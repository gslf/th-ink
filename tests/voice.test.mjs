import test from 'node:test';
import assert from 'node:assert/strict';
import {VoskEngine} from '../dist/js/voice-engine.js';
import {LocalVoice} from '../dist/js/voice.js';
import {Resampler,SpeechSegmenter,AudioQueue} from '../dist/js/audio-pipeline.js';
import {interpret,parseScreenless,findTextRanges,confirmationSnapshot,confirmationValid,numberedParagraph,interruption} from '../dist/js/screenless.js';

test('resampling: 44.1/48 kHz → 16 kHz without drift between blocks',()=>{
 for(const rate of [44100,48000,16000]){const r=new Resampler(rate),output=[];let left=rate;while(left){const n=Math.min(left,128);r.push(new Float32Array(n).fill(0.25),x=>output.push(x));left-=n;}assert.equal(output.length,16000);assert.ok(output.every(x=>Math.abs(x-.25)<1e-6));}
});
test('VAD: silence and DC offset ignored, pre-roll and ending after a short pause',()=>{
 const events=[],v=new SpeechSegmenter(e=>events.push(e));
 for(let i=0;i<20;i++)v.frame(new Float32Array(320).fill(.1));assert.equal(events.length,0);
 const wave=Float32Array.from({length:320},(_,i)=>Math.sin(i/10)*.2);
 for(let i=0;i<30;i++)v.frame(wave);for(let i=0;i<21;i++)v.frame(new Float32Array(320));
 assert.equal(events.filter(e=>e.type==='start').length,1);assert.equal(events.filter(e=>e.type==='end').length,1);assert.equal(events.at(-1).at-events.at(-1).lastSpeech,420);assert.ok(events.filter(e=>e.type==='audio').reduce((n,e)=>n+e.data.length,0)>30*320);
});
test('audio queue: ordering and explicit limit, no delayed execution',async()=>{
 let release,overflow=0;const seen=[];const q=new AudioQueue(async item=>{seen.push(item.id);await new Promise(r=>release=r);},()=>overflow++,10);
 q.push({id:1,data:new Float32Array(6)});q.push({id:2,data:new Float32Array(6)});assert.equal(overflow,1);assert.equal(q.closed,true);release();await new Promise(r=>setTimeout(r,0));assert.deepEqual(seen,[1]);
});
test('ASR: sequential requests, recognition without the SpeechRecognition API',async()=>{
 const engine=new VoskEngine();let fake;
 engine.model={ready:true,KaldiRecognizer:class {constructor(){this.events={};fake=this;}setWords(){}on(name,fn){this.events[name]=fn;}acceptWaveformFloat(){}retrieveFinalResult(){}remove(){}}};
 const r=engine.createRecognizer();const first=r.feed(new Float32Array(320));await assert.rejects(()=>r.feed(new Float32Array(320)),/concorrente/);fake.events.partialresult({event:'partialresult',result:{partial:'ciao'}});assert.equal((await first).result.partial,'ciao');const final=r.finish();fake.events.result({event:'result',result:{text:'ciao mondo'}});assert.equal((await final).result.text,'ciao mondo');r.dispose();
});
test('stopping during inference cancels the request and produces no text',async()=>{
 const engine=new VoskEngine();engine.model={ready:true,KaldiRecognizer:class {setWords(){}on(){}acceptWaveformFloat(){}remove(){}}};const r=engine.createRecognizer();const p=r.feed(new Float32Array(320));r.dispose();await assert.rejects(p,{name:'AbortError'});
});
test('reading: pause/stop only, no destructive commands from audio feedback',()=>{
 assert.equal(interruption('stop reading'),'stopReading');assert.equal(interruption('pausa lettura'),'pauseReading');assert.equal(interruption('cancella paragrafo'),null);assert.equal(interruption('la frase contiene stop reading ma continua'),null);
 const speech={stop(){},speak(){},pause(){},resume(){}};const voice=new LocalVoice({engine:{},speech});voice.active=true;voice.processing={interruptOnly:true};let edits=0,stops=0;voice.addEventListener('text',()=>edits++);voice.addEventListener('interrupt',()=>stops++);voice.partial('delete previous paragraph');voice.partial('stop reading');voice.partial('stop reading');assert.equal(edits,0);assert.equal(stops,1);
});
test('parser: spoken numbers and bilingual arguments',()=>{
 assert.deepEqual(parseScreenless('scegli due'),{id:'openResult',value:'2'});assert.deepEqual(parseScreenless('go to paragraph three'),{id:'gotoParagraph',value:'3'});assert.deepEqual(parseScreenless('nuova nota chiamata Idee'),{id:'new',value:'Idee'});assert.equal(interpret('modalità comando cancella paragrafo','dictation').command.id,'deleteParagraph');assert.equal(interpret('cancella paragrafo','dictation').text,'cancella paragrafo');assert.equal(interpret('virgola','dictation').text,',');assert.equal(interpret('letterale virgola','dictation').text,'virgola');
});
test('Unicode selection: original indices, combining accents, and emoji',()=>{
 const t='🍃 Caffè, caffe\u0300, CAFFÈ';const ranges=findTextRanges(t,'caffe');assert.deepEqual(ranges.map(r=>t.slice(...r)),['Caffè','caffe\u0300','CAFFÈ']);assert.deepEqual(numberedParagraph('uno\n\ndue\n\ntre',2),[5,8]);
});
test('confirmations: selection, title, content, identity, and expiration',()=>{
 const n={id:'a',title:'Uno',body:'Testo',updated:1},p=confirmationSnapshot(n,[0,5],{id:'deleteSelection'},1000);
 assert.ok(confirmationValid(p,n,[0,5],2000));for(const current of [{...n,id:'b'},{...n,title:'Due'},{...n,body:'Altro'},{...n,updated:2}])assert.equal(confirmationValid(p,current,[0,5],2000),false);assert.equal(confirmationValid(p,n,[1,5],2000),false);assert.equal(confirmationValid(p,n,[0,5],32000),false);
});

