import createModule from '../vendor/espeak/espeak-ng.js';
let ready;
async function instance(){
  ready ||= createModule({locateFile:name=>new URL('../vendor/espeak/'+name,import.meta.url).href}).then(module=>new module.eSpeakNGWorker());
  return ready;
}
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(async()=>{
  const synth=await instance();
  if(data.type==='init'){self.postMessage({id:data.id,ready:true});return;}
  synth.set_voice(data.lang==='it-IT'?'it':'en-us');synth.set_rate(data.rate||175);
  const chunks=[];
  synth.synthesize(data.text.replace(/[<>]/g,' '),(samples)=>{if(samples?.length)chunks.push(samples.slice());return false;});
  const audio=new Float32Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;
  for(const chunk of chunks){for(let i=0;i<chunk.length;i++)audio[offset+i]=chunk[i]/32768;offset+=chunk.length;}
  self.postMessage({id:data.id,audio,sampleRate:22050},[audio.buffer]);
 }).catch(error=>self.postMessage({id:data.id,error:error.message}));};
