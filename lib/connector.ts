import {PREPARED_CLIPS,RESERVE_CLIPS} from "./game-settings";
import {replenishWarmPool} from './warm';
import { env } from 'cloudflare:workers';
import { database,Failure,hash,now,token,response,type Room } from './server';
import type {Option} from './game';
export async function bytes(req:Request,max:number){const reader=req.body?.getReader();if(!reader)throw new Failure(400,'Body required');const chunks:Uint8Array[]=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Failure(413,'Upload exceeds bound')}chunks.push(value)}const out=new Uint8Array(size);let at=0;for(const chunk of chunks){out.set(chunk,at);at+=chunk.length}return out}
export async function jsonBody(req:Request){const body=JSON.parse(new TextDecoder().decode(await bytes(req,65536)));if(!body||typeof body!=='object'||Array.isArray(body))throw new Failure(400,'Object required');return body as Record<string,unknown>}
export async function prepare(r:Room,retry=false){
 const db=database();if(!['LOBBY','PAUSED'].includes(r.phase))throw new Failure(409,'Prepare in the lobby or paused recovery');
 const active=await db.prepare("SELECT id,status FROM jobs WHERE room_id=? AND status IN ('PENDING','LEASED','FAILED') ORDER BY created_at DESC LIMIT 1").bind(r.id).first<{id:string,status:string}>();
 if(active){if(active.status==='FAILED'&&retry)await db.prepare("UPDATE jobs SET status='PENDING',error=NULL WHERE id=?").bind(active.id).run();return active}
 const remaining=await db.prepare("SELECT count(*) AS n,COALESCE(MAX(number),0) AS last FROM rounds WHERE room_id=?").bind(r.id).first<{n:number,last:number}>();
 if(r.phase==='LOBBY'&&remaining?.n){const complete=await db.prepare("SELECT id,status FROM jobs WHERE room_id=? AND status='COMPLETE' ORDER BY created_at DESC LIMIT 1").bind(r.id).first();if(complete)return complete}
 const available=await db.prepare("SELECT count(*) AS n FROM rounds WHERE room_id=? AND status='READY'").bind(r.id).first<{n:number}>();if(r.phase==='PAUSED'&&available?.n)return {status:'AVAILABLE'};
 const id=crypto.randomUUID(),startSlot=(remaining?.last??0)+1,count=r.phase==='LOBBY'?PREPARED_CLIPS:RESERVE_CLIPS;
 await db.prepare("INSERT INTO jobs(id,room_id,status,progress,created_at,start_slot,clip_count) SELECT ?,?,'PENDING',0,?,?,? WHERE NOT EXISTS(SELECT 1 FROM jobs WHERE room_id=? AND status IN ('PENDING','LEASED'))").bind(id,r.id,now(),startSlot,count,r.id).run();return {id,status:'PENDING'};
}
export async function connector(req:Request,path:string[]){
 const secret=env.CONNECTOR_SECRET;if(!secret||await hash(req.headers.get('authorization')??'')!==await hash('Bearer '+secret))throw new Failure(401,'Connector authorization required');
 const db=database(),stamp=now();
 if(path.join('/')==='connector/state'&&req.method==='GET'){
  const jobs=await db.prepare("SELECT status,count(*) AS count FROM jobs WHERE status IN ('PENDING','LEASED') AND (status<>'LEASED' OR lease_until>?) GROUP BY status").bind(stamp).all();return response({jobs:jobs.results});
 }
 if(path.join('/')==='connector/covers/pending'&&req.method==='POST'){
  const covers=await db.prepare("SELECT r.id,r.number AS slot,j.id AS jobId FROM rounds r JOIN rooms g ON g.id=r.room_id JOIN jobs j ON j.room_id=r.room_id AND r.number>=j.start_slot AND r.number<j.start_slot+j.clip_count WHERE r.artwork_status='PENDING' AND r.status IN ('READY','OPEN','CLOSED') AND j.status<>'CLEANED' AND g.expires_at>? AND g.phase<>'CANCELLED' ORDER BY CASE WHEN g.phase='FINISHED' THEN 0 WHEN g.phase IN ('LOBBY','PLAYING','REVEAL') THEN 1 ELSE 2 END,g.last_activity DESC,j.created_at,r.number LIMIT 12").bind(stamp).all();return response({covers:covers.results});
 }
 if(path[1]==='covers'&&path[2]&&req.method==='POST'){
  const round=await db.prepare("SELECT r.id,r.room_id,r.artwork_status FROM rounds r JOIN rooms g ON g.id=r.room_id WHERE r.id=? AND g.expires_at>? AND g.phase<>'CANCELLED'").bind(path[2],stamp).first<{id:string,room_id:string,artwork_status:string}>();
  if(!round)throw new Failure(404,'Artwork request unavailable');if(round.artwork_status==='READY')return response({ok:true});
  if(req.headers.get('content-type')?.startsWith('application/json')){const body=await jsonBody(req);if(body.missing!==true)throw new Failure(400,'Artwork result required');await db.prepare("UPDATE rounds SET artwork_status='MISSING' WHERE id=? AND artwork_status<>'READY'").bind(round.id).run();return response({ok:true})}
  if(!env.BUCKET||req.headers.get('content-type')!=='image/jpeg')throw new Failure(400,'JPEG artwork required');const data=await bytes(req,524288);if(data.length<100||data[0]!==255||data[1]!==216||data[2]!==255)throw new Failure(400,'Invalid JPEG artwork');
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(b=>b.toString(16).padStart(2,'0')).join('');if(sha!==req.headers.get('x-content-sha256'))throw new Failure(400,'Artwork checksum mismatch');
  const key=`rooms/${round.room_id}/artwork/${round.id}.jpg`;await env.BUCKET.put(key,data,{httpMetadata:{contentType:'image/jpeg'},customMetadata:{sha256:sha}});await db.prepare("UPDATE rounds SET artwork_key=?,artwork_status='READY' WHERE id=?").bind(key,round.id).run();return response({ok:true});
 }
 if(path.join('/')==='connector/sound-check'&&req.method==='GET'){
  const object=await env.BUCKET?.get('sounds/speaker-check.mp3');if(!object)throw new Failure(404,'Sound check unavailable');
  const data=await object.arrayBuffer();const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('');return response({bytes:data.byteLength,sha256});
 }
 if(path.join('/')==='connector/sound-check'&&req.method==='POST'){
  if(!env.BUCKET)throw new Failure(503,'Storage unavailable');
  const data=await bytes(req,524288);if(data.length<1000)throw new Failure(400,'Sound check clip too small');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==req.headers.get('x-content-sha256'))throw new Failure(400,'Sound check checksum mismatch');
  await env.BUCKET.put('sounds/speaker-check.mp3',data,{httpMetadata:{contentType:'audio/mpeg'},customMetadata:{sha256:digest}});return response({ok:true});
 }

 if(path.join('/')==='connector/claim'&&req.method==='POST'){
  await replenishWarmPool();
  const job=await db.prepare("SELECT j.id,j.room_id,j.start_slot,j.clip_count FROM jobs j JOIN rooms r ON r.id=j.room_id WHERE r.expires_at>? AND r.phase IN ('LOBBY','PAUSED','WARMING') AND (j.status='PENDING' OR (j.status='LEASED' AND j.lease_until<?)) ORDER BY CASE WHEN r.phase='WARMING' THEN 1 ELSE 0 END,j.created_at LIMIT 1").bind(stamp,stamp).first<{id:string,room_id:string,start_slot:number,clip_count:number}>();if(!job)return response({job:null});
  const prior=await db.prepare('SELECT options_json,correct_option_id FROM rounds WHERE room_id=? AND number<?').bind(job.room_id,job.start_slot).all<{options_json:string,correct_option_id:string}>();const excluded=prior.results.map(r=>(JSON.parse(r.options_json) as Option[]).find(o=>o.id===r.correct_option_id)).filter(Boolean);const lease=token();const result=await db.prepare("UPDATE jobs SET status='LEASED',lease_until=?,lease_hash=? WHERE id=? AND (status='PENDING' OR (status='LEASED' AND lease_until<?))").bind(stamp+1800000,await hash(lease),job.id,stamp).run();return response({job:result.meta.changes?{id:job.id,roomId:job.room_id,lease,startSlot:job.start_slot,count:job.clip_count,excluded}:null});
 }
 if(path.join('/')==='connector/cleanup'&&req.method==='POST'){
  if(!env.BUCKET)throw new Failure(503,'Storage unavailable');const expired=await db.prepare("SELECT id FROM rooms WHERE (expires_at<=? OR phase='CANCELLED') AND EXISTS(SELECT 1 FROM jobs WHERE room_id=rooms.id AND status<>'CLEANED') LIMIT 20").bind(stamp).all<{id:string}>();let deleted=0;
  for(const r of expired.results){const list=await env.BUCKET.list({prefix:`rooms/${r.id}/`,limit:100});if(list.objects.length){await env.BUCKET.delete(list.objects.map(o=>o.key));deleted+=list.objects.length}if(!list.truncated)await db.prepare("UPDATE jobs SET status='CLEANED' WHERE room_id=?").bind(r.id).run();await db.prepare("UPDATE rooms SET active_key=NULL,phase=CASE WHEN phase='FINISHED' THEN 'FINISHED' ELSE 'CANCELLED' END WHERE id=?").bind(r.id).run()}const purge=await db.prepare("SELECT id FROM rooms WHERE expires_at<=? AND phase IN ('FINISHED','CANCELLED') AND NOT EXISTS(SELECT 1 FROM jobs WHERE room_id=rooms.id AND status<>'CLEANED') LIMIT 20").bind(stamp).all<{id:string}>();for(const r of purge.results){await db.batch([db.prepare('DELETE FROM attempts WHERE round_id IN (SELECT id FROM rounds WHERE room_id=?)').bind(r.id),db.prepare('DELETE FROM rounds WHERE room_id=?').bind(r.id),db.prepare('DELETE FROM sessions WHERE room_id=?').bind(r.id),db.prepare('DELETE FROM display_pairs WHERE room_id=?').bind(r.id),db.prepare('DELETE FROM jobs WHERE room_id=?').bind(r.id),db.prepare('DELETE FROM players WHERE room_id=?').bind(r.id),db.prepare('DELETE FROM rooms WHERE id=?').bind(r.id)])}await db.prepare('DELETE FROM limits WHERE window<?').bind(Math.floor(stamp/60000)-5).run();return response({deleted});
 }
 const jobId=path[2];const job=await db.prepare("SELECT j.* FROM jobs j JOIN rooms r ON r.id=j.room_id WHERE j.id=? AND j.status='LEASED' AND j.lease_until>? AND r.expires_at>? AND r.phase IN ('LOBBY','PAUSED','WARMING')").bind(jobId,stamp,stamp).first<{id:string,room_id:string,lease_hash:string,start_slot:number,clip_count:number}>();if(!job||await hash(req.headers.get('x-job-lease')??'')!==job.lease_hash)throw new Failure(409,'Preparation lease expired');
 if(path[3]==='question'&&req.method==='POST'){
  const body=await jsonBody(req),slot=Number(body.slot),options=body.options as Option[],correct=String(body.correctOptionId??''),sha=String(body.sha256??'');
  if(!Number.isInteger(slot)||slot<job.start_slot||slot>=job.start_slot+job.clip_count||!Array.isArray(options)||options.length!==4||! /^[a-f0-9]{64}$/.test(sha))throw new Failure(400,'Invalid question');
  for(const o of options)if(!o||! /^[a-zA-Z0-9-]{1,64}$/.test(o.id)||typeof o.title!=='string'||typeof o.artist!=='string'||!o.title.trim()||!o.artist.trim()||o.title.length>300||o.artist.length>300)throw new Failure(400,'Invalid choice');
  const label=(o:Option)=>JSON.stringify([o.artist.normalize('NFKC').toLowerCase(),o.title.normalize('NFKC').toLowerCase()]);
  if(new Set(options.map(o=>o.id)).size!==4||new Set(options.map(label)).size!==4||!options.some(o=>o.id===correct))throw new Failure(400,'Choices must be distinct');
  const correctLabel=label(options.find(o=>o.id===correct)!);const previous=await db.prepare('SELECT options_json,correct_option_id,number FROM rounds WHERE room_id=?').bind(job.room_id).all<{options_json:string,correct_option_id:string,number:number}>();for(const row of previous.results)if(row.number!==slot){const option=(JSON.parse(row.options_json) as Option[]).find(o=>o.id===row.correct_option_id);if(option&&label(option)===correctLabel)throw new Failure(400,'Repeated song')}
  const old=await db.prepare('SELECT id,options_json,correct_option_id,clip_sha FROM rounds WHERE room_id=? AND number=?').bind(job.room_id,slot).first<{id:string,options_json:string,correct_option_id:string,clip_sha:string}>();if(old){if(old.options_json!==JSON.stringify(options)||old.correct_option_id!==correct||old.clip_sha!==sha)throw new Failure(409,'Question retry does not match');return response({id:old.id})}
  const id=crypto.randomUUID();await db.prepare("INSERT INTO rounds(id,room_id,number,status,options_json,correct_option_id,clip_key,clip_sha) VALUES(?,?,?,'UPLOADING',?,?,?,?)").bind(id,job.room_id,slot,JSON.stringify(options),correct,`rooms/${job.room_id}/${job.id}/${slot}.mp3`,sha).run();return response({id});
 }
 if(path[3]==='clip'&&req.method==='POST'){
  const slot=Number(path[4]);if(!Number.isInteger(slot)||slot<job.start_slot||slot>=job.start_slot+job.clip_count)throw new Failure(400,'Clip outside job range');const round=await db.prepare('SELECT id,clip_key,clip_sha FROM rounds WHERE room_id=? AND number=?').bind(job.room_id,slot).first<{id:string,clip_key:string,clip_sha:string}>();if(!round||!env.BUCKET)throw new Failure(404,'Question not registered');const data=await bytes(req,2097152);if(data.length<1000)throw new Failure(400,'Clip too small');const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('');if(sha!==round.clip_sha)throw new Failure(400,'Clip checksum mismatch');
  await env.BUCKET.put(round.clip_key,data,{httpMetadata:{contentType:'audio/mpeg'},customMetadata:{sha256:sha}});await db.batch([db.prepare("UPDATE rounds SET status='READY' WHERE id=? AND status='UPLOADING'").bind(round.id),db.prepare("UPDATE jobs SET progress=(SELECT count(*) FROM rounds WHERE room_id=? AND status='READY' AND number>=? AND number<?),lease_until=? WHERE id=?").bind(job.room_id,job.start_slot,job.start_slot+job.clip_count,stamp+1800000,job.id),db.prepare('UPDATE rooms SET revision=revision+1 WHERE id=?').bind(job.room_id)]);return response({ok:true});
 }
 if(path[3]==='finish'&&req.method==='POST'){const count=await db.prepare("SELECT count(*) AS n FROM rounds WHERE room_id=? AND status='READY' AND number>=? AND number<?").bind(job.room_id,job.start_slot,job.start_slot+job.clip_count).first<{n:number}>();if(count?.n!==job.clip_count)throw new Failure(409,'All requested verified clips are required');await db.batch([db.prepare("UPDATE jobs SET status='COMPLETE',progress=clip_count WHERE id=?").bind(job.id),db.prepare("UPDATE rooms SET phase='WARM_READY',expires_at=?,revision=revision+1 WHERE id=? AND phase='WARMING'").bind(stamp+86400000,job.room_id)]);return response({ok:true})}
 if(path[3]==='fail'&&req.method==='POST'){await db.batch([db.prepare("UPDATE jobs SET status='FAILED',error='Music preparation failed; check the connector' WHERE id=?").bind(job.id),db.prepare("UPDATE rooms SET phase='CANCELLED',expires_at=? WHERE id=? AND phase='WARMING'").bind(stamp,job.room_id)]);return response({ok:true})}
 throw new Failure(404,'Unknown connector operation');
}
