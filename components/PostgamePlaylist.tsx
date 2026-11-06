"use client";
import {useState, type CSSProperties} from 'react';
import {PlayerAvatar} from './GameArt';

type SongResult={playerId:string,name:string,outcome:'correct'|'wrong'|'skipped'|'unanswered'};
export type PostgameSong={id:string,title:string,artist:string,artworkUrl?:string|null,results?:SongResult[]};
function initials(name:string){
 const words=name.trim().split(/\s+/).filter(Boolean);
 return (words.length>1?Array.from(words[0])[0]+Array.from(words[words.length-1])[0]:Array.from(words[0]??'?').slice(0,2).join('')).toLocaleUpperCase();
}
function Results({results}:{results:SongResult[]}){
 const players=results.filter(player=>player.outcome==='correct'||player.outcome==='wrong');
 if(!players.length)return null;
 return <div className="song-results" role="list" aria-label="Player results" data-dense={players.length>8}>{players.map(player=>{
  const correct=player.outcome==='correct',label=`${player.name}: ${correct?'Correct':'Wrong'}`;
  return <span key={player.playerId} role="listitem" className="song-result-badge" data-outcome={player.outcome} data-result-player-id={player.playerId} title={label} aria-label={label}>
   <PlayerAvatar id={player.playerId}/><span className="song-result-name" aria-hidden="true">{player.name}</span><span className="song-result-initials" aria-hidden="true">{initials(player.name)}</span><b className="song-result-mark" aria-hidden="true">{correct?'✓':'×'}</b>
  </span>;
 })}</div>;
}
function Cover({song}:{song:PostgameSong}){
 const [failed,setFailed]=useState(false);
 return <div className="album-cover">{song.artworkUrl&&!failed?<img src={song.artworkUrl} alt={`Album art for ${song.title}`} onError={()=>setFailed(true)}/>:<svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="33" fill="currentColor"/><circle cx="40" cy="40" r="13" fill="var(--violet)"/><circle cx="40" cy="40" r="4" fill="var(--paper)"/><circle cx="40" cy="40" r="25" fill="none" stroke="var(--paper)" opacity=".2"/></svg>}</div>;
}
export default function PostgamePlaylist({songs,playingId}:{songs:PostgameSong[],playingId:string|null}){
 const current=songs.find(song=>song.id===playingId);
 return <section className="postgame-playlist" aria-label="Songs from this game" style={{'--soundtrack-rows':Math.ceil(songs.length/2)} as CSSProperties}>
  <div className="standings-heading"><h2>THE SOUNDTRACK <small>{songs.length} TRACKS</small></h2><div className="song-result-legend" aria-label="Result key"><span data-outcome="correct">✓ Correct</span><span data-outcome="wrong">× Wrong</span></div></div>
  <div className="now-playing-card" aria-live="polite">{current?<><Cover key={current.id+(current.artworkUrl??'')} song={current}/><div><span className="eyebrow">NOW PLAYING ON THE TV</span><strong>{current.title}</strong><span>{current.artist}</span></div></>:<p>The soundtrack will light up when the TV music starts.</p>}</div>
  <ol className="postgame-songs" aria-label="Match songs and player results">{songs.map((song,index)=><li key={song.id} data-track-id={song.id} aria-current={song.id===playingId?'true':undefined}>
   <div className="song-heading"><b className="song-number">{String(index+1).padStart(2,'0')}</b><div className="song-details"><strong title={song.title}>{song.title}</strong><span title={song.artist}>{song.artist}</span></div>{song.id===playingId&&<span className="playing-marker" aria-label="Currently playing"><i/><i/><i/></span>}</div>
   {song.results&&<Results results={song.results}/>}
  </li>)}</ol>
 </section>;
}
