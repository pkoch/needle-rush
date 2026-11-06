"""Local-only full protocol test. Binary fixture tests uploads, not audio decoding."""
import concurrent.futures
import hashlib
import http.client
import json
import threading
import time
import uuid
BASE='http://127.0.0.1:5173'
SECRET='local-integration-fixture-not-a-production-secret'
def req(path,body=None,cookie='',expected=200,lease=None,connector=False,content_type=None):
    conn=http.client.HTTPConnection('127.0.0.1',5173,timeout=30)
    headers={'Origin':BASE,'Content-Type':'application/json'}
    if cookie:headers['Cookie']=cookie
    if connector:headers['Authorization']='Bearer '+SECRET
    if lease:headers['X-Job-Lease']=lease
    if isinstance(body,bytes):
        headers['Content-Type']=content_type or 'audio/mpeg';data=body
        if content_type=='image/jpeg':headers['X-Content-SHA256']=hashlib.sha256(body).hexdigest()
    else:data=json.dumps(body).encode() if body is not None else None
    conn.request('POST' if body is not None else 'GET',path,data,headers)
    r=conn.getresponse();raw=r.read();cookies='; '.join(v.split(';')[0] for k,v in r.getheaders() if k.lower()=='set-cookie');status=r.status;conn.close()
    if expected is not None:assert status==expected,(path,status,raw[:250])
    return json.loads(raw) if raw else {},cookies,status
_,owner,_=req('/signin-with-chatgpt?return_to=/host',expected=302)
r,_,_=req('/api/rooms',{},owner);code=r['code'];prefix='/api/rooms/'+code
old,_,_=req(prefix+'?role=owner',cookie=owner)
if old['phase']!='LOBBY' or old['players']:
 req(prefix+'/cancel',{},owner);r,_,_=req('/api/rooms',{},owner);code=r['code'];prefix='/api/rooms/'+code
players=[]
for i in range(16):
 p,c,_=req('/api/join',{'code':code,'name':f'M{i} '+uuid.uuid4().hex[:4]});players.append((p['playerId'],c))
display=owner
req('/api/connector/claim',{},expected=401)
req(prefix+'/prepare',{},owner)
result,_,_=req('/api/connector/claim',{},connector=True);job=result['job'];assert job
jobpath='/api/connector/jobs/'+job['id'];lease=job['lease']
fixture=b'upload-protocol-fixture-not-audio'*100;sha=hashlib.sha256(fixture).hexdigest()
for slot in range(1,job['count']+1):
 q={'slot':slot,'options':[{'id':str(i),'title':f'Fixture {slot}-{i}','artist':f'Artist {i}'} for i in range(4)],'correctOptionId':'0','sha256':sha}
 req(jobpath+'/question',q,lease=lease,connector=True)
 if slot==1:req(jobpath+'/clip/1',b'bad'*500,expected=400,lease=lease,connector=True)
 req(jobpath+'/clip/'+str(slot),fixture,lease=lease,connector=True)
req(jobpath+'/finish',{},lease=lease,connector=True)
stop=threading.Event();failures=[]
def heartbeat():
 while not stop.is_set():
  try:req(prefix+'/heartbeat',{'audioReady':True},display)
  except Exception as e:failures.append(str(e))
  stop.wait(1)
