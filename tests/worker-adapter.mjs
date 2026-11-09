import {parentPort} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
const pending=[];globalThis.self={postMessage:message=>parentPort.postMessage(message)};
globalThis.fetch=async()=>new Response(await readFile(new URL('../dist/assets/search.wasm',import.meta.url)),{headers:{'Content-Type':'application/wasm'}});
parentPort.on('message',data=>{if(self.onmessage)self.onmessage({data});else pending.push(data);});
await import('../src/js/search-worker.js');
for(const data of pending)self.onmessage({data});
