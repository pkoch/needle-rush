import {test,expect,type Page} from '@playwright/test';

async function mockSpeakerTest(page:Page){
 const samples=8000*8,body=Buffer.alloc(44+samples*2);body.write('RIFF',0);body.writeUInt32LE(36+samples*2,4);body.write('WAVEfmt ',8);body.writeUInt32LE(16,16);body.writeUInt16LE(1,20);body.writeUInt16LE(1,22);body.writeUInt32LE(8000,24);body.writeUInt32LE(16000,28);body.writeUInt16LE(2,32);body.writeUInt16LE(16,34);body.write('data',36);body.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)body.writeInt16LE(Math.round(4000*Math.sin(i*2*Math.PI*440/8000)),44+i*2);
 await page.route('**/sound-check',route=>route.fulfill({contentType:'audio/wav',body}));
}

async function blockAutomaticAudio(page:Page){
 await page.addInitScript(()=>{const Native=window.AudioContext;window.AudioContext=class extends Native{constructor(){super();let unlocked=false;Object.defineProperty(this,'state',{get:()=>unlocked?'running':'suspended'});const resume=this.resume.bind(this);this.resume=async()=>{unlocked=true;await resume()}}} as typeof AudioContext});
}

async function openFixtureTV(page:Page){
 await page.route('**/api/rooms',route=>route.fulfill({json:{code:'ABC234'}}));
 await page.request.get('/signin-with-chatgpt?return_to=/display');await page.goto('/display');await expect(page.locator('.room-panel')).not.toHaveAttribute('inert','');
}

test('responsive phone answers remain in the viewport',async({browser})=>{
 const ctx=await browser.newContext({viewport:{width:390,height:844}});await ctx.addInitScript(()=>localStorage.setItem('needle-room-player','ABC234'));
 const page=await ctx.newPage();const stamp=Date.now();
 await page.route('**/api/rooms/ABC234?role=player',route=>route.fulfill({json:{code:'ABC234',phase:'PLAYING',revision:1,scoredRounds:0,serverTime:Date.now(),preparation:null,playerId:'p0',attempt:null,players:[{id:'p0',name:'Player',score:0}],round:{id:'r',number:1,options:[{id:'a',title:'A Song with a Longer Title',artist:'An Artist'},{id:'b',title:'Second Choice',artist:'Another Band'},{id:'c',title:'Something Familiar',artist:'A Third Artist'},{id:'d',title:'Last Chance',artist:'The Fourth Band'}],opensAt:stamp-1000,closesAt:stamp+30000}}}));
 await page.goto('/join');await expect(page.locator('.answer')).toHaveCount(4);await expect(page.locator('.answer').last()).toBeInViewport();await expect(page.getByRole('button',{name:'Skip · −1 point',exact:true})).toBeInViewport();await expect(page.locator('.room-code-block')).toHaveCount(0);const edges=await page.locator('.answer,.skip-answer').evaluateAll(elements=>elements.map(el=>({left:el.getBoundingClientRect().left,width:el.getBoundingClientRect().width})));for(const edge of edges){expect(Math.abs(edge.left-edges[0].left)).toBeLessThan(1);expect(Math.abs(edge.width-edges[0].width)).toBeLessThan(1)}await expect(page.locator('.answer').first()).toBeEnabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:'outputs/phone-round.png',fullPage:false});await ctx.close();
});