beat=threading.Thread(target=heartbeat,daemon=True);beat.start();time.sleep(.15)
req(prefix+'/start',{},owner)
finished=False
try:
 for number in range(1,11):
  deadline=time.monotonic()+15
  while True:
   state,_,_=req(prefix+'?role=display',cookie=display)
   if state['phase']=='PREPARING' and state['round']:break
   assert time.monotonic()<deadline,('preparing timeout',state)
   time.sleep(.2)
  round_id=state['round']['id'];assert 'correctOptionId' not in state['round'];assert 'postgameSongs' not in state
  req(prefix+'/clip',cookie=players[0][1],expected=401)
  # Clip endpoint returns bytes, so inspect via separate connection.
  conn=http.client.HTTPConnection('127.0.0.1',5173);conn.request('GET',prefix+'/clip',headers={'Cookie':display});res=conn.getresponse();assert res.status==200;assert res.read()==fixture;conn.close()
  req(prefix+'/ready',{'roundId':round_id},display)
  state,_,_=req(prefix+'?role=display',cookie=display)
  if number==1:req(prefix+'/answer',{'roundId':round_id,'optionId':'0'},players[0][1],expected=409)
  time.sleep(max(0,(state['round']['opensAt']-time.time()*1000)/1000)+.04)
  req(prefix+'/skip',{'roundId':round_id},players[1][1])
  req(prefix+'/answer',{'roundId':round_id,'optionId':'1'},players[2][1])
  if number==1:
   candidates=[p for i,p in enumerate(players) if i not in (1,2)]
   def guess(p):return req(prefix+'/answer',{'roundId':round_id,'optionId':'0'},p[1],expected=None)[2]
   with concurrent.futures.ThreadPoolExecutor(max_workers=15) as pool:statuses=list(pool.map(guess,candidates))
   assert statuses.count(200)==14,statuses
  else:
   for i,p in enumerate(players):
    if i not in (1,2):req(prefix+'/answer',{'roundId':round_id,'optionId':'0'},p[1])
  state,_,_=req(prefix+'?role=owner',cookie=owner)
  late=next(p for i,p in enumerate(players) if i not in (1,2) and p[0]!=state['round']['winnerId'])
  if number==1:
   retry,_,_=req(prefix+'/answer',{'roundId':round_id,'optionId':'1'},late[1]);assert retry['accepted']
  assert state['phase']=='REVEAL' and state['scoredRounds']==number,state
  assert sum(p['score'] for p in state['players'])==12*number,state
  assert next(p['score'] for p in state['players'] if p['id']==players[2][0])==-3*number
  assert next(p['score'] for p in state['players'] if p['id']==players[1][0])==-1*number
  print(f'Round {number}/10: first +3, others +1, wrong −3, skip −1 and all-player reveal verified',flush=True)
  time.sleep(1.6)
 state,_,_=req(prefix+'?role=owner',cookie=owner)
 assert state['phase']=='FINISHED' and state['scoredRounds']==10,state
 assert len(state['postgameTracks'])==10
 assert len(state['postgameSongs'])==10
 track=state['postgameTracks'][0]
 jpeg=b'\xff\xd8\xff'+b'artwork-fixture'*20
 req('/api/connector/covers/'+track,jpeg,connector=True,content_type='image/jpeg')
 req(prefix+'/heartbeat',{'audioReady':True,'postgameTrackId':track},owner)
 for identity in (owner,players[0][1]):
  snapshot,_,_=req(prefix+('?role=owner' if identity==owner else '?role=player'),cookie=identity)
  assert snapshot['nowPlaying']['id']==track
  assert len(snapshot['postgameSongs'])==10 and snapshot['postgameSongs'][0]['artworkUrl']
  for song in snapshot['postgameSongs']:
   results={result['playerId']:result for result in song['results']}
   assert len(results)==16
   assert results[players[1][0]]['outcome']=='skipped'
   assert results[players[2][0]]['outcome']=='wrong'
   assert all(result['outcome']=='correct' for pid,result in results.items() if pid not in (players[1][0],players[2][0]))
   assert all(result['name'].startswith('M') for result in results.values())
  conn=http.client.HTTPConnection('127.0.0.1',5173);conn.request('GET',prefix+'/album-art?roundId='+track,headers={'Cookie':identity});image=conn.getresponse();assert image.status==200 and image.read()==jpeg;conn.close()
 req(prefix+'/album-art?roundId='+track,expected=401)
 req(prefix+'/heartbeat',{'audioReady':True,'postgameTrackId':None},owner)
 stopped,_,_=req(prefix+'?role=player',cookie=players[0][1]);assert stopped['nowPlaying'] is None
 def check_afterparty():
  conn=http.client.HTTPConnection('127.0.0.1',5173);conn.request('GET',prefix+'/afterparty-clip?roundId='+track,headers={'Cookie':owner});response=conn.getresponse();assert response.status==200;assert response.read()==fixture;conn.close()
 req(prefix+'/afterparty-clip?roundId='+track,cookie=players[0][1],expected=401)
 check_afterparty();req('/api/connector/cleanup',{},connector=True);check_afterparty()
 req(prefix+'/clip',cookie=display,expected=404)
 req(prefix+'/cancel',{},owner);cleaned,_,_=req('/api/connector/cleanup',{},connector=True);assert cleaned['deleted']>=job['count']
 req(prefix+'/afterparty-clip?roundId='+track,cookie=owner,expected=404)
 finished=True
 print('Full 10-round, 16-player HTTP match with private post-game clip retention and cancellation cleanup passed.',flush=True)
 assert not failures,failures
finally:
 stop.set();beat.join(3)
 if not finished:req(prefix+'/cancel',{},owner)
