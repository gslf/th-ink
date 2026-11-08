import {appReady,db,state,flush,execute,dailyBackup} from '/js/app.js';
import {FilenSession} from '/js/filen-session.js';
import {Storage} from '/js/storage.js';
import {createFilen} from '/js/filen-provider.js';
await appReady;
// Test archive only. Suppress automatic test downloads; exercise explicit download separately.
await dailyBackup.enable(false);
const panel=document.createElement('section');panel.style='position:fixed;bottom:8px;left:8px;z-index:90;background:var(--paper);padding:8px;max-width:90%;font:11px system-ui';
const run=document.createElement('button');run.textContent='Check Filen and backup';panel.append(run);const output=document.createElement('output');output.id='filen-qa-result';panel.append(output);document.body.append(panel);
run.onclick=async()=>{
 const results=[],assert=(ok,text)=>{if(!ok)throw Error(text);results.push(text);};
 run.disabled=true;
 try{
  const name='think-filen-credentials-qa-'+crypto.randomUUID(),temp=await new Storage().open(name),session=new FilenSession(temp);
  const config={email:'qa@example.invalid',apiKey:'fake-key',masterKeys:['fake-master'],publicKey:'fake-public',privateKey:'fake-private',authVersion:2,baseFolderUUID:'fake-base',userId:1,password:'never-persist',twoFactorCode:'123456'};
  await session.save(config);const raw=await temp.get('settings','filen-session-v1');assert(raw.key.extractable===false,'Non-exportable Web Crypto key in IndexedDB');temp.db.close();await temp.open(name);const restored=await new FilenSession(temp).load();assert(restored.apiKey==='fake-key'&&!('password' in restored)&&!('twoFactorCode' in restored),'Session reopened without password or 2FA');await session.clear();assert(await session.load()===null,'Disconnect removes the session');temp.db.close();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});
  const sdk=await createFilen();const key='12345678901234567890123456789012',metadata='Caffè — Filen browser';const encrypted=await sdk.crypto().encrypt().metadata({metadata,key});assert(await sdk.crypto().decrypt().metadata({metadata:encrypted,key})===metadata,'Official SDK: real encryption and decryption in the browser');
  await execute('new');const title=document.querySelector('#note-title'),editor=document.querySelector('#editor');title.value='Backup di prova';title.dispatchEvent(new Event('input'));editor.value='Testo italiano. English text.';editor.dispatchEvent(new Event('input'));await flush();await db.revision(state.notes.find(n=>n.id===state.current));
  await dailyBackup.prepare();assert(dailyBackup.blob?.size>0,'Worker prepares a ZIP archive');const content=await dailyBackup.blob.text();assert(content.includes('Testo italiano. English text.')&&content.includes('th-ink-backup.json'),'Backup contains text and restorable data');assert(!content.includes('fake-key'),'Backup excludes credentials');
  await execute('settings');assert(document.querySelector('#modal-content').textContent.includes('Filen'),'Preferences: Filen available');assert(document.querySelector('[data-backup-download]')&&!document.querySelector('[data-backup-download]').disabled,'Backup available with a gesture');
  output.textContent=results.length+' PASS';output.dataset.results=JSON.stringify(results);
 }catch(e){output.textContent='FAIL '+e.message;}finally{run.disabled=false;}
};
