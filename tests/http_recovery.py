"""Real loopback HTTP replacement-job recovery without consuming scored rounds."""
import hashlib
import http.client
import json
import subprocess
from pathlib import Path
BASE='http://127.0.0.1:5173'
def req(path,body=None,cookie='',connector=False,lease=None):
 c=http.client.HTTPConnection('127.0.0.1',5173,timeout=30);h={'Origin':BASE,'Content-Type':'application/json'}
 if cookie:h['Cookie']=cookie
 if connector:h['Authorization']='Bearer local-integration-fixture-not-a-production-secret'
 if lease:h['X-Job-Lease']=lease
 c.request('POST' if body is not None else 'GET',path,body if isinstance(body,bytes) else json.dumps(body).encode() if body is not None else None,h);r=c.getresponse();raw=r.read();cookies='; '.join(v.split(';')[0] for k,v in r.getheaders() if k.lower()=='set-cookie');status=r.status;c.close();assert status in (200,302),(path,status,raw[:200]);return (json.loads(raw) if raw else {}),cookies
_,owner=req('/signin-with-chatgpt?return_to=/host');r,_=req('/api/rooms',{},owner);code=r['code'];prefix='/api/rooms/'+code
# Only the local test database is changed: make every existing round unavailable.
root=Path(__file__).resolve().parents[1]
command=f"UPDATE rooms SET phase='PAUSED',scored_rounds=0,current_round_id=NULL WHERE code='{code}'; UPDATE rounds SET status='VOID' WHERE room_id=(SELECT id FROM rooms WHERE code='{code}'); UPDATE jobs SET status='COMPLETE' WHERE room_id=(SELECT id FROM rooms WHERE code='{code}');"
subprocess.run(['node','node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',command],cwd=root,check=True,stdout=subprocess.DEVNULL)
s,_=req(prefix+'?role=owner',cookie=owner);assert s['phase']=='PAUSED' and s['scoredRounds']==0
r,_=req('/api/connector/claim',{},connector=True);job=r['job'];assert job and job['count']==2
clip=b'recovery-fixture'*100
for slot in range(job['startSlot'],job['startSlot']+2):
 q={'slot':slot,'options':[{'id':str(i),'title':f'Recovery {slot}-{i}','artist':f'Artist {i}'} for i in range(4)],'correctOptionId':'0','sha256':hashlib.sha256(clip).hexdigest()}
 req(f"/api/connector/jobs/{job['id']}/question",q,connector=True,lease=job['lease'])
 req(f"/api/connector/jobs/{job['id']}/clip/{slot}",clip,connector=True,lease=job['lease'])
req(f"/api/connector/jobs/{job['id']}/finish",{},connector=True,lease=job['lease'])
req(prefix+'/resume',{},owner)
s,_=req(prefix+'?role=owner',cookie=owner);assert s['phase']=='PREPARING' and s['round'] and s['scoredRounds']==0
req(prefix+'/cancel',{},owner)
clean,_=req('/api/connector/cleanup',{},connector=True);assert clean['deleted']>=2
again,_=req('/api/connector/cleanup',{},connector=True);assert again['deleted']==0
print('Exhausted reserve HTTP recovery prepared two replacement clips and resumed without consuming a round.')
