// Pure, testable DSP. Fixed 16 kHz output; weighted integration keeps fractional
// phase between render quanta (44.1 kHz and 48 kHz both work without sample drift).
export class Resampler {
  constructor(inputRate, outputRate = 16000) {this.ratio=inputRate/outputRate;this.remaining=this.ratio;this.sum=0;}
  push(input, emit) {
    for (let i=0;i<input.length;i++) {
      let available=1;
      while(available>1e-9){const take=Math.min(available,this.remaining);this.sum+=input[i]*take;this.remaining-=take;available-=take;
        if(this.remaining<1e-9){emit(this.sum/this.ratio);this.remaining=this.ratio;this.sum=0;}
      }
    }
  }
}
export class SpeechSegmenter {
  constructor(emit, {silenceMs=420, maxMs=12000, threshold=0.001}={}) {
    this.emit=emit;this.silenceMs=silenceMs;this.maxMs=maxMs;this.threshold=threshold;this.noise=0.0001;this.reset();
  }
  reset(){this.active=false;this.pre=[];this.batch=[];this.silence=0;this.elapsed=0;this.attack=0;this.samples=0;}
  frame(frame) {
    let energy=0,mean=0;for(const x of frame)mean+=x;mean/=frame.length;
    for(const x of frame)energy+=(x-mean)**2;
    const rms=Math.sqrt(energy/frame.length),ms=frame.length/16;
    const voiced=rms>Math.max(this.threshold,this.noise*3);
    this.samples+=frame.length;
    if(!this.active){
      if(!voiced)this.noise=this.noise*0.98+rms*0.02;
      this.pre.push(frame);if(this.pre.length>10)this.pre.shift();
      this.attack=voiced?this.attack+1:0;
      if(this.attack<2)return;
      this.active=true;this.elapsed=0;this.emit({type:'start',at:this.samples/16});
      for(const f of this.pre)this.append(f);this.pre=[];
    }else this.append(frame);
    this.elapsed+=ms;this.silence=voiced?0:this.silence+ms;
    if(voiced)this.lastSpeech=this.samples/16;
    if(this.silence>=this.silenceMs||this.elapsed>=this.maxMs){this.flush();this.emit({type:'end',at:this.samples/16,lastSpeech:this.lastSpeech});this.active=false;this.attack=0;this.silence=0;}
  }
  append(frame){this.batch.push(frame);if(this.batch.length>=4)this.flush();}
  flush(){if(!this.batch.length)return;const data=new Float32Array(this.batch.reduce((n,f)=>n+f.length,0));let offset=0;for(const f of this.batch){data.set(f,offset);offset+=f.length;}this.batch=[];this.emit({type:'audio',data});}
}

// Never build an unbounded audio queue on slow devices: reject the utterance,
// tell the user, and keep the text unchanged instead of applying stale commands.
export class AudioQueue {
  constructor(handle, overflow, maxSamples=24000) {this.handle=handle;this.overflow=overflow;this.maxSamples=maxSamples;this.queue=[];this.samples=0;this.running=false;this.closed=false;}
  push(item){if(this.closed)return;this.samples+=item.data?.length||0;if(this.samples>this.maxSamples){this.close();this.overflow();return;}this.queue.push(item);this.drain();}
  async drain(){if(this.running)return;this.running=true;try{while(this.queue.length&&!this.closed){const item=this.queue.shift();await this.handle(item);this.samples-=item.data?.length||0;}}catch(e){if(!this.closed){this.close();this.overflow(e);}}finally{this.running=false;}}
  close(){this.closed=true;this.queue=[];this.samples=0;}
}
