import {cacheAsset} from './voice-engine.js';
import {SPEECH_ASSETS} from './voice-config.js';
export class LocalSpeech {
  constructor(onState=()=>{}){this.onState=onState;this.generation=0;this.requests=new Map();this.nextId=0;this.chunks=[];this.index=0;this.paused=false;}
  async prepare(progress,signal){
    for(const asset of SPEECH_ASSETS)await cacheAsset(asset,n=>progress?.({stage:'speech',progress:n}),signal);
    if(!this.worker){this.worker=new Worker(new URL('./speech-worker.js',import.meta.url),{type:'module'});
      this.worker.onmessage=({data})=>{const request=this.requests.get(data.id);if(!request)return;this.requests.delete(data.id);clearTimeout(request.timeout);data.error?request.reject(Error(data.error)):request.resolve(data);};
      this.worker.onerror=event=>{for(const req of this.requests.values()){clearTimeout(req.timeout);req.reject(Error(event.message||'Sintesi locale non disponibile.'));}this.requests.clear();this.worker?.terminate();this.worker=null;};
    }
    await this.request({type:'init'});
  }
  request(data){return new Promise((resolve,reject)=>{const id=++this.nextId;const timeout=setTimeout(()=>{this.requests.delete(id);reject(Error('Sintesi vocale non risponde.'));},30000);this.requests.set(id,{resolve,reject,timeout});this.worker.postMessage({...data,id});});}
  async speak(text,lang='it-IT',context){
    this.stop();this.chunks=text.match(/[\s\S]{1,160}(?:\s|$)|[\s\S]{1,160}/g)||[];this.index=0;this.lang=lang;const generation=this.generation;
    this.context=context||(this.context?.state!=='closed'?this.context:null)||new AudioContext();await this.context.resume();
    if(!this.worker)await this.prepare();
    if(generation!==this.generation)return;return this.play();
  }
  async play(){
    const generation=++this.generation;this.paused=false;this.speaking=true;this.onState(true);
    try{
      for(;this.index<this.chunks.length;this.index++){
        const data=await this.request({type:'synthesize',text:this.chunks[this.index],lang:this.lang});
        if(generation!==this.generation)return;
        const buffer=this.context.createBuffer(1,data.audio.length,data.sampleRate);buffer.copyToChannel(data.audio,0);
        const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.context.destination);this.source=source;
        await new Promise(resolve=>{this.resolvePlayback=resolve;source.onended=()=>{source.disconnect();resolve();};source.start();});
        if(generation!==this.generation)return;
      }
    }finally{if(generation===this.generation){this.speaking=false;this.onState(false);}}
  }
  pause(){if(!this.speaking)return;this.stop(true);this.paused=true;}
  async resume(){if(this.index>=this.chunks.length||!this.context||this.context.state==='closed')return;const generation=this.generation;await this.context.resume();if(generation===this.generation)return this.play();}
  async repeat(){this.stop();this.index=0;return this.resume();}
  stop(pause=false){this.generation++;try{this.source?.stop();}catch{}this.source=null;this.resolvePlayback?.();this.resolvePlayback=null;this.speaking=false;this.paused=pause;this.onState(false);}
  dispose(){this.stop();for(const p of this.requests.values()){clearTimeout(p.timeout);p.reject(new DOMException('Sessione chiusa','AbortError'));}this.requests.clear();this.worker?.terminate();this.worker=null;}
}
