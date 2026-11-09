import {NoteFont,noteFonts} from './note-font.js';
import {mountLibrary} from './library-actions.js';
import {createToast} from './toast.js';
import {Publisher} from './publisher.js';
import {publishSettings} from './publish-ui.js';
import {pruneReminderMetadata,freshRestoredReminders} from './reminder-model.js';
import {Reminders} from './reminders.js';
import {TagIndex} from './tag-index.js';
import {t,getLocale,getLanguage,getLanguagePreference,configureLanguage,setLanguagePreference,validPreference,bindStaticTranslations,updateLanguageMetadata} from './i18n.js';
import {FilenSession} from './filen-session.js';
import {FilenSync,cleanItem,keyOf,signature} from './filen-sync.js';
import {createFilen,FilenProvider} from './filen-provider.js';
import {filenSettings} from './filen-ui.js';
import {DailyBackup} from './daily-backup.js';
import {restoreBackup} from './restore-backup.js';
import {SetupPrompts} from './setup-prompts.js';
import {NoteTree} from './note-tree.js';
import {Persistence} from './persistence.js';
import {createMarkdownEditor} from './markdown-editor.js';
import {newlineEdit,headingEdit,indentEdit} from './editor-actions.js';
import {uid,normalize,markdown,parseMarkdown,folderPath,safeName,paragraphRange,previousParagraphRange,replaceRange,renderMarkdown,voiceIntent} from './core.js';
import {Storage} from './storage.js';
import {noteProperties,normalizeTags,tagKey} from './note-properties.js';
import {mountNoteProperties} from './properties-ui.js';
import {mountFindReplace,replacementEdit} from './find-replace.js';
import {archive,download} from './archive.js';
import {LocalVoice} from './voice.js';
import {SpokenEditor,spokenMarkdown} from './spoken-editor.js';
import {icon,setupIcons} from './icons.js';
import {ThemeController} from './theme.js';
import {needsRecognitionRepeat} from './screenless.js';
const $=s=>document.querySelector(s);
const notificationToast=createToast($('#toast'));
const languageStorageKey=$('#app').dataset.testDatabase?'th-ink-language:'+$('#app').dataset.testDatabase:'th-ink-language';
configureLanguage(languageStorageKey);
const translateStatic=bindStaticTranslations(document.body);
translateStatic();updateLanguageMetadata();
const editor=$('#editor'),title=$('#note-title'),db=new Storage(),voice=new LocalVoice();
const state={tagIndex:new TagIndex(),notes:[],folders:[],current:null,filter:'all',sort:'updated',preview:false,mode:'keyboard',undo:new Map(),redo:new Map(),pending:null,request:0,paletteMode:'commands',paletteIndex:0,saveQueue:Promise.resolve(),dirty:new Set(),saving:0,readOnly:false,clipboard:'',searchResults:[]};
let searchWorker,saveTimer,editGroupTimer,editGroup=false,wakeLock=null,listTimer;
const channel='BroadcastChannel' in window?new BroadcastChannel('th-ink'):null;
voice.lang=getLocale();
setupIcons();
createMarkdownEditor(editor,$('#document-scroll'),{newline:()=>execute('newline').catch(report)});
const voiceCursor={setEnabled(){editor.ensureCaretVisible();},update(follow){if(follow)editor.ensureCaretVisible();}};
const themeStorageKey=$('#app').dataset.testDatabase?'th-ink-theme:'+$('#app').dataset.testDatabase:'th-ink-theme';
const appearance=new ThemeController({apply:(effective,preference)=>{document.documentElement.dataset.theme=effective;document.body.classList.toggle('dark',effective==='dark');document.querySelector('meta[name="theme-color"]').content=effective==='dark'?'#20211e':'#faf9f6';try{localStorage.setItem(themeStorageKey,preference);}catch{}document.querySelectorAll('[name="appearance"]').forEach(input=>input.checked=input.value===preference);},save:value=>db.put('settings',{id:'theme',value})});
const mobileLayout=matchMedia('(max-width:760px)');
const persistence=new Persistence();
const filenSession=new FilenSession(db);
let filenAuthEpoch=0;
const cloud=new FilenSync({db,local:syncItems,apply:applySyncItem,before:flush,enabled:()=>!state.readOnly&&!document.hidden&&navigator.onLine});
const dailyBackup=new DailyBackup({db,before:flush});
const publisher=new Publisher({db,before:flush,snapshot:()=>({notes:state.notes,folders:state.folders}),enabled:()=>!state.readOnly});
publisher.addEventListener('change',()=>document.querySelectorAll('[data-publish-status]').forEach(el=>el.textContent=t(publisher.message)));
function showPublish(){return publishSettings({modal,publisher,folders:state.folders,notes:state.notes,readOnly:state.readOnly});}
cloud.addEventListener('change',()=>document.querySelectorAll('[data-filen-status]').forEach(el=>el.textContent=t(cloud.message)));
dailyBackup.addEventListener('change',()=>{document.querySelectorAll('[data-backup-status]').forEach(el=>el.textContent=dailyBackup.config.lastRequested?t('Download richiesto: ')+dailyBackup.config.lastRequested:t('Uno ZIP al giorno durante l’uso dell’app.'));document.querySelectorAll('[data-backup-download]').forEach(el=>el.disabled=!dailyBackup.blob);});
function syncItems(){return [...state.folders.map(f=>cleanItem({...f,kind:'folder',parent:f.parent||null})),...state.notes.map(n=>cleanItem({...n,kind:'note',folder:n.folder||null}))];}
function currentSyncItem(item){const value=(item.kind==='note'?state.notes:state.folders).find(n=>n.id===item.id);return value?cleanItem({...value,kind:item.kind}):null;}
async function applySyncItem(item,expected){
 if(state.readOnly)return false;
 const operation=state.saveQueue.catch(()=>{}).then(async()=>{
  const current=currentSyncItem(item);if((current?signature(current):null)!==expected)return false;
  if(current&&signature(current)===signature(item))return true;
  const {kind,...value}=item;value.trashGroup=value.trashGroup||null;if(kind==='folder')value.deleted=!!value.deleted;
  if(kind==='folder'){
   const ancestors=new Set([value.id]);let parent=value.parent;while(parent){if(ancestors.has(parent))throw Error(t('La struttura delle cartelle cloud contiene un ciclo.'));ancestors.add(parent);parent=state.folders.find(f=>f.id===parent)?.parent;}
   await db.put('folders',value);const old=state.folders.find(f=>f.id===value.id);if(old)Object.assign(old,value);else state.folders.push(value);
  }else{
   Object.assign(value,noteProperties(value));
   const old=state.notes.find(n=>n.id===value.id);if(old)await db.revision(old);
   // Recheck after async history write: the user may have kept typing.
   const latest=currentSyncItem(item);if((latest?signature(latest):null)!==expected)return false;
   // Commit to editor state synchronously; any later typing queues a newer save.
   if(old)Object.assign(old,value);else state.notes.push(value);
   if(state.current===value.id){const stack=state.undo.get(value.id)||[];if(current){stack.push({title:current.title,body:current.body,...noteProperties(current),start:editor.selectionStart,end:editor.selectionEnd});state.undo.set(value.id,stack.slice(-100));state.redo.set(value.id,[]);}const start=editor.selectionStart,end=editor.selectionEnd;spoken.cancel();title.value=value.title;editor.value=value.body;editor.setSelectionRange(Math.min(start,value.body.length),Math.min(end,value.body.length));title.readOnly=editor.readOnly=!!value.deleted;count();resize();if(state.preview){$('#preview').innerHTML=renderMarkdown(value.body);reminders.decorate();}}
   $('#save-state').textContent=t('Salvataggio…');try{await db.saveNote(value);if(old)old.reminders=value.reminders||[];}catch(e){state.dirty.add(value.id);$('#save-state').textContent=t('Non salvato');throw e;}finally{updateSaveStatus();}index([value]);channel?.postMessage({type:'changed',id:value.id});
  }
  refresh();renderNoteProperties();if(note()){const path=folderPath(note().folder,state.folders).join(' / ');$('#breadcrumb').textContent=path||t('Appunti');$('#folder-label').textContent=note().deleted?t('NEL CESTINO'):path||t('Senza cartella');$('#pin-note').textContent=note().pinned?'✦':'☆';$('#pin-note').setAttribute('aria-pressed',String(!!note().pinned));}dailyBackup.invalidate();return true;
 });state.saveQueue=operation;return operation;
}
function showFilen(){if(state.readOnly)return toast(t('Collega Filen dalla finestra principale.'));return filenSettings({modal,sync:cloud,session:filenSession,remembered:()=>filenSession.remembered,connect:async(credentials,remember)=>{
 ++filenAuthEpoch;const sdk=await createFilen();await sdk.login(credentials);
 if(remember)await filenSession.save(sdk.config);else await filenSession.clear();
 await cloud.attach(new FilenProvider(sdk));void cloud.sync().catch(()=>{});
},disconnect:async()=>{++filenAuthEpoch;await cloud.detach();await filenSession.clear();}});}
async function restoreFilen(){const epoch=filenAuthEpoch;try{const config=await filenSession.load();if(!config||epoch!==filenAuthEpoch)return;const sdk=await createFilen(config);if(epoch!==filenAuthEpoch)return;await cloud.attach(new FilenProvider(sdk));if(epoch===filenAuthEpoch)await cloud.sync();}catch{if(cloud.status==='disconnected')cloud.notify('error',t('Ricollega Filen dalle preferenze.'));}}
function backgroundWork(){if(state.readOnly||document.hidden)return;if(cloud.provider)void cloud.sync().catch(()=>{});if(dailyBackup.due)void dailyBackup.prepare().catch(()=>{});}


