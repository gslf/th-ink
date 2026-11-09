import {normalize} from './core.js';
const encoder=new TextEncoder();let engine=null,docs=new Map(),dirty=true,heap=0,queryOffset=0;
const ready=(async()=>{try{const result=await WebAssembly.instantiateStreaming(fetch('../assets/search.wasm'));engine=result.instance.exports;heap=Number(engine.__heap_base.value);}catch{/* Same semantics on browsers without WebAssembly. */}})();
function ensure(bytes){const needed=bytes-engine.memory.buffer.byteLength;if(needed>0)engine.memory.grow(Math.ceil(needed/65536));}
function pack(){if(!engine||!dirty)return;let offset=heap;for(const doc of docs.values())offset+=doc.bytes.length;ensure(offset+65536);let view=new Uint8Array(engine.memory.buffer);offset=heap;for(const doc of docs.values()){doc.offset=offset;view.set(doc.bytes,offset);offset+=doc.bytes.length;}queryOffset=offset;dirty=false;}
self.onmessage=async({data})=>{
 if(data.type==='update'){for(const note of data.notes){const title=normalize(note.title);const text=title+'\n'+normalize(note.body);docs.set(note.id,{id:note.id,title,text,bytes:encoder.encode(text),deleted:note.deleted});}dirty=true;return;}
 if(data.type!=='search')return;
 await ready;
 const begin=performance.now();const terms=normalize(data.query).trim().split(/\s+/).filter(Boolean);const ids=[];
 try{pack();}catch{engine=null;}
 const bytes=terms.map(t=>encoder.encode(t));
 const offsets=[];if(engine){let cursor=queryOffset;ensure(cursor+bytes.reduce((sum,b)=>sum+b.length,0));const view=new Uint8Array(engine.memory.buffer);for(const b of bytes){offsets.push(cursor);view.set(b,cursor);cursor+=b.length;}}
 for(const doc of docs.values()){
  if(doc.deleted)continue;
  let match=true;
  for(let i=0;i<terms.length;i++){
   if(engine){if(!engine.contains(doc.offset,doc.bytes.length,offsets[i],bytes[i].length)){match=false;break;}}
   else if(!doc.text.includes(terms[i])){match=false;break;}
  }
  if(match)ids.push({id:doc.id,score:terms.every(t=>doc.title.includes(t))?1:0});
 }
 ids.sort((a,b)=>b.score-a.score);
 self.postMessage({type:'results',request:data.request,ids:ids.map(n=>n.id),ms:performance.now()-begin,engine:engine?'C / WASM':'JavaScript'});
};
