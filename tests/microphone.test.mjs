import test from 'node:test';
import assert from 'node:assert/strict';
import {requestMicrophone} from '../dist/js/microphone.js';
test('microphone permissions time out and a late stream is stopped',async()=>{
 let grant,stopped=0;
 await assert.rejects(requestMicrophone(()=>new Promise(resolve=>grant=resolve),{timeoutMs:5}),/non ha risposto/);
 grant({getTracks:()=>[{stop:()=>stopped++}]});await Promise.resolve();assert.equal(stopped,1);
});
test('cancelling a microphone request rejects promptly and releases late access',async()=>{
 const abort=new AbortController();let grant,stopped=0;
 const pending=requestMicrophone(()=>new Promise(resolve=>grant=resolve),{signal:abort.signal});abort.abort();
 await assert.rejects(pending,{name:'AbortError'});grant({getTracks:()=>[{stop:()=>stopped++}]});await Promise.resolve();assert.equal(stopped,1);
});
test('an already cancelled request never asks the browser for microphone access',async()=>{
 const abort=new AbortController();abort.abort();let asked=false;
 await assert.rejects(requestMicrophone(()=>{asked=true;},{signal:abort.signal}),{name:'AbortError'});assert.equal(asked,false);
});
test('microphone failures explain denial, missing devices and occupied devices',async()=>{
 for(const [name,message] of [['NotAllowedError',/negato/],['NotFoundError',/Nessun microfono/],['NotReadableError',/non è accessibile/]])await assert.rejects(requestMicrophone(()=>Promise.reject(new DOMException('',name))),message);
 const stream={getTracks:()=>[]};assert.equal(await requestMicrophone(()=>Promise.resolve(stream)),stream);
});
