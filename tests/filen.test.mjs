import test from 'node:test';
import assert from 'node:assert/strict';
import {FilenSync,eventFor,parseEvent,serializeEvent,signature,keyOf} from '../src/js/filen-sync.js';
import {FilenSession} from '../src/js/filen-session.js';
import {DailyBackup,backupArchive,localDay} from '../src/js/daily-backup.js';
import {restoreBackup} from '../src/js/restore-backup.js';
class DB {
 data=new Map();
 async put(store,value){this.data.set(store+':'+value.id,structuredClone(value));}
 async get(store,id){return structuredClone(this.data.get(store+':'+id));}
 async remove(store,id){this.data.delete(store+':'+id);}
 async all(store){return [...this.data].filter(([k])=>k.startsWith(store+':')).map(([,v])=>structuredClone(v));}
 async snapshot(){return Object.fromEntries(await Promise.all(['notes','folders','history'].map(async s=>[s,await this.all(s)])));}
}
class Remote {
 account='test-account';files=new Map();writes=0;
 async list(){return [...this.files.keys()];}
 async read(rev){return this.files.get(rev);}
 async write(rev,name,text){this.writes++;this.files.set(rev,text);}
}
const note=(body='Caffè. Italiano e English.')=>({kind:'note',id:'n1',title:'Titolo ☕',body,folder:null,created:1,updated:2,pinned:false,deleted:false});
async function client(remote,items=[]){
 const db=new DB(),state=structuredClone(items);
 const sync=new FilenSync({db,local:()=>structuredClone(state),apply:async(item,expected)=>{const at=state.findIndex(n=>keyOf(n)===keyOf(item)),old=state[at];if((old?signature(old):null)!==expected)return false;if(at<0)state.push(structuredClone(item));else state[at]=structuredClone(item);return true;}});
 await sync.attach(remote);return {sync,state,db};
}
const edit=(client,body)=>{const n=client.state.find(n=>n.id==='n1');n.body=body;n.updated++;};
test('Filen: Markdown round trip, unicode and tamper detection',async()=>{const e=await eventFor(note('Hello\n<!-- -->\nàèì'));assert.deepEqual(await parseEvent(serializeEvent(e),e.revision),e);await assert.rejects(parseEvent(serializeEvent(e)+'x',e.revision));});
test('Filen: folders, first upload, second device, no redundant uploads',async()=>{const r=new Remote(),a=await client(r,[{kind:'folder',id:'f',name:'Idee',parent:null},{...note(),folder:'f'}]);await a.sync.sync();assert.equal(r.writes,2);const b=await client(r);await b.sync.sync();assert.equal(b.state.length,2);assert.equal(b.state.find(n=>n.kind==='note').folder,'f');await a.sync.sync();await b.sync.sync();assert.equal(r.writes,2);});
test('Filen: edits and trash/restoration propagate',async()=>{const r=new Remote(),a=await client(r,[note()]);await a.sync.sync();const b=await client(r);await b.sync.sync();edit(a,'Versione nuova');await a.sync.sync();await b.sync.sync();assert.equal(b.state[0].body,'Versione nuova');b.state[0].deleted=true;await b.sync.sync();await a.sync.sync();assert.equal(a.state[0].deleted,true);a.state[0].deleted=false;await a.sync.sync();await b.sync.sync();assert.equal(b.state[0].deleted,false);});
test('Filen: offline conflicts preserve both texts and converge',async()=>{const r=new Remote(),a=await client(r,[note()]);await a.sync.sync();const b=await client(r);await b.sync.sync();edit(a,'Modifica A');edit(b,'Modifica B');await a.sync.sync();await b.sync.sync();await a.sync.sync();await b.sync.sync();assert.deepEqual(new Set(a.state.map(n=>n.body)),new Set(['Modifica A','Modifica B']));assert.deepEqual(new Set(b.state.map(n=>n.body)),new Set(['Modifica A','Modifica B']));const writes=r.writes;await a.sync.sync();await b.sync.sync();assert.equal(r.writes,writes);assert.equal(a.state.length,2);});
test('Filen: typing during upload is not replaced',async()=>{const r=new Remote(),a=await client(r,[note()]),write=r.write.bind(r);r.write=async(...args)=>{edit(a,'Typed during upload');await write(...args);};await a.sync.sync();assert.equal(a.state[0].body,'Typed during upload');r.write=write;await a.sync.sync();const b=await client(r);await b.sync.sync();assert.ok(b.state.some(n=>n.body==='Typed during upload'));});
test('Filen: failed upload retries without loss',async()=>{const r=new Remote(),a=await client(r,[note()]),write=r.write.bind(r);r.write=async()=>{throw Error('Offline');};await assert.rejects(a.sync.sync());assert.equal(a.state[0].body,note().body);r.write=write;await a.sync.sync();assert.equal(r.files.size,1);});
test('Filen: missing cloud revisions do not delete local notes',async()=>{const r=new Remote(),a=await client(r,[note()]);await a.sync.sync();r.files.clear();await assert.rejects(a.sync.sync(),/Mancano versioni/);assert.equal(a.state.length,1);});
const config={email:'fake@example.invalid',apiKey:'test-api-key',masterKeys:['test-master'],publicKey:'public',privateKey:'private',authVersion:2,baseFolderUUID:'base',userId:9,password:'do-not-store',twoFactorCode:'123456'};
test('Filen: encrypted session excludes password, key cannot be exported',async()=>{const db=new DB(),s=new FilenSession(db);await s.save(config);const saved=await db.get('settings','filen-session-v1');assert.equal(saved.key.extractable,false);await assert.rejects(crypto.subtle.exportKey('raw',saved.key));assert.ok(!JSON.stringify(saved).includes('do-not-store'));const resumed=await new FilenSession(db).load();assert.equal(resumed.apiKey,'test-api-key');assert.equal(resumed.password,undefined);assert.equal(resumed.twoFactorCode,undefined);await s.clear();assert.equal(await s.load(),null);});
test('Filen: altered encrypted session fails authentication',async()=>{const db=new DB(),s=new FilenSession(db);await s.save(config);const r=await db.get('settings','filen-session-v1');new Uint8Array(r.ciphertext)[0]^=1;await db.put('settings',r);await assert.rejects(s.load());});
test('Backup: daily request, persisted reopen, manual retry and next day',async()=>{const db=new DB();let count=0,date=new Date(2026,10,7,23,55);const options={db,send:()=>count++,now:()=>date},b=new DailyBackup(options);await b.restore();await b.prepare();assert.equal(b.request({automatic:true}),true);await new Promise(r=>setTimeout(r,0));assert.equal(b.request({automatic:true}),false);const c=new DailyBackup(options);await c.restore();await c.prepare();assert.equal(c.request({automatic:true}),false);assert.equal(c.request(),true);await new Promise(r=>setTimeout(r,0));date=new Date(2026,10,8,0,2);await c.prepare();assert.equal(c.request({automatic:true}),true);assert.equal(count,3);assert.equal(localDay(date),'2026-11-08');});
test('Backup: disabled auto, stale snapshot and blocked downloads',async()=>{const db=new DB(),b=new DailyBackup({db,send:()=>{throw Error('blocked');}});await b.restore();await b.prepare();assert.throws(()=>b.request(),/blocked/);assert.equal(b.config.lastRequested,'');await b.enable(false);assert.equal(b.request({automatic:true}),false);b.invalidate();assert.equal(b.request(),false);clearTimeout(b.timer);});
test('Backup: Markdown, trash/history included; session excluded',async()=>{const snapshot={notes:[note(),{...note('Trashed'),id:'trash',deleted:true}],folders:[],history:[{id:'n1',items:[{title:'Prima',body:'Vecchia',at:1}]}],settings:[{id:'filen-session-v1',secret:'DO-NOT-BACKUP'}]};const text=await backupArchive(snapshot).text();for(const value of ['Note/','Cestino/','th-ink-backup.json','Vecchia'])assert.ok(text.includes(value));assert.ok(!text.includes('DO-NOT-BACKUP'));});
test('Backup restore remaps IDs, preserves trash/history, rejects cycles',()=>{const data={format:'th.ink-backup',version:1,notes:[{...note(),folder:'f',deleted:true}],folders:[{id:'f',name:'Folder',parent:null}],history:[{id:'n1',items:[{title:'Old',body:'Old',at:1}]}]};const restored=restoreBackup(JSON.stringify(data));assert.notEqual(restored.notes[0].id,'n1');assert.equal(restored.notes[0].folder,restored.folders[0].id);assert.equal(restored.history[0].id,restored.notes[0].id);assert.equal(restored.notes[0].deleted,true);data.folders[0].parent='f';assert.throws(()=>restoreBackup(JSON.stringify(data)),/Struttura/);});
test('Filen: truly simultaneous writers converge and preserve both branches',async()=>{
 const r=new Remote(),a=await client(r,[note()]);await a.sync.sync();const b=await client(r);await b.sync.sync();edit(a,'Concurrent A');edit(b,'Concurrent B');
 let count=0,release;const barrier=new Promise(resolve=>release=resolve),write=r.write.bind(r);
 r.write=async(...args)=>{if(++count===2)release();await barrier;return write(...args);};
 await Promise.all([a.sync.sync(),b.sync.sync()]);r.write=write;
 await Promise.all([a.sync.sync(),b.sync.sync()]);await a.sync.sync();await b.sync.sync();
 assert.deepEqual(new Set(a.state.map(n=>n.body)),new Set(['Concurrent A','Concurrent B']));assert.deepEqual(new Set(b.state.map(n=>n.body)),new Set(['Concurrent A','Concurrent B']));assert.equal(a.state.length,2);
});
test('Filen: local typing while remote revision downloads is preserved',async()=>{
 const r=new Remote(),a=await client(r,[note()]);await a.sync.sync();const b=await client(r);await b.sync.sync();edit(a,'Remote');await a.sync.sync();const read=r.read.bind(r);r.read=async rev=>{edit(b,'Local typing');return read(rev);};await b.sync.sync();assert.ok(b.state.some(n=>n.body==='Local typing'));r.read=read;await a.sync.sync();assert.ok(a.state.some(n=>n.body==='Local typing'));
});
test('Filen: switching accounts does not reuse another account baseline',async()=>{
 const r=new Remote(),a=await client(r,[note()]);await a.sync.sync();const other=new Remote();other.account='second';await a.sync.detach();await a.sync.attach(other);await a.sync.sync();assert.equal(other.writes,1);assert.equal(r.writes,1);
});
test('Filen: failure after successful upload retries idempotently',async()=>{
 const r=new Remote(),a=await client(r,[note()]),write=r.write.bind(r);r.write=async(...args)=>{await write(...args);throw Error('Connection lost after upload');};await assert.rejects(a.sync.sync());r.write=write;await a.sync.sync();assert.equal(r.files.size,1);assert.equal(a.state.length,1);
});
test('Filen: untrusted path-like identifiers are rejected before writes',async()=>{await assert.rejects(eventFor({...note(),id:'../../escape'}),/Elemento cloud/);});
test('Filen: emoji and multiple tags synchronize, including removal on another device',async()=>{
 const r=new Remote(),a=await client(r,[{...note(),emoji:'💡',tags:['Ideas','Work']}]);await a.sync.sync();
 const b=await client(r);await b.sync.sync();assert.equal(b.state[0].emoji,'💡');assert.deepEqual(b.state[0].tags,['Ideas','Work']);
 b.state[0].emoji='';b.state[0].tags=[];b.state[0].updated++;await b.sync.sync();await a.sync.sync();assert.equal(a.state[0].emoji,undefined);assert.equal(a.state[0].tags,undefined);assert.equal(a.state[0].body,note().body);
});
