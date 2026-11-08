import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../dist/sw.js',import.meta.url),'utf8');
function harness(caches={}){const handlers={},shown=[],opened=[],messages=[];let windows=[];const self={location:new URL('https://gslf.it/th-ink/sw.js'),addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(...args)=>shown.push(args)},clients:{claim:async()=>{},matchAll:async()=>windows,openWindow:async url=>opened.push(url)}};vm.runInNewContext(source,{self,URL,Request,Response,console,caches});return {handlers,shown,opened,messages,setWindows:items=>windows=items};}
test('push notifications constrain destinations to the app and preserve reminder links',async()=>{
 const h=harness();let promise;h.handlers.push({data:{json:()=>({title:'th.ink',body:'Call Alice',url:'https://gslf.it/th-ink/?note=n&reminder=r',tag:'think-n:r'})},waitUntil:p=>promise=p});await promise;
 assert.equal(h.shown[0][1].data.url,'https://gslf.it/th-ink/?note=n&reminder=r');assert.equal(h.shown[0][1].tag,'think-n:r');
 h.handlers.push({data:{json:()=>({url:'https://attacker.example/'})},waitUntil:p=>promise=p});await promise;assert.equal(h.shown[1][1].data.url,'https://gslf.it/th-ink/');
 h.handlers.notificationclick({notification:{close(){},data:h.shown[0][1].data},waitUntil:p=>promise=p});await promise;assert.deepEqual(h.opened,['https://gslf.it/th-ink/?note=n&reminder=r']);
 let focused=false;h.setWindows([{url:'https://gslf.it/th-ink/',focus:async()=>focused=true,postMessage:m=>h.messages.push(m)}]);h.handlers.notificationclick({notification:{close(){},data:h.shown[0][1].data},waitUntil:p=>promise=p});await promise;assert(focused);assert.equal(h.messages[0].note,'n');assert.equal(h.messages[0].reminder,'r');
});
test('API requests never use the offline shell fallback',()=>{const h=harness();let responded=false;h.handlers.fetch({request:new Request('https://gslf.it/th-ink/api/index.php?action=status'),respondWith:()=>responded=true});assert.equal(responded,false);});

test('th.ink activation preserves CWtty and BlackSquelch offline caches',async()=>{
 const current=source.match(/const CACHE='([^']+)'/)[1],deleted=[];
 const h=harness({keys:async()=>['cwtty','blacksquelch:https://gslf.it/blacksquelch/:v1','th-ink-shell-old',current],delete:async key=>deleted.push(key)});
 let promise;h.handlers.activate({waitUntil:p=>promise=p});await promise;
 assert.deepEqual(deleted,['th-ink-shell-old']);
});