const installedDisplay=matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)');
const setupPrompts=new SetupPrompts({installed:installedDisplay.matches||navigator.standalone===true});
let setupReady=false;
function renderSetup(){
 const box=$('#setup-toast'),kind=setupReady?setupPrompts.next:null,previous=box.dataset.kind;
 const hadFocus=box.contains(document.activeElement);
 box.hidden=!kind;box.dataset.kind=kind||'';
 if(kind){
  $('#setup-message').textContent=t('th.ink sulla tua Home.\nAnche offline.');
  $('#setup-action').textContent=setupPrompts.busy?t('Attendi…'):t('Installa');
  $('#setup-action').disabled=setupPrompts.busy;$('#setup-dismiss').disabled=setupPrompts.busy;
 }
 if(hadFocus&&previous!==kind)(kind?$('#setup-action'):state.mode==='voice'?$('[data-mode=voice]'):editor).focus({preventScroll:true});
 if(previous!==kind)resize();
}
setupPrompts.addEventListener('change',renderSetup);
installedDisplay.addEventListener('change',()=>setupPrompts.setInstalled(installedDisplay.matches||navigator.standalone===true));
function installInstructions(){const el=modal(t('Installa th.ink'));el.append(text('p',t('Nel menu del browser scegli “Installa app” o “Aggiungi alla schermata Home”. Su iPhone e iPad trovi “Aggiungi alla schermata Home” nel menu Condividi.')),text('p',t('Se il browser integrato non offre questa voce, apri lo stesso indirizzo nel browser del dispositivo. Le note restano nel browser in cui le hai scritte: esportale prima di cambiare browser.')),button(t('Ho capito'),closeModal,'primary'));}
async function installApp(){if(setupPrompts.busy)return;setupPrompts.busy=true;renderSetup();try{const result=await setupPrompts.install();if(result==='manual'){setupPrompts.dismiss('install');installInstructions();}}catch{setupPrompts.dismiss('install');installInstructions();}finally{setupPrompts.busy=false;renderSetup();}}
$('#setup-action').onclick=()=>installApp().catch(report);
$('#setup-dismiss').onclick=()=>setupPrompts.dismiss('install');
function updateSaveStatus(){if(state.dirty.size||state.saving)return;$('#save-state').textContent=state.readOnly?t('Sola lettura'):t('Salvato');}
const tree=new NoteTree($('#note-tree'),{open:id=>openNote(id).catch(report),choose:id=>{if(!['pinned','trash','tags','reminders'].includes(state.filter))state.filter=id;renderList();},save:value=>{if(!state.readOnly)db.put('settings',{id:'collapsed-folders',value}).catch(report);}});
const reminders=new Reminders({db,note,purge:purgeRemoteReminders,notes:()=>state.notes,readOnly:()=>state.readOnly,modal,close:closeModal,report,flush,open:openNote,render:renderList,selection:()=>[editor.selectionStart,editor.selectionEnd],select:(from,to)=>{setPreview(false);editor.setSelectionRange(from,to);focusEditor();},commit:(n,properties,change)=>{checkpoint();n.reminders=properties;if(change){setPreview(false);editor.replaceMarkdown(change.text,change.from,change.to);}changed();renderList();}});
async function purgeRemoteReminders(ids){
 const byNote=new Map();for(const id of ids){const [noteId,reminderId]=id.split(':');if(!byNote.has(noteId))byNote.set(noteId,new Set());byNote.get(noteId).add(reminderId);}
 for(const n of state.notes){const deleted=byNote.get(n.id);if(!deleted||!n.reminders?.some(r=>deleted.has(r.id)))continue;
  const ranges=[...n.body.matchAll(/\[[^\]\n]+\]\(reminder:([a-zA-Z0-9_-]{1,64})\)/g)].filter(m=>deleted.has(m[1])).map(m=>[m.index,m.index+m[0].length]);
  const preserve=n.id===state.current&&(state.preview||!editor.contains(document.activeElement)),scroll=$('#document-scroll').scrollTop;let selection=[editor.selectionStart,editor.selectionEnd];
  for(const [from,to] of ranges.reverse()){
   const mapPosition=p=>p<=from?p:p>=to?p-(to-from):from;selection=selection.map(mapPosition);
   if(n.id===state.current&&!preserve){const map=p=>p<=from?p:p>=to?p-(to-from):from;editor.replaceMarkdown('',from,to,[map(editor.selectionStart),map(editor.selectionEnd)]);}
   n.body=n.body.slice(0,from)+n.body.slice(to);
  }
  n.reminders=n.reminders.filter(r=>!deleted.has(r.id));n.updated=Math.max(Date.now(),n.updated+1);scheduleSave(n);
  if(n.id===state.current){if(preserve){editor.value=n.body;editor.setSelectionRange(...selection);}count();if(state.preview){$('#preview').innerHTML=renderMarkdown(n.body);reminders.decorate();}if(preserve)$('#document-scroll').scrollTop=scroll;}
 }
 await flush();
}
function syncNavigation(){
 const app=$('#app'),open=app.classList.contains('library-open'),focused=app.classList.contains('focus');
 $('#workspace').inert=mobileLayout.matches&&open;$('#sidebar').inert=mobileLayout.matches&&!open||focused;
 $('#library-toggle').setAttribute('aria-expanded',String(open));
 document.querySelectorAll('[data-action="focus"]').forEach(b=>{
  b.setAttribute('aria-pressed',String(focused));b.setAttribute('aria-label',t(focused?'Esci dalla concentrazione':'Modalità concentrazione'));
  b.title=t(focused?'Esci dalla concentrazione':'Modalità concentrazione')+' · Ctrl Shift F';
  b.replaceChildren(icon(focused?'unfocus':'focus'));b.disabled=!note();
 });
}
let focusView=null;
function setFocus(enabled){
 const app=$('#app');if(enabled===app.classList.contains('focus')||enabled&&!note())return;
 if(enabled){focusView={preview:state.preview,noteId:state.current};app.classList.remove('library-open');}
 app.classList.toggle('focus',enabled);
 if(enabled)setPreview(false);
 else if(focusView?.noteId===state.current&&state.mode!=='voice')setPreview(focusView.preview);
 syncNavigation();syncFocusVoice();resize();editor.ensureCaretVisible();
 if(!document.activeElement?.getClientRects().length)$('[data-action="focus"]').focus({preventScroll:true});
}

