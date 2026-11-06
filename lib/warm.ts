import {PREPARED_CLIPS} from "./game-settings";
import {database,now,roomCode} from './server';

export const WARM_POOL_SIZE=2;
const WARM_TTL=24*60*60*1000;

/** Called only by the authenticated connector, never by public visitors. */
export async function replenishWarmPool(){
 const db=database(),stamp=now(),id=crypto.randomUUID(),jobId=crypto.randomUUID();
 await db.batch([
  db.prepare("INSERT INTO rooms(id,code,owner_id,phase,active_key,revision,scored_rounds,last_activity,expires_at,created_at) SELECT ?,?,'__warm_pool__','WARMING',NULL,0,0,?,?,? WHERE (SELECT count(*) FROM rooms WHERE phase IN ('WARMING','WARM_READY') AND expires_at>?)<?").bind(id,roomCode(),stamp,stamp+WARM_TTL,stamp,stamp,WARM_POOL_SIZE),
  db.prepare("INSERT INTO jobs(id,room_id,status,progress,created_at,start_slot,clip_count) SELECT ?,?,'PENDING',0,?,1,? WHERE EXISTS(SELECT 1 FROM rooms WHERE id=? AND phase='WARMING')").bind(jobId,id,stamp,PREPARED_CLIPS,id)
 ]);
}

/** Atomic one-consumer allocation. A cold pool may supply an in-progress pack. */
export async function claimWarmRoom(ownerId:string){
 const stamp=now(),code=roomCode();
 return database().prepare("UPDATE rooms SET owner_id=?,code=?,phase='LOBBY',active_key=1,last_activity=?,expires_at=?,revision=revision+1 WHERE id=(SELECT id FROM rooms WHERE phase IN ('WARM_READY','WARMING') AND expires_at>? ORDER BY CASE WHEN phase='WARM_READY' THEN 0 ELSE 1 END,created_at LIMIT 1) AND phase IN ('WARM_READY','WARMING') AND NOT EXISTS(SELECT 1 FROM rooms WHERE active_key=1) RETURNING code").bind(ownerId,code,stamp,stamp+7200000,stamp).first<{code:string}>();
}
