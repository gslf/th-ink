import {Resampler, SpeechSegmenter} from './audio-pipeline.js';
class ThinkCapture extends AudioWorkletProcessor {
  constructor(){
    super();this.meterFrames=0;this.meterEnergy=0;this.meterPeak=0;this.frame=new Float32Array(320);this.offset=0;this.resampler=new Resampler(sampleRate);
    this.segmenter=new SpeechSegmenter(message=>{message.clock=currentTime*1000;this.port.postMessage(message,message.data?[message.data.buffer]:[]);});
    this.port.onmessage=({data})=>{if(data.type==='reset'){this.segmenter.reset();this.offset=0;}if(data.silenceMs)this.segmenter.silenceMs=data.silenceMs;};
  }
  process(inputs){const channels=inputs[0];if(!channels?.length)return true;const length=channels[0].length;const mono=new Float32Array(length);for(const channel of channels)for(let i=0;i<length;i++)mono[i]+=channel[i]/channels.length;
    for(const sample of mono){this.meterEnergy+=sample*sample;this.meterPeak=Math.max(this.meterPeak,Math.abs(sample));}this.meterFrames+=length;
    if(this.meterFrames>=sampleRate/10){this.port.postMessage({type:'level',rms:Math.sqrt(this.meterEnergy/this.meterFrames),peak:this.meterPeak,speech:this.segmenter.active,threshold:Math.max(this.segmenter.threshold,this.segmenter.noise*3)});this.meterFrames=0;this.meterEnergy=0;this.meterPeak=0;}
    this.resampler.push(mono,sample=>{this.frame[this.offset++]=sample;if(this.offset===320){this.segmenter.frame(this.frame);this.frame=new Float32Array(320);this.offset=0;}});return true;
  }
}
registerProcessor('think-capture',ThinkCapture);
