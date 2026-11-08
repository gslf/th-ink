import {appReady,db,state,flush,voice} from '/js/app.js';await appReady;await (await import('/js/app.js')).changeLanguage('it',{persist:false});
const cleanup=document.createElement('button');cleanup.id='qa-clean';cleanup.textContent='Finish tests';cleanup.style='position:fixed;bottom:5px;right:5px;z-index:100;font-size:10px;padding:4px;background:var(--paper);color:var(--muted)';document.body.append(cleanup);
cleanup.onclick=async()=>{voice.dispose();await flush();for(const n of state.notes)await db.files?.removeEntry(n.id+'.md').catch(()=>{});db.db.close();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('think-ux-qa');r.onsuccess=resolve;r.onerror=()=>reject(r.error);});localStorage.removeItem('th-ink-theme:think-ux-qa');cleanup.textContent='Tests cleaned up';cleanup.disabled=true;};
const {spoken,execute,setMode,voiceCursor}=await import('/js/app.js');
const qaVoice=document.createElement('button');qaVoice.textContent='Test voice cursor';qaVoice.id='qa-voice';qaVoice.style='position:fixed;bottom:5px;left:5px;z-index:100;font-size:10px;padding:4px;background:var(--paper);color:var(--muted)';document.body.append(qaVoice);
const qaResult=document.createElement('output');qaResult.id='qa-voice-result';qaResult.style='position:fixed;top:0;right:0;z-index:100;font:10px system-ui';document.body.append(qaResult);
qaVoice.onclick=async()=>{
 const results=[];const assert=(ok,msg)=>{if(!ok)throw Error(msg);results.push(msg);};const editor=document.querySelector('#editor');
 const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 try{
 voice.speak=async()=>{};voice.mode='commands';await execute('new');document.querySelector('#note-title').value='Un pensiero alla volta.';document.querySelector('#note-title').dispatchEvent(new Event('input'));
 editor.value=Array.from({length:18},(_,i)=>`Paragrafo ${i+1}. Una frase da conservare. L’ultima frase di questo pensiero.`).join('\n\n');editor.dispatchEvent(new Event('input'));
 editor.setSelectionRange(0,0);await setMode('voice');
 await spoken.receive('seleziona l’ultima frase del paragrafo');await frame();assert(editor.value.slice(editor.selectionStart,editor.selectionEnd)==='L’ultima frase di questo pensiero.','Exact last sentence');
 assert(document.querySelector('.voice-selection').textContent==='L’ultima frase di questo pensiero.','Selection visible without focus');
 await spoken.receive('spostati al paragrafo successivo');assert(editor.selectionStart===editor.value.indexOf('Paragrafo 2.'),'Next paragraph');
 await spoken.receive('spostati tre frasi in avanti');assert(editor.selectionStart===editor.value.indexOf('Paragrafo 3.'),'Three sentences forward');
 await spoken.receive('fine nota');await spoken.receive('dettatura');await spoken.receive('Nuovo pensiero in fondo.');await frame();
 assert(editor.value.endsWith('Nuovo pensiero in fondo.'),'Dictation at cursor');
 const caret=editor.markdownView.coordsAtPos(editor.selectionEnd),viewport=document.querySelector('#document-scroll').getBoundingClientRect(),dock=document.querySelector('#voice-dock').getBoundingClientRect();
 assert(caret.top>=viewport.top&&caret.bottom<=viewport.bottom&&caret.bottom<=dock.top,'Cursor in visible text, above the panel');
 await spoken.receive('modalità comando');await spoken.receive('seleziona la prima frase della nota');await frame();
 const first=editor.markdownView.coordsAtPos(editor.selectionEnd);assert(first.top>=viewport.top&&first.bottom<=viewport.bottom,'Return to visible first sentence');
 await spoken.receive('modifica frase');await spoken.receive('Un inizio nuovo.');await spoken.receive('conferma');assert(editor.value.startsWith('Un inizio nuovo.'),'Sentence edit confirmed');
 await spoken.receive('spostati al paragrafo successivo');await spoken.receive('seleziona l’ultima frase del paragrafo');await frame();await flush();
 qaResult.textContent=results.length+' PASS';qaResult.dataset.results=JSON.stringify(results);qaVoice.textContent='Repeat cursor test';
 }catch(e){qaResult.textContent='FAIL '+e.message;}
};
const qaLocal=document.createElement('button');qaLocal.textContent='Test local archive';qaLocal.id='qa-local';qaLocal.style='position:fixed;bottom:28px;left:5px;z-index:100;font-size:10px;padding:4px';document.body.append(qaLocal);
const localResult=document.createElement('output');localResult.id='qa-local-result';localResult.style='position:fixed;top:0;right:0;z-index:100;font:10px system-ui';document.body.append(localResult);
qaLocal.onclick=async()=>{
 const results=[];const assert=(ok,message)=>{if(!ok)throw Error(message);results.push(message);};
 try{
  await execute('new');const editor=document.querySelector('#editor'),title=document.querySelector('#note-title');title.value='Tutto resta qui.';title.dispatchEvent(new Event('input'));editor.value='Una nota locale.\n\nMarkdown, offline e senza account.';editor.dispatchEvent(new Event('input'));await flush();
  const stored=await db.get('notes',state.current);assert(stored.title===title.value&&stored.body===editor.value,'Note saved and read back from IndexedDB');
  if(db.files){const file=await(await db.files.getFileHandle(state.current+'.md')).getFile();assert(await file.text()==='# Tutto resta qui.\n\n'+editor.value,'Accurate local Markdown copy');}
  await db.revision(stored);assert((await db.get('history',stored.id)).items.at(-1).body===stored.body,'History available');
  await execute('settings');const panel=document.querySelector('#modal-content');assert(panel.textContent.includes('Filen')&&!/onedrive|google drive|proton|client id|oauth/i.test(panel.textContent),'Preferences: Filen and local backup only');assert(panel.textContent.includes('Esporta le note')&&panel.textContent.includes('Importa note'),'Import and export available');
  assert(document.querySelectorAll('[name="appearance"]').length===3,'Light, dark, and auto themes available');
  localResult.textContent=results.length+' LOCAL PASS';localResult.dataset.results=JSON.stringify(results);
 }catch(e){localResult.textContent='LOCAL FAIL '+e.message;}
};
