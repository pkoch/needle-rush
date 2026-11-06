import {postgameSongs} from "../../../lib/postgame-songs";
import {recordPlayback,currentPlayback} from "../../../lib/postgame-playback";
import {GAME_ROUNDS} from "../../../lib/game-settings";
import {CLIENT_RELEASE} from "../../../lib/release";
import {claimWarmRoom} from "../../../lib/warm";
import {connector,jsonBody,prepare} from "../../../lib/connector";
import { answer,current,reconcile,start,ready,scores,audioFailed,upcoming,resume } from "../../../lib/game";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { Failure,database,now,token,hash,roomCode,cookie,response,origin,owner,rate,room,session } from "../../../lib/server";
export const dynamic="force-dynamic";
async function authorizeTV(r:{owner_id:string}){if(await owner()!==r.owner_id)throw new Failure(403,'Only the signed-in TV owner can control music')}
async function handle(req:Request){const serverReceivedAt=now();try{
 const path=new URL(req.url).pathname.slice(5).split("/");const db=database();const action=path.join("/");
 if(path[0]==="connector")return await connector(req,path);
 if(req.method==="POST")origin(req);
 const body=req.method==="POST"?await jsonBody(req):{};
 if(action==="bootstrap"&&req.method==="POST"){
  if(env.BOOTSTRAP_ENABLED!=="true")throw new Failure(403,"Owner setup is closed");const user=await getChatGPTUser();if(!user)throw new Failure(401,"Sign in first");
  await db.prepare("INSERT INTO owners(id,created_at) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM owners)").bind(user.userId,now()).run();await owner();return response({ok:true});
 }
 if(action==="rooms"&&req.method==="GET"){
  const id=await owner();const active=await db.prepare("SELECT code FROM rooms WHERE active_key=1 AND owner_id=? AND expires_at>?").bind(id,now()).first<{code:string}>();return response({code:active?.code??null});
 }
 if(action==="rooms"&&req.method==="POST"){
  const id=await owner();await rate(req,"create",5);const stamp=now();
  await db.prepare("UPDATE rooms SET phase='CANCELLED',active_key=NULL WHERE expires_at<=? AND active_key=1").bind(stamp).run();
  const existing=await db.prepare("SELECT code FROM rooms WHERE active_key=1").first<{code:string}>();if(existing){const old=await room(existing.code);if(old.phase==='LOBBY')await prepare(old);return response(existing)}
  const warmed=await claimWarmRoom(id);if(warmed)return response(warmed);
  const concurrent=await db.prepare("SELECT code FROM rooms WHERE active_key=1").first<{code:string}>();if(concurrent)return response(concurrent);
  const code=roomCode();await db.prepare("INSERT INTO rooms(id,code,owner_id,phase,active_key,revision,scored_rounds,last_activity,expires_at,created_at) VALUES(?,?,?,'LOBBY',1,0,0,?,?,?)").bind(crypto.randomUUID(),code,id,stamp,stamp+7200000,stamp).run();await prepare(await room(code));return response({code});
 }
 if(action==="join"&&req.method==="POST"){
  await rate(req,"join",30);const code=String(body.code??"");const r=await room(code);if(r.phase!=="LOBBY")throw new Failure(409,"This game has started; join the next one");
  const name=String(body.name??"").normalize("NFKC").trim();if(Array.from(name).length<2||Array.from(name).length>20||/[\p{Cc}\p{Cf}]/u.test(name))throw new Failure(400,"Use a name of 2–20 visible characters");
  if(cookie(req,"nr_player")){try{const old=await session(req,r,"player");return response({code:r.code,playerId:old.player_id})}catch{}}
  const player=crypto.randomUUID(),value=token(),stamp=now();
  await db.batch([
   db.prepare("INSERT INTO players(id,room_id,name,name_key,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rooms WHERE id=? AND phase='LOBBY') AND (SELECT count(*) FROM players WHERE room_id=?)<16").bind(player,r.id,name,name.toLocaleLowerCase("en-US"),stamp,r.id,r.id),
   db.prepare("INSERT INTO sessions(token_hash,room_id,role,player_id,expires_at) SELECT ?,?,'player',?,? WHERE EXISTS(SELECT 1 FROM players WHERE id=?)").bind(await hash(value),r.id,player,stamp+7200000,player),
   db.prepare("UPDATE rooms SET revision=revision+1 WHERE id=? AND EXISTS(SELECT 1 FROM players WHERE id=?)").bind(r.id,player)
  ]);
  const created=await db.prepare("SELECT id FROM players WHERE id=?").bind(player).first();if(!created)throw new Failure(409,"Room full or already started");return response({code:r.code,playerId:player},{role:"player",value});
 }
 if(action==="pair"&&req.method==="POST"){
  await owner();
  await rate(req,"pair",12);const value=token(),stamp=now(),key=await hash(String(body.pairCode??"").toUpperCase());
  const pair=await db.prepare("SELECT room_id FROM display_pairs WHERE code_hash=? AND consumed_at IS NULL AND expires_at>?").bind(key,stamp).first<{room_id:string}>();if(!pair){const playerCode=await db.prepare("SELECT id FROM rooms WHERE code=? AND expires_at>?").bind(String(body.pairCode??"").toUpperCase(),stamp).first();throw new Failure(404,playerCode?"That is the player room code. On the owner’s phone, use the code labelled ONE-TIME TV LINK CODE, or tap Pair TV with this game.":"TV pairing code invalid or expired. On the owner’s phone, tap Pair TV with this game for a fresh one.")}
  const r=await db.prepare("SELECT code FROM rooms WHERE id=? AND expires_at>? AND phase NOT IN ('FINISHED','CANCELLED')").bind(pair.room_id,stamp).first<{code:string}>();if(!r)throw new Failure(404,"Room unavailable");
  const digest=await hash(value);await db.batch([
   db.prepare("UPDATE display_pairs SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL AND expires_at>?").bind(stamp,key,stamp),
   db.prepare("INSERT INTO sessions(token_hash,room_id,role,expires_at) SELECT ?,?,'display',? WHERE changes()=1").bind(digest,pair.room_id,stamp+7200000),
   db.prepare("UPDATE sessions SET revoked_at=? WHERE room_id=? AND role='display' AND token_hash<>? AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=?)").bind(stamp,pair.room_id,digest,digest)
  ]);const ok=await db.prepare("SELECT token_hash FROM sessions WHERE token_hash=?").bind(digest).first();if(!ok)throw new Failure(409,"Code already used");return response({code:r.code},{role:"display",value});
 }
 if(path[0]==="rooms"&&path[1]){
  let r=await room(path[1]);const op=path[2];
  if(op==="remove-player"&&req.method==="POST"){if(await owner()!==r.owner_id)throw new Failure(403,"Wrong owner");const playerId=String(body.playerId??"");await db.batch([db.prepare("DELETE FROM sessions WHERE player_id=? AND room_id=? AND EXISTS(SELECT 1 FROM rooms WHERE id=? AND phase='LOBBY')").bind(playerId,r.id,r.id),db.prepare("DELETE FROM players WHERE id=? AND room_id=? AND EXISTS(SELECT 1 FROM rooms WHERE id=? AND phase='LOBBY')").bind(playerId,r.id,r.id),db.prepare("UPDATE rooms SET revision=revision+1 WHERE id=? AND phase='LOBBY'").bind(r.id)]);return response({ok:true})}
  if(op==="prepare"&&req.method==="POST"){if(await owner()!==r.owner_id)throw new Failure(403,"Wrong owner");return response(await prepare(r,true))}
  if(op==='album-art'&&req.method==='GET'){
   if((await getChatGPTUser())?.userId===r.owner_id)await authorizeTV(r);else await session(req,r,'player');
   if(r.phase!=='FINISHED'||!env.BUCKET)throw new Failure(404,'Album art unavailable');
   const track=await db.prepare("SELECT artwork_key FROM rounds WHERE id=? AND room_id=? AND status='CLOSED' AND artwork_status='READY'").bind(new URL(req.url).searchParams.get('roundId'),r.id).first<{artwork_key:string}>();
   if(!track)throw new Failure(404,'Album art unavailable');const object=await env.BUCKET.get(track.artwork_key);if(!object)throw new Failure(404,'Album art unavailable');return new Response(object.body,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(op==='afterparty-clip'&&req.method==='GET'){
   await authorizeTV(r);if(!['REVEAL','FINISHED'].includes(r.phase)||r.scored_rounds!==GAME_ROUNDS||!env.BUCKET)throw new Failure(404,'Post-game music unavailable');
   const track=await db.prepare("SELECT clip_key FROM rounds WHERE id=? AND room_id=? AND status='CLOSED'").bind(new URL(req.url).searchParams.get('roundId'),r.id).first<{clip_key:string}>();
   if(!track)throw new Failure(404,'Post-game clip unavailable');const object=await env.BUCKET.get(track.clip_key);if(!object)throw new Failure(503,'Post-game clip unavailable');
   return new Response(object.body,{headers:{'Content-Type':'audio/mpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(op==="sound-check"&&req.method==="GET"){await authorizeTV(r);if(['FINISHED','CANCELLED'].includes(r.phase)||!env.BUCKET)throw new Failure(404,"Sound check unavailable");const object=await env.BUCKET.get('sounds/speaker-check.mp3');if(!object)throw new Failure(503,"Speaker test is not installed yet");return new Response(object.body,{headers:{"Content-Type":"audio/mpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}})}
  if(op==="next-clip"&&req.method==="GET"){await authorizeTV(r);const next=await upcoming(r);if(!next||!['PREPARING','COUNTDOWN','PLAYING','REVEAL'].includes(r.phase)||new URL(req.url).searchParams.get('roundId')!==next.id||!env.BUCKET)throw new Failure(404,"Clip unavailable");const object=await env.BUCKET.get(next.clip_key);if(!object)throw new Failure(503,"Clip unavailable");return new Response(object.body,{headers:{"Content-Type":"audio/mpeg","Cache-Control":"private, no-store"}})}
  if(op==="preloaded"&&req.method==="POST"){await authorizeTV(r);const next=await upcoming(r);if(next&&next.id===body.roundId)await db.prepare("UPDATE rounds SET preloaded=1 WHERE id=? AND status='READY'").bind(next.id).run();return response({ok:true})}
  if(op==="clip"&&req.method==="GET"){await authorizeTV(r);const round=await current(r);if(!round||!["PREPARING","COUNTDOWN","PLAYING"].includes(r.phase)||!["READY","OPEN"].includes(round.status)||!env.BUCKET)throw new Failure(404,"Clip unavailable");const object=await env.BUCKET.get(round.clip_key);if(!object)throw new Failure(503,"Clip unavailable");return new Response(object.body,{headers:{"Content-Type":"audio/mpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}})}
  if((op==="answer"||op==="skip")&&req.method==="POST"){const player=await session(req,r,"player");if(!player.player_id)throw new Failure(403,"Player required");await rate(req,"answer:"+player.player_id,30);await answer(r,player.player_id,String(body.roundId??""),String(body.optionId??""),op==="skip");return response({accepted:true})}
  if((op==="heartbeat"||op==="ready"||op==="audio-failed")&&req.method==="POST"){await authorizeTV(r);if(op==="ready")await ready(r,String(body.roundId??""));else await db.prepare("UPDATE rooms SET display_last_seen=?,display_audio_ready=? WHERE id=?").bind(now(),body.audioReady===true&&op!=="audio-failed"?1:0,r.id).run();if(op==="audio-failed")await audioFailed(r);if(op!=="ready")await recordPlayback(r,body.postgameTrackId,body.audioReady===true&&op!=="audio-failed",serverReceivedAt);return response({ok:true})}
  if(op==="start"&&req.method==="POST"){
   try{await session(req,r,"player")}catch(error){if((await getChatGPTUser())?.userId===r.owner_id)await authorizeTV(r);else throw error}
   await start(r);return response({ok:true});
  }
  if(["pause","resume","cancel"].includes(op)&&req.method==="POST"){if(await owner()!==r.owner_id)throw new Failure(403,"Wrong owner");if(op==="start")await start(r);if(op==="pause")await db.prepare("UPDATE rooms SET pause_requested=1,phase=CASE WHEN phase='PREPARING' THEN 'PAUSED' ELSE phase END,revision=revision+1 WHERE id=?").bind(r.id).run();if(op==="resume")await resume(r);if(op==="cancel")await db.prepare("UPDATE rooms SET phase='CANCELLED',active_key=NULL,expires_at=?,revision=revision+1 WHERE id=? AND phase<>'CANCELLED'").bind(now()+86400000,r.id).run();return response({ok:true})}
  if(op==="pair-code"&&req.method==="POST"){if(await owner()!==r.owner_id)throw new Failure(403,"Wrong owner");await rate(req,"pair-code",10);if(!['LOBBY','PAUSED'].includes(r.phase))throw new Failure(409,"Pause before replacing the display");const code=roomCode();await db.batch([db.prepare("DELETE FROM display_pairs WHERE room_id=?").bind(r.id),db.prepare("INSERT INTO display_pairs(code_hash,room_id,expires_at) VALUES(?,?,?)").bind(await hash(code),r.id,now()+300000)]);return response({pairCode:code,expiresIn:300})}
  if(!op&&req.method==="GET"){
   const role=new URL(req.url).searchParams.get("role")??"player";let playerId:string|null=null;if(role==="owner"||role==="display"){if(await owner()!==r.owner_id)throw new Failure(403,"Wrong owner")}else if(role==="display"||role==="player"){playerId=(await session(req,r,role)).player_id}else throw new Failure(400,"Invalid role");
   await db.prepare("UPDATE rooms SET last_activity=?,expires_at=? WHERE id=? AND phase NOT IN ('FINISHED','CANCELLED')").bind(now(),now()+7200000,r.id).run();if(role==="player")await db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=? AND revoked_at IS NULL").bind(now()+7200000,await hash(cookie(req,"nr_"+role))).run();await reconcile(r);await db.prepare("UPDATE rooms SET phase='PAUSED',revision=revision+1 WHERE id=? AND phase='PREPARING' AND current_round_id IS NULL").bind(r.id).run();r=await room(path[1]);if(r.phase==='PAUSED'||(role==='owner'&&r.phase==='LOBBY'))await prepare(r);const round=await current(r);const reveal=round?.status==="CLOSED";const attempt=playerId&&round?await db.prepare("SELECT option_id,correct FROM attempts WHERE round_id=? AND player_id=?").bind(round.id,playerId).first():null;const snapshot={release:CLIENT_RELEASE,serverReceivedAt,code:r.code,phase:r.phase,revision:r.revision,scoredRounds:r.scored_rounds,displayReady:r.display_audio_ready===1&&(r.display_last_seen??0)>now()-5000,players:await scores(r.id),preparation:await db.prepare("SELECT status,progress,error,clip_count FROM jobs WHERE room_id=? ORDER BY created_at DESC LIMIT 1").bind(r.id).first(),playerId,finaleStartsAt:r.phase==='FINISHED'?r.deadline:null,nowPlaying:await currentPlayback(r),postgameSongs:await postgameSongs(r),revealEndsAt:reveal?r.deadline:null,postgameTracks:role!=='player'&&r.scored_rounds===GAME_ROUNDS&&['REVEAL','FINISHED'].includes(r.phase)?(await db.prepare("SELECT id FROM rounds WHERE room_id=? AND status='CLOSED' ORDER BY number LIMIT ?").bind(r.id,GAME_ROUNDS).all<{id:string}>()).results.map(track=>track.id):undefined,nextClip:role!=='player'?await upcoming(r).then(x=>x?{id:x.id}:null):undefined,attempt:attempt?(reveal?{optionId:attempt.option_id,correct:attempt.correct,skipped:attempt.option_id==='__skip__',points:attempt.option_id==='__skip__'?-1:attempt.correct?(round?.winner_id===playerId?3:1):-3}:{locked:true,optionId:attempt.option_id}):null,round:round?{id:round.id,number:r.scored_rounds+(reveal?0:1),options:JSON.parse(round.options_json),opensAt:round.opens_at,closesAt:round.closes_at,...(reveal?{correctOptionId:round.correct_option_id,winnerId:round.winner_id}:{})}:null,serverTime:now()};return response(snapshot,role==="player"?{role,value:cookie(req,"nr_"+role)}:undefined);
  }
 }
 throw new Failure(404,"Unknown operation");
 }catch(e){if(e instanceof Failure)return Response.json({error:e.message,...(e.code?{code:e.code}:{})},{status:e.status,headers:{"Cache-Control":"no-store"}});if(e instanceof SyntaxError)return Response.json({error:"Invalid request"},{status:400});console.error("Game operation failed",e instanceof Error?e.name:"Unknown");return Response.json({error:"Request could not complete; the room may have changed or the name is taken"},{status:409})}}
export const GET=handle;export const POST=handle;
