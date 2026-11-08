import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
test('worker: preserves early updates, accents, AND, edits, and trash',async()=>{
 const worker=new Worker(new URL('./worker-adapter.mjs',import.meta.url));
 const search=(query,request)=>new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('message',resolve);worker.postMessage({type:'search',query,request});});
 try{
  worker.postMessage({type:'update',notes:[{id:'1',title:'Caffè',body:'italiano English'},{id:'2',title:'Altro',body:'English'},{id:'3',title:'Caffè',body:'italiano',deleted:true}]});
  let result=await search('CAFFE italiano',1);assert.deepEqual(result.ids,['1']);assert.equal(result.engine,'C / WASM');
  worker.postMessage({type:'update',notes:[{id:'1',title:'Caffè',body:'aggiornato'}]});result=await search('English',2);assert.deepEqual(result.ids,['2']);
  result=await search('non presente',3);assert.deepEqual(result.ids,[]);
 }finally{await worker.terminate();}
});