test('real MP3 plays through guesses and stops only after the reveal',async({browser})=>{
 test.skip(!process.env.NEEDLE_REAL_CLIP,'Requires an existing private prepared clip path');
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const clip=await readFile(process.env.NEEDLE_REAL_CLIP!);const sha=createHash('sha256').update(clip).digest('hex');
 const host=await browser.newContext();const owner=await host.newPage();await owner.goto('/signin-with-chatgpt?return_to=/host');
 const headers={Origin:'http://127.0.0.1:5173'};
 let created=await (await host.request.post('/api/rooms',{headers,data:{}})).json();await host.request.post(`/api/rooms/${created.code}/cancel`,{headers,data:{}});created=await (await host.request.post('/api/rooms',{headers,data:{}})).json();const code=created.code,prefix='/api/rooms/'+code;
 const connector={...headers,Authorization:'Bearer local-integration-fixture-not-a-production-secret'};
 await host.request.post(prefix+'/prepare',{headers,data:{}});const {job}=await (await host.request.post('/api/connector/claim',{headers:connector,data:{}})).json();expect(job).toBeTruthy();
 const lease={...connector,'X-Job-Lease':job.lease};
 for(let slot=1;slot<=job.count;slot++){
  const q={slot,options:[0,1,2,3].map(i=>({id:String(i),title:`Audio fixture ${slot}-${i}`,artist:'Browser test'})),correctOptionId:'0',sha256:sha};
  expect((await host.request.post(`/api/connector/jobs/${job.id}/question`,{headers:lease,data:q})).ok()).toBeTruthy();
  expect((await host.request.post(`/api/connector/jobs/${job.id}/clip/${slot}`,{headers:{...lease,'Content-Type':'audio/mpeg'},data:clip})).ok()).toBeTruthy();
 }
 expect((await host.request.post(`/api/connector/jobs/${job.id}/finish`,{headers:lease,data:{}})).ok()).toBeTruthy();
 const player=await browser.newContext({viewport:{width:390,height:844}});const phone=await player.newPage();await phone.goto('/join?code='+code);await expect(phone.locator('.room-panel')).not.toHaveAttribute('inert','');await phone.getByLabel('Your name').fill('Audio player');await phone.getByRole('button',{name:'Join the room'}).click();await expect(phone.getByText('Audio player (you)',{exact:true})).toBeVisible();await expect(phone.locator('.room-code')).toHaveCount(0);
 const friend=await browser.newContext();expect((await friend.request.post('/api/join',{headers,data:{code,name:'Audio friend'}})).ok()).toBeTruthy();
 const display=await browser.newContext({viewport:{width:1920,height:1080}});
 await display.addInitScript({content:`window.__audio={durations:[],peaks:[],starts:[],stops:[],gains:[],history:[]};setInterval(()=>{if(window.__audio.gains[0])window.__audio.history.push({at:Date.now(),gain:window.__audio.gains[0].gain.value})},50);const createGain=AudioContext.prototype.createGain;AudioContext.prototype.createGain=function(){const g=createGain.call(this);window.__audio.gains.push(g);return g};const decode=AudioContext.prototype.decodeAudioData;AudioContext.prototype.decodeAudioData=async function(data){const b=await decode.call(this,data);if(b.duration<10)return b;window.__audio.durations.push(b.duration);let peak=0;const values=b.getChannelData(0);for(let i=0;i<values.length;i+=64)peak=Math.max(peak,Math.abs(values[i]));window.__audio.peaks.push(peak);return b};const make=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(){const s=make.call(this),start=s.start.bind(s),stop=s.stop.bind(s);s.start=(...args)=>{if(s.buffer?.duration<10)return start(...args);window.__audio.starts.push(Date.now());return start(...args)};s.addEventListener('ended',()=>{if(s.buffer?.duration>10)window.__audio.stops.push(Date.now())});s.stop=(...args)=>stop(...args);return s}`});
 await display.request.get('/signin-with-chatgpt?return_to=/display');const tv=await display.newPage();await blockAutomaticAudio(tv);await tv.addInitScript({content:`window.__roundTimes={};new MutationObserver(()=>{if(document.querySelector('.answer.correct')&&!window.__roundTimes.reveal)window.__roundTimes.reveal=Date.now();if(document.querySelector('.room-header')?.textContent.includes('ROUND 2 / 10')&&!window.__roundTimes.next)window.__roundTimes.next=Date.now()}).observe(document,{subtree:true,childList:true,attributes:true})`});await mockSpeakerTest(tv);await tv.goto('/display');await expect(tv.locator('.room-panel')).not.toHaveAttribute('inert','');await expect(tv.locator('.room-code')).toHaveText(code);let checks=0;tv.on('request',r=>{if(r.url().endsWith('/sound-check'))checks++});await tv.locator('.room-header').click();await expect(tv.getByText('✓ TV audio enabled. Start the game on this TV.')).toBeVisible();
 await expect(phone.getByRole('button',{name:'Start game',exact:false})).toBeEnabled();await tv.screenshot({path:'outputs/tv-controller-lobby25.png',fullPage:true});const started=phone.waitForResponse(r=>r.url().endsWith('/start')&&r.request().method()==='POST');const simultaneous=await Promise.all([phone.getByRole('button',{name:'Start game',exact:false}).click(),friend.request.post(prefix+'/start',{headers,data:{}})]);expect((await started).status()).toBe(200);expect(simultaneous[1]!.status()).toBe(200);
 await expect(phone.locator('.answer').first()).toBeEnabled({timeout:15000});
 await expect.poll(()=>tv.evaluate(()=>((window as any).__audio.starts.length))).toBe(1);
 expect(checks).toBe(0);const facts=await tv.evaluate(()=>((window as any).__audio));expect(facts.durations[0]).toBeGreaterThan(29.8);expect(facts.durations[0]).toBeLessThan(30.3);expect(facts.peaks[0]).toBeGreaterThan(.001);
 const first=phone.waitForResponse(r=>r.url().endsWith('/answer')&&r.request().method()==='POST');await phone.locator('.answer').first().click();expect((await first).status()).toBe(200);await expect(phone.getByText('Guess locked in. Waiting for the other players…')).toBeVisible();expect(await phone.locator('.answer.correct').count()).toBe(0);await expect(phone.locator('.answer.selected')).toHaveCount(1);await expect(phone.locator('.answer').first()).toHaveAttribute('aria-pressed','true');expect(await tv.locator('.answer.correct,.answer.selected').count()).toBe(0);const before=await (await player.request.get(prefix+'?role=player')).json();expect(before.attempt.correct).toBeUndefined();expect(before.round.correctOptionId).toBeUndefined();await friend.addInitScript(code=>localStorage.setItem('needle-room-player',code),code);const second=await friend.newPage();await second.goto('/join?code='+code);await expect(second.locator('.answer').first()).toBeEnabled();const done=second.waitForResponse(r=>r.url().endsWith('/answer')&&r.request().method()==='POST');await second.locator('.answer').first().click();expect((await done).status()).toBe(200);const acceptedAt=Date.now();const revealState=await (await friend.request.get(prefix+'?role=player')).json();expect(revealState.phase).toBe('REVEAL');expect(revealState.revealEndsAt-revealState.round.closesAt).toBe(1500);
 await expect(phone.locator('.result-overlay')).toContainText('+3');await expect(second.locator('.result-overlay')).toContainText('+1');
 await expect.poll(()=>tv.evaluate(at=>((window as any).__audio.history.some((sample:any)=>sample.at>=at&&sample.at<at+1500&&sample.gain>.99)),acceptedAt)).toBeTruthy();
 await expect(tv.getByText('ROUND 2 / 10',{exact:true})).toBeVisible({timeout:6000});
 const times=await tv.evaluate(()=>((window as any).__roundTimes));const transitionMs=times.next-times.reveal;expect(transitionMs).toBeGreaterThan(0);expect(transitionMs).toBeLessThan(2700);
 const secondRound=await (await host.request.get(prefix+'?role=owner')).json();expect(secondRound.round.closesAt).toBeNull();expect(secondRound.round.opensAt-secondRound.serverTime).toBeGreaterThan(1800);await expect(phone.locator('.answer')).toHaveCount(0);await expect(tv.locator('.round-timer')).toBeVisible();
 await expect.poll(()=>tv.evaluate(at=>((window as any).__audio.history.some((sample:any)=>sample.at>at+1400&&sample.at<at+3500&&sample.gain>.1&&sample.gain<.9)),acceptedAt)).toBeTruthy();
 await expect.poll(()=>tv.evaluate(()=>((window as any).__audio.stops.length)),{timeout:4000}).toBeGreaterThan(0);const stopAt=await tv.evaluate(()=>((window as any).__audio.stops[0]));expect(stopAt-acceptedAt).toBeGreaterThan(3100);expect(stopAt-acceptedAt).toBeLessThan(4400);
 console.log('Feedback stage',transitionMs,'ms; old audio ended after',stopAt-acceptedAt,'ms');
 await expect(tv.locator('.round-timer,.round-progress')).toHaveCount(0);
 await expect(phone.getByRole('button',{name:'Skip · −1 point',exact:true})).toBeEnabled();
 expect((await friend.request.post(prefix+'/answer',{headers,data:{roundId:secondRound.round.id,optionId:'1'}})).ok()).toBeTruthy();
 await tv.route('**/heartbeat',route=>route.fulfill({json:{ok:true}}));
 await tv.waitForTimeout(31000);
 const waiting=await (await host.request.get(prefix+'?role=owner')).json();expect(waiting.phase).toBe('PLAYING');expect(waiting.round.id).toBe(secondRound.round.id);expect(waiting.round.correctOptionId).toBeUndefined();
 await tv.unroute('**/heartbeat');
 let delayThird=true;
 await tv.route('**/api/rooms/*?role=owner',async route=>{const response=await route.fetch();const snapshot=await response.json();if(delayThird&&snapshot.round?.number===3&&['COUNTDOWN','PLAYING'].includes(snapshot.phase)){delayThird=false;await new Promise(resolve=>setTimeout(resolve,1100))}await route.fulfill({response,json:snapshot})});
 await phone.getByRole('button',{name:'Skip · −1 point',exact:true}).click();
 await expect.poll(()=>tv.evaluate(()=>((window as any).__audio.starts.length)),{timeout:7000}).toBe(3);
 await expect.poll(async()=> (await (await host.request.get(prefix+'?role=owner')).json()).phase).toBe('PLAYING');
 let playing=await (await host.request.get(prefix+'?role=owner')).json();expect(playing.phase).toBe('PLAYING');expect(playing.scoredRounds).toBe(2);
 expect(playing.players.find((p:any)=>p.name==='Audio player').score).toBe(2);expect(playing.players.find((p:any)=>p.name==='Audio friend').score).toBe(-2);
 expect((await host.request.post(prefix+'/pause',{headers,data:{}})).ok()).toBeTruthy();
 expect((await friend.request.post(prefix+'/skip',{headers,data:{roundId:playing.round.id}})).ok()).toBeTruthy();
 await phone.getByRole('button',{name:'Skip · −1 point',exact:true}).click();
 await expect.poll(async()=> (await (await host.request.get(prefix+'?role=owner')).json()).phase,{timeout:6000}).toBe('PAUSED');
 expect((await host.request.post(prefix+'/resume',{headers,data:{}})).ok()).toBeTruthy();
 await expect.poll(()=>tv.evaluate(()=>((window as any).__audio.starts.length))).toBe(4);
 playing=await (await host.request.get(prefix+'?role=owner')).json();expect(['COUNTDOWN','PLAYING']).toContain(playing.phase);expect(playing.round.number).toBe(4);
 expect(await phone.evaluate(()=>document.querySelectorAll('audio,video').length)).toBe(0);
 await host.request.post(prefix+'/cancel',{headers,data:{}});await tv.unrouteAll({behavior:'wait'});await host.close();await player.close();await friend.close();await display.close();
});

