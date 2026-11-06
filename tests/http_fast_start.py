"""Isolated warm-pool HTTP proof. Protocol fixtures, no live library or Site writes."""
import hashlib
import http.client
import json
import os
import time
PORT=int(os.environ.get('NEEDLE_TEST_PORT','5174'))
BASE=f'http://127.0.0.1:{PORT}'
def req(path,body=None,cookie='',connector=False,lease=None):
 c=http.client.HTTPConnection('127.0.0.1',PORT,timeout=30);h={'Origin':BASE,'Content-Type':'application/json'}
 if cookie:h['Cookie']=cookie
 if connector:h['Authorization']='Bearer local-integration-fixture-not-a-production-secret'
 if lease:h['X-Job-Lease']=lease
 c.request('POST' if body is not None else 'GET',path,body if isinstance(body,bytes) else json.dumps(body).encode() if body is not None else None,h)
 r=c.getresponse();raw=r.read();cookie='; '.join(v.split(';')[0] for k,v in r.getheaders() if k.lower()=='set-cookie');status=r.status;c.close();assert status in (200,302),(path,status,raw[:250]);return (json.loads(raw) if raw else {}),cookie
# Connector fills a private, unallocated game before any host opens a room.
r,_=req('/api/connector/claim',{},connector=True);job=r['job'];assert job
fixture=b'private-warm-fixture'*100;sha=hashlib.sha256(fixture).hexdigest()
for slot in range(1,job['count']+1):
 q={'slot':slot,'options':[{'id':str(i),'title':f'Warm fixture {slot}-{i}','artist':f'Artist {i}'} for i in range(4)],'correctOptionId':'0','sha256':sha}
 req(f"/api/connector/jobs/{job['id']}/question",q,connector=True,lease=job['lease'])
 req(f"/api/connector/jobs/{job['id']}/clip/{slot}",fixture,connector=True,lease=job['lease'])
req(f"/api/connector/jobs/{job['id']}/finish",{},connector=True,lease=job['lease'])
_,owner=req('/signin-with-chatgpt?return_to=/host')
started=time.perf_counter();r,_=req('/api/rooms',{},owner);elapsed=time.perf_counter()-started;code=r['code']
s,_=req('/api/rooms/'+code+'?role=owner',cookie=owner)
assert s['phase']=='LOBBY' and s['preparation']['status']=='COMPLETE' and s['preparation']['progress']==12,s
assert elapsed<1.5,elapsed
req('/api/rooms/'+code+'/cancel',{},owner)
# With no spare ready pack, room creation still queues its own preparation automatically.
r,_=req('/api/rooms',{},owner);second=r['code'];assert second!=code
s,_=req('/api/rooms/'+second+'?role=owner',cookie=owner)
assert s['preparation']['status']=='PENDING',s
req('/api/rooms/'+second+'/cancel',{},owner)
req('/api/connector/cleanup',{},connector=True)
print(json.dumps({'warm_room_assignment_ms':round(elapsed*1000,1),'clips_ready_immediately':12,'manual_prepare_requests':0,'cold_fallback_auto_queued':True}))
