"""Loopback-only integration checks; requires a seeded local_seedy owner."""
import http.client
import json
import uuid
BASE='http://127.0.0.1:5173'
def req(path,body=None,cookie=None,expected=200):
    conn=http.client.HTTPConnection('127.0.0.1',5173,timeout=30)
    headers={'Origin':BASE,'Content-Type':'application/json'}
    if cookie:headers['Cookie']=cookie
    conn.request('POST' if body is not None else 'GET',path,json.dumps(body) if body is not None else None,headers)
    r=conn.getresponse();raw=r.read();cookies=[v.split(';')[0] for k,v in r.getheaders() if k.lower()=='set-cookie'];status=r.status;conn.close()
    assert status==expected,(path,status,raw[:300])
    return (json.loads(raw) if raw and raw[:1] in (b'{',b'[') else None),'; '.join(cookies)
_,host=req('/signin-with-chatgpt?return_to=/host',expected=302)
assert host,'Mock sign-in did not issue a cookie'
r,_=req('/api/rooms',{},host);code=r['code']
_,_=req('/api/rooms/'+code+'?role=owner',cookie=host)
_,_=req('/api/rooms/'+code+'?role=owner',expected=401)
suffix=uuid.uuid4().hex[:5]
a,player=req('/api/join',{'code':code,'name':'Player '+suffix})
assert 'nr_player=' in player
s,_=req('/api/rooms/'+code,cookie=player);assert s['playerId']==a['playerId']
req('/api/rooms/'+code+'/start',{},player,409)
for action in ('pause','resume','cancel','heartbeat','ready','preloaded'):
 req('/api/rooms/'+code+'/'+action,{},player,401)
req('/api/rooms/'+code+'?role=owner',cookie=player,expected=401)
req('/api/rooms/'+code+'?role=display',cookie=player,expected=401)
req('/api/rooms/'+code+'/clip',cookie=player,expected=401)
req('/api/rooms/'+code+'/sound-check',cookie=player,expected=401)
req('/api/rooms/'+code+'/heartbeat',{'audioReady':True},host)
req('/api/rooms/'+code+'/cancel',{},host)
print('HTTP authenticated TV owner, guest player sessions, control and music authorization checks passed.')
