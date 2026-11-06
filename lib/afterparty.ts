/** A bounded two-source playlist. Timing uses the audio clock, never room scores. */
export function startAfterparty(
 context:AudioContext, tracks:readonly string[], startsAt:number,
 load:(id:string,signal:AbortSignal)=>Promise<AudioBuffer>,
 onError:(message:string)=>void,onPlaying:(id:string|null)=>void=()=>{},
){
 const abort=new AbortController(),sources=new Map<AudioBufferSourceNode,GainNode>();
 const timeline=new Map<AudioBufferSourceNode,{id:string,start:number,end:number}>();let current:string|null=null;
 const announce=()=>{let latest:{id:string,start:number}|null=null;const clock=context.currentTime;if(context.state==='running')for(const track of timeline.values())if(track.start<=clock&&track.end>clock&&(!latest||track.start>latest.start))latest=track;const id=latest?.id??null;if(id!==current){current=id;onPlaying(id)}};
 const watcher=setInterval(announce,100);
 let stopped=false,recovering=false,timer:ReturnType<typeof setTimeout>|undefined;
 const curve=(incoming:boolean)=>Float32Array.from({length:64},(_,i)=>incoming?Math.sin(i/63*Math.PI/2):Math.cos(i/63*Math.PI/2));
 const stop=()=>{if(stopped)return;stopped=true;abort.abort();clearTimeout(timer);clearInterval(watcher);for(const [source,gain] of sources){source.onended=null;try{source.stop()}catch{}source.disconnect();gain.disconnect()}sources.clear();timeline.clear();if(current!==null){current=null;onPlaying(null)}};
 const schedule=async(index:number,requestedStart:number,lookahead=5)=>{
  if(stopped)return;
  // A suspended audio clock must not grow a queue of future sources.
  if(requestedStart-context.currentTime>lookahead+.05){timer=setTimeout(()=>void schedule(index,requestedStart,lookahead),250);return}
  try{
   const buffer=await load(tracks[index],abort.signal);if(stopped)return;if(recovering){recovering=false;onError('')}
   const start=Math.max(context.currentTime+.02,requestedStart),duration=buffer.duration;
   if(!Number.isFinite(duration)||duration<=0)throw Error('Invalid post-game clip');
   const fade=Math.min(2,duration/4),end=start+duration;
   const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;
   source.connect(gain);gain.connect(context.destination);sources.set(source,gain);timeline.set(source,{id:tracks[index],start,end});
   gain.gain.setValueAtTime(0,start);gain.gain.setValueCurveAtTime(curve(true),start,fade);
   gain.gain.setValueAtTime(1,end-fade);gain.gain.setValueCurveAtTime(curve(false),end-fade,fade);
   source.onended=()=>{sources.delete(source);timeline.delete(source);source.disconnect();gain.disconnect();announce()};
   source.start(start);source.stop(end);
   const next=end-fade,lead=Math.min(5,duration/3);
   timer=setTimeout(()=>void schedule((index+1)%tracks.length,next,lead),Math.max(0,(next-context.currentTime-lead)*1000));
  }catch(error){if(stopped||abort.signal.aborted)return;recovering=true;onError('Post-game music is temporarily unavailable. Retrying…');timer=setTimeout(()=>void schedule(index,context.currentTime+.1,lookahead),3000)}
 };
 if(tracks.length)void schedule(0,startsAt);
 return stop;
}