test('command grammar requires independent agreement and rejects forced matches',async()=>{
 const {chooseTranscript}=await import('../dist/js/voice-grammar.js');const result=text=>({text,words:[{conf:.9}]});
 assert.equal(chooseTranscript(result('modalità omaggio'),result('modalità comando'),'dictation').text,'modalità comando');
 assert.equal(chooseTranscript(result('questa è una nota in italiano'),result('cancella nota'),'commands').source,'free');
 assert.equal(chooseTranscript(result(''),result('conferma'),'commands').source,'free');
 assert.equal(chooseTranscript(result('annulla'),{text:'conferma',words:[{conf:.2}]},'commands').text,'annulla');
 assert.equal(chooseTranscript(result('parole incerte'),result('stop reading'),'interrupt').text,'stop reading');
});

test('VAD: quiet speech below the old threshold reaches the recognizer',()=>{
 const events=[],v=new SpeechSegmenter(e=>events.push(e));
 const quiet=Float32Array.from({length:320},(_,i)=>Math.sin(i/10)*.003);
 for(let i=0;i<30;i++)v.frame(quiet);
 for(let i=0;i<21;i++)v.frame(new Float32Array(320));
 assert.equal(events.filter(e=>e.type==='start').length,1);
 assert.equal(events.filter(e=>e.type==='end').length,1);
 assert.ok(events.filter(e=>e.type==='audio').some(e=>e.data.some(x=>Math.abs(x)>.002)));
});

test('uncertain dictation is preserved; commands and arguments require repetition',async()=>{
 const {needsRecognitionRepeat}=await import('../dist/js/screenless.js');
 assert.equal(needsRecognitionRepeat({text:'una frase da salvare',confidence:.2},'dictation'),false);
 assert.equal(needsRecognitionRepeat({text:'modalità comando',confidence:.2},'dictation'),true);
 assert.equal(needsRecognitionRepeat({text:'cancella paragrafo',confidence:.2},'commands'),true);
 assert.equal(needsRecognitionRepeat({text:'nuovo titolo',confidence:.2},'dictation',true),true);
 assert.equal(needsRecognitionRepeat({text:'conferma',confidence:.9},'commands'),false);
});
