import {database,now,type Room} from './server';

export const RECORD_PLAYBACK_SQL="INSERT INTO postgame_playback(room_id,track_id,started_at,last_seen) SELECT g.id,t.id,?,? FROM rooms g JOIN rounds t ON t.room_id=g.id WHERE g.id=? AND g.phase='FINISHED' AND t.id=? AND t.status='CLOSED' ON CONFLICT(room_id) DO UPDATE SET track_id=excluded.track_id,started_at=CASE WHEN postgame_playback.track_id=excluded.track_id THEN postgame_playback.started_at ELSE excluded.started_at END,last_seen=excluded.last_seen WHERE excluded.last_seen>=postgame_playback.last_seen";
export const STOP_PLAYBACK_SQL="INSERT INTO postgame_playback(room_id,track_id,started_at,last_seen) SELECT id,NULL,?,? FROM rooms WHERE id=? AND phase='FINISHED' ON CONFLICT(room_id) DO UPDATE SET track_id=NULL,started_at=excluded.started_at,last_seen=excluded.last_seen WHERE excluded.last_seen>=postgame_playback.last_seen";
export const CURRENT_PLAYBACK_SQL="SELECT p.track_id AS id,p.started_at AS startedAt FROM postgame_playback p JOIN rooms g ON g.id=p.room_id JOIN rounds t ON t.id=p.track_id AND t.room_id=g.id WHERE p.room_id=? AND g.phase='FINISHED' AND t.status='CLOSED' AND p.last_seen>?";

export async function recordPlayback(room:Room,track:unknown,audioReady:boolean,stamp=now()){
 const db=database();
 if(audioReady&&typeof track==='string'&&room.phase==='FINISHED'){
  await db.prepare(RECORD_PLAYBACK_SQL).bind(stamp,stamp,room.id,track).run();
 }else await db.prepare(STOP_PLAYBACK_SQL).bind(stamp,stamp,room.id).run();
}
export async function currentPlayback(room:Room){
 return room.phase==='FINISHED'?database().prepare(CURRENT_PLAYBACK_SQL).bind(room.id,now()-5000).first<{id:string,startedAt:number}>():null;
}
