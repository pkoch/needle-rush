"use client";
import { useEffect,useRef,useState } from "react";
import {startAfterparty} from "../lib/afterparty";
import QRCode from "qrcode";
import {suggestPlayerName} from "../lib/player-name";
import {GAME_ROUNDS,PREPARED_CLIPS} from "../lib/game-settings";
import PostgamePlaylist,{type PostgameSong} from "./PostgamePlaylist";
import StandingsList from "./StandingsList";
import FinalResults from "./FinalResults";
import {createFinaleAudio} from "../lib/finale-audio";
import type {FinaleCue} from "../lib/finale";
import {CLIENT_RELEASE} from "../lib/release";
import {takeSpeakerLease} from "../lib/speaker-lease";
import { Soundwave, PartyConfetti } from "./GameArt";
type Mode="owner"|"player";
type Round={id:string,number:number,options:{id:string,title:string,artist:string}[],opensAt:number|null,closesAt:number|null,correctOptionId?:string,winnerId?:string};
type Snapshot={release?:string,code:string,phase:string,revision:number,scoredRounds:number,displayReady:boolean,preparation:{status:string,progress:number,error:string|null,clip_count:number}|null,serverTime:number,serverReceivedAt?:number,revealEndsAt?:number|null,finaleStartsAt?:number|null,nextClip?:{id:string}|null,postgameTracks?:string[],postgameSongs?:PostgameSong[],nowPlaying?:{id:string,startedAt:number}|null,players:{id:string,name:string,score:number}[],playerId:string|null,round:Round|null,attempt:{locked?:boolean,correct?:number,points?:number,skipped?:boolean,optionId?:string}|null};
class ApiError extends Error{constructor(public status:number,message:string,public code?:string){super(message)}}
async function call<T={code:string}>(path:string,body?:unknown,signal?:AbortSignal){const r=await fetch('/api/'+path,{signal,method:body?'POST':'GET',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const data=await r.json() as T & {error?:string,code?:string};if(!r.ok)throw new ApiError(r.status,data.error??'Connection failed',data.code);return data}
export default function RoomPanel({mode,allowed=true,bootstrap=false}:{mode:Mode,allowed?:boolean,bootstrap?:boolean}){
 const isTV=mode!=='player';
 const [playerJoined,setPlayerJoined]=useState(false),[musicError,setMusicError]=useState(''),[localPlaying,setLocalPlaying]=useState<string|null>(null);
 const playingTrack=useRef<string|null>(null),polling=useRef<AbortController|null>(null),epoch=useRef(0),afterparty=useRef<(()=>void)|null>(null);
 const opening=useRef<Promise<{code:string}>|null>(null),autoAudioAttempted=useRef(false),unlocking=useRef(false);
 const [hydrated,setHydrated]=useState(false);
 useEffect(()=>setHydrated(true),[]);
 const [picked,setPicked]=useState<{roundId:string,optionId:string}|null>(null);
 const [updateRelease,setUpdateRelease]=useState(''),[audioElsewhere,setAudioElsewhere]=useState(false);
 const speakerLease=useRef<(()=>void)|null>(null),gameSources=useRef(new Set<AudioBufferSourceNode>()),networkIssue=useRef(false),gameGains=useRef(new Map<AudioBufferSourceNode,GainNode>()),fadingSources=useRef(new Set<AudioBufferSourceNode>());
 const [code,setCode]=useState(''),[name,setName]=useState(''),[state,setState]=useState<Snapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[sound,setSound]=useState(false),[audioConfirmed,setAudioConfirmed]=useState(false),[qr,setQr]=useState(''),[clock,setClock]=useState(Date.now()),[pending,setPending]=useState(false),[connected,setConnected]=useState(false);
 const context=useRef<AudioContext|null>(null),buffer=useRef<{id:string,data:AudioBuffer}|null>(null),nextBuffer=useRef<{id:string,data:AudioBuffer}|null>(null),source=useRef<AudioBufferSourceNode|null>(null),scheduled=useRef(''),offset=useRef(0),bestRTT=useRef(Infinity),live=useRef(state);
 live.current=state;
 const finaleAudio=useRef<ReturnType<typeof createFinaleAudio>|null>(null),finaleAllowed=useRef(false);
 finaleAllowed.current=isTV&&connected&&sound&&audioConfirmed&&!updateRelease&&state?.phase==='FINISHED';
 const playFinaleCue=(cue:FinaleCue)=>{
  if(!finaleAllowed.current||!context.current||!speakerLease.current)return;
  finaleAudio.current??=createFinaleAudio(context.current,()=>finaleAllowed.current&&document.visibilityState==='visible'&&!!speakerLease.current&&context.current?.state==='running',()=>Date.now()+offset.current);
  finaleAudio.current.play(cue);
 };
 useEffect(()=>{if(!finaleAllowed.current)finaleAudio.current?.cancel()},[isTV,connected,sound,audioConfirmed,updateRelease,state?.phase]);
 useEffect(()=>{const hide=()=>{if(document.visibilityState==='hidden')finaleAudio.current?.cancel()};document.addEventListener('visibilitychange',hide);return()=>{document.removeEventListener('visibilitychange',hide);finaleAudio.current?.cancel()}},[]);
 const checkBuffer=useRef<AudioBuffer|null>(null),checkSource=useRef<AudioBufferSourceNode|null>(null);
 const stopSpeakerTest=()=>{try{checkSource.current?.stop()}catch{}try{checkSource.current?.disconnect()}catch{}checkSource.current=null};
 const halt=()=>{finaleAudio.current?.cancel();for(const node of gameSources.current){try{node.stop()}catch{}try{node.disconnect()}catch{}}gameSources.current.clear();for(const gain of gameGains.current.values()){try{gain.disconnect()}catch{}}gameGains.current.clear();fadingSources.current.clear();try{source.current?.stop()}catch{}try{source.current?.disconnect()}catch{}source.current=null;scheduled.current=''};
 const fadeOutgoing=(startsAt:number)=>{
  const node=source.current,ctx=context.current,gain=node?gameGains.current.get(node):null;
  if(!node||!ctx||!gain||fadingSources.current.has(node))return;
  const wall=Date.now()+offset.current,untilEnd=(startsAt+2000-wall)/1000;
  if(untilEnd<=0){try{node.stop()}catch{}return}
  const start=ctx.currentTime+Math.max(0,(startsAt-wall)/1000),end=ctx.currentTime+untilEnd;
  gain.gain.cancelScheduledValues(ctx.currentTime);gain.gain.setValueAtTime(Math.min(1,untilEnd/2),ctx.currentTime);
  if(startsAt>wall)gain.gain.setValueAtTime(1,start);
  gain.gain.linearRampToValueAtTime(0,end);try{node.stop(end)}catch{}fadingSources.current.add(node);
 };
 const releaseSpeakers=()=>{afterparty.current?.();afterparty.current=null;halt();stopSpeakerTest();speakerLease.current?.();speakerLease.current=null};
 useEffect(()=>{if(mode==='player')setName(current=>current||suggestPlayerName());const saved=localStorage.getItem('needle-room-'+mode);if(mode==='player'){const query=new URLSearchParams(location.search).get('code')?.toUpperCase();setCode(query??saved??'');setPlayerJoined(!!saved&&(!query||query===saved))}return()=>{releaseSpeakers();context.current?.close()}},[mode]);
 useEffect(()=>{if(!isTV||!allowed)return;let active=true;opening.current??=call<{code:string|null}>('rooms').then(value=>value.code?{code:value.code}:call('rooms',{}));opening.current.then(value=>{if(active)setCode(value.code)}).catch(error=>{if(active)setError(error.message)});return()=>{active=false}},[mode,allowed]);
 useEffect(()=>{if(!isTV)return;const leave=()=>{releaseSpeakers();setSound(false);setAudioConfirmed(false)};window.addEventListener('pagehide',leave);return()=>window.removeEventListener('pagehide',leave)},[mode]);
 useEffect(()=>{if(!['COUNTDOWN','PLAYING'].includes(state?.phase??''))return;setClock(Date.now()+offset.current);const timer=setInterval(()=>setClock(Date.now()+offset.current),100);return()=>clearInterval(timer)},[state?.phase]);
 useEffect(()=>{if(!code||code.length!==6||!allowed||(mode==='player'&&!playerJoined))return;const requestEpoch=epoch.current,controller=new AbortController();polling.current=controller;let active=true;let timer:ReturnType<typeof setTimeout>;const poll=async()=>{const started=Date.now();try{const value=await call<Snapshot>(`rooms/${encodeURIComponent(code)}?role=${mode}`,undefined,controller.signal);if(active&&requestEpoch===epoch.current){if(value.release&&value.release!==CLIENT_RELEASE){releaseSpeakers();setSound(false);setAudioConfirmed(false);setConnected(false);setUpdateRelease(value.release);return}const ended=Date.now(),rtt=ended-started,networkRTT=Math.max(0,rtt-(value.serverTime-(value.serverReceivedAt??value.serverTime)));if(networkRTT<bestRTT.current){bestRTT.current=networkRTT;offset.current=((value.serverReceivedAt??value.serverTime)+value.serverTime-started-ended)/2}setClock(ended+offset.current);setState(old=>!old||old.code!==value.code||value.revision>=old.revision?value:old);setConnected(true);if(networkIssue.current){networkIssue.current=false;setError('')}localStorage.setItem('needle-room-'+mode,code)}}catch(e){if(active&&requestEpoch===epoch.current){if(mode==='player'&&!live.current&&e instanceof ApiError&&e.status===401)setPlayerJoined(false);networkIssue.current=true;setError((e as Error).message);setConnected(false);halt()}}if(active)timer=setTimeout(poll,live.current?.phase==='FINISHED'?1000:live.current&&live.current.phase!=='LOBBY'?200:isTV?200:500)};poll();return()=>{active=false;controller.abort();if(polling.current===controller)polling.current=null;clearTimeout(timer)}},[code,mode,allowed,playerJoined]);
 useEffect(()=>{if(!code||!isTV||!connected)return;const beat=()=>{if(!speakerLease.current)return;return call(`rooms/${code}/heartbeat`,{audioReady:audioConfirmed&&context.current?.state==='running',postgameTrackId:playingTrack.current}).catch(()=>{setConnected(false);halt()})};beat();const timer=setInterval(beat,1000);return()=>clearInterval(timer)},[code,mode,connected,sound,audioConfirmed]);
 useEffect(()=>{
  if(!isTV||!connected||!code)return;let active=true;
  const unlock=()=>{if(!active||audioConfirmed||unlocking.current||updateRelease)return;unlocking.current=true;void enableSound(false).finally(()=>{unlocking.current=false})};
  const interact=(event:Event)=>{if((event.target as Element)?.closest?.('.speaker-check button'))return;if(event instanceof KeyboardEvent&&(event.altKey||event.ctrlKey||event.metaKey||['Shift','Control','Alt','Meta','Escape'].includes(event.key)))return;unlock()};
  window.addEventListener('pointerup',interact);window.addEventListener('keydown',interact);
  if(!autoAudioAttempted.current){autoAudioAttempted.current=true;context.current??=new AudioContext();if(context.current.state==='running'&&navigator.locks){void (async()=>{const locks=await navigator.locks?.query();if(active&&!locks?.held?.some(lock=>lock.name==='needle-rush-speakers'))unlock()})()}}
  return()=>{active=false;window.removeEventListener('pointerup',interact);window.removeEventListener('keydown',interact)};
 },[mode,code,connected,audioConfirmed,updateRelease]);
 useEffect(()=>{if(!state||mode==='player')return;let active=true;QRCode.toDataURL(location.origin+'/join?code='+state.code,{width:260,margin:2,errorCorrectionLevel:'M',color:{dark:'#23202d',light:'#fff7e7'}}).then(v=>{if(active)setQr(v)});return()=>{active=false}},[state?.code,mode]);
 useEffect(()=>{setPending(false);setPicked(null)},[state?.round?.id]);
 useEffect(()=>{if(mode==='player'&&state?.phase==='COUNTDOWN')window.scrollTo(0,0)},[mode,state?.phase,state?.round?.id]);
 useEffect(()=>{if(!isTV||!sound||!audioConfirmed||!connected||state?.phase!=='PREPARING'||!state.round||!context.current)return;let active=true;const id=state.round.id;const load=async()=>{try{if(nextBuffer.current?.id===id){buffer.current=nextBuffer.current;nextBuffer.current=null;await call(`rooms/${code}/ready`,{roundId:id});return}const r=await fetch(`/api/rooms/${code}/clip`);if(!r.ok)throw Error('The next clip is unavailable');const data=await context.current!.decodeAudioData(await r.arrayBuffer());if(!active)return;buffer.current={id,data};await call(`rooms/${code}/ready`,{roundId:id})}catch(e){if(active){setError((e as Error).message);await call(`rooms/${code}/audio-failed`,{}).catch(()=>{})}}};load();return()=>{active=false}},[mode,sound,audioConfirmed,connected,state?.phase,state?.round?.id,code]);
 useEffect(()=>{if(!isTV||!sound||!audioConfirmed||!connected||!state?.nextClip||!context.current||!['PREPARING','COUNTDOWN','PLAYING','REVEAL'].includes(state.phase))return;const id=state.nextClip.id;if(nextBuffer.current?.id===id)return;let active=true;fetch(`/api/rooms/${code}/next-clip?roundId=${encodeURIComponent(id)}`).then(async r=>{if(!r.ok)throw Error('Preload unavailable');const data=await context.current!.decodeAudioData(await r.arrayBuffer());if(active){nextBuffer.current={id,data};await call(`rooms/${code}/preloaded`,{roundId:id})}}).catch(()=>{});return()=>{active=false}},[mode,sound,audioConfirmed,connected,state?.nextClip?.id,code]);
 useEffect(()=>{
  if(!isTV)return;
  const r=state?.round;
  if(!connected||!sound||!audioConfirmed||!r){halt();return}
  if(state?.phase==='REVEAL'){if(state.revealEndsAt)fadeOutgoing(state.revealEndsAt);return}
  if(state?.phase==='FINISHED'&&source.current&&fadingSources.current.has(source.current))return;
  if(!['COUNTDOWN','PLAYING'].includes(state?.phase??'')){halt();return}
  if(scheduled.current===r.id)return;
  const tail=state?.phase==='COUNTDOWN'&&!!r.opensAt&&r.opensAt>Date.now()+offset.current;
  if(tail)fadeOutgoing(r.opensAt!-3000);else halt();
  let active=true;
  const play=async()=>{try{
   if(nextBuffer.current?.id===r.id){buffer.current=nextBuffer.current;nextBuffer.current=null}
   if(!context.current||context.current.state!=='running'||!r.opensAt)throw Error('Tap this TV once to allow sound');
   if(buffer.current?.id!==r.id){
    const response=await fetch(`/api/rooms/${code}/clip`);if(!response.ok)throw Error('The current clip is unavailable');
    const data=await context.current.decodeAudioData(await response.arrayBuffer());if(!active)return;buffer.current={id:r.id,data};
   }
   if(!active||live.current?.round?.id!==r.id||!speakerLease.current)return;
   if(!tail)halt();
   const delay=(r.opensAt-(Date.now()+offset.current))/1000;
   const audio=context.current.createBufferSource();audio.buffer=buffer.current.data;audio.loop=true;const gain=context.current.createGain();gain.gain.value=1;audio.connect(gain);gain.connect(context.current.destination);gameGains.current.set(audio,gain);
   gameSources.current.add(audio);audio.onended=()=>{gameSources.current.delete(audio);gameGains.current.delete(audio);fadingSources.current.delete(audio);gain.disconnect()};
   audio.start(context.current.currentTime+Math.max(0,delay),Math.max(0,-delay)%buffer.current.data.duration);source.current=audio;scheduled.current=r.id;
  }catch(e){if(active){setError((e as Error).message);await call(`rooms/${code}/audio-failed`,{}).catch(()=>{});halt()}}};
  play();return()=>{active=false};
 },[state?.phase,state?.round?.id,state?.revealEndsAt,mode,connected,sound,audioConfirmed,code]);
 const postgameRoom=isTV&&sound&&audioConfirmed&&connected&&state?.postgameTracks?.length===GAME_ROUNDS&&['REVEAL','FINISHED'].includes(state.phase)?code:null;
 useEffect(()=>{
  if(!postgameRoom||!context.current)return;
  const ctx=context.current,tracks=live.current!.postgameTracks!,at=ctx.currentTime+Math.max(0,((live.current!.revealEndsAt??(Date.now()+offset.current))+2000-Date.now()-offset.current)/1000);
  const stop=startAfterparty(ctx,tracks,at,async(id,signal)=>{const response=await fetch(`/api/rooms/${postgameRoom}/afterparty-clip?roundId=${encodeURIComponent(id)}`,{signal});if(!response.ok)throw Error('Post-game clip unavailable');return ctx.decodeAudioData(await response.arrayBuffer())},message=>setMusicError(message),id=>{playingTrack.current=id;setLocalPlaying(id);if(speakerLease.current&&live.current?.code===postgameRoom)void call(`rooms/${postgameRoom}/heartbeat`,{audioReady:ctx.state==='running',postgameTrackId:id}).catch(()=>{})});
  afterparty.current=stop;return()=>{stop();setMusicError('');if(afterparty.current===stop)afterparty.current=null};
 },[postgameRoom]);
 async function act(task:()=>Promise<void>){setBusy(true);setError('');try{await task()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function enableSound(playTest=true){await act(async()=>{
  if(updateRelease)throw Error('Load the TV update before enabling sound.');
  context.current??=new AudioContext();await context.current.resume();if(context.current.state!=='running')throw Error('Audio is blocked; interact with this screen to retry');
  releaseSpeakers();setAudioConfirmed(false);setSound(false);
  const ownLease=await takeSpeakerLease(()=>{halt();stopSpeakerTest();speakerLease.current=null;setSound(false);setAudioConfirmed(false);setAudioElsewhere(true)});speakerLease.current=ownLease;setAudioElsewhere(false);
  if(!playTest){setSound(true);setAudioConfirmed(true);return}
  if(!checkBuffer.current){const response=await fetch(`/api/rooms/${code}/sound-check`);if(!response.ok)throw Error('Speaker test unavailable. Please try again.');checkBuffer.current=await context.current.decodeAudioData(await response.arrayBuffer())}
  if(speakerLease.current!==ownLease)return;
  const audio=context.current.createBufferSource();audio.buffer=checkBuffer.current;audio.connect(context.current.destination);audio.start();checkSource.current=audio;setSound(true);
 })}


 const round=state?.round,open=!!round&&connected&&!state?.attempt&&!pending&&['COUNTDOWN','PLAYING'].includes(state?.phase??'')&&clock>=(round.opensAt??Infinity);
 const selectedOption=state?.attempt?.optionId??(picked?.roundId===round?.id?picked?.optionId:undefined);
 const command=(op:string)=>act(async()=>{await call(`rooms/${code}/${op}`,{})});
 const startNewGame=()=>act(async()=>{
  epoch.current++;afterparty.current?.();afterparty.current=null;
  if(state&&!['FINISHED','CANCELLED'].includes(state.phase))await call(`rooms/${state.code}/cancel`,{});
  const fresh=await call('rooms',{});
  const snapshot=await call<Snapshot>(`rooms/${fresh.code}?role=owner`);
  halt();stopSpeakerTest();buffer.current=null;nextBuffer.current=null;bestRTT.current=Infinity;setState(snapshot);setCode(fresh.code);
  localStorage.setItem('needle-room-owner',fresh.code);
 });
 const remaining=state?.phase==='COUNTDOWN'?Math.max(0,Math.min(3,Math.ceil(((round?.opensAt??clock)-clock)/1000))):Math.max(0,Math.ceil(((round?.closesAt??clock)-clock)/1000));

 return <section className="room-panel" data-mode={mode} data-phase={state?.phase??'SETUP'} aria-busy={busy} inert={!hydrated}>
 {mode==='owner'&&!allowed&&<><div className="notice">Hosting is locked until the owner identity is securely provisioned.</div>{bootstrap&&<button className="button primary" disabled={busy} onClick={()=>act(async()=>{await call('bootstrap',{});location.reload()})}>Claim this private Site</button>}</>}
 {isTV&&allowed&&!state&&!error&&<p role="status">Opening game…</p>}
 {isTV&&allowed&&!state&&error&&<button className="button primary" onClick={()=>{opening.current=null;location.reload()}}>Retry</button>}
 {mode==='player'&&!state&&<form className="join-form" onSubmit={e=>{e.preventDefault();act(async()=>{epoch.current++;polling.current?.abort();setPlayerJoined(false);const r=await call('join',{code,name});setPlayerJoined(true);setCode(r.code);setState(await call<Snapshot>(`rooms/${r.code}?role=player`))})}}><label>Room code<input className="code-input" value={code} onChange={e=>{epoch.current++;setPlayerJoined(false);setError('');setCode(e.target.value.toUpperCase())}} maxLength={6} autoComplete="off" required placeholder="ABC234"/></label><label>Your name<input value={name} onChange={e=>setName(e.target.value)} maxLength={40} autoComplete="nickname" required placeholder="What should we call you?"/></label><button type="button" className="button secondary name-reroll" onClick={()=>setName(suggestPlayerName())}>↻ Another name</button><button className="button primary" disabled={busy||code.length!==6||!name.trim()}>Join the room ↗</button></form>}
 {updateRelease&&<section className="notice" role="alert"><strong>{isTV?'A TV update is ready.':'A game update is ready.'}</strong><p>Load it before continuing.</p><button className="button primary" onClick={()=>{releaseSpeakers();location.replace(location.pathname+'?release='+encodeURIComponent(updateRelease))}}>Load update</button></section>}
 {audioElsewhere&&<p className="notice" role="status">Audio moved to another TV tab. Tap here to use this TV instead.</p>}
 {error&&<p className="notice" role="alert">{error}</p>}
 {musicError&&<p className="notice" role="alert">{musicError}</p>}
 {state?.phase==='FINISHED'&&!connected&&<button className="button secondary reconnect-button finale-reconnect" onClick={()=>{halt();setState(null);setCode('');localStorage.removeItem('needle-room-'+mode)}}>Reconnect</button>}
 {state&&(state.phase==='FINISHED'?<FinalResults
  roomKey={state.code+':'+(state.round?.id??'finished')}
  players={state.players} playerId={state.playerId} mode={isTV?'tv':'phone'}
  startsAt={state.finaleStartsAt??state.revealEndsAt??null} getServerNow={()=>Date.now()+offset.current}
  onCue={isTV?playFinaleCue:undefined} onNewGame={isTV?startNewGame:undefined} busy={busy}
  soundtrack={state.postgameSongs?.length?<PostgamePlaylist songs={state.postgameSongs} playingId={connected?(isTV&&speakerLease.current?localPlaying:(state.nowPlaying?.id??null)):null}/>:undefined}
 />:<div className="lobby" data-phase={state.phase}>
 <header className="room-header">
  {isTV&&<div className="room-code-block"><div className="eyebrow">PLAYERS JOIN WITH THIS CODE</div><strong className="room-code">{state.code}</strong></div>}
  <div className="room-meta"><span className="live-dot" aria-hidden="true"/><span>{state.phase==='FINISHED'?'THE FINAL RANKING':round?`ROUND ${round.number} / ${GAME_ROUNDS}`:`${state.players.length} / 16 PLAYERS`}</span></div>
 </header>
 {state.phase==='LOBBY'&&<section className="start-panel" aria-label="Ready to start"><h2>Ready for the first song?</h2><ul><li role="status" aria-live="polite">{state.preparation?.status==='COMPLETE'?'✓ Music ready':state.preparation?.status==='FAILED'?'○ Music connection needs attention':`○ Getting music ready automatically — ${state.preparation?.progress??0}/${state.preparation?.clip_count??PREPARED_CLIPS} clips (${Math.round(100*(state.preparation?.progress??0)/Math.max(1,state.preparation?.clip_count??PREPARED_CLIPS))}%)`}</li><li>{state.displayReady?'✓ TV audio enabled':'○ Tap anywhere on the TV once to allow sound'}</li><li>{state.players.length>=2?'✓':'○'} {state.players.length} players joined · need at least 2</li></ul><button className="button primary" disabled={busy||state.preparation?.status!=='COMPLETE'||!state.displayReady||state.players.length<2} onClick={()=>command('start')}>Start game ▶</button></section>}
 {isTV&&(['LOBBY','PAUSED'].includes(state.phase)||(['PREPARING','COUNTDOWN','PLAYING'].includes(state.phase)&&(!sound||!audioConfirmed)))&&<section className="speaker-check" aria-label="Speaker check"><h2>TV audio</h2><p>{['COUNTDOWN','PLAYING'].includes(state.phase)?'Tap anywhere on this TV, or press a key, to allow sound.':(audioConfirmed?'TV sound is ready. The Rick Astley check is optional.':'Your browser needs one tap or keypress on this TV to allow sound. The Rick Astley check is optional.')}</p><button className="button secondary" onClick={()=>enableSound()} disabled={busy||!!updateRelease}>{checkBuffer.current?'Play Rick again ♪':'Play Rick Astley ♪'}</button>{sound&&!audioConfirmed&&<button className="button primary" onClick={()=>{stopSpeakerTest();setAudioConfirmed(true)}}>I heard it — ready</button>}{audioConfirmed&&<p role="status">{state.phase==='PREPARING'?'✓ TV audio enabled. Loading the next song…':state.phase==='PAUSED'?'✓ TV audio enabled. Use Resume on this TV.':'✓ TV audio enabled. Start the game on this TV.'}</p>}</section>}
 {state.phase==='LOBBY'&&mode!=='player'&&qr&&<figure className="qr join-card">
  <div className="join-card-top"><span className="eyebrow">YOUR PHONE IS YOUR CONTROLLER</span><span className="join-arrow" aria-hidden="true">↙</span></div>
  <h2>Get in on it.</h2><div className="qr-frame"><img src={qr} width="260" height="260" alt="Scan to join this room"/></div>
  <figcaption><strong>Scan. Join. Show off.</strong><span>PLAYER QR · scan, pick a name, join.</span></figcaption>
 </figure>}
 {!(mode==='player'&&state.phase==='FINISHED')&&<section className={'stage'+(state.phase==='LOBBY'?' lobby-intro':'')} aria-label="Game status">
  <div className="stage-copy">
   <div className="stage-eyebrow eyebrow">{state.phase==='LOBBY'?'GOOD MUSIC. QUESTIONABLE CONFIDENCE.':state.phase==='COUNTDOWN'?'EARS OPEN. THUMBS READY.':state.phase==='PLAYING'?'FOUR CHOICES. ONE SHOT.':state.phase==='REVEAL'?'AND THE ANSWER IS…':state.phase==='FINISHED'?'THAT’S A WRAP':state.phase==='PAUSED'?'A QUICK INTERMISSION':state.phase==='CANCELLED'?'THANKS FOR PLAYING':'THE NEXT TRACK IS UP'}</div>
   <h2 className="stage-title">{state.phase==='LOBBY'?(mode==='player'?<>You’re in.<br/><em>Ears ready?</em></>:<>The room’s<br/><em>warming up.</em></>):state.phase==='COUNTDOWN'?<>Here comes<br/><em>the drop.</em></>:state.phase==='PLAYING'?<>Know it?<br/><em>Show it.</em></>:state.phase==='REVEAL'?(round?.winnerId?<>Now that’s<br/><em>a good ear.</em></>:<>That was<br/><em>a tough one.</em></>):state.phase==='FINISHED'?<>A room full<br/><em>of legends.</em></>:state.phase==='PAUSED'?<>Hold that<br/><em>thought.</em></>:state.phase==='CANCELLED'?<>One more<br/><em>encore?</em></>:<>Stay tuned.<br/><em>It’s coming.</em></>}</h2>
   {state.phase==='LOBBY'&&<p className="stage-intro">{mode==='player'?'Keep an eye on the TV. Your next big moment is one song away.':'Grab your phone. Gather your people. Find out who really knows the music.'}</p>}
  </div>
  {state.phase==='COUNTDOWN'&&<div className="round-timer"  aria-hidden="true"><span className="timer-value" key={remaining}>{remaining>0?remaining:'GO!'}</span><span className="timer-label">GET READY</span></div>}
  {isTV&&['LOBBY','PREPARING','PLAYING'].includes(state.phase)&&<Soundwave/>}
  {state.phase==='LOBBY'&&isTV&&<div className="lobby-sticker" aria-hidden="true"><span>{GAME_ROUNDS} SONGS</span><strong>ONE<br/>LEGEND.</strong><span>MAKE IT YOU ↗</span></div>}
  {['REVEAL','FINISHED'].includes(state.phase)&&<PartyConfetti key={state.phase}/>}
  <p className="phase" role="status" aria-live="polite">{!connected?'Reconnecting…':state.phase==='PREPARING'?'Get ready…':state.phase==='COUNTDOWN'?(remaining>0?`Get ready: ${remaining}`:'Go!'):state.phase==='PLAYING'?'Take your time. Waiting for everyone to answer or skip.' :state.phase==='REVEAL'?(round?.winnerId?`${state.players.find(p=>p.id===round.winnerId)?.name??'Someone'} got it!`:'Nobody got it this time.'):state.phase==='PAUSED'?'Paused. Waiting for the host and TV.':state.phase==='FINISHED'?'Ten rounds. A room full of legends.':state.phase==='CANCELLED'?'This game has ended.':'Waiting for the room to fill up.'}</p>
 </section>}

 {mode==='player'&&state.phase==='REVEAL'&&state.attempt?.skipped&&<div className="skip-result" role="status">Skipped <strong>−1 point</strong></div>}
 {round&&['PLAYING','REVEAL'].includes(state.phase)&&<div className={'answers '+(state.phase==='REVEAL'?'answer-reveal':'')} key={round.id}>{round.options.map((o,i)=><button className={'answer '+(round.correctOptionId===o.id?'correct ':'')+(mode==='player'&&selectedOption===o.id?'selected ':'')} aria-pressed={mode==='player'?selectedOption===o.id:undefined} key={o.id} disabled={mode!=='player'||!open} onClick={()=>{setPicked({roundId:round.id,optionId:o.id});setPending(true);act(async()=>{try{await call(`rooms/${code}/answer`,{roundId:round.id,optionId:o.id});const next=await call<Snapshot>(`rooms/${code}?role=player`);setState(next)}catch(error){setPicked(null);throw error}finally{setPending(false)}})}}><b className="answer-letter">{'ABCD'[i]}</b><span><strong>{o.title}</strong><small>{o.artist}</small></span>{mode==='player'&&selectedOption===o.id&&<span className="answer-pick">Your pick</span>}{round.correctOptionId===o.id&&<span className="answer-check" aria-label="Correct answer">✓</span>}{mode==='player'&&state.phase==='REVEAL'&&selectedOption===o.id&&state.attempt?.points!==undefined&&<span className="result-overlay" data-outcome={state.attempt.correct?'correct':'wrong'} aria-hidden="true"><b>{state.attempt.points>0?'+':'−'}{Math.abs(state.attempt.points)}</b><span>{state.attempt.correct?(state.attempt.points===3?'First!':'Correct!'):'Wrong guess'}</span></span>}</button>)}</div>}
 {mode==='player'&&round&&state.phase==='PLAYING'&&<button className="button secondary skip-answer" disabled={!open} onClick={()=>{setPending(true);act(async()=>{try{await call(`rooms/${code}/skip`,{roundId:round.id});setState(await call<Snapshot>(`rooms/${code}?role=player`))}finally{setPending(false)}})}}>Skip · −1 point</button>}
 {mode==='player'&&['PLAYING','REVEAL'].includes(state.phase)&&<p className="player-feedback" data-locked={!!state.attempt||pending} aria-live="polite">{pending?'Submitting your guess…':state.attempt?(state.phase==='REVEAL'?(state.attempt.skipped?'Skipped. −1 point.':state.attempt.correct?`${state.attempt.points===3?'First!':'Correct!'} +${state.attempt.points} ${state.attempt.points===1?'point':'points'}`:'Wrong guess. −3 points.'):'Guess locked in. Waiting for the other players…'):'One guess. First correct +3; other correct +1; wrong −3; skip −1.'}</p>}
 {state.phase==='REVEAL'&&state.scoredRounds>=GAME_ROUNDS?<section className="standings-panel finale-pending" role="status"><span className="finale-pending-star" aria-hidden="true">✦</span><div className="eyebrow">THE ENCORE IS COMING</div><h2>Who owns<br/>the room?</h2><p>Final results incoming.</p></section>:['LOBBY','PLAYING','REVEAL','COUNTDOWN'].includes(state.phase)&&<section hidden={!['LOBBY','COUNTDOWN'].includes(state.phase)} className="standings-panel" aria-label={state.phase==='LOBBY'?'Players in the room':'Full player ranking'}>
  <div className="standings-heading"><h2>{state.phase==='LOBBY'?'THE LINEUP':'THE LEADERBOARD'}</h2><span>{state.players.length} {state.players.length===1?'player':'players'}{state.phase==='LOBBY'?' and counting':''}</span></div>
  <StandingsList players={state.players} playerId={state.playerId} showMovement={['REVEAL','COUNTDOWN','FINISHED'].includes(state.phase)} onRemove={mode==='owner'&&state.phase==='LOBBY'?id=>act(async()=>{await call(`rooms/${code}/remove-player`,{playerId:id})}):undefined}/>
  {state.players.length===0&&<div className="lineup-empty"><span aria-hidden="true">✳</span><h3>The best seat is yours.</h3><p>Be the first to scan in. The room starts with you.</p></div>}
  {state.phase==='LOBBY'&&state.players.length>0&&state.players.length<16&&<p className="lineup-invite"><span aria-hidden="true">＋</span> There’s room for {16-state.players.length} more. Get your people in here.</p>}
 </section>}
 {mode==='owner'&&<div className="host-actions">{state.phase==='LOBBY'&&state.preparation?.status==='FAILED'&&<><p role="alert">The library server couldn’t finish this game’s music.</p><button className="button secondary" disabled={busy} onClick={()=>command('prepare')}>Retry music connection</button></>}{['PLAYING','COUNTDOWN','REVEAL','PREPARING'].includes(state.phase)&&<button className="button secondary" onClick={()=>command('pause')}>Pause after this round</button>}{state.phase==='PAUSED'&&<><p role="status">{state.preparation?`${state.preparation.status.toLowerCase()} · ${state.preparation.progress} / ${state.preparation.clip_count} clips${state.preparation.error?' · '+state.preparation.error:''}`:'Waiting for recovery'}</p><button className="button secondary" onClick={()=>command('prepare')}>Prepare replacements / retry</button><button className="button primary" onClick={()=>command('resume')}>Resume</button></>}{!['FINISHED','CANCELLED'].includes(state.phase)&&<button className="button secondary" onClick={()=>command('cancel')}>End game</button>}{<button className="button primary" disabled={busy} onClick={startNewGame}>Start new game</button>}</div>}
 {state&&!connected&&<button className="button secondary reconnect-button" onClick={()=>{halt();setState(null);setCode('');localStorage.removeItem('needle-room-'+mode)}}>Reconnect</button>}
 </div>)} </section>
}
