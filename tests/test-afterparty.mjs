import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as wait} from 'node:timers/promises';
import {startAfterparty} from '../lib/afterparty.ts';
test('now playing follows the audio clock rather than prefetching, including wrap and stop',async()=>{
 const original=globalThis.setTimeout,clear=globalThis.clearTimeout,timers=[],nodes=[],events=[];
 globalThis.setTimeout=(callback,delay)=>{const timer={callback,delay};timers.push(timer);return timer};globalThis.clearTimeout=()=>{};
 const context={currentTime:0,state:'running',destination:{},createBufferSource(){const node={connect(){},disconnect(){},start(){},stop(){},onended:null};nodes.push(node);return node},createGain(){return {connect(){},disconnect(){},gain:{setValueAtTime(){},setValueCurveAtTime(){}}}}};
 let stop;
 try{
  stop=startAfterparty(context,['first','second'],5,async()=>({duration:30}),()=>{},id=>events.push(id));
  await wait(130);assert.deepEqual(events,[]);
  context.currentTime=5.1;await wait(130);assert.deepEqual(events,['first']);
  context.currentTime=28;timers.shift().callback();await wait(130);assert.deepEqual(events,['first']);
  context.currentTime=33.1;await wait(130);assert.deepEqual(events,['first','second']);
  context.currentTime=56;nodes[0].onended();timers.shift().callback();await wait(130);assert.deepEqual(events,['first','second']);
  context.currentTime=61.1;await wait(130);assert.deepEqual(events,['first','second','first']);
  stop();assert.equal(events.at(-1),null);
 }finally{stop?.();globalThis.setTimeout=original;globalThis.clearTimeout=clear}
});
