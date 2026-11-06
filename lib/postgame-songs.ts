import {GAME_ROUNDS} from './game-settings';
import {database} from './server';

type Result={round_id:string,playerId:string,name:string,option_id:string|null,correct:number|null};
/** Only authenticated finished-room snapshots call this; never reveal earlier answers. */
export async function postgameSongs(room:{id:string,code:string,phase:string}){
 if(room.phase!=='FINISHED')return undefined;
 const db=database();
 const tracks=await db.prepare("SELECT id,options_json,correct_option_id,artwork_status FROM rounds WHERE room_id=? AND status='CLOSED' ORDER BY number LIMIT ?").bind(room.id,GAME_ROUNDS).all<{id:string,options_json:string,correct_option_id:string,artwork_status:string}>();
 const attempts=await db.prepare("SELECT r.id AS round_id,p.id AS playerId,p.name,a.option_id,a.correct FROM rounds r JOIN players p ON p.room_id=r.room_id LEFT JOIN attempts a ON a.round_id=r.id AND a.player_id=p.id WHERE r.room_id=? AND r.status='CLOSED' ORDER BY r.number,p.created_at,p.id").bind(room.id).all<Result>();
 return tracks.results.map(track=>{
  const option=(JSON.parse(track.options_json) as {id:string,title:string,artist:string}[]).find(option=>option.id===track.correct_option_id)!;
  return {id:track.id,title:option.title,artist:option.artist,artworkUrl:track.artwork_status==='READY'?`/api/rooms/${room.code}/album-art?roundId=${track.id}`:null,
   results:attempts.results.filter(attempt=>attempt.round_id===track.id).map(attempt=>({playerId:attempt.playerId,name:attempt.name,outcome:attempt.option_id===null?'unanswered':attempt.option_id==='__skip__'?'skipped':attempt.correct?'correct':'wrong'}))};
 });
}
