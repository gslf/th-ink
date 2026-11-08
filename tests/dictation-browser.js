import {appReady,spoken,voice,state,db,flush,setMode,changeLanguage} from '/js/app.js';
await appReady;
const button=document.createElement('button');button.id='qa-run';button.textContent='Check quiet audio → saved note';button.style='position:fixed;top:10px;right:10px;z-index:10000;padding:16px';document.body.append(button);
const report=document.createElement('pre');report.id='qa-result';report.style='position:fixed;top:60px;right:10px;z-index:10000;background:#f9f8f4;padding:20px;max-width:600px;white-space:pre-wrap';document.body.append(report);
button.onclick=async()=>{
 button.disabled=true;let input,timeout;const results=[];
 try{
  for(const lang of ['it-IT','en-US']){
   await changeLanguage(lang==='it-IT'?'it':'en');await spoken.a.create('Quiet microphone test '+lang);input=new AudioContext();await input.resume();const destination=input.createMediaStreamDestination();voice.getStream=async()=>destination.stream;voice.lang=lang;voice.mode='commands';voice.argumentMode=true;
   // Exercise automatic Voice startup and the same listener that edits the note.
   await setMode('voice');
   if(!voice.active)throw Error('Start failed: '+document.querySelector('#voice-status').textContent);
   if(voice.mode!=='dictation'||voice.argumentMode||voice.speaking)throw Error('Not immediately ready for dictation at startup');
   const generated=await voice.speech.request({type:'synthesize',text:lang==='it-IT'?'buongiorno questa è una prova':'hello this is a test',lang,rate:155});
   const rms=Math.sqrt(generated.audio.reduce((sum,v)=>sum+v*v,0)/generated.audio.length),gain=.003/rms;
   const pcm=generated.audio.map(v=>v*gain);const buffer=input.createBuffer(1,pcm.length,generated.sampleRate);buffer.copyToChannel(pcm,0);
   const recognized=new Promise((resolve,reject)=>{timeout=setTimeout(()=>reject(Error('No transcription. '+document.querySelector('#voice-status').textContent)),15000);voice.addEventListener('recognition',event=>resolve(event.detail),{once:true});voice.addEventListener('error',event=>reject(Error(event.detail)),{once:true});});
   const source=input.createBufferSource();source.buffer=buffer;source.connect(destination);source.start(input.currentTime+.2);
   report.textContent='Simulated listening at low volume: '+lang;
   const result=await recognized;clearTimeout(timeout);await spoken.pipeline;await flush();const note=state.notes.find(n=>n.id===state.current),saved=await db.get('notes',note.id);
   if(!note.body.trim()||note.body.trim()!==result.text.trim()||saved.body!==note.body)throw Error('Audio recognized but text not saved in the note');
   results.push({lang,rms:.003,recognized:result.text,note:saved.body,finalMs:Math.round(result.metrics.finalMs),pass:true});await setMode('keyboard');await input.close();input=null;
  }
  report.textContent='PASS: Voice mode → AudioWorklet → WASM model → saved note, IT and EN.\n'+JSON.stringify(results,null,2);
 }catch(e){report.textContent='FAIL: '+e.stack;}finally{clearTimeout(timeout);voice.stop();if(input)await input.close();button.disabled=false;}
};

const cleanup=document.createElement('button');cleanup.id='qa-clean';cleanup.textContent='Clean up test data only';cleanup.style='position:fixed;bottom:10px;right:10px;z-index:10000';document.body.append(cleanup);cleanup.onclick=async()=>{voice.dispose();await flush();for(const n of state.notes)await db.files?.removeEntry(n.id+'.md').catch(()=>{});db.db.close();await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('think-dictation-qa');request.onsuccess=resolve;request.onerror=()=>reject(request.error);});cleanup.textContent='Test data removed';cleanup.disabled=true;};
