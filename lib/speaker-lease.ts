/** One speaker output per browser profile, including separate TV tabs. */
export async function takeSpeakerLease(onLost:()=>void):Promise<()=>void>{
 const id=crypto.randomUUID(),controller=new AbortController();
 const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('needle-rush-speakers');
 let released=false,unlock:(()=>void)|undefined;
 const release=()=>{if(released)return;released=true;controller.abort();unlock?.();channel?.close()};
 if(channel)channel.onmessage=event=>{if(event.data?.type==='claim'&&event.data.id!==id){onLost();release()}};
 channel?.postMessage({type:'claim',id});
 try{
  if(navigator.locks){
   await new Promise<void>((resolve,reject)=>{
    const timeout=setTimeout(()=>{release();reject(Error('Close the other TV tab, then play Rick here.'))},4000);
    navigator.locks.request('needle-rush-speakers',{signal:controller.signal},async()=>{
     if(released)return;
     await new Promise<void>(done=>{unlock=done;clearTimeout(timeout);resolve()});
    }).catch(error=>{clearTimeout(timeout);reject(error)});
   });
  }else await new Promise(resolve=>setTimeout(resolve,100));
  if(released)throw Error('Audio moved to another TV tab.');
  return release;
 }catch(error){release();throw error}
}
