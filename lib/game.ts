import {GAME_ROUNDS} from "./game-settings";
import { database,Failure,now,type Room } from './server';
export type Option={id:string,title:string,artist:string};
export type Round={id:string,room_id:string,number:number,status:string,options_json:string,correct_option_id:string,clip_key:string,opens_at:number|null,closes_at:number|null,winner_id:string|null};
export async function current(r:Room){return r.current_round_id?database().prepare('SELECT * FROM rounds WHERE id=? AND room_id=?').bind(r.current_round_id,r.id).first<Round>():null}
export const ANSWER_SQL="INSERT INTO attempts(id,round_id,player_id,option_id,correct,accepted_at) SELECT ?,r.id,p.id,?,CASE WHEN r.correct_option_id=? THEN 1 ELSE 0 END,? FROM rounds r JOIN rooms g ON g.id=r.room_id JOIN players p ON p.room_id=g.id WHERE r.id=? AND p.id=? AND g.current_round_id=r.id AND g.phase IN ('COUNTDOWN','PLAYING') AND r.status='OPEN' AND r.opens_at<=? AND g.expires_at>? AND NOT EXISTS(SELECT 1 FROM attempts WHERE round_id=r.id AND player_id=p.id)";
export async function answer(r:Room,player:string,roundId:string,optionId:string,skip=false){
 const db=database(),stamp=now();const round=await current(r);if(!round||round.id!==roundId)throw new Failure(409,'This round has ended');
 const prior=await db.prepare('SELECT correct,option_id FROM attempts WHERE round_id=? AND player_id=?').bind(roundId,player).first();if(prior)return prior;
 const options=JSON.parse(round.options_json) as Option[];if(skip)optionId='__skip__';if(!skip&&!options.some(o=>o.id===optionId))throw new Failure(400,'Invalid option');
 const id=crypto.randomUUID();await db.batch([
 db.prepare(ANSWER_SQL).bind(id,optionId,optionId,stamp,roundId,player,stamp,stamp),
 db.prepare("UPDATE rounds SET winner_id=? WHERE id=? AND status='OPEN' AND winner_id IS NULL AND EXISTS(SELECT 1 FROM attempts WHERE id=? AND correct=1)").bind(player,roundId,id),
 db.prepare("UPDATE rounds SET status='CLOSED',closes_at=? WHERE id=? AND status='OPEN' AND (SELECT count(*) FROM attempts WHERE round_id=?)=(SELECT count(*) FROM players WHERE room_id=?)").bind(stamp,roundId,roundId,r.id),
 db.prepare('UPDATE rooms SET revision=revision+1 WHERE id=? AND EXISTS(SELECT 1 FROM attempts WHERE id=?)').bind(r.id,id)
 ]);
 const result=await db.prepare('SELECT correct,option_id FROM attempts WHERE round_id=? AND player_id=?').bind(roundId,player).first();if(!result)throw new Failure(409,'Guessing is closed');await reconcile(r);return result;
}
export async function reconcile(r:Room){const db=database(),stamp=now();await db.batch([
 db.prepare("UPDATE rooms SET phase='REVEAL',deadline=(SELECT closes_at+1500 FROM rounds WHERE id=rooms.current_round_id),scored_rounds=scored_rounds+1,revision=revision+1 WHERE id=? AND phase IN ('COUNTDOWN','PLAYING') AND EXISTS(SELECT 1 FROM rounds WHERE id=rooms.current_round_id AND status='CLOSED')").bind(r.id),
 db.prepare("UPDATE rooms SET phase='PAUSED',revision=revision+1 WHERE id=? AND phase IN ('COUNTDOWN','PLAYING') AND EXISTS(SELECT 1 FROM rounds WHERE id=rooms.current_round_id AND status='VOID')").bind(r.id),
 db.prepare("UPDATE rooms SET phase='PLAYING',revision=revision+1 WHERE id=? AND phase='COUNTDOWN' AND EXISTS(SELECT 1 FROM rounds WHERE id=rooms.current_round_id AND opens_at<=?)").bind(r.id,stamp),
 db.prepare("UPDATE rooms SET phase='FINISHED',active_key=NULL,expires_at=?,revision=revision+1 WHERE id=? AND phase='REVEAL' AND deadline<=? AND scored_rounds>=?").bind(stamp+86400000,r.id,stamp,GAME_ROUNDS),
 db.prepare("UPDATE rooms SET phase='PAUSED',revision=revision+1 WHERE id=? AND phase='REVEAL' AND deadline<=? AND pause_requested=1").bind(r.id,stamp),
 db.prepare("UPDATE rounds SET status='OPEN',opens_at=(SELECT deadline+3000 FROM rooms WHERE id=?),closes_at=NULL WHERE id=(SELECT id FROM rounds WHERE room_id=? AND status='READY' ORDER BY number LIMIT 1) AND preloaded=1 AND EXISTS(SELECT 1 FROM rooms WHERE id=? AND phase='REVEAL' AND deadline<=? AND scored_rounds<?)").bind(r.id,r.id,r.id,stamp,GAME_ROUNDS),
 db.prepare("UPDATE rooms SET phase='COUNTDOWN',current_round_id=(SELECT id FROM rounds WHERE room_id=? AND status='OPEN' ORDER BY number LIMIT 1),revision=revision+1 WHERE id=? AND phase='REVEAL' AND deadline<=? AND scored_rounds<? AND EXISTS(SELECT 1 FROM rounds WHERE room_id=? AND status='OPEN')").bind(r.id,r.id,stamp,GAME_ROUNDS,r.id),
 db.prepare("UPDATE rooms SET phase='PREPARING',current_round_id=(SELECT id FROM rounds WHERE room_id=? AND status='READY' ORDER BY number LIMIT 1),revision=revision+1 WHERE id=? AND phase='REVEAL' AND deadline<=? AND scored_rounds<?").bind(r.id,r.id,stamp,GAME_ROUNDS)
 ]);}
