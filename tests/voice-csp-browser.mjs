// Real local recognition under the application's production CSP, with synthetic
// audio only: no hardware microphone, bypassCSP, or external recognition service.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.QA_URL||'http://127.0.0.1:4173';
const target=new URL(process.env.QA_PAGE||'__i18nqa.html',base.endsWith('/')?base:base+'/').href;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--autoplay-policy=no-user-gesture-required']});
const errors=[],violations=[],requests=[],results=[];
try{
 const context=await browser.newContext({locale:'en-US'}),page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
 await page.exposeFunction('recordCSPViolation',event=>violations.push(event));
 await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>window.recordCSPViolation({directive:e.violatedDirective,blocked:e.blockedURI})));
 await page.goto(target);
 await page.evaluate(async()=>{const app=await import(new URL('./js/app.js',location.href));await app.appReady;await app.dailyBackup.enable(false);await navigator.serviceWorker.ready;});
 await page.waitForFunction(()=>navigator.serviceWorker.controller);
 const policy=await page.locator('meta[http-equiv=Content-Security-Policy]').getAttribute('content');
 assert.ok(policy.includes("'wasm-unsafe-eval'"));assert.ok(!policy.includes("'unsafe-eval'"));
 // A prior installed runtime must not shadow the new version through CacheStorage.
 await page.evaluate(async()=>{
  const {VOICE_CACHE}=await import(new URL('./js/voice-engine.js',location.href));
  const cache=await caches.open(VOICE_CACHE);
  await cache.put(new URL('./vendor/vosk/vosk.js',location.href),new Response('throw Error("stale runtime loaded")',{headers:{'Content-Type':'text/javascript'}}));
 });
 for(const offline of [false,true]){
  await context.setOffline(offline);
  if(offline){await page.reload();await page.evaluate(async()=>{const app=await import(new URL('./js/app.js',location.href));await app.appReady;await app.dailyBackup.enable(false);});}
  for(const lang of ['it-IT','en-US']){
   const result=await page.evaluate(async({lang,offline})=>{
    const root=new URL('./',location.href),app=await import(new URL('js/app.js',root));
    const {Resampler}=await import(new URL('js/audio-pipeline.js',root));
    const {grammar}=await import(new URL('js/voice-grammar.js',root));
    const {interpret}=await import(new URL('js/screenless.js',root));
    await app.changeLanguage(lang==='it-IT'?'it':'en');
    const voice=app.voice,start=performance.now(),phrase=lang==='it-IT'?'modalità comando':'command mode';
    const input=new AudioContext(),destination=input.createMediaStreamDestination();await input.resume();
    voice.getStream=async()=>destination.stream;
    try{
     await app.setMode('voice');
     // Selecting Voice starts recognition, synthesis and AudioWorklet directly.
     if(!voice.active)throw Error(document.querySelector('#voice-status').textContent);
     const generated=await voice.speech.request({type:'synthesize',text:phrase,lang,rate:155});
     if(!generated.audio.length)throw Error('No synthetic speech returned');
     const pcm=[];new Resampler(generated.sampleRate).push(generated.audio,sample=>pcm.push(sample));pcm.push(...new Float32Array(8000));
     const recognizer=voice.engine.createRecognizer(()=>{},grammar(lang,'commands'));let recognized='';
     try{
      for(let offset=0;offset<pcm.length;offset+=1280){const r=await recognizer.feed(Float32Array.from(pcm.slice(offset,offset+1280)));if(r.event==='result')recognized+=' '+r.result.text;}
      recognized+=' '+(await recognizer.finish()).result.text;
     }finally{recognizer.dispose();}
     if(interpret(recognized.trim(),'dictation').command?.id!=='commands')throw Error('Constrained recognition failed: '+recognized);
     let timer;
     const capture=new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(Error('AudioWorklet recognition timed out: '+JSON.stringify({active:voice.active,mode:app.state.mode,speaking:voice.speaking,status:document.querySelector('#voice-status').textContent}))),25000);
      voice.addEventListener('recognition',event=>resolve(event.detail),{once:true});
     });
     try{
      const buffer=input.createBuffer(1,generated.audio.length,generated.sampleRate);buffer.copyToChannel(generated.audio,0);
      const source=input.createBufferSource();source.buffer=buffer;source.connect(destination);source.start(input.currentTime+.2);
      const detail=await capture;
      if(interpret(detail.text,'dictation').command?.id!=='commands')throw Error('AudioWorklet recognition failed: '+detail.text);
      return {lang,offline,recognized:recognized.trim(),pipeline:detail.text,elapsedMs:Math.round(performance.now()-start)};
     }finally{clearTimeout(timer);}
    }finally{await app.setMode('keyboard');voice.engine.dispose();voice.speech.dispose();await input.close();}
   },{lang,offline});
   results.push(result);console.log('PASS real speech CSP',JSON.stringify(result));
  }
 }
 assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
 assert.ok(requests.every(url=>new URL(url).origin===new URL(target).origin),'all speech requests stay on the app origin');
 const report=new URL('./reports/voice-csp.json',import.meta.url);await mkdir(new URL('./reports/',import.meta.url),{recursive:true});
 await writeFile(report,JSON.stringify({browser:browser.version(),policy,results,errors,violations},null,2)+'\n');
}finally{await browser.close();}