function setLibrary(open,{restore=true}={}){$('#app').classList.toggle('library-open',open);syncNavigation();if(restore)(open?$('#note-tree [tabindex="0"]')||$('#close-library'):$('#library-toggle'))?.focus();}
function updateViewport(){const viewport=window.visualViewport;const height=viewport?viewport.height:window.innerHeight;document.documentElement.style.setProperty('--app-height',`${Math.round(height)}px`);const typing=editor.contains(document.activeElement)||[title,$('#palette-input')].includes(document.activeElement)||document.activeElement?.matches('#modal input:not([type=radio])');document.body.classList.toggle('keyboard-open',mobileLayout.matches&&!!typing&&window.innerHeight-height>120);}
mobileLayout.addEventListener('change',()=>{$('#app').classList.remove('library-open');syncNavigation();resize();});window.visualViewport?.addEventListener('resize',updateViewport);window.addEventListener('resize',updateViewport);document.addEventListener('focusin',updateViewport);document.addEventListener('focusout',()=>requestAnimationFrame(updateViewport));updateViewport();
function focusEditor(){if(state.mode!=='voice')editor.focus({preventScroll:true});editor.ensureCaretVisible();}
function note(){return state.notes.find(n=>n.id===state.current);}
function text(tag,content,className){const el=document.createElement(tag);el.textContent=content;if(className)el.className=className;return el;}
function toast(message,duration){if(state.mode==='voice'&&!document.querySelector('dialog[open]')){$('#voice-status').textContent=message;notificationToast.hide();return;}notificationToast.show(message,duration);}
function report(error){console.error(error);toast(t(error.message||String(error)),8000);}
function snapshot(){const n=note();return n?{title:n.title,body:n.body,...noteProperties(n),start:editor.selectionStart,end:editor.selectionEnd}:null;}
function checkpoint(){if(!note())return;const stack=state.undo.get(state.current)||[];stack.push(snapshot());if(stack.length>100)stack.shift();state.undo.set(state.current,stack);state.redo.set(state.current,[]);}
function undo(redo=false){const from=redo?state.redo:state.undo,to=redo?state.undo:state.redo,stack=from.get(state.current)||[];if(!stack.length)return toast(t('Nessuna modifica da ')+(redo?t('ripetere'):t('annullare')));const saved=freshRestoredReminders(stack.pop(),note()),other=to.get(state.current)||[];other.push(snapshot());to.set(state.current,other);Object.assign(note(),{title:saved.title,body:saved.body,...noteProperties(saved)});title.value=saved.title;editor.value=saved.body;editor.setSelectionRange(saved.start,saved.end);changed();focusEditor();}
let titleMeasure='';
function resize(){if(title.clientWidth){const key=[title.value,title.clientWidth,getComputedStyle(title).font].join('\0');if(key!==titleMeasure){titleMeasure=key;title.style.height='auto';title.style.height=title.scrollHeight+'px';}}editor.refreshEditor();voiceCursor.update(state.mode==='voice');}
function count(){const n=note();const words=n?.body.trim().match(/\S+/g)?.length||0;$('#word-count').textContent=`${words} ${words===1?t('parola'):t('parole')}`;}
function index(notes){for(const n of notes){if(pruneReminderMetadata(n).length&&!state.readOnly){n.updated=Math.max(Date.now(),n.updated+1);state.dirty.add(n.id);clearTimeout(saveTimer);saveTimer=setTimeout(()=>flush().catch(report),180);}state.tagIndex.upsert(n);reminders.upsert(n);}searchWorker?.postMessage({type:'update',notes});}
function scheduleSave(n){pruneReminderMetadata(n);state.tagIndex.upsert(n);reminders.upsert(n);state.dirty.add(n.id);$('#save-state').textContent=t('Salvataggio…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>flush().catch(report),180);}
async function flush(){
 clearTimeout(saveTimer);
 const values=[...state.dirty].map(id=>state.notes.find(n=>n.id===id)).filter(Boolean).map(n=>structuredClone(n));state.dirty.clear();state.saving+=values.length;
 const next=state.saveQueue.catch(()=>{}).then(async()=>{
  for(const n of values){try{await db.saveNote(n);index([n]);channel?.postMessage({type:'changed',id:n.id});}catch(e){for(const pending of values)state.dirty.add(pending.id);$('#save-state').textContent=t('Non salvato');throw Error(t('Salvataggio non riuscito. Esporta la nota prima di chiudere. ')+e.message);}}
  if(!state.dirty.size)$('#save-state').textContent=state.readOnly?t('Sola lettura'):t('Salvato');
 });
 state.saveQueue=next;try{await next;if(values.length){await reminders.persist();cloud.schedule();dailyBackup.invalidate();}}finally{state.saving-=values.length;updateSaveStatus();}
}
function changed(){const n=note();if(!n||state.readOnly)return;n.title=title.value;n.body=editor.value;n.updated=Date.now();scheduleSave(n);count();renderNoteProperties();resize();if(state.preview){$('#preview').innerHTML=renderMarkdown(n.body);reminders.decorate();}clearTimeout(listTimer);listTimer=setTimeout(renderList,250);}
function setPreview(value){value=value&&!$('#app').classList.contains('focus');state.preview=value;$('.format-bar').hidden=value||!note();$('#editor-surface').hidden=value||!note();editor.hidden=value||!note();$('#preview').hidden=!value||!note();$('#write-tab').classList.toggle('selected',!value);$('#preview-tab').classList.toggle('selected',value);$('#write-tab').setAttribute('aria-pressed',!value);$('#preview-tab').setAttribute('aria-pressed',value);if(value&&note())$('#preview').innerHTML=renderMarkdown(note().body);if(!value)resize();reminders.decorate();}
function date(at,long=false){return new Intl.DateTimeFormat(getLocale(),long?{day:'numeric',month:'long',year:'numeric'}:{day:'numeric',month:'short'}).format(at);}
function renderSort(){const button=$('#sort');button.replaceChildren(icon(state.sort==='title'?'sortAlpha':'sortTime'));button.dataset.sort=state.sort;button.title=state.sort==='title'?t('Ordina per ultima modifica'):t('Ordina per titolo');button.setAttribute('aria-label',button.title);}
function renderList(){
 renderSort();
 const reminderView=state.filter==='reminders';$('#note-tree').hidden=reminderView;$('#reminder-list').hidden=!reminderView;if(reminderView)reminders.render($('#reminder-list'));else tree.render(state);
 $('#reminder-count').textContent=[...reminders.index.rows.values()].filter(r=>!r.done).length;$('#sort').hidden=reminderView;
 document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.filter||b.dataset.filter==='all'&&!['pinned','trash','tags','reminders'].includes(state.filter)));
 $('#tag-count').textContent=state.tagIndex.groups.size;
 $('#add-folder').hidden=['tags','reminders'].includes(state.filter);
 $('#all-count').textContent=state.tagIndex.active;$('#pin-count').textContent=state.tagIndex.pinned;
 $('#tree-heading').textContent=state.filter==='trash'?t('CESTINO'):state.filter==='pinned'?t('PREFERITE'):state.filter==='tags'?t('Tags'):state.filter==='reminders'?'Reminders':t('ARCHIVIO');
 const folder=state.folders.find(f=>f.id===state.filter);$('.new-note').title=folder?t('Nuova nota in ')+folder.name:t('Nuova nota senza cartella');
}
function refresh(){renderList();}
async function openNote(id){
 await flush();if(note())await db.revision(note());
 const previousId=state.current;state.current=id;state.pending=null;editGroup=false;const n=note();if(!n)setFocus(false);
 if(n){if(n.deleted)state.filter='trash';else if(state.filter==='trash'||state.filter==='pinned'&&!n.pinned)state.filter=n.folder||'all';else if(!['pinned','tags','reminders'].includes(state.filter))state.filter=n.folder||'all';tree.reveal(n.folder,state.folders);}
 for(const selector of ['.document-meta','.note-title','.document-tabs','.format-bar'])$(selector).hidden=!n;
 $('#empty-state').hidden=!!n;title.value=n?.title||'';editor.value=n?.body||'';title.readOnly=state.readOnly||!!n?.deleted;editor.readOnly=state.readOnly||!!n?.deleted;
 $('#note-date').textContent=n?date(n.created,true).toUpperCase():'';$('#pin-note').textContent=n?.pinned?'✦':'☆';$('#pin-note').setAttribute('aria-pressed',String(!!n?.pinned));$('#pin-note').setAttribute('aria-label',n?.pinned?t('Rimuovi dai preferiti'):t('Aggiungi ai preferiti'));
 const path=n?folderPath(n.folder,state.folders).join(' / '):'';$('#breadcrumb').textContent=path||t('Appunti');$('#folder-label').textContent=n?.deleted?t('NEL CESTINO'):path||t('Senza cartella');$('#file-label').textContent=n?.deleted?t('sola lettura'):'.md';
 editor.setSelectionRange(0,0);setPreview(state.preview);count();renderNoteProperties();renderList();setLibrary(false,{restore:false});resize();$('#document-scroll').scrollTop=0;if(previousId!==id){$('#document').classList.remove('note-reveal');requestAnimationFrame(()=>$('#document').classList.add('note-reveal'));}
 if(n)await db.put('settings',{id:'last-note',value:id});
}
async function createNote(parent){
 if(state.readOnly)return toast(t('Archivio aperto in un’altra finestra. Chiudila e ricarica per modificare.'));
 if(parent&&!state.folders.some(f=>f.id===parent&&!f.deleted))throw Error(t('Scegli una cartella disponibile.'));
 await flush();const n={id:uid(),title:'',body:'',folder:parent===undefined?(state.folders.some(f=>f.id===state.filter&&!f.deleted)?state.filter:null):parent,created:Date.now(),updated:Date.now(),pinned:false,deleted:false};state.notes.push(n);scheduleSave(n);if(['trash','pinned','tags','reminders'].includes(state.filter))state.filter='all';refresh();await openNote(n.id);if(state.mode!=='voice')($('#app').classList.contains('focus')?editor:title).focus();
}
function edit(replacement,start=editor.selectionStart,end=editor.selectionEnd,selection){if(!note()||note().deleted||state.readOnly)return;setPreview(false);checkpoint();editor.replaceMarkdown(replacement,start,end,selection);changed();focusEditor();}
function wrap(left,right=left){const start=editor.selectionStart,end=editor.selectionEnd;const selected=editor.value.slice(start,end);edit(left+selected+right,start,end,[start+left.length,start+left.length+selected.length]);}
function prefix(value){const start=editor.value.lastIndexOf('\n',editor.selectionStart-1)+1;const end=editor.selectionEnd;const selected=editor.value.slice(start,end);edit(selected.split('\n').map(line=>value+line).join('\n'),start,end);}
function selectParagraph(previous=false){const range=(previous?previousParagraphRange:paragraphRange)(editor.value,editor.selectionStart);setPreview(false);focusEditor();editor.setSelectionRange(...range);return range;}
function renderNoteProperties(){
 const n=note(),button=$('#note-properties'),tags=$('#note-tags');if(!button)return;
 button.replaceChildren(n?.emoji?text('span',n.emoji,'note-emoji'):icon('notes'));button.disabled=!n||state.readOnly||!!n.deleted;button.title=t('Emoji e tag');button.setAttribute('aria-label',t('Proprietà della nota'));
 tags.replaceChildren();for(const tag of normalizeTags(n?.tags)){const chip=text('button',tag,'note-tag');chip.title=t('Mostra le note con questo tag');chip.onclick=()=>{state.filter='tags';tree.collapsed.delete('tag:'+encodeURIComponent(tagKey(tag)));renderList();setLibrary(true);tree.tags.reveal('tag:'+encodeURIComponent(tagKey(tag)));};tags.append(chip);}
 tags.hidden=!tags.childElementCount;
}
function editNoteProperties(){
 const n=note();if(!n||n.deleted||state.readOnly)return;
 const root=modal(t('Emoji e tag'));
 mountNoteProperties(root,n,state.tagIndex.suggestions(getLocale()),{save:async properties=>{
  if(JSON.stringify(noteProperties(n))===JSON.stringify(properties)){closeModal();return;}
  if(state.readOnly||n.deleted)throw Error('Nota non modificabile.');
  await db.revision(n);if(state.readOnly||n.deleted)throw Error('Nota non modificabile.');
  const stack=state.undo.get(n.id)||[];stack.push({title:n.title,body:n.body,...noteProperties(n),start:editor.selectionStart,end:editor.selectionEnd});state.undo.set(n.id,stack.slice(-100));state.redo.set(n.id,[]);
  Object.assign(n,properties);n.updated=Date.now();scheduleSave(n);await flush();renderNoteProperties();renderList();closeModal();
 },cancel:closeModal});
}
function modal(heading){const el=$('#modal-content');el.classList.remove('filen-panel');const headingNode=text('h2',heading);headingNode.id='modal-title';el.replaceChildren(headingNode);if(!$('#modal').open)$('#modal').showModal();return el;}
function closeModal(){$('#modal').close();}
function button(label,fn,cls=''){const b=text('button',label,cls);b.onclick=()=>Promise.resolve(fn()).catch(report);return b;}
function form(heading,fields,submit){
 const el=modal(heading),f=document.createElement('form');
 for(const field of fields){const label=text('label',field.label);label.htmlFor='field-'+field.name;const input=document.createElement(field.options?'select':'input');input.id=label.htmlFor;input.name=field.name;if(field.options)for(const [value,name] of field.options){const o=text('option',name);o.value=value;input.append(o);}input.value=field.value||'';input.required=!!field.required;f.append(label,input);}
 const actions=text('div','','buttons');const save=button(t('Conferma'),()=>{} ,'primary');save.type='submit';actions.append(save);const cancel=button(t('Annulla'),closeModal);cancel.type='button';actions.append(cancel);f.append(actions);f.onsubmit=async e=>{e.preventDefault();try{await submit(Object.fromEntries(new FormData(f)));closeModal();}catch(e){report(e);}};el.append(f);setTimeout(()=>f.querySelector('input,select')?.focus(),0);
}
const folderOptions=()=>[['',t('Senza cartella')],...state.folders.filter(f=>!f.deleted).map(f=>[f.id,folderPath(f.id,state.folders).join(' / ')])];
async function addFolder(name,parent=null){if(state.readOnly)throw Error(t('Archivio aperto in un’altra finestra.'));name=name.trim();if(!name)throw Error(t('Scegli un nome per la cartella.'));if(parent&&!state.folders.some(f=>f.id===parent&&!f.deleted))throw Error(t('Scegli una cartella disponibile.'));if(state.folders.some(f=>!f.deleted&&f.parent===parent&&normalize(f.name)===normalize(name)))throw Error(t('Esiste già una cartella con questo nome.'));const f={id:uid(),name,parent};await db.put('folders',f);state.folders.push(f);refresh();cloud.schedule();dailyBackup.invalidate();return f;}
function folderForm(){form(t('Un posto per le idee.'),[{name:'name',label:t('Nome della cartella'),required:true},{name:'parent',label:t('Dentro la cartella'),options:folderOptions(),value:state.folders.some(f=>f.id===state.filter&&!f.deleted)?state.filter:''}],async values=>{const f=await addFolder(values.name,values.parent||null);state.filter=f.id;tree.reveal(f.id,state.folders);refresh();});}
async function mutate(fn){const n=note();if(!n)return;fn(n);n.updated=Date.now();scheduleSave(n);await flush();refresh();}
const commandList=[
 ['copy','Copia selezione','Ctrl C'],['cut','Taglia selezione',''],['paste','Incolla','Ctrl V'],['indent','Aumenta rientro','Tab'],['outdent','Riduci rientro','Shift Tab'],['table','Inserisci tabella',''],['clearFormat','Rimuovi formattazione',''],['duplicateParagraph','Duplica paragrafo',''],['moveUp','Sposta paragrafo sopra',''],['moveDown','Sposta paragrafo sotto',''],['new','Nuova nota','Ctrl Alt N'],['search','Cerca nelle note','Ctrl K'],['folder','Nuova cartella',''],['bold','Grassetto','Ctrl B'],['italic','Corsivo','Ctrl I'],['strike','Barrato',''],['heading','Titolo Markdown',''],['bullet','Elenco puntato',''],['numbered','Elenco numerato',''],['task','Lista di attività',''],['toggleTask','Spunta attività',''],['quote','Citazione',''],['code','Codice inline',''],['codeBlock','Blocco codice',''],['link','Collegamento',''],['reminder','Inserisci reminder',''],['date','Inserisci data',''],['undo','Annulla modifica','Ctrl Z'],['redo','Ripeti modifica','Ctrl Shift Z'],['selectAll','Seleziona tutto',''],['selectParagraph','Seleziona paragrafo',''],['previous','Paragrafo precedente',''],['next','Paragrafo successivo',''],['start','Vai a inizio nota',''],['end','Vai a fine nota',''],['read','Leggi la nota ad alta voce',''],['readParagraph','Leggi il paragrafo',''],['readSelection','Leggi la selezione',''],['stopReading','Ferma lettura',''],['where','Leggi la posizione',''],['properties','Emoji e tag',''],['rename','Rinomina nota',''],['move','Sposta nota',''],['pin','Aggiungi / rimuovi preferita',''],['duplicate','Duplica nota',''],['replace','Trova e sostituisci','Ctrl S'],['replaceAllNotes','Trova e sostituisci in tutte le note','Alt S'],['deletePrevious','Cancella paragrafo precedente',''],['deleteParagraph','Cancella paragrafo',''],['deleteSelection','Cancella selezione',''],['export','Esporta nota Markdown',''],['archive','Esporta archivio ZIP',''],['import','Importa file Markdown',''],['importFolder','Importa cartella Markdown',''],['history','Cronologia della nota',''],['trash','Sposta nel cestino / ripristina',''],['focus','Modalità concentrazione','Ctrl Shift F'],['preview','Scrivi / leggi','Ctrl Shift P'],['save','Salva',''],['help','Guida ai comandi vocali',''],['settings','Preferenze','']
];
async function execute(id,args={},source='keyboard'){
 const n=note();
 if(state.readOnly&&!['search','settings','help','archive','export','focus','preview','palette','more','read','readParagraph','readSelection','readPrevious','stopReading','where','start','end','previous','next','selectAll','selectParagraph','open','commands','dictation','stop','cancel'].includes(id))return feedback(t('Archivio aperto in un’altra finestra. Chiudila e ricarica per modificare.'));
 if(n?.deleted&&!['trash','new','search','folder','settings','help','archive','import','importFolder','export','history','focus','preview','save','palette','more','read','readParagraph','readPrevious','readSelection','stopReading','commands','dictation','stop','confirm','cancel'].includes(id))return toast(t('Ripristina prima la nota dal cestino.'));
 if(source==='voice'&&['deletePrevious','deleteParagraph','deleteSelection','trash','replace'].includes(id)){
  if(!n)return;state.pending={id,args,noteId:n.id,body:n.body,selection:[editor.selectionStart,editor.selectionEnd]};return feedback(t('Confermi la modifica? Di’ conferma oppure annulla comando.'));
 }
 switch(id){
 case 'properties':return editNoteProperties();
 case 'new':return createNote();case 'folder':return args.value?addFolder(args.value,state.folders.some(f=>f.id===state.filter&&!f.deleted)?state.filter:null):folderForm();
 case 'copy':case 'cut':{state.clipboard=editor.value.slice(editor.selectionStart,editor.selectionEnd);if(!state.clipboard)return feedback(t('Nessun testo selezionato.'));try{await navigator.clipboard.writeText(state.clipboard);}catch{/* Session clipboard remains available offline and without permission. */}if(id==='cut')edit('');return feedback(t('Testo copiato.'));}
 case 'paste':{let value=state.clipboard;if(source!=='voice')try{value=await navigator.clipboard.readText();}catch{}if(!value)return feedback(t('Gli appunti sono vuoti.'));return edit(value);}
 case 'selectText':{const start=normalize(editor.value).indexOf(normalize(args.value));if(start<0)return feedback(t('Testo non trovato.'));const exact=editor.value.toLocaleLowerCase().indexOf(args.value.toLocaleLowerCase());if(exact<0)return feedback(t('Ripeti il testo con gli stessi accenti della nota.'));setPreview(false);focusEditor();editor.setSelectionRange(exact,exact+args.value.length);return feedback(t('Testo selezionato.'));}
 case 'openResult':{$('#palette').close();const found=state.searchResults[Number(args.value)-1];if(!found)return feedback(t('Risultato non disponibile.'));await openNote(found);return feedback(t('Aperta ')+note().title);}
 case 'indent':case 'outdent':{const change=indentEdit(editor.value,editor.selectionStart,editor.selectionEnd,id==='outdent');return edit(change.text,change.start,change.end,change.selection);}
 case 'table':return edit(t('\n| Colonna 1 | Colonna 2 |\n| --- | --- |\n| Testo | Testo |\n'));
 case 'clearFormat':{const selection=editor.value.slice(editor.selectionStart,editor.selectionEnd);return edit(selection.replace(/^(?:#{1,6} |>-? |[-*] (?:\[[ xX]\] )?)/gm,'').replace(/(\*\*|~~|`|\*)/g,''));}
 case 'duplicateParagraph':{const [start,end]=paragraphRange(editor.value,editor.selectionStart);return edit('\n\n'+editor.value.slice(start,end),end,end);}
 case 'moveUp':case 'moveDown':{const [start,end]=paragraphRange(editor.value,editor.selectionStart);if(id==='moveUp'){if(!start)return;const [ps,pe]=previousParagraphRange(editor.value,start);return edit(editor.value.slice(start,end)+'\n\n'+editor.value.slice(ps,pe),ps,end);}if(end===editor.value.length)return;const [ns,ne]=paragraphRange(editor.value,end+2);return edit(editor.value.slice(ns,ne)+'\n\n'+editor.value.slice(start,end),start,ne);}
 case 'undo':return undo();case 'redo':return undo(true);
 case 'bold':return wrap('**');case 'italic':return wrap('*');case 'strike':return wrap('~~');case 'code':return wrap('`');case 'codeBlock':return wrap('\n```\n','\n```\n');
 case 'heading':{const change=headingEdit(editor.value,editor.selectionStart,editor.selectionEnd,Number(args.level)||2);return edit(change.text,change.start,change.end,change.selection);}case 'bullet':return prefix('- ');case 'numbered':return prefix('1. ');case 'task':return prefix('- [ ] ');case 'quote':return prefix('> ');
 case 'toggleTask':{const start=editor.value.lastIndexOf('\n',editor.selectionStart-1)+1;const end=editor.value.indexOf('\n',start);const line=editor.value.slice(start,end<0?editor.value.length:end);if(!/^[ \t]*[-+*] \[[ xX]\]/.test(line))return toast(t('Posiziona il cursore su una casella.'));return edit(line.replace(/^([ \t]*[-+*] )\[([ xX])\]/,(_,prefix,v)=>prefix+(v===' '?'[x]':'[ ]')),start,end<0?editor.value.length:end);}
 case 'link':{const start=editor.selectionStart,end=editor.selectionEnd;return form(t('Un collegamento.'),[{name:'label',label:t('Testo'),value:editor.value.slice(start,end)||t('Collegamento')},{name:'url',label:t('Indirizzo https://'),required:true}],v=>{if(!/^https?:\/\//i.test(v.url))throw Error(t('Inserisci un indirizzo HTTP o HTTPS.'));edit(`[${v.label}](${v.url})`,start,end);});}
 case 'date':return edit(date(Date.now(),true));case 'newline':{const change=newlineEdit(editor.value,editor.selectionStart,editor.selectionEnd);return edit(change.text,change.start,change.end,change.selection);}case 'paragraph':return edit('\n\n');case 'insert':return edit(args.value||'');
 case 'selectAll':setPreview(false);if(state.mode==='voice')return editor.setSelectionRange(0,editor.value.length);focusEditor();return editor.select();case 'selectParagraph':return selectParagraph();
 case 'previous':{const [start]=previousParagraphRange(editor.value,editor.selectionStart);focusEditor();return editor.setSelectionRange(start,start);}
 case 'next':{const [,end]=paragraphRange(editor.value,editor.selectionEnd);const p=Math.min(editor.value.length,end+2);focusEditor();return editor.setSelectionRange(p,p);}
 case 'start':focusEditor();return editor.setSelectionRange(0,0);case 'end':focusEditor();return editor.setSelectionRange(editor.value.length,editor.value.length);
 case 'deletePrevious':case 'deleteParagraph':{const [start,end]=(id==='deletePrevious'?previousParagraphRange:paragraphRange)(editor.value,editor.selectionStart);if(start===end)return toast(t('Nessun paragrafo da cancellare.'));return edit('',start,Math.min(editor.value.length,end+2));}
 case 'deleteSelection':return edit('');
 case 'read':return voice.speak(n?`${n.title}. ${n.body}`:t('Nessuna nota aperta.'));
 case 'readSelection':return voice.speak(editor.value.slice(editor.selectionStart,editor.selectionEnd)||t('Nessun testo selezionato.'));
 case 'readPrevious':case 'readParagraph':{const [start,end]=(id==='readPrevious'?previousParagraphRange:paragraphRange)(editor.value,editor.selectionStart);return voice.speak(editor.value.slice(start,end)||t('Paragrafo vuoto.'));}
 case 'where':return voice.speak(t('Nota {title}. Paragrafo {paragraph}. {words}. Modalità {mode}.',{title:n?.title||t('senza titolo'),paragraph:editor.value.slice(0,editor.selectionStart).split(/\n\n/).length,words:$('#word-count').textContent,mode:voice.mode==='commands'?t('comandi'):t('dettatura')}));
 case 'stopReading':return voice.stopReading();
 case 'rename':if(!n)return;if(args.value){checkpoint();title.value=args.value;return changed();}return form(t('Dai un nome al pensiero.'),[{name:'title',label:t('Titolo'),value:n.title,required:true}],v=>{checkpoint();title.value=v.title;changed();});
 case 'move':if(!n)return;if(args.value){const matches=state.folders.filter(f=>!f.deleted&&(normalize(f.name)===normalize(args.value)||normalize(folderPath(f.id,state.folders).join(' / '))===normalize(args.value)));if(matches.length!==1)return feedback(t('Cartella non trovata o nome ambiguo. Usa il percorso completo.'));return library.perform({kind:'note',id:n.id},'move',matches[0].id);}return library.moveDialog({kind:'note',id:n.id});
 case 'pin':await mutate(n=>n.pinned=!n.pinned);$('#pin-note').textContent=note()?.pinned?'✦':'☆';$('#pin-note').setAttribute('aria-pressed',String(!!note()?.pinned));$('#pin-note').setAttribute('aria-label',note()?.pinned?t('Rimuovi dai preferiti'):t('Aggiungi ai preferiti'));return;
 case 'duplicate':if(!n)return;{const copy=await library.duplicate({kind:'note',id:n.id});if(copy)return openNote(copy.id);return;}
 case 'replaceAllNotes':return openFindReplace('all');
 case 'replace':if(!n)return;if(args.from){if(!editor.value.includes(args.from))return feedback(t('Testo non trovato.'));checkpoint();editor.value=editor.value.split(args.from).join(args.to);return changed();}return openFindReplace('note');
 case 'trash':if(!n)return;return library.perform({kind:'note',id:n.id},n.deleted?'restore':'trash');
 case 'export':if(n)download(new Blob([markdown(n)],{type:'text/markdown;charset=utf-8'}),safeName(n.title)+'.md');return;
 case 'archive':await flush();download(archive(state.notes,state.folders),'th-ink-'+new Date().toISOString().slice(0,10)+'.zip');return;
 case 'import':$('#import-files').click();return;case 'importFolder':$('#import-directory').click();return;
 case 'reminder':return reminders.edit();case 'reminderAccount':return reminders.account();case 'history':return history();case 'focus':setFocus(!$('#app').classList.contains('focus'));return;case 'preview':return setPreview(!state.preview);
 case 'save':await flush();return toast(t('Nota salvata sul dispositivo.'));case 'search':state.voiceSearch=source==='voice';return openPalette('search',args.value||'');case 'palette':return openPalette('commands');case 'more':return openPalette('commands');case 'settings':return settings();case 'help':return help();
 case 'open':{const matches=state.notes.filter(n=>!n.deleted&&normalize(n.title)===normalize(args.value));if(matches.length!==1)return feedback(t('Nota non trovata o titolo ambiguo.'));await openNote(matches[0].id);return feedback(t('Aperta {title}.',{title:matches[0].title}));}
 case 'commands':voice.mode='commands';return feedback(t('Modalità comandi.'));
 case 'dictation':voice.mode='dictation';state.pending=null;return feedback(t('Modalità dettatura.'));
 case 'stop':return setMode('keyboard');
 case 'confirm':{const pending=state.pending;state.pending=null;if(!pending)return feedback(t('Nessuna modifica da confermare.'));if(pending.noteId!==n?.id||pending.body!==n?.body)return feedback(t('La nota è cambiata. Ripeti il comando.'));editor.setSelectionRange(...pending.selection);await execute(pending.id,pending.args,'confirmed');return feedback(t('Modifica applicata. Puoi dire annulla.'));}
 case 'cancel':state.pending=null;return feedback(t('Comando annullato.'));
 }
}
const findMemory={query:'',replacement:'',matchCase:false};
function openFindReplace(scope){
 if($('#palette').open)$('#palette').close();
 const root=modal(t(scope==='all'?'Trova e sostituisci in tutte le note':'Trova e sostituisci.'));
 mountFindReplace(root,{scope,notes:()=>state.notes,current:()=>state.current,memory:findMemory,readOnly:()=>state.readOnly,
  locate:async(target,match)=>{try{const latest=state.notes.find(n=>n.id===target.id);if(!latest||latest.deleted||latest.body!==target.body)throw Error('La nota è cambiata. Ripeti la ricerca.');closeModal();if(state.current!==target.id)await openNote(target.id);setPreview(false);editor.setSelectionRange(match.from,match.to);focusEditor();}catch(error){report(error);}},
  replace:async(targets,value)=>{
   if(state.readOnly)throw Error('Archivio in sola lettura.');
   await flush();
   const valid=()=>targets.every(target=>{const n=state.notes.find(n=>n.id===target.id);return n&&!n.deleted&&n.body===target.body;});
   if(!valid())throw Error('Le note sono cambiate. Ripeti la ricerca.');
   await Promise.all(targets.map(target=>db.revision(state.notes.find(n=>n.id===target.id))));
   if(state.readOnly||!valid())throw Error('Le note sono cambiate. Ripeti la ricerca.');
   for(const target of targets){
    const n=state.notes.find(n=>n.id===target.id),active=n.id===state.current,selection=active?[editor.selectionStart,editor.selectionEnd]:[0,0];
    const stack=state.undo.get(n.id)||[];stack.push({title:n.title,body:n.body,...noteProperties(n),start:selection[0],end:selection[1]});state.undo.set(n.id,stack.slice(-100));state.redo.set(n.id,[]);
    const change=replacementEdit(n.body,target.matches,value,selection);n.body=change.text;n.updated=Date.now();scheduleSave(n);
    if(active){editor.value=change.text;editor.setSelectionRange(...change.selection);if(state.preview){$('#preview').innerHTML=renderMarkdown(n.body);reminders.decorate();}count();resize();}
   }
   await flush();refresh();
  }
 });
}
function feedback(message){$('#transcript').textContent=message;toast(message);navigator.vibrate?.(20);if(voice.localVoices().length)return voice.speak(message).catch(report);}
function openPalette(mode='commands',query=''){
 if($('#modal').open)closeModal();
 state.paletteMode=mode;state.paletteIndex=0;$('#palette-label').textContent=mode==='search'?t('CERCA NEL TUO ARCHIVIO'):t('COMANDI');$('#palette-input').placeholder=mode==='search'?t('Cerca un pensiero…'):t('Cosa vuoi fare?');$('#palette-input').value=query;$('#palette-input').setAttribute('aria-expanded','true');$('#palette-results').setAttribute('aria-label',mode==='search'?t('Cerca nelle note'):t('Comandi'));if(!$('#palette').open)$('#palette').showModal();$('#palette-input').focus();updatePalette();
}
function paletteRows(rows){const el=$('#palette-results');el.replaceChildren();for(const row of rows){const b=button('',()=>{$('#palette').close();return row.fn();},'palette-result');b.id='palette-option-'+el.childElementCount;b.setAttribute('role','option');b.tabIndex=-1;b.append(text('span',row.label),text('small',row.detail||''));el.append(b);}if(!rows.length)el.append(text('p',t('Nessun risultato. Prova con altre parole.'),'empty-list'));state.paletteIndex=0;highlightPalette();}
function highlightPalette(){const all=[...$('#palette-results').querySelectorAll('button')];all.forEach((b,i)=>{b.classList.toggle('chosen',i===state.paletteIndex);b.setAttribute('aria-selected',String(i===state.paletteIndex));});if(all[state.paletteIndex])$('#palette-input').setAttribute('aria-activedescendant',all[state.paletteIndex].id);else $('#palette-input').removeAttribute('aria-activedescendant');all[state.paletteIndex]?.scrollIntoView({block:'nearest'});}
async function updatePalette(){const query=$('#palette-input').value;if(state.paletteMode==='commands'){state.request++;$('#search-time').textContent='';paletteRows(commandList.filter(c=>normalize(t(c[1])).includes(normalize(query))).map(c=>({label:t(c[1]),detail:c[2],fn:()=>execute(c[0])})));}else{await flush();searchWorker?.postMessage({type:'search',query,request:++state.request});}}
function help(){const el=modal(t('Mani libere. Mente libera.'));el.append(text('p',t('Pronuncia “modalità comando” oppure “command mode”. I comandi sono esatti, disponibili anche in inglese con “Hey think”. Di’ “dettatura” / “dictation” per tornare a scrivere. Vosk riconosce la voce sul dispositivo. Durante la lettura di’ pausa lettura o ferma lettura: tutti gli altri comandi sono bloccati fino alla fine dell’audio.')));
 el.append(text('p',t('Le frasi seguono la punteggiatura del testo. In dettatura puoi dire “punto”, “punto interrogativo” e “nuovo paragrafo”. “Prima” e “ultima frase” si riferiscono al paragrafo corrente, salvo “della nota”. Gli spostamenti arrivano all’inizio delle frasi o dei paragrafi; ai limiti della nota il cursore si ferma.')));
 const examples=[['seleziona l’ultima frase del paragrafo','select the last sentence in the paragraph'],['seleziona la prima frase della nota','select the first sentence in the note'],['spostati tre frasi in avanti','move three sentences forward'],['spostati al paragrafo successivo','move to the next paragraph'],['seleziona due frasi successive','select the next two sentences'],['estendi selezione tre parole avanti','extend selection three words forward'],['inizio frase / fine paragrafo','start of sentence / end of paragraph'],['vai alla frase due','go to sentence two'],['modifica frase / cancella frase','edit sentence / delete sentence'],['deseleziona','deselect'],['evidenzia ultima frase','highlight the last sentence'],['seleziona da qui alla fine del paragrafo','select from here to the end of the paragraph'],['cancella il paragrafo precedente','delete previous paragraph'],['leggi il paragrafo precedente','read previous paragraph'],['seleziona paragrafo','select paragraph'],['grassetto / corsivo / barrato','bold / italic / strikethrough'],['elenco / elenco numerato / casella','bullet list / numbered list / checklist'],['spunta casella / citazione / codice','toggle checkbox / quote / code'],['inizio nota / fine nota','start of note / end of note'],['paragrafo precedente / successivo','previous paragraph / next paragraph'],['sostituisci ciao con salve','replace hello with hi'],['rinomina nota Idee','rename note Ideas'],['apri nota Idee / cerca viaggio','open note Ideas / search for travel'],['sposta in Lavoro / crea cartella Idee','move to Work / create folder Ideas'],['leggi nota / leggi selezione','read note / read selection'],['nuova nota / duplica nota','new note / duplicate note'],['cestina nota / preferita','trash note / pin note'],['inserisci una frase / nuovo paragrafo','insert a sentence / new paragraph'],['annulla / ripeti / dove sono','undo / redo / where am i'],['elenca note / scegli uno','list notes / choose one'],['elenca cestino / ripristina nota','list trash / restore note'],['modifica selezione / modifica paragrafo','edit selection / edit paragraph'],['trova e sostituisci / collegamento','find and replace / link'],['elenca cartelle / sposta nota','list folders / move note'],['pausa lettura / continua lettura','pause reading / resume reading'],['leggi cronologia / ripristina versione uno','read history / restore version one'],['conferma / annulla comando','confirm / cancel'],['dettatura / ferma ascolto','dictation / stop listening']];for(const [it,en] of examples){const row=text('div','','help-row');row.append(text('span',getLanguage()==='it'?it:en));el.append(row);}el.append(text('p',t('Ctrl/⌘ K: ricerca · Ctrl/⌘ X: comandi · Ctrl/⌘ S: trova/sostituisci nella nota · Alt S: trova/sostituisci in tutte le note · Ctrl/⌘ B/I: formato · Ctrl/⌘ Z: annulla · Ctrl/⌘ Shift Z: ripeti · Ctrl/⌘ Alt N: nuova nota. Le conferme vocali proteggono cancellazioni e sostituzioni. Schermo spento e ascolto in background non sono garantiti dal browser.')));
}
async function history(){const n=note();if(!n)return;await flush();await db.revision(n);const record=await db.get('history',n.id);const el=modal(t('Le versioni del pensiero.'));el.append(text('p',t('Fino a 30 versioni locali per nota. Il ripristino conserva prima la versione attuale.')));for(const item of (record?.items||[]).slice().reverse()){const row=text('div','','setting-row');row.append(text('span',date(item.at,true)+' · '+new Date(item.at).toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit'})),button(t('Ripristina'),async()=>{checkpoint();await db.revision(n);const restored=freshRestoredReminders(item,n);title.value=restored.title;editor.value=restored.body;Object.assign(n,noteProperties(restored));changed();closeModal();toast(t('Versione ripristinata.'));}));el.append(row);}}
const noteFont=new NoteFont({db,root:document.documentElement,onChange:()=>{resize();}});
async function settings(){
 const el=modal(t('Come ti piace.'));
 const languageLabel=text('label',t('Lingua dell’app'));languageLabel.htmlFor='app-language';
 const languageSelect=document.createElement('select');languageSelect.id='app-language';languageSelect.name='language';
 for(const [value,label] of [['auto',t('Automatico (browser)')],['it','Italiano'],['en','English']]){const option=text('option',label);option.value=value;languageSelect.append(option);}
 languageSelect.value=getLanguagePreference();languageSelect.onchange=async()=>{languageSelect.disabled=true;try{await changeLanguage(languageSelect.value);await settings();$('#app-language').focus();}catch(e){languageSelect.disabled=false;languageSelect.value=getLanguagePreference();report(e);}};
 el.append(languageLabel,languageSelect,text('p',t('Interfaccia, dettatura e lettura usano la stessa lingua. Le note esistenti non vengono tradotte.')));
 const fontLabel=text('label',t('Carattere delle note'));fontLabel.htmlFor='note-font';
 const fontSelect=document.createElement('select');fontSelect.id='note-font';fontSelect.name='note-font';
 for(const font of noteFonts){const option=text('option',font.label);option.value=font.id;fontSelect.append(option);}fontSelect.value=noteFont.preference;
 fontSelect.onchange=async()=>{try{await noteFont.set(fontSelect.value);}catch(e){fontSelect.value=noteFont.preference;report(e);}};
 el.append(fontLabel,fontSelect,text('p',t('Solo il testo delle note. Interfaccia e blocchi di codice mantengono il proprio carattere.')));
 const field=document.createElement('fieldset');field.className='theme-picker';field.append(text('legend',t('Aspetto')));const options=text('div','','theme-options');
 for(const [value,label,symbol] of [['light',t('Chiaro'),'☀'],['dark',t('Scuro'),'☾'],['auto','Auto','◐']]){const item=document.createElement('label'),input=document.createElement('input');input.type='radio';input.name='appearance';input.value=value;input.checked=appearance.preference===value;input.onchange=()=>{if(input.checked)appearance.set(value).catch(report);};const icon=text('span',symbol);icon.setAttribute('aria-hidden','true');item.append(input,icon,text('span',label));options.append(item);}field.append(options);el.append(field,text('p',t('Auto segue l’aspetto del dispositivo.')));
 const row=(parent,name,detail,label,fn)=>{const r=text('div','','setting-row'),left=text('div',name);if(detail)left.append(text('small',detail));r.append(left,button(label,fn));parent.append(r);};
 row(el,t('Sito statico'),t(publisher.config.folder?publisher.message:'Pubblica una cartella come journal.'),t('Gestisci'),showPublish);el.lastElementChild.querySelector('small').dataset.publishStatus='';
 row(el,'Reminders',t('Account privato e notifiche'),t('Gestisci'),()=>reminders.account());
 row(el,'Filen',t(cloud.message),t('Gestisci'),showFilen);el.lastElementChild.querySelector('small').dataset.filenStatus='';
 const backupRow=text('div','','setting-row'),backupLabel=text('label',t('Backup giornaliero')),backupToggle=document.createElement('input');backupToggle.type='checkbox';backupToggle.checked=dailyBackup.config.enabled;backupToggle.disabled=state.readOnly;backupToggle.onchange=()=>dailyBackup.enable(backupToggle.checked).catch(report);backupLabel.className='backup-label';backupLabel.prepend(backupToggle);const backupDetail=text('small',dailyBackup.config.lastRequested?t('Download richiesto: ')+dailyBackup.config.lastRequested:t('Uno ZIP al giorno durante l’uso dell’app.'));backupDetail.dataset.backupStatus='';backupLabel.append(backupDetail);const backupButton=button(t('Scarica'),()=>{if(!dailyBackup.request())toast(t('Preparazione del backup. Riprova tra un momento.'));});backupButton.dataset.backupDownload='';backupButton.disabled=!dailyBackup.blob;backupRow.append(backupLabel,backupButton);el.append(backupRow,text('p',t('Il browser sceglie la destinazione del download e può chiedere conferma. Con l’app chiusa il backup non viene eseguito.')));void dailyBackup.prepare().catch(report);
 row(el,t('Esporta le note'),t('Un archivio ZIP con file Markdown e cartelle.'),t('Esporta'),()=>execute('archive'));
 row(el,t('Importa note'),t('Markdown, testo o th-ink-backup.json.'),t('Importa'),()=>execute('import'));
 if(!setupPrompts.installed)row(el,t('Installa th.ink'),t('Aprila come un’app, anche offline.'),t('Installa'),installApp);
 const extra=document.createElement('details');extra.className='settings-extra';extra.append(text('summary',t('Archivio e strumenti')));el.append(extra);
 row(extra,t('Importa una cartella'),t('Mantiene le sottocartelle.'),t('Scegli'),()=>execute('importFolder'));
 row(extra,t('Voce offline'),t('Italiano e inglese sul dispositivo.'),t('Apri'),()=>{closeModal();return setMode('voice');});
 extra.append(text('p',t('Le note restano in questo browser. Esporta una copia prima di cancellarne i dati.')));
 const status=text('p',t('Archivio locale'),'storage-info');el.append(status);try{const usage=await navigator.storage.estimate();status.textContent=t('{size} MB su questo dispositivo',{size:new Intl.NumberFormat(getLocale(),{maximumFractionDigits:1}).format((usage.usage||0)/1024/1024)});}catch{}
}

async function changeLanguage(value,{persist=true}={}){
 const resumeVoice=state.mode==='voice';
 if(!validPreference(value))throw Error('Unsupported language preference');
 await flush();
 if(persist)await db.put('settings',{id:'language',value});
 await setMode('keyboard');voice.stop();spoken.cancel();await voiceLaunch?.catch(()=>{});
 try{setLanguagePreference(value,{persist});}catch{setLanguagePreference(value,{persist:false});}
 voice.lang=getLocale();voice.mode='dictation';
 await noteFont.restore();
 translateStatic();setupIcons();updateLanguageMetadata();renderNoteProperties();
 editor.lang=title.lang=getLanguage();
 $('#transcript').textContent='';notificationToast.hide();
 renderSort();
 renderList();count();updateSaveStatus();renderSetup();online();
 const n=note(),path=n?folderPath(n.folder,state.folders).join(' / '):'';
 $('#note-date').textContent=n?date(n.created,true).toUpperCase():'';
 $('#breadcrumb').textContent=path||t('Appunti');$('#folder-label').textContent=n?.deleted?t('NEL CESTINO'):path||t('Senza cartella');
 $('#pin-note').setAttribute('aria-label',n?.pinned?t('Rimuovi dai preferiti'):t('Aggiungi ai preferiti'));
 $('#file-label').textContent=n?.deleted?t('sola lettura'):'.md';
 if($('#palette').open){$('#palette-label').textContent=state.paletteMode==='search'?t('CERCA NEL TUO ARCHIVIO'):t('COMANDI');$('#palette-input').placeholder=state.paletteMode==='search'?t('Cerca un pensiero…'):t('Cosa vuoi fare?');await updatePalette();}
 if(resumeVoice)await setMode('voice');
 voiceCursor.update(true);syncNavigation();syncFocusVoice();resize();editor.ensureCaretVisible();
}
window.addEventListener('languagechange',()=>{if(getLanguagePreference()==='auto')changeLanguage('auto',{persist:false}).catch(report);});
window.addEventListener('storage',event=>{if(event.key===languageStorageKey&&validPreference(event.newValue))changeLanguage(event.newValue,{persist:false}).then(()=>{if($('#app-language'))settings();}).catch(report);});

let voicePreparing=false,voiceNotice=false,voiceEpoch=0,voiceLaunch=null;
function syncFocusVoice(){
 const button=$('[data-mode=voice]');
 const commands=state.mode==='voice'&&voice.mode==='commands';
 button.classList.toggle('command-mode',commands);
 button.setAttribute('aria-label',commands?`${t('Voce')} · ${t('Modalità comandi attiva.')}`:t('Voce'));
 button.title=commands?t('Modalità comandi attiva.'):t('Voce');
 button.classList.toggle('preparing',voicePreparing);
 button.setAttribute('aria-busy',String(voicePreparing));
 $('#voice-dock').hidden=state.mode!=='voice';
 $('#voice-status').hidden=!voicePreparing&&!voiceNotice;
}
function renderVoiceLevel(level){
 const value=Math.max(0,Math.min(1,level));
 $('#app').style.setProperty('--voice-level',String(value));
 for(const id of ['#voice-level','#voice-underline'])$(id).setAttribute('aria-valuenow',String(Math.round(value*100)/100));
}
async function setMode(mode,{keepNotice=false}={}){
 if(mode===state.mode&&(mode!=='voice'||voice.active||voicePreparing))return voiceLaunch;
 const epoch=++voiceEpoch,previous=voiceLaunch;
 state.mode=mode;if(!keepNotice)voiceNotice=false;
 $('#app').classList.toggle('voice-mode',mode==='voice');voiceCursor.setEnabled(mode==='voice');
 document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
 if(mode!=='voice'){
  voicePreparing=false;voice.stop();renderVoiceLevel(0);syncFocusVoice();await releaseWakeLock();return;
 }
 setLibrary(false,{restore:false});setPreview(false);$('[data-mode=voice]').focus({preventScroll:true});
 $('#transcript').textContent='';
 voicePreparing=true;$('#voice-status').textContent=t('Preparazione motore locale');syncFocusVoice();
 voiceLaunch=(async()=>{
  // Serialize a quick Write → Voice change behind any cancelled startup.
  if(previous)await previous.catch(()=>{});
  if(epoch!==voiceEpoch)return;
  try{
   if(state.readOnly)throw Error('Questa finestra è in sola lettura. Chiudi l’altra finestra di th.ink e ricarica per dettare.');
   if(note()?.deleted)throw Error('Ripristina la nota dal cestino prima di dettare.');
   spoken.cancel();voice.mode='dictation';if(!note())await createNote();
   if(epoch!==voiceEpoch)return;
   await voice.start();
   if(epoch===voiceEpoch&&!voice.active)await setMode('keyboard');
  }catch(error){
   if(epoch===voiceEpoch){
    await setMode('keyboard');
    if(error.name!=='AbortError'){voiceNotice=true;$('#voice-status').textContent=t(error.message);syncFocusVoice();}
   }
  }finally{if(epoch===voiceEpoch){voicePreparing=false;syncFocusVoice();}}
 })();
 return voiceLaunch;
}
new MutationObserver(syncFocusVoice).observe($('#voice-status'),{childList:true,characterData:true,subtree:true});
async function releaseWakeLock(){try{await wakeLock?.release();}catch{}wakeLock=null;}
const spoken=new SpokenEditor({
 setArgumentMode:value=>voice.argumentMode=value,language:()=>voice.lang,mode:()=>voice.mode,setMode:mode=>voice.mode=mode,
 snapshot:()=>({note:note()?{...note()}:null,selection:[editor.selectionStart,editor.selectionEnd]}),
 say:message=>{ $('#transcript').textContent=message;return voice.speak(message); },
 read:message=>voice.speak(spokenMarkdown(message,voice.lang)),
 interrupt:id=>id==='pauseReading'?voice.pauseReading():voice.stopReading(),resume:()=>voice.resumeReading(),repeat:()=>voice.repeatReading(),stop:()=>setMode('keyboard'),
 setLanguage:async lang=>{await changeLanguage(lang.startsWith('it')?'it':'en');await voice.speak(getLanguage()==='it'?'Italiano pronto.':'English ready.');},
 insert:async(value,punctuation)=>{if(punctuation&&value==='\n')return execute('newline');if(state.readOnly)throw Error(t('Archivio in sola lettura.'));if(!note())await createNote();if(note().deleted)throw Error(t('Ripristina prima la nota.'));const prefix=!punctuation&&editor.selectionStart&&!/\s/.test(editor.value[editor.selectionStart-1])?' ':'';edit(prefix+value);},
 edit:(...args)=>{if(state.readOnly||!note()||note().deleted)throw Error(t('Nota non modificabile.'));edit(...args);},
 select:range=>{setPreview(false);editor.setSelectionRange(...range);voiceCursor.update(true);},
 execute:async(id,args={})=>{if(state.readOnly)throw Error(t('Archivio in sola lettura.'));if(note()?.deleted&&id!=='trash')throw Error(t('Ripristina prima la nota.'));
  if(id==='copy'||id==='cut'){state.clipboard=editor.value.slice(editor.selectionStart,editor.selectionEnd);if(!state.clipboard)throw Error(t('Nessun testo selezionato.'));if(id==='cut')edit('');return;}
  if(id==='paste'){if(!state.clipboard)throw Error(t('Appunti vuoti.'));edit(state.clipboard);return;}
  if(id==='save'){await flush();return;}
  if(['import','importFolder','settings','export','archive','history'].includes(id))throw Error(t('Questa azione di sistema richiede un gesto sullo schermo.'));
  return execute(id,args,'screenless');},
 notes:()=>[...state.notes].sort((a,b)=>b.updated-a.updated),folders:()=>[{id:null,name:t('Senza cartella'),label:voice.lang==='it-IT'?t('Senza cartella'):'No folder'},...state.folders.filter(f=>!f.deleted).map(f=>({id:f.id,name:f.name,label:folderPath(f.id,state.folders).join(' / ')}))],
 open:openNote,create:async name=>{await createNote();title.value=name;changed();await flush();},folder:async name=>{await addFolder(name,state.folders.some(f=>f.id===state.filter&&!f.deleted)?state.filter:null);},
 move:async id=>{if(state.readOnly)throw Error(t('Archivio in sola lettura.'));await mutate(n=>n.folder=id);await openNote(state.current);},
 selectFolder:id=>{state.filter=id||'all';refresh();},
 search:async query=>{await flush();const request='spoken-'+uid();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{searchWorker.removeEventListener('message',listener);reject(Error(t('Ricerca scaduta.')));},5000);const listener=({data})=>{if(data.request!==request)return;clearTimeout(timer);searchWorker.removeEventListener('message',listener);resolve(data.ids.map(id=>state.notes.find(n=>n.id===id)).filter(Boolean).map(n=>({id:n.id,label:n.title||t('Senza titolo')})));};searchWorker.addEventListener('message',listener);searchWorker.postMessage({type:'search',query,request});});},
 history:async()=>{if(!note())return [];await flush();await db.revision(note());return (await db.get('history',note().id))?.items.slice().reverse()||[];},
 restore:async version=>{if(state.readOnly||note()?.deleted)throw Error(t('Nota non modificabile.'));await db.revision(note());checkpoint();const restored=freshRestoredReminders(version,note());title.value=restored.title;editor.value=restored.body;Object.assign(note(),noteProperties(restored));changed();await flush();},
 focus:()=>setFocus(true)
});
voice.addEventListener('mode',syncFocusVoice);
voice.addEventListener('recognition',({detail})=>{ $('#transcript').textContent=detail.text;
 if(needsRecognitionRepeat(detail,voice.mode,voice.argumentMode)){feedback(voice.lang==='it-IT'?t('Non ho capito bene. Ripeti la frase.'):'I did not catch that. Please repeat.');return;}
 $('#voice-status').textContent=detail.confidence!==null&&detail.confidence<.45?t('Testo inserito con riconoscimento incerto: controlla la trascrizione.'):t('Dettatura ricevuta.');spoken.receive(detail.text).catch(report).finally(()=>voiceCursor.update(true));
});
voice.addEventListener('interrupt',({detail})=>{if(detail==='pauseReading')voice.pauseReading();else voice.stopReading();});
voice.addEventListener('progress',({detail})=>{const names={microphone:t('In attesa del permesso del microfono. Consenti l’accesso nel browser o nell’app.'),audio:t('Avvio ingresso audio…'),runtime:t('Preparazione motore locale'),model:t('Preparazione modello'),speech:t('Preparazione voce di lettura'),loading:t('Caricamento del modello in memoria'),ready:t('Modello pronto. Audio elaborato sul dispositivo.')};$('#voice-status').textContent=(names[detail.stage]||detail.stage)+(detail.progress===undefined?'':` · ${Math.round(detail.progress*100)}%`);});
voice.addEventListener('speaking',({detail})=>{if(voice.active)$('#voice-status').textContent=detail?t('Lettura in corso. Puoi dire ferma lettura o pausa lettura.'):voice.mode==='commands'?t('Modalità comandi attiva.'):t('Dettatura attiva. Parla, poi fai una breve pausa.');});
voice.addEventListener('level',({detail})=>renderVoiceLevel(Math.min(1,Math.sqrt(Math.max(0,detail.rms))*3)));
voice.addEventListener('unrecognized',()=>{$('#voice-status').textContent=t('Audio ricevuto, ma nessuna parola riconosciuta. Avvicinati al microfono e ripeti.');});
voice.addEventListener('interim',({detail})=>$('#transcript').textContent=detail);
voice.addEventListener('error',({detail})=>{voiceNotice=true;$('#voice-status').textContent=t(detail);syncFocusVoice();});
voice.addEventListener('state',async({detail})=>{
 if(detail){try{const lock=await navigator.wakeLock?.request('screen');if(voice.active)wakeLock=lock;else await lock?.release();}catch{}}
 else{renderVoiceLevel(0);if(state.mode==='voice'&&!voicePreparing)void setMode('keyboard',{keepNotice:true});await releaseWakeLock();}
 syncFocusVoice();
});
async function importFiles(files){if(state.readOnly)throw Error(t('Archivio aperto in un’altra finestra.'));let first=null;const imported=[];for(const file of files){if(/\.json$/i.test(file.name)){if(file.size>100*1024*1024)throw Error(t('Backup troppo grande (massimo 100 MB).'));await flush();const restored=restoreBackup(await file.text());for(const f of restored.folders){await db.put('folders',f);state.folders.push(f);}for(const n of restored.notes){await db.saveNote(n);state.notes.push(n);imported.push(n);first??=n.id;}for(const h of restored.history)await db.put('history',h);continue;}if(!/\.(md|markdown|txt)$/i.test(file.name))continue;if(file.size>10*1024*1024){toast(t('File troppo grande: {name}. Limite 10 MB.',{name:file.name}));continue;}let parent=null;const path=file.webkitRelativePath?.split('/').slice(0,-1)||[];for(const name of path){let f=state.folders.find(f=>!f.deleted&&f.parent===parent&&f.name===name);if(!f)f=await addFolder(name,parent);parent=f.id;}const content=parseMarkdown(await file.text(),file.name);const n={...content,id:uid(),folder:parent,created:Date.now(),updated:Date.now(),pinned:false,deleted:false};await db.saveNote(n);state.notes.push(n);imported.push(n);first??=n.id;}index(imported);cloud.schedule();dailyBackup.invalidate();state.filter='all';refresh();if(first)await openNote(first);toast(t('{count} note importate.',{count:imported.length}));}
for(const id of ['#import-files','#import-directory'])$(id).onchange=e=>{importFiles([...e.target.files]).catch(report).finally(()=>e.target.value='');};
document.addEventListener('click',e=>{const action=e.target.closest('[data-action]');if(action)execute(action.dataset.action,{level:action.dataset.level}).catch(report);const filter=e.target.closest('[data-filter]');if(filter){state.filter=filter.dataset.filter;refresh();}const mode=e.target.closest('[data-mode]');if(mode)setMode(mode.dataset.mode).catch(report);if(e.target.closest('[data-close]')){if(e.target.closest('#modal'))closeModal();else $('#palette').close();}});
const headingToggle=$('#heading-toggle'),headingMenu=$('#heading-menu');
function closeHeadings(){headingMenu.hidden=true;headingToggle.setAttribute('aria-expanded','false');}
headingToggle.onclick=()=>{headingMenu.hidden=!headingMenu.hidden;headingToggle.setAttribute('aria-expanded',String(!headingMenu.hidden));};
headingToggle.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();headingMenu.hidden=false;headingToggle.setAttribute('aria-expanded','true');headingMenu.querySelector('button').focus({preventScroll:true});}});
headingMenu.addEventListener('keydown',e=>{const buttons=[...headingMenu.querySelectorAll('button')],at=buttons.indexOf(document.activeElement);let next;if(['ArrowRight','ArrowDown'].includes(e.key))next=(at+1)%buttons.length;if(['ArrowLeft','ArrowUp'].includes(e.key))next=(at+buttons.length-1)%buttons.length;if(e.key==='Home')next=0;if(e.key==='End')next=buttons.length-1;if(next!==undefined){e.preventDefault();buttons[next].focus({preventScroll:true});}});
headingMenu.addEventListener('click',e=>{if(e.target.closest('button'))closeHeadings();});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.heading-control'))closeHeadings();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!headingMenu.hidden){e.preventDefault();closeHeadings();headingToggle.focus({preventScroll:true});}});
$('.format-bar').addEventListener('pointerdown',e=>{if(e.target.closest('button'))e.preventDefault();});
editor.addEventListener('beforeinput',()=>{if(!editGroup){checkpoint();editGroup=true;}clearTimeout(editGroupTimer);editGroupTimer=setTimeout(()=>editGroup=false,700);});
title.addEventListener('beforeinput',()=>{if(!editGroup){checkpoint();editGroup=true;}clearTimeout(editGroupTimer);editGroupTimer=setTimeout(()=>editGroup=false,700);});
editor.addEventListener('keydown',e=>{if(e.key==='Tab'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();execute(e.shiftKey?'outdent':'indent').catch(report);}if(e.key==='Escape'){voice.stopReading();$('.format-bar button').focus();}});
editor.addEventListener('input',changed);title.addEventListener('input',()=>{title.value=title.value.replace(/[\r\n]+/g,' ');changed();});editor.addEventListener('blur',()=>{editGroup=false;});title.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();focusEditor();}});
$('#write-tab').onclick=()=>setPreview(false);$('#preview-tab').onclick=()=>setPreview(true);$('#pin-note').onclick=()=>{execute('pin').catch(report);$('#pin-note').classList.remove('pin-pop');requestAnimationFrame(()=>$('#pin-note').classList.add('pin-pop'));};
$('#add-folder').onclick=folderForm;$('#sort').onclick=()=>{state.sort=state.sort==='updated'?'title':'updated';renderList();toast(state.sort==='title'?t('Note ordinate per titolo.'):t('Note ordinate per ultima modifica.'));};
$('#library-toggle').onclick=()=>{$('#app').classList.remove('focus');setLibrary(true);};$('#close-library').onclick=()=>setLibrary(false);
document.addEventListener('keydown',e=>{if(!$('#app').classList.contains('library-open')||!mobileLayout.matches||$('#modal').open||$('#palette').open)return;if(e.key==='Escape'){e.preventDefault();setLibrary(false);}if(e.key==='Tab'){const targets=[...$('#sidebar').querySelectorAll('a,button,[tabindex="0"]')].filter(b=>!b.disabled&&b.getClientRects().length);const first=targets[0],last=targets.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
$('#palette').addEventListener('close',()=>{$('#palette-input').setAttribute('aria-expanded','false');$('#palette-input').removeAttribute('aria-activedescendant');});
$('#palette-input').oninput=()=>updatePalette().catch(report);$('#palette-input').onkeydown=e=>{const buttons=$('#palette-results').querySelectorAll('button');if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();state.paletteIndex=Math.max(0,Math.min(buttons.length-1,state.paletteIndex+(e.key==='ArrowDown'?1:-1)));highlightPalette();}if(e.key==='Enter'){e.preventDefault();buttons[state.paletteIndex]?.click();}};
// Capture the requested shortcuts before the editor or native Cut/Save handlers.
document.addEventListener('keydown',e=>{
 if(e.isComposing||e.shiftKey||e.getModifierState('AltGraph'))return;
 const key=e.key.toLowerCase(),command=(e.ctrlKey||e.metaKey)&&!e.altKey;
 const id=command&&key==='x'?'palette':command&&key==='s'?'replace':e.altKey&&!e.ctrlKey&&!e.metaKey&&key==='s'?'replaceAllNotes':null;
 if(!id)return;e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;
 if(id==='replace')openFindReplace('note');else if(id==='replaceAllNotes')openFindReplace('all');else openPalette();
},true);
document.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey))return;const key=e.key.toLowerCase();const global={k:'search'};let id=global[key];if(!$('#modal').open&&!$('#palette').open){if(key==='n'&&e.altKey)id='new';else if(key==='f'&&e.shiftKey)id='focus';else if(key==='p'&&e.shiftKey)id='preview';else if(['#editor','#note-title'].some(s=>e.target.closest(s))||key==='s')id=({b:'bold',i:'italic',z:e.shiftKey?'redo':'undo',y:'redo'})[key]||id;}if(id){e.preventDefault();execute(id).catch(report);}});
window.addEventListener('resize',resize);window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();setupPrompts.offer(e);});window.addEventListener('appinstalled',()=>{setupPrompts.setInstalled(true);void persistence.ensure();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){flush().catch(report);voice.stop();releaseWakeLock();}});
window.addEventListener('beforeunload',e=>{if(state.dirty.size||state.saving){e.preventDefault();e.returnValue='';}});
const online=()=>$('#offline-state').textContent=navigator.onLine?'':t('Offline · puoi scrivere');window.addEventListener('online',online);window.addEventListener('offline',online);
channel?.addEventListener('message',async({data})=>{if(data.type!=='changed')return;const latest=await db.get('notes',data.id);if(!latest)return;const current=state.notes.find(n=>n.id===data.id);if(current&&current.updated>=latest.updated)return;if(data.id===state.current&&state.dirty.has(data.id))return toast(t('Nota modificata in un’altra finestra. Esporta una copia prima di ricaricare.'));if(data.id===state.current){toast(t('Questa nota è cambiata in un’altra finestra. Riaprila per aggiornarla.'));return;}if(current)Object.assign(current,latest);else state.notes.push(latest);index([latest]);refresh();});
const library=mountLibrary({state,db,tree,flush,report,form,openNote,execute,editor,edit,addFolder,createNote,changed:async(notes,folders)=>{
 const byId=new Map(state.notes.map(n=>[n.id,n])),latest=notes.map(n=>byId.get(n.id)).filter(Boolean);index(latest);
 if(state.folders.some(f=>f.id===state.filter&&f.deleted))state.filter='all';
 const current=note();if(current){
  const scroll=$('#document-scroll').scrollTop;title.value=current.title;title.readOnly=editor.readOnly=state.readOnly||!!current.deleted;
  if(current.deleted&&state.mode==='voice')setMode('keyboard');
  const path=folderPath(current.folder,state.folders).join(' / ');$('#breadcrumb').textContent=path||t('Appunti');$('#folder-label').textContent=current.deleted?t('NEL CESTINO'):path||t('Senza cartella');
  $('#pin-note').textContent=current.pinned?'✦':'☆';$('#pin-note').setAttribute('aria-pressed',String(!!current.pinned));renderNoteProperties();$('#document-scroll').scrollTop=scroll;
 }
 refresh();updateSaveStatus();dailyBackup.invalidate();cloud.schedule();
 if(latest.length>50)channel?.postMessage({type:'library-changed'});
 else{for(const n of latest)channel?.postMessage({type:'changed',id:n.id});if(folders.length)channel?.postMessage({type:'folders-changed'});}
 await reminders.persist();
}});
channel?.addEventListener('message',async({data})=>{if(data.type==='folders-changed'&&state.readOnly){state.folders=await db.all('folders');refresh();}});
channel?.addEventListener('message',async({data})=>{if(data.type!=='library-changed'||!state.readOnly)return;
 [state.notes,state.folders]=await Promise.all([db.all('notes'),db.all('folders')]);index(state.notes);
 const n=note();if(n){const scroll=$('#document-scroll').scrollTop,start=editor.selectionStart,end=editor.selectionEnd;title.value=n.title;editor.value=n.body;editor.setSelectionRange(Math.min(start,n.body.length),Math.min(end,n.body.length));$('#document-scroll').scrollTop=scroll;if(state.preview){$('#preview').innerHTML=renderMarkdown(n.body);reminders.decorate();}}refresh();renderNoteProperties();
});
async function boot(){
 await db.open($('#app').dataset.testDatabase||'think-v1');
 const savedLanguage=(await db.get('settings','language'))?.value;
 if(validPreference(savedLanguage))setLanguagePreference(savedLanguage,{persist:false});
 await noteFont.restore();
 translateStatic();setupIcons();updateLanguageMetadata();renderNoteProperties();voice.lang=getLocale();editor.lang=title.lang=getLanguage();
 void persistence.ensure();
 tree.collapsed=new Set((await db.get('settings','collapsed-folders'))?.value||[]);
 if(navigator.locks)await new Promise(resolve=>{navigator.locks.request(($('#app').dataset.testDatabase?'th-ink-writer:'+$('#app').dataset.testDatabase:'th-ink-writer'),{ifAvailable:true},async lock=>{state.readOnly=!lock;resolve();if(lock)await new Promise(()=>{});}).catch(()=>resolve());});
 [state.notes,state.folders]=await Promise.all([db.all('notes'),db.all('folders')]);
 if(!state.readOnly&&!(await db.get('settings','initialized'))){
  const ideas={id:uid(),name:t('Pensieri'),parent:null},work={id:uid(),name:t('Progetti'),parent:null};state.folders.push(ideas,work);for(const f of [ideas,work])await db.put('folders',f);
  const now=Date.now();state.notes=[{id:uid(),title:t('Uno spazio per pensare.'),body:t('Non tutto deve diventare qualcosa.\nA volte, basta scriverlo.\n\nQuesto è il tuo spazio: poche distrazioni, nessuna fretta. Un posto per raccogliere quello che ti passa per la testa e ritrovarlo quando serve.\n\n## Comincia da qui\n\n- Scrivi un pensiero, anche incompleto.\n- Dagli un posto, oppure lascialo libero.\n- Torna a leggerlo con occhi nuovi.\n\n> Le idee hanno bisogno di spazio. Non di rumore.\n\nLe note restano su questo dispositivo. Da Preferenze puoi esportarle come semplici file Markdown.'),folder:ideas.id,created:now,updated:now,pinned:true,deleted:false},{id:uid(),title:t('Le cose da ricordare'),body:t('- [ ] Fare spazio alle idee nuove\n- [ ] Finire quel libro sul comodino\n- [ ] Uscire a camminare, senza una meta\n\nLe piccole cose meritano un posto.'),folder:ideas.id,created:now-86400000,updated:now-86400000,pinned:false,deleted:false},{id:uid(),title:t('Meno, ma meglio.'),body:t('Un’idea per il prossimo progetto.\n\n## La domanda giusta\n\nCosa rimane, se togliamo tutto ciò che non serve?\n\nVelocità. Chiarezza. Una cosa fatta bene.'),folder:work.id,created:now-172800000,updated:now-172800000,pinned:false,deleted:false}];for(const n of state.notes)await db.saveNote(n);await db.put('settings',{id:'initialized',value:true});
 }
 const themeSetting=await db.get('settings','theme'),legacyTheme=await db.get('settings','dark');await appearance.set(['auto','light','dark'].includes(themeSetting?.value)?themeSetting.value:legacyTheme?legacyTheme.value?'dark':'light':'auto',{persist:false});syncNavigation();
 searchWorker=new Worker('./js/search-worker.js',{type:'module'});searchWorker.onerror=()=>toast(t('Ricerca non disponibile: ricarica l’app.'));searchWorker.onmessage=({data})=>{if(data.request!==state.request||state.paletteMode!=='search')return;paletteRows(data.ids.slice(0,100).map(id=>state.notes.find(n=>n.id===id)).filter(Boolean).map(n=>({label:n.title||t('Senza titolo'),detail:folderPath(n.folder,state.folders).join(' / ')||t('Nota'),fn:()=>openNote(n.id)})));state.searchResults=data.ids;if(state.voiceSearch){state.voiceSearch=false;feedback(data.ids.length?data.ids.slice(0,5).map((id,i)=>t('Risultato {number}: {title}',{number:i+1,title:state.notes.find(n=>n.id===id)?.title||t('senza titolo')})).join('. ')+t('. Di’ apri risultato seguito dal numero.'):t('Nessuna nota trovata.'));}$('#search-time').textContent=`${data.ids.length} ${data.ids.length===1?t('nota trovata'):t('note trovate')}`;};index(state.notes);
 refresh();if(state.readOnly)toast(t('Un’altra finestra sta usando l’archivio: qui puoi solo leggere.'));const last=(await db.get('settings','last-note'))?.value;await openNote(state.notes.some(n=>n.id===last&&!n.deleted)?last:state.notes.find(n=>!n.deleted)?.id||null);online();setupReady=true;renderSetup();
 if('serviceWorker' in navigator){try{await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});await navigator.serviceWorker.ready;}catch(e){toast(t('Cache offline non attivata. ')+e.message);}}
 reminders.initializing=reminders.init().catch(report);
 if(!state.readOnly){await publisher.restore();await dailyBackup.restore();void dailyBackup.prepare().catch(()=>{});void restoreFilen();setInterval(backgroundWork,60000);window.addEventListener('online',backgroundWork);document.addEventListener('visibilitychange',backgroundWork);document.addEventListener('pointerup',event=>{if(event.isTrusted&&event.target.closest('#editor,#note-title,#note-tree'))dailyBackup.request({automatic:true});},{passive:true});document.addEventListener('keydown',event=>{if(event.isTrusted&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&event.target.matches('#editor,#note-title'))dailyBackup.request({automatic:true});});}
 setInterval(()=>{if(note()&&!document.hidden)db.revision(note()).catch(report);},60000);
}
export const appReady=boot().catch(e=>{$('#save-state').textContent=t('Archivio non disponibile');editor.readOnly=true;title.readOnly=true;const el=modal(t('L’archivio non si è aperto.'));el.append(text('p',t('Il browser non ha consentito l’accesso ai dati locali. Verifica i permessi e lo spazio disponibile, poi ricarica. Nessun salvataggio è stato confermato.')),text('p',t(e.message)));});

export {library,publisher,showPublish,reminders,changeLanguage,spoken,voice,state,db,execute,openNote,flush,appearance,voiceCursor,setMode,cloud,filenSession,dailyBackup,applySyncItem,syncItems};

$('#preview').addEventListener('click',e=>{const b=e.target.closest('[data-reminder]');if(b)reminders.edit(b.dataset.reminder).catch(report);});

$('#preview').addEventListener('click',e=>{const link=e.target.closest('[data-note-link]');if(!link)return;const target=state.notes.find(n=>n.id===link.dataset.noteLink&&!n.deleted);if(target)openNote(target.id).catch(report);else toast(t('Elemento non disponibile.'));});
