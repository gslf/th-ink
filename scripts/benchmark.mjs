import {Worker} from 'node:worker_threads';
const worker=new Worker(new URL('../tests/worker-adapter.mjs',import.meta.url));
const count=10000,body='Una nota locale per pensieri, progetti e appunti. '.repeat(30);
worker.postMessage({type:'update',notes:Array.from({length:count},(_,i)=>({id:String(i),title:'Nota '+i,body:body+(i%100===0?' unicorno':''),deleted:false}))});
const times=[];let cold=0;
for(let i=0;i<21;i++){
 const result=await new Promise((resolve,reject)=>{const fail=e=>reject(e);worker.once('error',fail);worker.once('message',message=>{worker.off('error',fail);resolve(message);});worker.postMessage({type:'search',query:i%2?'unicorno':'pensieri appunti',request:i});});
 if(i===0)cold=result.ms;else times.push(result.ms);
}
await worker.terminate();times.sort((a,b)=>a-b);console.log(JSON.stringify({notes:count,textMB:(count*body.length/1e6).toFixed(1),coldMs:+cold.toFixed(2),medianMs:+times[10].toFixed(2),p95Ms:+times[19].toFixed(2),scope:'Worker C/WASM, Node desktop; excludes startup, IPC and UI. Not a smartphone benchmark.'},null,2));