export async function start(r:Room){if(['PREPARING','COUNTDOWN','PLAYING'].includes(r.phase))return;const db=database();const count=await db.prepare("SELECT count(*) AS n FROM rounds WHERE room_id=? AND status='READY'").bind(r.id).first<{n:number}>();if(!count||count.n<GAME_ROUNDS){const latest=await db.prepare('SELECT phase FROM rooms WHERE id=?').bind(r.id).first<{phase:string}>();if(latest&&['PREPARING','COUNTDOWN','PLAYING'].includes(latest.phase))return;throw new Failure(409,`Prepare ${GAME_ROUNDS} songs before starting`);}const result=await db.prepare("UPDATE rooms SET phase='PREPARING',current_round_id=(SELECT id FROM rounds WHERE room_id=? AND status='READY' ORDER BY number LIMIT 1),revision=revision+1 WHERE id=? AND phase='LOBBY' AND display_audio_ready=1 AND display_last_seen>? AND (SELECT count(*) FROM players WHERE room_id=?)>=2").bind(r.id,r.id,now()-5000,r.id).run();if(!result.meta.changes){const latest=await db.prepare('SELECT phase FROM rooms WHERE id=?').bind(r.id).first<{phase:string}>();if(latest&&['PREPARING','COUNTDOWN','PLAYING'].includes(latest.phase))return;throw new Failure(409,'Need two players and a sound-enabled display')}}
export async function ready(r:Room,roundId:string){const delay=3000;await database().batch([
 database().prepare('UPDATE rooms SET display_last_seen=? WHERE id=?').bind(now(),r.id),
 database().prepare("UPDATE rounds SET status='OPEN',opens_at=?,closes_at=NULL WHERE id=? AND room_id=? AND status='READY' AND EXISTS(SELECT 1 FROM rooms WHERE id=? AND phase='PREPARING' AND current_round_id=?)").bind(now()+delay,roundId,r.id,r.id,roundId),
 database().prepare("UPDATE rooms SET phase='COUNTDOWN',revision=revision+1 WHERE id=? AND phase='PREPARING' AND current_round_id=? AND EXISTS(SELECT 1 FROM rounds WHERE id=? AND status='OPEN')").bind(r.id,roundId,roundId)
 ])}
export async function scores(roomId:string){return (await database().prepare("SELECT p.id,p.name,COALESCE(SUM(CASE WHEN r.status='CLOSED' THEN CASE WHEN a.option_id='__skip__' THEN -1 WHEN a.correct=1 AND r.winner_id=p.id THEN 3 WHEN a.correct=1 THEN 1 WHEN a.correct=0 THEN -3 ELSE 0 END ELSE 0 END),0) AS score FROM players p LEFT JOIN attempts a ON a.player_id=p.id LEFT JOIN rounds r ON r.id=a.round_id AND r.room_id=p.room_id WHERE p.room_id=? GROUP BY p.id ORDER BY score DESC,p.created_at,p.id").bind(roomId).all()).results}

export async function audioFailed(r:Room){await database().batch([database().prepare("UPDATE rounds SET status='VOID' WHERE id=? AND status IN ('READY','OPEN') AND EXISTS(SELECT 1 FROM rooms WHERE id=? AND phase IN ('PREPARING','COUNTDOWN','PLAYING'))").bind(r.current_round_id,r.id),database().prepare("UPDATE rooms SET phase='PAUSED',display_audio_ready=0,revision=revision+1 WHERE id=? AND phase IN ('PREPARING','COUNTDOWN','PLAYING') AND EXISTS(SELECT 1 FROM rounds WHERE id=rooms.current_round_id AND status='VOID')").bind(r.id)]);}

export async function upcoming(r:Room){return database().prepare("SELECT * FROM rounds WHERE room_id=? AND status='READY' AND id<>COALESCE(?, '') ORDER BY number LIMIT 1").bind(r.id,r.current_round_id).first<Round>()}

export async function resume(r:Room){
 if(r.phase!=='PAUSED')throw new Failure(409,'This game is not paused');
 const db=database();
 const next=await db.prepare("SELECT id FROM rounds WHERE room_id=? AND status='READY' ORDER BY number LIMIT 1").bind(r.id).first<{id:string}>();
 if(!next)throw new Failure(409,'Waiting for replacement music. Please try Resume once it is ready.');
 await db.batch([
  db.prepare("UPDATE rounds SET preloaded=0 WHERE room_id=? AND status='READY'").bind(r.id),
  db.prepare("UPDATE rooms SET pause_requested=0,phase='PREPARING',current_round_id=?,revision=revision+1 WHERE id=? AND phase='PAUSED'").bind(next.id,r.id)
 ]);
}
