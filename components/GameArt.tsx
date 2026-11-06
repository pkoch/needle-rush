/** Original, code-drawn game artwork. No external image or icon assets. */
export function PlayerAvatar({id}:{id:string}) {
  const seed=Array.from(id).reduce((value,char)=>(value*31+char.charCodeAt(0))>>>0,0);
  const variant=seed%6;
  return <span className="player-avatar" data-color={variant} aria-hidden="true">
    <svg viewBox="0 0 48 48" fill="none">
      {variant%3===0?<><path d="M10 15c0-7 28-7 28 0v19c0 9-28 9-28 0V15Z" fill="currentColor"/><path d="M17 24v4m14-4v4m-14 6c4 4 10 4 14 0" stroke="#242028" strokeWidth="3" strokeLinecap="round"/></>:variant%3===1?<><path d="m24 6 5 8 10-1-2 10 7 8-10 4-4 10-8-7-10 2-1-10-8-6 9-5 2-10 10 2Z" fill="currentColor"/><path d="M17 22v4m13-4v4m-12 5c3 4 8 4 12 0" stroke="#242028" strokeWidth="3" strokeLinecap="round"/></>:<><circle cx="24" cy="24" r="19" fill="currentColor"/><path d="m14 21 6 3-6 3m20-6-6 3 6 3m-15 7h10" stroke="#242028" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></>}
    </svg>
  </span>;
}

export function Soundwave() {
  return <div className="soundwave" aria-hidden="true">{Array.from({length:17},(_,i)=><i key={i} style={{height:([28,46,66,40,82,58,100,74,48,92,62,80,46,68,36,54,24][i])+'%',animationDelay:-(i%7)*.13+'s'}}/>)}</div>;
}

export function PartyConfetti() {
  return <div className="party-confetti" aria-hidden="true">{Array.from({length:18},(_,i)=><i key={i} data-color={i%6} style={{left:((i*37)%100)+'%',animationDelay:(i%5)*.08+'s'}}/>)}</div>;
}
