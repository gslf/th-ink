import {requestMicrophone} from './microphone.js';
import {VoskEngine} from './voice-engine.js';
import {AudioQueue} from './audio-pipeline.js';
import {LocalSpeech} from './speech-output.js';
import {grammar,chooseTranscript,confidence} from './voice-grammar.js';
import {interruption} from './screenless.js';

export class LocalVoice extends EventTarget {
  constructor({engine=new VoskEngine(),speech,getStream}={}) {
    super();this.getStream=getStream;this.engine=engine;this.active=false;this._mode='dictation';this.lang='it-IT';this.generation=0;this.captureEpoch=0;
    this.speech=speech||new LocalSpeech(active=>this.outputState(active));this.speaking=false;this.metrics={};this.rateWindow=[];
  }
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  get mode(){return this._mode;}
  set mode(value){this._mode=value;this.node?.port.postMessage({silenceMs:value==='commands'?300:420});this.emit('mode',value);}
  availability(lang=this.lang){return this.engine.availability(lang);}
  async install(){this.abort=new AbortController();await this.engine.install(this.lang,p=>this.emit('progress',p),this.abort.signal);await this.speech.prepare(p=>this.emit('progress',p),this.abort.signal);}
  start(){if(this.active)return Promise.resolve();if(this.startTask)return this.startTask;this.startTask=this.begin().finally(()=>{this.startTask=null;});return this.startTask;}
  async begin(){
    if(!navigator.mediaDevices?.getUserMedia||!globalThis.AudioWorkletNode)throw Error('Servono HTTPS/localhost e AudioWorklet per la voce locale.');
    const generation=++this.generation;this.abort=new AbortController();
    const context=new AudioContext({latencyHint:'interactive'});this.context=context;
    await context.resume();
    try{
      await this.engine.load(this.lang,p=>this.emit('progress',p),this.abort.signal);
      await this.speech.prepare(p=>this.emit('progress',p),this.abort.signal);
      if(generation!==this.generation)return;
      this.emit('progress',{stage:'microphone'});
      const stream=await requestMicrophone(this.getStream||navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),{signal:this.abort.signal});
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;this.emit('progress',{stage:'audio'});await context.resume();if(context.state!=='running')throw Error('Il dispositivo non ha avviato l’audio. Premi nuovamente Avvia ascolto.');await context.audioWorklet.addModule(new URL('./audio-worklet.js',import.meta.url));
      if(generation!==this.generation)return;
      this.recognizer=this.engine.createRecognizer(partial=>this.partial(partial));
      this.source=context.createMediaStreamSource(stream);this.node=new AudioWorkletNode(context,'think-capture');this.node.onprocessorerror=()=>{this.emit('error','Acquisizione audio interrotta. Ricarica l’app e riprova.');this.stop();};
      this.sink=context.createGain();this.sink.gain.value=0;this.source.connect(this.node);this.node.connect(this.sink);this.sink.connect(context.destination);
      this.active=true;this.audioOrigin=performance.now()-context.currentTime*1000;this.mode=this.mode;
      this.queue=new AudioQueue(item=>this.process(item,generation),error=>{this.emit('error',error?.message||'Il dispositivo non tiene il passo. Ascolto fermato: ripeti la frase.');this.stop();});
      this.lastCaptureTime=performance.now();this.captureWatchdog=setInterval(()=>{if(this.active&&performance.now()-this.lastCaptureTime>5000){this.emit('error','Microfono aperto ma non arrivano campioni audio. Controlla l’ingresso del dispositivo e riavvia l’ascolto.');this.stop();}},1000);
      this.node.port.onmessage=({data})=>{if(!this.active)return;this.lastCaptureTime=performance.now();if(data.type==='level'){this.emit('level',data);return;}this.queue.push({...data,epoch:this.captureEpoch,interruptOnly:this.speaking||performance.now()<this.echoUntil});};
      for(const track of stream.getAudioTracks())track.onended=()=>{if(this.active){this.emit('error','Microfono scollegato.');this.stop();}};
      context.onstatechange=()=>{if(this.active&&context.state==='suspended'){this.emit('error','Il sistema ha sospeso l’audio. Tocca Avvia ascolto per riprendere.');this.stop();}};
      this.emit('device',{label:stream.getAudioTracks()[0]?.label||'Microfono',muted:stream.getAudioTracks()[0]?.muted});this.emit('state',true);this.emit('progress',{stage:'ready'});
    }catch(error){if(generation===this.generation)this.stop();if(error.name!=='AbortError')throw error;}
    finally{if(generation!==this.generation){streamClose(this.stream);await context.close().catch(()=>{});}}
  }
  partial(text){
    if(!this.active||!text)return;
    if(this.processing?.interruptOnly){const id=interruption(text);if(id&&!this.interrupted){this.interrupted=true;this.emit('interrupt',id);}return;}
    if(this.processing?.epoch!==this.captureEpoch)return;
    this.emit('interim',text);
  }
  async process(item,generation){
    if(!this.active||generation!==this.generation)return;
    if(item.type==='start'){this.control?.dispose();const controlMode=item.interruptOnly?'interrupt':this.mode;this.control=this.argumentMode?null:this.engine.createRecognizer(partial=>{if(this.segment?.interruptOnly)this.partial(partial);},grammar(this.lang,controlMode));this.segment={epoch:item.epoch,interruptOnly:item.interruptOnly,controlMode,texts:[],words:[],controlTexts:[],controlWords:[],started:performance.now()};this.interrupted=false;return;}
    if(!this.segment)return;
    if(item.epoch!==this.segment.epoch)this.segment.interruptOnly=true;
    this.processing={...item,interruptOnly:this.segment.interruptOnly};
    const begin=performance.now();
    if(item.type==='audio'){
      if(this.control){const constrained=await this.control.feed(item.data);if(generation!==this.generation)return;if(constrained.event==='result')this.accumulate(constrained.result,true);}
      const result=this.segment.interruptOnly?null:await this.recognizer.feed(item.data);if(generation!==this.generation)return;
      const ms=performance.now()-begin;this.rateWindow.push(ms/(item.data.length/16));if(this.rateWindow.length>30)this.rateWindow.shift();
      if(result?.event==='result')this.accumulate(result.result);
      this.metrics={...this.metrics,frameMs:ms,realTimeFactor:this.rateWindow.reduce((a,b)=>a+b,0)/this.rateWindow.length,queueMs:this.queue.samples/16};
    }
    if(item.type==='end'){
      if(this.control){const constrained=await this.control.finish();if(generation!==this.generation)return;this.accumulate(constrained.result,true);}
      const result=await this.recognizer.finish();if(generation!==this.generation)return;
      this.accumulate(result.result);const segment=this.segment;this.segment=null;
      const chosen=chooseTranscript({text:segment.texts.join(' ').trim(),words:segment.words},{text:segment.controlTexts.join(' ').trim(),words:segment.controlWords},segment.controlMode);const text=chosen.text;
      this.metrics={...this.metrics,endpointMs:item.at-item.lastSpeech,finalMs:Math.max(0,performance.now()-(this.audioOrigin+item.clock)+(item.at-item.lastSpeech))};
      this.emit('metrics',this.metrics);
      if(!text){if(!segment.interruptOnly)this.emit('unrecognized');return;}
      if(segment.interruptOnly||segment.epoch!==this.captureEpoch){const id=interruption(text);if(id&&!this.interrupted)this.emit('interrupt',id);return;}
      this.emit('recognition',{text,confidence:confidence(chosen.words),source:chosen.source,metrics:this.metrics});
      this.emit('text',text);
    }
  }
  accumulate(result,control=false){if(result?.text)this.segment[control?'controlTexts':'texts'].push(result.text);if(result?.result)this.segment[control?'controlWords':'words'].push(...result.result);}
  outputState(active){
    if(this.speaking===active)return;this.speaking=active;this.captureEpoch++;this.echoUntil=performance.now()+250;
    // The decoder can hear speech output, but this epoch is restricted to stop/pause.
    // Never let a delayed echo become an editing command after playback ends.
    if(this.segment)this.segment.interruptOnly=true;
    this.emit('speaking',active);
  }
  async speak(text){return this.speech.speak(text,this.lang,this.context?.state==='running'?this.context:undefined);}
  localVoices(){return [{name:'eSpeak NG locale',lang:this.lang,localService:true}];}
  stopReading(){this.speech.stop();}
  pauseReading(){this.speech.pause();}
  resumeReading(){return this.speech.resume();}
  repeatReading(){return this.speech.repeat();}
  stop(){
    clearInterval(this.captureWatchdog);this.generation++;this.abort?.abort();this.active=false;this.captureEpoch++;this.queue?.close();this.recognizer?.dispose();this.recognizer=null;this.control?.dispose();this.control=null;this.segment=null;
    this.source?.disconnect();this.node?.disconnect();this.sink?.disconnect();streamClose(this.stream);this.stream=null;
    this.speech.stop();this.context?.close().catch(()=>{});this.context=null;this.node=null;this.emit('state',false);
  }
  dispose(){this.stop();this.engine.dispose();this.speech.dispose();}
}
function streamClose(stream){stream?.getTracks().forEach(track=>track.stop());}
