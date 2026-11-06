"use client";
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {PlayerAvatar} from './GameArt';
type Player={id:string,name:string,score:number};
type Direction='up'|'down';
function AnimatedScore({score,direction}:{score:number,direction?:Direction}){
 const [shown,setShown]=useState(score),value=useRef(score);
 useEffect(()=>{
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){value.current=score;setShown(score);return}
  const from=value.current,started=performance.now();let frame=0;
  const tick=(stamp:number)=>{const progress=Math.min(1,(stamp-started)/700);value.current=from+(score-from)*(1-Math.pow(1-progress,3));setShown(Math.round(value.current));if(progress<1)frame=requestAnimationFrame(tick)};
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[score]);
 return <strong className="player-score" aria-label={`${score} points${direction?', moved '+direction+' in the ranking':''}`}><span aria-hidden="true">{shown} <small>pts</small></span>{direction&&<span key={score+direction} className="rank-trend" data-direction={direction} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d={direction==='up'?'M12 20V4M5 11l7-7 7 7':'M12 4v16M5 13l7 7 7-7'} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></span>}</strong>;
}
export default function StandingsList({players,playerId,onRemove,showMovement=true}:{players:Player[],playerId:string|null,showMovement?:boolean,onRemove?:(id:string)=>void}){
 const list=useRef<HTMLOListElement|null>(null),previous=useRef(new Map<string,number>()),scores=useRef(new Map<string,number>());
 const priorRanks=useRef(new Map<string,number>()),[directions,setDirections]=useState(new Map<string,Direction>());
 const ordered=[...players].sort((a,b)=>b.score-a.score);
 const signature=ordered.map(p=>`${p.id}:${p.score}`).join('|');
 useLayoutEffect(()=>{
  const ranks=new Map(ordered.map(p=>[p.id,ordered.findIndex(other=>other.score===p.score)+1])),movement=new Map<string,Direction>();
  for(const [id,rank] of ranks){const old=priorRanks.current.get(id);if(old!==undefined&&old!==rank)movement.set(id,rank<old?'up':'down')}
  if(priorRanks.current.size)setDirections(movement);priorRanks.current=ranks;
  const positions=new Map<string,number>(),animations:Animation[]=[];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  list.current?.querySelectorAll<HTMLElement>('[data-player-id]').forEach(row=>{
   const id=row.dataset.playerId!,top=row.offsetTop;positions.set(id,top);
   const old=previous.current.get(id);
   if(!reduced&&old!==undefined&&old!==top)animations.push(row.animate([{transform:`translateY(${old-top}px)`},{transform:'translateY(0)'}],{duration:650,easing:'cubic-bezier(.2,.8,.2,1)'}));
  });
  ordered.forEach(player=>{
   const old=scores.current.get(player.id),row=list.current?.querySelector<HTMLElement>(`[data-player-id="${CSS.escape(player.id)}"]`);
   if(!reduced&&row&&old!==undefined&&old!==player.score)animations.push(row.animate([{backgroundColor:'#604287',boxShadow:'0 0 0 3px #a68cff, 0 4px 0 #160d20'},{backgroundColor:getComputedStyle(row).backgroundColor,boxShadow:getComputedStyle(row).boxShadow}],{duration:750,easing:'ease-out'}));
  });
  scores.current=new Map(ordered.map(player=>[player.id,player.score]));previous.current=positions;
  return()=>animations.forEach(animation=>animation.cancel());
 },[signature]);
 return <ol ref={list} className="standings live-leaderboard" data-dense={ordered.length>8} aria-label="Ranking, highest score first">{ordered.map(p=><li key={p.id} data-player-id={p.id} data-you={p.id===playerId} data-rank={ordered.findIndex(x=>x.score===p.score)+1} data-accent={Array.from(p.id).reduce((v,c)=>(v*31+c.charCodeAt(0))>>>0,0)%6}>
  <b className="player-rank">{ordered.findIndex(x=>x.score===p.score)+1}</b><PlayerAvatar id={p.id}/><span className="player-name" title={p.name}>{p.name}{p.id===playerId?' (you)':''}</span><AnimatedScore score={p.score} direction={showMovement?directions.get(p.id):undefined}/>{onRemove&&<button aria-label={'Remove '+p.name} onClick={()=>onRemove(p.id)}>Remove</button>}
 </li>)}</ol>;
}