test('TV speaker card and single final ranking fit a full room',async({browser})=>{
 const ctx=await browser.newContext({viewport:{width:1920,height:1080}});await ctx.addInitScript(()=>localStorage.setItem('needle-room-display','ABC234'));const page=await ctx.newPage();let phase='LOBBY';
 await page.route('**/api/rooms/ABC234**',route=>route.fulfill({json:route.request().method()==='GET'?{code:'ABC234',phase,revision:phase==='LOBBY'?1:2,scoredRounds:phase==='FINISHED'?10:0,serverTime:Date.now(),preparation:{status:'COMPLETE',progress:22,clip_count:22},displayReady:true,playerId:null,attempt:null,round:null,players:Array.from({length:16},(_,i)=>({id:String(i),name:'Player '+(i+1),score:16-i}))}:{ok:true}}));
 await mockSpeakerTest(page);await openFixtureTV(page);await expect(page.locator('.room-panel')).not.toHaveAttribute('inert','');await page.getByRole('button',{name:'Play Rick Astley'}).click();await page.getByRole('button',{name:'I heard it'}).click();await page.screenshot({path:'outputs/tv-speaker-check.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBeTruthy();
 phase='FINISHED';await expect(page.locator('.room-panel')).toHaveAttribute('data-phase','FINISHED');await expect(page.locator('.podium')).toHaveCount(0);await expect(page.locator('.finale-row')).toHaveCount(16);await page.screenshot({path:'outputs/tv-podium.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBeTruthy();await ctx.close();
});

test('refreshed TV can confirm sound while preparing the next song',async({browser})=>{
 const ctx=await browser.newContext();await ctx.addInitScript(()=>localStorage.setItem('needle-room-display','ABC234'));const page=await ctx.newPage();
 await page.route('**/api/rooms/ABC234**',route=>route.fulfill({json:route.request().method()==='GET'?{code:'ABC234',phase:'PREPARING',revision:1,scoredRounds:4,serverTime:Date.now(),preparation:null,displayReady:false,playerId:null,attempt:null,round:null,players:[]}:{ok:true}}));
 await mockSpeakerTest(page);await blockAutomaticAudio(page);await openFixtureTV(page);await expect(page.getByRole('button',{name:'Play Rick Astley'})).toBeVisible();await expect(page.locator('.room-panel')).not.toHaveAttribute('inert','');await page.getByRole('button',{name:'Play Rick Astley'}).click();await page.getByRole('button',{name:'I heard it'}).click();await expect(page.locator('.speaker-check')).toBeHidden();await ctx.close();
});

test('owner sees live clip counts and percent during automatic preparation',async({browser})=>{
 const ctx=await browser.newContext();await ctx.addInitScript(()=>localStorage.setItem('needle-room-owner','ABC234'));
 const page=await ctx.newPage();let progress=0;
 await page.route('**/api/rooms/ABC234**',route=>route.fulfill({json:route.request().method()==='GET'?{code:'ABC234',phase:'LOBBY',revision:progress+1,scoredRounds:0,serverTime:Date.now(),displayReady:false,preparation:{status:progress===12?'COMPLETE':'LEASED',progress,clip_count:12,error:null},playerId:null,attempt:null,round:null,players:[]}:{pairCode:'DEF234'}}));
 await openFixtureTV(page);
 await expect(page.getByText('○ Getting music ready automatically — 0/12 clips (0%)',{exact:true})).toBeVisible();
 progress=7;await expect(page.getByText('○ Getting music ready automatically — 7/12 clips (58%)',{exact:true})).toBeVisible();
 progress=12;await expect(page.getByText('✓ Music ready',{exact:true})).toBeVisible();await ctx.close();
});


test('TV reconnect can re-enable sound during an untimed live round',async({browser})=>{
 const ctx=await browser.newContext();await ctx.addInitScript(()=>localStorage.setItem('needle-room-display','ABC234'));const page=await ctx.newPage();
 await page.route('**/api/rooms/ABC234**',route=>route.fulfill({json:route.request().method()==='GET'?{code:'ABC234',phase:'PLAYING',revision:1,scoredRounds:1,serverTime:Date.now(),preparation:null,displayReady:false,playerId:null,attempt:null,round:null,players:[]}:{ok:true}}));
 await mockSpeakerTest(page);await blockAutomaticAudio(page);await openFixtureTV(page);await expect(page.getByRole('button',{name:'Play Rick Astley'})).toBeVisible();await page.getByRole('button',{name:'Play Rick Astley'}).click();await page.getByRole('button',{name:'I heard it'}).click();await expect(page.locator('.speaker-check')).toBeHidden();await ctx.close();
});


test('TV stops the previous looping track when snapshots skip the reveal',async({browser})=>{
 test.skip(!process.env.NEEDLE_REAL_CLIP,'Requires a private prepared clip');
 const {readFile}=await import('node:fs/promises');const clip=await readFile(process.env.NEEDLE_REAL_CLIP!);
 const ctx=await browser.newContext({viewport:{width:1920,height:1080}});
 await ctx.addInitScript({content:`localStorage.setItem('needle-room-display','ABC234');window.__tracks={active:0,max:0,starts:0,stops:0};const create=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(){const node=create.call(this),start=node.start.bind(node),stop=node.stop.bind(node);let playing=false;node.start=(...args)=>{if(node.buffer?.duration<10)return start(...args);start(...args);playing=true;window.__tracks.starts++;window.__tracks.active++;window.__tracks.max=Math.max(window.__tracks.max,window.__tracks.active)};node.stop=(...args)=>{if(node.buffer?.duration<10)return stop(...args);if(playing){playing=false;window.__tracks.active--;window.__tracks.stops++}return stop(...args)};return node}`});
 const tv=await ctx.newPage();let number=1;let failures=0;
 await tv.route('**/api/rooms/ABC234?role=owner',route=>route.fulfill({json:{code:'ABC234',phase:'PLAYING',revision:number,scoredRounds:number-1,serverTime:Date.now(),displayReady:true,preparation:null,playerId:null,attempt:null,nextClip:null,players:[],round:{id:'track-'+number,number,opensAt:Date.now()-1500,closesAt:null,options:[0,1,2,3].map(i=>({id:String(i),title:'Track '+i,artist:'Test artist'}))}}}));
 await tv.route('**/api/rooms/ABC234/clip',route=>route.fulfill({contentType:'audio/mpeg',body:clip}));
 await tv.route('**/api/rooms/ABC234/heartbeat',route=>route.fulfill({json:{ok:true}}));
 await tv.route('**/api/rooms/ABC234/audio-failed',route=>{failures++;return route.fulfill({json:{ok:true}})});
 await mockSpeakerTest(tv);await blockAutomaticAudio(tv);await openFixtureTV(tv);await tv.getByRole('button',{name:'Play Rick Astley'}).click();await tv.getByRole('button',{name:'I heard it'}).click();
 for(let track=1;track<=3;track++){
  number=track;await expect.poll(()=>tv.evaluate(()=>((window as any).__tracks.starts))).toBe(track);
  const actual=await tv.evaluate(()=>((window as any).__tracks));expect(actual.active).toBe(1);expect(actual.max).toBe(1);expect(actual.stops).toBe(track-1);
 }
 expect(failures).toBe(0);await tv.unrouteAll({behavior:'wait'});await ctx.close();
});

test('Rick Astley speaker check is private, repeatable and stops on confirmation',async({browser})=>{
 const host=await browser.newContext();const headers={Origin:'http://127.0.0.1:5173'};await host.request.get('/signin-with-chatgpt?return_to=/host');
 let room=await (await host.request.post('/api/rooms',{headers,data:{}})).json();await host.request.post(`/api/rooms/${room.code}/cancel`,{headers,data:{}});room=await (await host.request.post('/api/rooms',{headers,data:{}})).json();
 const prefix=`/api/rooms/${room.code}`;
 const guest=await browser.newContext();expect((await guest.request.get(prefix+'/sound-check')).status()).toBe(401);expect((await guest.request.post(prefix+'/start',{headers,data:{}})).status()).toBe(401);await guest.close();
 const display=await browser.newContext();await display.addInitScript({content:`window.__check={starts:0,stops:0,active:0,max:0,durations:[]};const create=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(){const node=create.call(this),start=node.start.bind(node),stop=node.stop.bind(node);let active=false;node.start=(...args)=>{start(...args);active=true;window.__check.starts++;window.__check.active++;window.__check.durations.push(node.buffer.duration);window.__check.max=Math.max(window.__check.max,window.__check.active)};node.stop=(...args)=>{if(active){active=false;window.__check.active--;window.__check.stops++}return stop(...args)};return node}`});
 await display.request.get('/signin-with-chatgpt?return_to=/display');const tv=await display.newPage();await tv.goto('/display');await expect(tv.locator('.room-panel')).not.toHaveAttribute('inert','');await expect(tv.locator('.room-code')).toHaveText(room.code);
 await tv.getByRole('button',{name:'Play Rick Astley'}).click();await expect.poll(()=>tv.evaluate(()=>((window as any).__check.starts))).toBe(1);
 await tv.getByRole('button',{name:'Play Rick again'}).click();await expect.poll(()=>tv.evaluate(()=>((window as any).__check.starts))).toBe(2);
 let facts=await tv.evaluate(()=>((window as any).__check));expect(facts.max).toBe(1);expect(facts.stops).toBe(1);expect(facts.durations[0]).toBeGreaterThan(7.8);expect(facts.durations[0]).toBeLessThan(8.3);
 await tv.getByRole('button',{name:'I heard it'}).click();facts=await tv.evaluate(()=>((window as any).__check));expect(facts.active).toBe(0);expect(facts.stops).toBe(2);
 await host.request.post(prefix+'/cancel',{headers,data:{}});await host.close();await display.close();
});

test('live TV speaker panel is readable after reload on the dark stage',async({browser})=>{
 const ctx=await browser.newContext({viewport:{width:1280,height:720}});await ctx.addInitScript(()=>localStorage.setItem('needle-room-display','ABC234'));const tv=await ctx.newPage();
 await tv.route('**/api/rooms/ABC234**',route=>route.fulfill({json:route.request().method()==='GET'?{code:'ABC234',phase:'PLAYING',revision:1,scoredRounds:2,serverTime:Date.now(),release:'32',displayReady:false,preparation:null,playerId:null,attempt:null,nextClip:null,players:[],round:{id:'round3',number:3,opensAt:Date.now()-1000,closesAt:null,options:[0,1,2,3].map(i=>({id:String(i),title:'Song '+i,artist:'Artist '+i}))}}:{ok:true}}));
 await blockAutomaticAudio(tv);await openFixtureTV(tv);await expect(tv.locator('.room-panel')).not.toHaveAttribute('inert','');
 await expect(tv.getByRole('heading',{name:'TV audio'})).toBeVisible();await expect(tv.getByRole('button',{name:'Play Rick Astley'})).toBeVisible();await expect(tv.locator('.display-build')).toHaveCount(0);
 const colors=await tv.locator('.speaker-check').evaluate(element=>({background:getComputedStyle(element).backgroundColor,text:getComputedStyle(element).color,heading:getComputedStyle(element.querySelector('h2')!).color,button:getComputedStyle(element.querySelector('button')!).color}));
 expect(colors.background).toBe('rgb(255, 246, 223)');expect(colors.text).toBe('rgb(33, 22, 41)');expect(colors.heading).toBe(colors.text);expect(colors.button).toBe(colors.text);
 await tv.screenshot({path:'outputs/tv-sound-check-readable.png',fullPage:true});await ctx.close();
});

test('two TV tabs hand off exclusive audio and stop on a release mismatch',async({browser})=>{
 test.skip(!process.env.NEEDLE_REAL_CLIP,'Requires a private prepared clip');const {readFile}=await import('node:fs/promises');const clip=await readFile(process.env.NEEDLE_REAL_CLIP!);
 const ctx=await browser.newContext({viewport:{width:1280,height:720}});let release='28',number=1;
 await ctx.addInitScript({content:`localStorage.setItem('needle-room-display','ABC234');window.__tabAudio={active:0,starts:0};const make=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(){const node=make.call(this),start=node.start.bind(node),stop=node.stop.bind(node);let active=false;node.start=(...args)=>{start(...args);active=true;window.__tabAudio.active++;window.__tabAudio.starts++};node.stop=(...args)=>{if(active){active=false;window.__tabAudio.active--}return stop(...args)};return node}`});
 await ctx.route('**/api/rooms/ABC234?role=owner',route=>route.fulfill({json:{code:'ABC234',release,phase:'PLAYING',revision:number,scoredRounds:number-1,serverTime:Date.now(),displayReady:true,preparation:null,playerId:null,attempt:null,nextClip:null,players:[],round:{id:'track-'+number,number,opensAt:Date.now()-1500,closesAt:null,options:[0,1,2,3].map(i=>({id:String(i),title:'Song '+i,artist:'Artist'}))}}}));
 await ctx.route('**/api/rooms/ABC234/clip',route=>route.fulfill({contentType:'audio/mpeg',body:clip}));await ctx.route('**/api/rooms/ABC234/heartbeat',route=>route.fulfill({json:{ok:true}}));
 const first=await ctx.newPage();await mockSpeakerTest(first);await blockAutomaticAudio(first);await openFixtureTV(first);await first.getByRole('button',{name:'Play Rick Astley'}).click();await first.getByRole('button',{name:'I heard it'}).click();await expect.poll(()=>first.evaluate(()=>((window as any).__tabAudio.starts))).toBe(2);
 const second=await ctx.newPage();await mockSpeakerTest(second);await blockAutomaticAudio(second);await openFixtureTV(second);await second.getByRole('button',{name:'Play Rick Astley'}).click();await expect(first.getByText('Audio moved to another TV tab. Tap here to use this TV instead.',{exact:true})).toBeVisible();await expect.poll(()=>first.evaluate(()=>((window as any).__tabAudio.active))).toBe(0);
 await second.getByRole('button',{name:'I heard it'}).click();await expect.poll(()=>second.evaluate(()=>((window as any).__tabAudio.starts))).toBe(2);expect(await second.evaluate(()=>((window as any).__tabAudio.active))).toBe(1);
 number=2;await expect.poll(()=>second.evaluate(()=>((window as any).__tabAudio.starts))).toBe(3);expect(await first.evaluate(()=>((window as any).__tabAudio.active))).toBe(0);expect(await second.evaluate(()=>((window as any).__tabAudio.active))).toBe(1);
 release='29';await expect(second.getByText('A TV update is ready.',{exact:true})).toBeVisible();await expect.poll(()=>second.evaluate(()=>((window as any).__tabAudio.active))).toBe(0);await expect(second.getByRole('button',{name:'Load update'})).toBeVisible();await expect(second.getByRole('button',{name:/Play Rick/})).toBeDisabled();await second.unrouteAll({behavior:'wait'});await ctx.close();
});

test('speaker-test errors remain visible while game snapshots keep updating',async({browser})=>{
 const ctx=await browser.newContext();await ctx.addInitScript(()=>localStorage.setItem('needle-room-display','ABC234'));const tv=await ctx.newPage();
 await tv.route('**/api/rooms/ABC234?role=owner',route=>route.fulfill({json:{code:'ABC234',release:'32',phase:'PLAYING',revision:1,scoredRounds:0,serverTime:Date.now(),displayReady:false,preparation:null,playerId:null,attempt:null,nextClip:null,players:[],round:null}}));
 await tv.route('**/api/rooms/ABC234/heartbeat',route=>route.fulfill({json:{ok:true}}));await tv.route('**/sound-check',route=>route.fulfill({status:503,json:{error:'Unavailable'}}));
 await blockAutomaticAudio(tv);await openFixtureTV(tv);await expect(tv.locator('.room-panel')).not.toHaveAttribute('inert','');await tv.getByRole('button',{name:'Play Rick Astley'}).click();await expect(tv.getByRole('alert')).toHaveText('Speaker test unavailable. Please try again.');await tv.waitForTimeout(800);await expect(tv.getByRole('alert')).toHaveText('Speaker test unavailable. Please try again.');await ctx.close();
});

test('player selection persists across snapshots, reload and the answer reveal',async({browser})=>{
 const ctx=await browser.newContext({viewport:{width:390,height:844}});await ctx.addInitScript(()=>localStorage.setItem('needle-room-player','ABC234'));const page=await ctx.newPage();let picked=false,reveal=false;
 await page.route('**/api/rooms/ABC234?role=player',route=>route.fulfill({json:{code:'ABC234',release:'32',phase:reveal?'REVEAL':'PLAYING',revision:reveal?3:picked?2:1,scoredRounds:reveal?1:0,serverTime:Date.now(),displayReady:true,preparation:null,playerId:'p',nextClip:null,attempt:picked?(reveal?{optionId:'1',correct:0,points:-3}:{optionId:'1',locked:true}):null,players:[{id:'p',name:'Player',score:reveal?-3:0}],round:{id:'r1',number:1,opensAt:Date.now()-1000,closesAt:null,options:[0,1,2,3].map(i=>({id:String(i),title:'Song '+i,artist:'Artist '+i})),...(reveal?{correctOptionId:'0'}:{})}}}));
 await page.route('**/api/rooms/ABC234/answer',route=>{picked=true;return route.fulfill({json:{accepted:true}})});
 await page.goto('/join');await expect(page.locator('.answer')).toHaveCount(4);await page.locator('.answer').nth(1).click();await expect(page.locator('.answer').nth(1)).toHaveAttribute('aria-pressed','true');await expect(page.locator('.answer.correct')).toHaveCount(0);await page.reload();await expect(page.locator('.answer').nth(1)).toHaveClass(/selected/);await expect(page.locator('.answer.correct')).toHaveCount(0);
 reveal=true;await expect(page.locator('.answer').first()).toHaveClass(/correct/);await expect(page.locator('.answer').nth(1)).toHaveClass(/selected/);await expect(page.locator('.answer.selected')).toHaveCount(1);await expect(page.locator('.result-overlay')).toContainText('−3');await expect.poll(()=>page.locator('.answer').nth(2).evaluate(el=>Number(getComputedStyle(el).opacity))).toBeLessThan(.3);await page.screenshot({path:'outputs/phone-selected-reveal.png'});await ctx.close();
});

test('leaderboard is a vertical descending list and animates changes in rank',async({browser})=>{
 const ctx=await browser.newContext({viewport:{width:1280,height:720}});await ctx.addInitScript(()=>localStorage.setItem('needle-room-display','ABC234'));const page=await ctx.newPage();let changed=false;
 await page.route('**/api/rooms/ABC234**',route=>route.fulfill({json:route.request().method()==='GET'?{code:'ABC234',release:'32',phase:'REVEAL',revision:changed?2:1,scoredRounds:1,serverTime:Date.now(),displayReady:true,preparation:null,playerId:null,attempt:null,round:null,players:[{id:'a',name:'Alice',score:changed?4:1},{id:'b',name:'Bob',score:3},{id:'c',name:'Carol',score:2}]}:{ok:true}}));
 await openFixtureTV(page);await expect(page.locator('.room-panel')).not.toHaveAttribute('inert','');await expect(page.locator('.standings li').first()).toHaveAttribute('data-player-id','b');await page.waitForTimeout(700);changed=true;await expect(page.locator('.standings li').first()).toHaveAttribute('data-player-id','a');
 expect(await page.locator('[data-player-id="a"]').evaluate(row=>row.getAnimations().some(animation=>animation.effect?.getTiming().duration===650))).toBeTruthy();await page.waitForTimeout(750);await expect(page.locator('[data-player-id="a"] .player-score')).toHaveText('4 pts');expect(await page.locator('.standings li').first().evaluate(row=>row.getBoundingClientRect().height)).toBeGreaterThanOrEqual(68);
 const positions=await page.locator('.standings li').evaluateAll(rows=>rows.map(row=>({id:(row as HTMLElement).dataset.playerId,top:(row as HTMLElement).offsetTop,left:(row as HTMLElement).offsetLeft})));
 expect(positions.map(p=>p.id)).toEqual(['a','b','c']);expect(positions[0].top).toBeLessThan(positions[1].top);expect(positions[1].top).toBeLessThan(positions[2].top);expect(new Set(positions.map(p=>p.left)).size).toBe(1);const ink=await page.locator('.standings li').first().evaluate(row=>({row:getComputedStyle(row).color,score:getComputedStyle(row.querySelector('.player-score')!).color,background:getComputedStyle(row).backgroundColor}));expect(ink.row).toBe('rgb(33, 22, 41)');expect(ink.score).toBe(ink.row);expect(ink.background).toBe('rgb(255, 246, 223)');await page.screenshot({path:'outputs/tv-vertical-leaderboard.png',fullPage:true});await ctx.close();
});

test('countdown shows 3, 2, 1, Go despite slow server work and clock skew',async({browser})=>{
 const ctx=await browser.newContext({viewport:{width:390,height:844}});
 await ctx.addInitScript(()=>{localStorage.setItem('needle-room-player','ABC234');(window as any).__digits=[];new MutationObserver(()=>{const digit=document.querySelector('.timer-value')?.textContent;if(digit&&digit!==(window as any).__digits.at(-1))(window as any).__digits.push(digit)}).observe(document,{childList:true,subtree:true,characterData:true})});
 const page=await ctx.newPage();let opensAt=0;
 await page.route('**/api/rooms/ABC234?role=player',async route=>{
  const serverReceivedAt=Date.now()+45000;await new Promise(r=>setTimeout(r,1200));const serverTime=Date.now()+45000;
  opensAt ||= serverTime+2500;
  await route.fulfill({json:{code:'ABC234',release:'32',phase:'COUNTDOWN',revision:1,scoredRounds:0,serverReceivedAt,serverTime,displayReady:true,preparation:null,playerId:'p',attempt:null,players:[],round:{id:'r1',number:1,opensAt,closesAt:null,options:[]}}});
 });
 await page.goto('/join');await expect(page.locator('.timer-value')).toHaveText('3');
 await expect(page.locator('.timer-value')).toHaveText('2');await expect(page.locator('.timer-value')).toHaveText('1');await expect(page.locator('.timer-value')).toHaveText('GO!');
 expect(await page.evaluate(()=>(window as any).__digits)).toEqual(['3','2','1','GO!']);await ctx.close();
});

test('TV receives the initial countdown without a two-second lobby wait',async({browser})=>{
 const ctx=await browser.newContext();await ctx.addInitScript(()=>localStorage.setItem('needle-room-display','ABC234'));const page=await ctx.newPage();let start=0,calls=0;
 await page.route('**/api/rooms/ABC234**',route=>{if(route.request().method()!=='GET')return route.fulfill({json:{ok:true}});calls++;const stamp=Date.now();if(!start)start=stamp;return route.fulfill({json:{code:'ABC234',release:'32',phase:calls===1?'LOBBY':'COUNTDOWN',revision:calls,scoredRounds:0,serverTime:stamp,serverReceivedAt:stamp,displayReady:true,preparation:null,playerId:null,attempt:null,players:[],round:calls===1?null:{id:'r',number:1,opensAt:start+3000,closesAt:null,options:[]}}})});
 await openFixtureTV(page);await expect(page.locator('.timer-value')).toHaveText('3',{timeout:1200});expect(Date.now()-start).toBeLessThan(1000);await ctx.close();
});


test('join suggests two editable BIP39 words and can reroll before joining',async({browser})=>{
 const {readFile}=await import('node:fs/promises');const source=await readFile('lib/player-name.ts','utf8');const words=new Set(source.split('`')[1].split('\n'));
 const ctx=await browser.newContext();const page=await ctx.newPage();let accepted='';
 await page.route('**/api/join',async route=>{accepted=route.request().postDataJSON().name;await route.fulfill({json:{code:'ABC234'}})});
 await page.route('**/api/rooms/ABC234?role=player',route=>!accepted?route.fulfill({status:401,json:{error:'Rejoin this room'}}):route.fulfill({json:{code:'ABC234',release:'32',phase:'LOBBY',revision:1,scoredRounds:0,serverTime:Date.now(),preparation:null,displayReady:false,playerId:'p',attempt:null,round:null,players:[{id:'p',name:accepted,score:0}]}}));
 await page.goto('/join');const input=page.getByLabel('Your name');await expect(input).not.toHaveValue('');
 const check=(name:string)=>{const parts=name.toLowerCase().split(' ');expect(parts).toHaveLength(2);expect(parts[0]).not.toBe(parts[1]);for(const word of parts)expect(words.has(word)).toBeTruthy()};
 check(await input.inputValue());await page.getByRole('button',{name:'Another name'}).click();check(await input.inputValue());
 await input.fill('My own name');await expect(input).toHaveValue('My own name');await page.getByRole('button',{name:'Another name'}).click();const suggested=await input.inputValue();check(suggested);await page.getByLabel('Room code').fill('ABC234');await page.getByRole('button',{name:'Join the room'}).click();await expect(page.getByText(suggested+' (you)',{exact:true})).toBeVisible();expect(accepted).toBe(suggested);await ctx.close();
});

test('final player screen clears guess feedback and shows only the ranking',async({browser})=>{
 const ctx=await browser.newContext({viewport:{width:390,height:844}});await ctx.addInitScript(()=>localStorage.setItem('needle-room-player','ABC234'));const page=await ctx.newPage();let finished=false,points=3;
 await page.route('**/api/rooms/ABC234?role=player',route=>route.fulfill({json:{code:'ABC234',release:'32',phase:finished?'FINISHED':'REVEAL',revision:finished?2:1,scoredRounds:10,serverTime:Date.now(),displayReady:true,preparation:null,playerId:'p',attempt:{optionId:'a',correct:1,points},round:{id:'r10',number:10,opensAt:Date.now()-5000,closesAt:Date.now(),correctOptionId:'a',options:[{id:'a',title:'Last song',artist:'Last band'}]},players:[{id:'p',name:'Player',score:12},{id:'q',name:'Friend',score:8}]}}));
 await page.goto('/join');await expect(page.locator('.result-overlay')).toContainText('+3');await expect(page.locator('.result-overlay')).toContainText('First!');await expect(page.locator('.player-feedback')).toHaveText('First! +3 points');points=1;await expect(page.locator('.result-overlay')).toContainText('Correct!');await expect(page.locator('.player-feedback')).toHaveText('Correct! +1 point');finished=true;
 await expect(page.locator('.room-panel')).toHaveAttribute('data-phase','FINISHED');await expect(page.locator('.player-feedback,.stage,.answers,.skip-answer')).toHaveCount(0);await expect(page.getByRole('region',{name:'Final player ranking'})).toBeVisible();await expect(page.locator('.finale-row')).toHaveCount(2);await page.screenshot({path:'outputs/phone-final-ranking25.png'});await ctx.close();
});


test('only TV hosting needs login; guests have no game controls or music access',async({browser})=>{
 const ctx=await browser.newContext();const headers={Origin:'http://127.0.0.1:5173'};
 const tv=await ctx.request.get('/display',{maxRedirects:0});expect(tv.status()).toBe(307);expect(tv.headers().location).toContain('/signin-with-chatgpt');
 expect((await ctx.request.get('/join')).status()).toBe(200);expect((await ctx.request.post('/api/rooms',{headers,data:{}})).status()).toBe(401);
 const page=await ctx.newPage();await page.goto('/join');await expect(page.getByLabel('Your name')).not.toHaveValue('');await expect(page.getByRole('button',{name:'Open game controls'})).toHaveCount(0);await ctx.close();
});

test('TV opens the active room directly and Start new game clears the old match',async({browser})=>{
 const ctx=await browser.newContext();await ctx.request.get('/signin-with-chatgpt?return_to=/display');const headers={Origin:'http://127.0.0.1:5173'};
 let room=await (await ctx.request.post('/api/rooms',{headers,data:{}})).json();await ctx.request.post(`/api/rooms/${room.code}/cancel`,{headers,data:{}});room=await (await ctx.request.post('/api/rooms',{headers,data:{}})).json();
 const guest=await browser.newContext();expect((await guest.request.post('/api/join',{headers,data:{code:room.code,name:'Previous player'}})).ok()).toBeTruthy();
 await ctx.addInitScript(()=>{localStorage.setItem('needle-room-owner','OLD234');localStorage.setItem('needle-room-display','OLD234')});const page=await ctx.newPage();await page.goto('/display');await expect(page.getByRole('button',{name:'Open game controls'})).toHaveCount(0);await expect(page.locator('.pairing-form')).toHaveCount(0);
 await expect(page.locator('.room-code')).toHaveText(room.code);await page.getByRole('button',{name:'Start new game',exact:true}).click();await expect(page.locator('.room-code')).not.toHaveText(room.code);const fresh=await page.locator('.room-code').innerText();
 await expect(page.locator('.qr img')).toBeVisible();await expect(page.locator('.standings li')).toHaveCount(0);const snapshot=await (await ctx.request.get(`/api/rooms/${fresh}?role=owner`)).json();expect(snapshot.phase).toBe('LOBBY');expect(snapshot.scoredRounds).toBe(0);expect(snapshot.players).toEqual([]);
 expect((await guest.request.post(`/api/rooms/${fresh}/start`,{headers,data:{}})).status()).toBe(401);expect((await guest.request.get(`/api/rooms/${fresh}/clip`)).status()).toBe(401);expect((await guest.request.get(`/api/rooms/${fresh}?role=owner`)).status()).toBe(401);
 await ctx.request.post(`/api/rooms/${fresh}/cancel`,{headers,data:{}});await ctx.close();await guest.close();
});


test('blocked TV audio unlocks on its first interaction without a separate enable button',async({browser})=>{
 const ctx=await browser.newContext();const page=await ctx.newPage();let ready=false,checks=0;
 await page.route('**/api/rooms/ABC234**',route=>{if(route.request().method()==='POST'){if(route.request().url().endsWith('/heartbeat'))ready=route.request().postDataJSON().audioReady;return route.fulfill({json:{ok:true}})}return route.fulfill({json:{code:'ABC234',release:'32',phase:'LOBBY',revision:1,scoredRounds:0,serverTime:Date.now(),displayReady:ready,preparation:{status:'COMPLETE',progress:12,clip_count:12},players:[{id:'p',name:'Player',score:0},{id:'q',name:'Friend',score:0}],playerId:null,round:null,attempt:null}})});
 page.on('request',r=>{if(r.url().endsWith('/sound-check'))checks++});await blockAutomaticAudio(page);await openFixtureTV(page);await expect(page.locator('.room-code')).toHaveText('ABC234');await expect(page.getByRole('button',{name:'Open game controls'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Enable game audio'})).toHaveCount(0);expect(ready).toBe(false);await page.locator('.room-header').click();await expect.poll(()=>ready).toBe(true);expect(checks).toBe(0);await ctx.close();
});

test('a new room code never shows an expiry warning before joining',async({browser})=>{
 const ctx=await browser.newContext();await ctx.addInitScript(()=>localStorage.setItem('needle-room-player','OLD234'));const page=await ctx.newPage();let joined=false,reads=0;
 await page.route('**/api/join',route=>{joined=true;return route.fulfill({json:{code:'ABC234'}})});
 await page.route('**/api/rooms/ABC234?role=player',route=>{reads++;return route.fulfill(joined?{json:{code:'ABC234',release:'32',phase:'LOBBY',revision:1,scoredRounds:0,serverTime:Date.now(),displayReady:false,preparation:null,playerId:'p',attempt:null,round:null,players:[{id:'p',name:'Fresh player',score:0}]}}:{status:401,json:{error:'Session expired or replaced'}})});
 await page.goto('/join?code=ABC234');await expect(page.getByLabel('Your name')).not.toHaveValue('');await page.waitForTimeout(700);expect(reads).toBe(0);await expect(page.getByRole('alert')).toHaveCount(0);await page.getByLabel('Your name').fill('Fresh player');await page.getByRole('button',{name:'Join the room'}).click();await expect(page.getByText('Fresh player (you)',{exact:true})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);await ctx.close();
});

test('a genuinely expired restored session warns once and clears after rejoining',async({browser})=>{
 const ctx=await browser.newContext();await ctx.addInitScript(()=>localStorage.setItem('needle-room-player','ABC234'));const page=await ctx.newPage();let valid=false,reads=0;
 await page.route('**/api/join',route=>{valid=true;return route.fulfill({json:{code:'ABC234'}})});
 await page.route('**/api/rooms/ABC234?role=player',route=>{reads++;return route.fulfill(valid?{json:{code:'ABC234',release:'32',phase:'LOBBY',revision:1,scoredRounds:0,serverTime:Date.now(),displayReady:false,preparation:null,playerId:'p',attempt:null,round:null,players:[{id:'p',name:'Player',score:0}]}}:{status:401,json:{error:'Your player session has expired. Please rejoin.',code:'SESSION_EXPIRED'}})});
 await page.goto('/join');await expect(page.getByRole('alert')).toHaveText('Your player session has expired. Please rejoin.');await page.waitForTimeout(700);expect(reads).toBe(1);await page.getByLabel('Your name').fill('Player');await page.getByRole('button',{name:'Join the room'}).click();await expect(page.getByText('Player (you)',{exact:true})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);await ctx.close();
});

test('finished TV crossfades all ten excerpts back to the first and stops for a new game',async({browser})=>{
 const ctx=await browser.newContext();const page=await ctx.newPage();await blockAutomaticAudio(page);
 await page.addInitScript({content:`window.__mix={starts:[],curves:[]};const make=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(){const source=make.call(this),start=source.start.bind(source),stop=source.stop.bind(source),ctx=this;let item;source.start=(at=ctx.currentTime,...rest)=>{item={at,end:Infinity,wall:Date.now()+(at-ctx.currentTime)*1000};window.__mix.starts.push(item);return start(at,...rest)};source.stop=(at=ctx.currentTime)=>{if(item)item.end=at;return stop(at)};window.__mix.context=ctx;return source};const gain=AudioContext.prototype.createGain;AudioContext.prototype.createGain=function(){const g=gain.call(this),curve=g.gain.setValueCurveAtTime.bind(g.gain);g.gain.setValueCurveAtTime=(values,at,duration)=>{window.__mix.curves.push({at,duration,first:values[0],last:values[values.length-1]});return curve(values,at,duration)};return g}`});
 const samples=6400,body=Buffer.alloc(44+samples*2);body.write('RIFF',0);body.writeUInt32LE(36+samples*2,4);body.write('WAVEfmt ',8);body.writeUInt32LE(16,16);body.writeUInt16LE(1,20);body.writeUInt16LE(1,22);body.writeUInt32LE(8000,24);body.writeUInt32LE(16000,28);body.writeUInt16LE(2,32);body.writeUInt16LE(16,34);body.write('data',36);body.writeUInt32LE(samples*2,40);
 const tracks=Array.from({length:10},(_,i)=>'track'+i),loads:string[]=[],fadeEnds=Date.now()+1800;let failedOnce=false;
 await page.route('**/api/rooms',route=>route.fulfill({json:{code:route.request().method()==='POST'?'NEW234':'ABC234'}}));
 await page.route('**/api/rooms/ABC234/afterparty-clip?roundId=*',route=>{if(!failedOnce){failedOnce=true;return route.fulfill({status:503,body:'Temporary fixture failure'})}loads.push(new URL(route.request().url()).searchParams.get('roundId')!);return route.fulfill({contentType:'audio/wav',body})});
 await page.route('**/api/rooms/*?role=owner',route=>{const finished=route.request().url().includes('/ABC234?');return route.fulfill({json:{code:finished?'ABC234':'NEW234',release:'32',phase:finished?'FINISHED':'LOBBY',revision:1,scoredRounds:finished?10:0,serverTime:Date.now(),revealEndsAt:fadeEnds-2000,postgameTracks:finished?tracks:undefined,postgameSongs:finished?tracks.map((id,i)=>({id,title:'Track '+i,artist:'Band '+i})):undefined,displayReady:true,preparation:null,playerId:null,attempt:null,round:null,players:[{id:'p',name:'Winner',score:12}]}})});
 await page.route('**/heartbeat',route=>route.fulfill({json:{ok:true}}));
 await page.request.get('/signin-with-chatgpt?return_to=/display');await page.goto('/display');await expect(page.locator('.room-panel')).toHaveAttribute('data-phase','FINISHED');await page.locator('.finale-brand').click();
 await expect(page.getByRole('alert')).toHaveText('Post-game music is temporarily unavailable. Retrying…');await expect(page.getByRole('alert')).toHaveCount(0,{timeout:6000});
 await expect.poll(()=>loads.length,{timeout:15000}).toBeGreaterThanOrEqual(11);expect(loads.slice(0,11)).toEqual([...tracks,tracks[0]]);
 await expect(page.locator('.postgame-songs li')).toHaveCount(10);await expect(page.locator('.postgame-songs li[aria-current=true]')).toHaveCount(1);await expect(page.locator('.display-build')).toHaveCount(0);const mix=await page.evaluate(()=>(window as any).__mix);expect(mix.starts[0].wall).toBeGreaterThanOrEqual(fadeEnds-40);for(let i=0;i<10;i++){expect(mix.starts[i+1].at).toBeLessThan(mix.starts[i].end);expect(mix.starts[i].end-mix.starts[i+1].at).toBeGreaterThan(.1)}expect(mix.curves.some((c:any)=>c.first===0&&c.last===1)).toBeTruthy();expect(mix.curves.some((c:any)=>c.first===1&&c.last<.001)).toBeTruthy();
 await page.getByRole('button',{name:'Start new game',exact:true}).click();await expect(page.locator('.room-code')).toHaveText('NEW234');const count=loads.length;await page.waitForTimeout(1200);expect(loads.length).toBe(count);expect(await page.evaluate(()=>(window as any).__mix.starts.filter((s:any)=>s.end>(window as any).__mix.context.currentTime).length)).toBe(0);await ctx.close();
});

test('session API distinguishes expiry, removal and a cookie for another room',async({browser})=>{
 const host=await browser.newContext(),guest=await browser.newContext();const headers={Origin:'http://127.0.0.1:5173'};const create=async()=>{let response=await host.request.post('/api/rooms',{headers,data:{}});if(response.status()===429){await new Promise(r=>setTimeout(r,61000-Date.now()%60000));response=await host.request.post('/api/rooms',{headers,data:{}})}expect(response.ok()).toBeTruthy();return response.json()};
 await host.request.get('/signin-with-chatgpt?return_to=/display');let room=await create();
 const joined=await (await guest.request.post('/api/join',{headers,data:{code:room.code,name:'Session proof'}})).json();expect(joined.playerId).toMatch(/^[a-f0-9-]{36}$/);
 const prefix='/api/rooms/'+room.code;expect((await guest.request.get(prefix+'?role=player')).status()).toBe(200);
 const {execFileSync}=await import('node:child_process');
 const update=(sql:string)=>execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',sql],{stdio:'pipe'});
 update(`UPDATE sessions SET expires_at=0 WHERE player_id='${joined.playerId}'`);
 let result=await guest.request.get(prefix+'?role=player');expect(result.status()).toBe(401);expect((await result.json()).code).toBe('SESSION_EXPIRED');
 update(`UPDATE sessions SET expires_at=${Date.now()+3600000},revoked_at=1 WHERE player_id='${joined.playerId}'`);
 result=await guest.request.get(prefix+'?role=player');expect((await result.json()).code).toBe('SESSION_REVOKED');
 update(`UPDATE sessions SET revoked_at=NULL WHERE player_id='${joined.playerId}'`);
 await host.request.post(prefix+'/cancel',{headers,data:{}});room=await create();
 result=await guest.request.get('/api/rooms/'+room.code+'?role=player');const other=await result.json();expect(result.status()).toBe(401);expect(other.code).toBe('SESSION_OTHER_ROOM');expect(other.error).not.toMatch(/expired/i);
 const anonymous=await browser.newContext();result=await anonymous.request.get('/api/rooms/'+room.code+'?role=player');expect((await result.json()).code).toBe('SESSION_MISSING');await anonymous.addCookies([{name:'nr_player',value:'unknown-fixture-token',domain:'127.0.0.1',path:'/'}]);result=await anonymous.request.get('/api/rooms/'+room.code+'?role=player');const invalid=await result.json();expect(invalid.code).toBe('SESSION_INVALID');expect(invalid.error).not.toMatch(/expired/i);
 await host.request.post('/api/rooms/'+room.code+'/cancel',{headers,data:{}});await anonymous.close();await guest.close();await host.close();
});

test('a delayed old session failure cannot overwrite a successful rejoin',async({browser})=>{
 const ctx=await browser.newContext();await ctx.addInitScript(()=>localStorage.setItem('needle-room-player','ABC234'));const page=await ctx.newPage();let joined=false,started=false;
 await page.route('**/api/join',route=>{joined=true;return route.fulfill({json:{code:'ABC234'}})});
 await page.route('**/api/rooms/ABC234?role=player',async route=>{if(!joined){started=true;await new Promise(r=>setTimeout(r,1000));await route.fulfill({status:401,json:{error:'Your player session has expired. Please rejoin.',code:'SESSION_EXPIRED'}}).catch(()=>{});return}await route.fulfill({json:{code:'ABC234',release:'32',phase:'LOBBY',revision:1,scoredRounds:0,serverTime:Date.now(),displayReady:false,preparation:null,playerId:'p',attempt:null,round:null,players:[{id:'p',name:'Player',score:0}]}})});
 await page.goto('/join');await expect.poll(()=>started).toBe(true);await page.getByLabel('Your name').fill('Player');await page.getByRole('button',{name:'Join the room'}).click();await expect(page.getByText('Player (you)',{exact:true})).toBeVisible();await page.waitForTimeout(1300);await expect(page.getByRole('alert')).toHaveCount(0);await ctx.close();
});

test('transition centers the countdown and animates rank movement without the scoring legend',async({browser})=>{
 const ctx=await browser.newContext({viewport:{width:390,height:844}});await ctx.addInitScript(()=>localStorage.setItem('needle-room-player','ABC234'));const page=await ctx.newPage();let moved=false,countdown=false,opens=0;
 await page.route('**/api/rooms/ABC234?role=player',route=>route.fulfill({json:{code:'ABC234',release:'32',phase:countdown?'COUNTDOWN':'REVEAL',revision:countdown?3:moved?2:1,scoredRounds:1,serverTime:Date.now(),preparation:null,displayReady:true,playerId:'p',attempt:countdown?null:{correct:1,points:3,optionId:'a'},round:{id:countdown?'r2':'r1',number:countdown?2:1,opensAt:countdown?opens:Date.now()-1000,closesAt:null,options:[]},players:[{id:'p',name:'Player',score:moved?6:2},{id:'q',name:'Friend',score:4}]}}));
 await page.goto('/join');await expect(page.locator('.standings li').first()).toHaveAttribute('data-player-id','q');moved=true;await expect(page.locator('[data-player-id="p"] .rank-trend')).toHaveAttribute('data-direction','up');await expect(page.locator('[data-player-id="q"] .rank-trend')).toHaveAttribute('data-direction','down');
 await expect(page.locator('.standings-panel')).toBeHidden();opens=Date.now()+3000;countdown=true;await expect(page.locator('.round-timer')).toBeVisible();
 const up=await page.locator('[data-player-id="p"] .rank-trend').evaluate(el=>({color:getComputedStyle(el).color,animated:el.querySelector('svg')!.getAnimations().length>0}));expect(up.color).toBe('rgb(33, 108, 80)');expect(up.animated).toBeTruthy();expect(await page.locator('[data-player-id="q"] .rank-trend').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(157, 46, 62)');
 await expect(page.locator('.player-feedback')).toHaveCount(0);await expect(page.locator('.stage-copy')).toBeHidden();await expect(page.locator('.standings li')).toHaveCount(2);await expect(page.locator('[data-player-id="p"] .player-score')).toHaveText('6 pts');
 const box=await page.locator('.round-timer').boundingBox();expect(Math.abs(box!.x+box!.width/2-195)).toBeLessThan(2);expect(box!.height).toBeGreaterThanOrEqual(200);await page.screenshot({path:'outputs/phone-transition27.png'});await ctx.close();
});


test('final player playlist follows the TV and displays current album art',async({browser})=>{
 const ctx=await browser.newContext({viewport:{width:390,height:844}});await ctx.addInitScript(()=>localStorage.setItem('needle-room-player','ABC234'));const page=await ctx.newPage();let playing='t0';
 const art='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#7961e8"/></svg>');
 const songs=Array.from({length:10},(_,i)=>({id:'t'+i,title:'Song '+i,artist:'Band '+i,artworkUrl:art}));
 await page.route('**/api/rooms/ABC234?role=player',route=>route.fulfill({json:{code:'ABC234',release:'32',phase:'FINISHED',revision:1,scoredRounds:10,serverTime:Date.now(),preparation:null,displayReady:true,playerId:'p',attempt:null,round:null,postgameSongs:songs,nowPlaying:playing?{id:playing,startedAt:Date.now()}:null,players:[{id:'p',name:'Player',score:6},{id:'q',name:'Friend',score:4}]}}));
 await page.goto('/join');await expect(page.locator('.postgame-songs li')).toHaveCount(10);await expect(page.locator('[data-track-id=t0]')).toHaveAttribute('aria-current','true');await expect(page.getByAltText('Album art for Song 0')).toBeVisible();playing='t4';await expect(page.locator('[data-track-id=t4]')).toHaveAttribute('aria-current','true');await expect(page.locator('[data-track-id=t0]')).not.toHaveAttribute('aria-current','true');await expect(page.getByAltText('Album art for Song 4')).toBeVisible();await expect(page.locator('.display-build')).toHaveCount(0);await page.screenshot({path:'outputs/phone-playlist28.png',fullPage:true});
 playing='';await expect(page.locator('.postgame-songs li[aria-current=true]')).toHaveCount(0);await expect(page.locator('.album-cover img')).toHaveCount(0);await ctx.close();
});

test('TV final rankings and ten-song playlist fit together with album artwork',async({browser})=>{
 const ctx=await browser.newContext({viewport:{width:1920,height:1080}});const page=await ctx.newPage();await blockAutomaticAudio(page);
 await page.route('**/api/rooms/ABC234**',route=>route.fulfill({json:route.request().method()==='GET'?{code:'ABC234',release:'32',phase:'FINISHED',revision:1,scoredRounds:10,serverTime:Date.now(),preparation:null,displayReady:false,postgameSongs:Array.from({length:10},(_,i)=>({id:'t'+i,title:'Song '+i,artist:'Band '+i})),nowPlaying:null,playerId:null,attempt:null,round:null,players:Array.from({length:16},(_,i)=>({id:String(i),name:'Player '+i,score:20-i}))}:{ok:true}}));
 await openFixtureTV(page);await expect(page.locator('.postgame-songs li')).toHaveCount(10);await expect(page.locator('.finale-row')).toHaveCount(16);await expect(page.locator('.display-build')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBeTruthy();for(const size of [{width:1920,height:1080},{width:1280,height:720}]){
  await page.setViewportSize(size);await page.waitForTimeout(800);
  const fit=await page.locator('.finale-row,.postgame-songs li,.finale-new-game').evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}));expect(fit).toBeTruthy();
  const tops=await page.locator('.finale-row').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));expect(tops.every((top,i)=>i===0||top>tops[i-1])).toBeTruthy();
  await page.screenshot({path:`outputs/tv-merged29-${size.height}.png`,fullPage:true});
 }await ctx.close();
});


test('ranking is hidden during guesses and returns between rounds on TV and phones',async({browser})=>{
 for(const mode of ['tv','phone']){
  const ctx=await browser.newContext({viewport:mode==='tv'?{width:1280,height:720}:{width:390,height:844}});
  if(mode==='phone')await ctx.addInitScript(()=>localStorage.setItem('needle-room-player','ABC234'));
  const page=await ctx.newPage();let phase='PLAYING',revision=1;
  await page.route('**/api/rooms',route=>route.fulfill({json:{code:'ABC234'}}));
  await page.route('**/api/rooms/ABC234**',route=>route.fulfill({json:route.request().method()==='GET'?{code:'ABC234',release:'32',phase,revision,scoredRounds:1,serverTime:Date.now(),displayReady:false,preparation:null,playerId:mode==='phone'?'p':null,attempt:null,players:[{id:'p',name:'Player',score:3},{id:'q',name:'Friend',score:1}],round:{id:'r',number:2,opensAt:phase==='COUNTDOWN'?Date.now()+2500:Date.now()-1000,closesAt:null,options:[0,1,2,3].map(i=>({id:String(i),title:'Song '+i,artist:'Artist '+i}))}}:{ok:true}}));
  if(mode==='tv'){await blockAutomaticAudio(page);await page.request.get('/signin-with-chatgpt?return_to=/display')}
  await page.goto(mode==='tv'?'/display':'/join');await expect(page.locator('.answers .answer')).toHaveCount(4);await expect(page.locator('.standings-panel')).toBeHidden();
  phase='REVEAL';revision++;await expect(page.locator('.room-panel')).toHaveAttribute('data-phase','REVEAL');await expect(page.locator('.standings-panel')).toBeHidden();await expect(page.locator('.answer')).toHaveCount(4);
  phase='COUNTDOWN';revision++;await expect(page.locator('.round-timer')).toBeVisible();await expect(page.locator('.standings li')).toHaveCount(2);
  phase='PLAYING';revision++;await expect(page.locator('.answers .answer')).toHaveCount(4);await expect(page.locator('.standings-panel')).toBeHidden();
  await ctx.close();
 }
});


test('final playlist shows player icons and answer badges without TV scrolling',async({browser})=>{
 for(const mode of ['tv','phone']){
  const ctx=await browser.newContext({viewport:mode==='tv'?{width:1280,height:720}:{width:390,height:844}});
  if(mode==='phone')await ctx.addInitScript(()=>localStorage.setItem('needle-room-player','ABC234'));
  const page=await ctx.newPage();const results=Array.from({length:16},(_,i)=>({playerId:'p'+i,name:'Player '+i+' with a long name',outcome:i<12?'correct':i===12?'wrong':i===13?'skipped':'unanswered'}));
  await page.route('**/api/rooms',route=>route.fulfill({json:{code:'ABC234'}}));
  await page.route('**/api/rooms/ABC234**',route=>route.fulfill({json:route.request().method()==='GET'?{code:'ABC234',release:'32',phase:'FINISHED',revision:1,scoredRounds:10,serverTime:Date.now(),displayReady:false,preparation:null,playerId:mode==='phone'?'p0':null,attempt:null,round:null,players:results.map((p,i)=>({id:p.playerId,name:p.name,score:30-i})),postgameSongs:Array.from({length:10},(_,i)=>({id:'t'+i,title:'Song '+i,artist:'Band '+i,results})),nowPlaying:{id:'t4',startedAt:Date.now()}}:{ok:true}}));
  if(mode==='tv'){await blockAutomaticAudio(page);await page.request.get('/signin-with-chatgpt?return_to=/display')}
  await page.goto(mode==='tv'?'/display':'/join');await expect(page.locator('.song-results')).toHaveCount(10);
  const song=page.locator('[data-track-id=t4]');await expect(song).toHaveAttribute('aria-current','true');
  await expect(song.locator('[data-outcome=correct][data-result-player-id]')).toHaveCount(12);
  await expect(song.locator('[data-outcome=wrong]')).toContainText('Player 12 with a long name');
  await expect(song.locator('[data-outcome=skipped]')).toHaveCount(0);
  await expect(song.locator('[data-outcome=unanswered]')).toHaveCount(0);
  await expect(song.locator('.song-result-badge .player-avatar')).toHaveCount(13);
  await expect(song.locator('[data-result-player-id=p12]')).toHaveAttribute('aria-label','Player 12 with a long name: Wrong');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  if(mode==='tv'){
   expect(await page.locator('.postgame-songs').evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBeTruthy();
   for(const track of await page.locator('.postgame-songs>li').all())await expect(track).toBeInViewport({ratio:1});
   await expect(page.locator('.finale-row').first()).toBeInViewport({ratio:1});await expect(page.locator('.finale-row').last()).toBeInViewport({ratio:1});
   const row=page.locator('[data-track-id=t9]');expect(await row.evaluate(el=>{const rect=el.getBoundingClientRect();return Array.from(el.querySelectorAll('.song-result-badge')).every(group=>group.getBoundingClientRect().bottom<=rect.bottom)})).toBeTruthy();
   await expect(page.getByRole('button',{name:'Start new game',exact:true})).toBeInViewport();
  }
  await page.screenshot({path:'outputs/'+mode+'-playlist-results30.png',fullPage:true});await ctx.close();
 }
});

test('redesigned setlist fits ten tracks and every answer badge across TV and phone sizes',async({page})=>{
 await page.goto('/playlist-preview');
 for(const size of [{width:1920,height:1080},{width:1280,height:720},{width:1024,height:768}]){
  await page.setViewportSize(size);
  for(const count of [2,8,16]){
   await page.getByLabel('Preview player count').selectOption(String(count));
   await expect(page.locator('.postgame-songs>li')).toHaveCount(10);await expect(page.locator('.finale-row')).toHaveCount(count);await page.waitForTimeout(800);
   const fits=await page.locator('.postgame-songs>li,.song-result-badge,.finale-row,.finale-new-game').evaluateAll(nodes=>nodes.every(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}));expect(fits).toBeTruthy();
   expect(await page.locator('.postgame-songs').evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBeTruthy();
   expect(await page.locator('.song-result-initials').evaluateAll(nodes=>nodes.filter(el=>getComputedStyle(el).display!=='none').every(el=>el.scrollWidth<=el.clientWidth+1))).toBeTruthy();
   const cards=await page.locator('.postgame-songs>li').evaluateAll(nodes=>nodes.map(el=>({left:el.getBoundingClientRect().left,top:el.getBoundingClientRect().top})));expect(cards[0].left).toBe(cards[4].left);expect(cards[5].left).toBeGreaterThan(cards[0].left);expect(cards[5].top).toBe(cards[0].top);
  }
  if(size.width===1280)await page.screenshot({path:'outputs/playlist-redesign32-tv.png'});
 }
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});await page.waitForTimeout(100);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(await page.locator('.postgame-songs').evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBeTruthy();
 }
 await page.screenshot({path:'outputs/playlist-redesign32-phone.png',fullPage:true});
});
