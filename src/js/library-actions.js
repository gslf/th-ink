import {t} from './i18n.js';
import {folderPath,normalize} from './core.js';
import {libraryIndex,descendants,libraryPlan,validateMove} from './library-model.js';
import {freshRestoredReminders} from './reminder-model.js';
import {normalizeTags} from './note-properties.js';
import {ContextMenu} from './context-menu.js';
import {LibraryInteractions} from './library-interactions.js';

export function mountLibrary({state,db,tree,flush,changed,report,form,openNote,execute,editor,edit,addFolder,createNote}){
 const history=[];let busy=false;
 const menu=new ContextMenu(report),feedback=document.createElement('div');feedback.className='library-feedback';feedback.hidden=true;document.body.append(feedback);
 const status=document.createElement('span');status.setAttribute('role','status');const undoButton=document.createElement('button');feedback.append(status,undoButton);
 const get=source=>(source.kind==='folder'?state.folders:state.notes).find(x=>x.id===source.id);
 function message(value){status.textContent=value;undoButton.textContent=t('Annulla spostamento');undoButton.hidden=!history.length;feedback.hidden=false;clearTimeout(message.timer);message.timer=setTimeout(()=>feedback.hidden=true,9000);}
 const writable=()=>{if(state.readOnly)throw Error('Archivio in sola lettura.');};
 async function apply(patches,{remember=true,created=[]}={}){
  writable();if(busy)throw Error('Attendi il completamento dello spostamento.');busy=true;
  try{
   await flush();writable();
   const index=libraryIndex(state.notes,state.folders),lookup=c=>(c.kind==='folder'?index.folderById:index.noteById).get(c.id);
   for(const c of patches){const item=lookup(c);if(!item||Object.keys(c.before).some(k=>JSON.stringify(item[k]??(k==='deleted'?false:null))!==JSON.stringify(c.before[k])))throw Error('L’elemento è cambiato. Riprova.');}
   if(!patches.length&&!created.length)return;
   const notes=[],folders=[];
   for(const c of patches){const item=lookup(c);Object.assign(item,c.after);if(c.kind==='note'){item.updated=Math.max(Date.now(),item.updated+1);notes.push(structuredClone(item));}else folders.push(structuredClone(item));}
   for(const n of created){state.notes.push(n);notes.push(structuredClone(n));}
   const mirrorIds=new Set([...created.map(n=>n.id),...patches.filter(c=>c.kind==='note'&&('title' in c.after||'tags' in c.after)).map(c=>c.id)]);
   const save=db.saveLibraryChanges({notes,folders,mirrors:notes.filter(n=>mirrorIds.has(n.id))});state.saveQueue=save;state.saving++;
   try{await save;}catch(error){for(const c of patches)Object.assign(lookup(c),c.before);const ids=new Set(created.map(c=>c.id));state.notes=state.notes.filter(n=>!ids.has(n.id));throw error;}finally{state.saving--;}
   if(remember)history.push({patches,created:created.map(n=>n.id)});if(history.length>20)history.shift();
   await changed(notes,folders);
  }finally{busy=false;}
 }
 async function perform(source,action,parent=null){
  writable();await flush();const patches=libraryPlan(state.notes,state.folders,source,action,parent);
  await apply(patches);if(patches.length){if(action!=='trash')tree.reveal(source.kind==='folder'?source.id:parent,state.folders);tree.render(state);message(t(action==='trash'?'Spostato nel cestino.':'Archivio aggiornato.'));}
 }
 async function undo(){
  const last=history.at(-1);if(!last)return;const patches=last.patches.map(c=>({...c,before:c.after,after:c.before}));
  for(const id of last.created){const n=get({kind:'note',id});if(n&&!n.deleted)patches.push({kind:'note',id,before:{deleted:false},after:{deleted:true}});}
  await apply(patches,{remember:false});history.pop();message(t('Spostamento annullato.'));
 }
 undoButton.onclick=()=>undo().catch(report);
 async function duplicate(source){
  writable();await flush();const n=get(source);if(!n||n.deleted)return;
  const copy=freshRestoredReminders(n,{reminders:[]});Object.assign(copy,{id:crypto.randomUUID(),title:n.title+t(' — copia'),created:Date.now(),updated:Date.now(),trashGroup:null});
  await apply([],{created:[copy]});message(t('Nota duplicata.'));return copy;
 }
 const folderChoices=source=>{const index=libraryIndex(state.notes,state.folders),excluded=source.kind==='folder'?descendants(index,source.id):new Set();return [['',t('Livello principale')],...state.folders.filter(f=>!f.deleted&&!excluded.has(f.id)).map(f=>[f.id,folderPath(f.id,state.folders).join(' / ')]).sort((a,b)=>a[1].localeCompare(b[1]))];};
 function moveDialog(source){const item=get(source);if(!item)return;form(t('Sposta in…'),[{name:'folder',label:t('Cartella di destinazione'),options:folderChoices(source),value:item.parent||item.folder||''}],v=>perform(source,'move',v.folder||null));}
 function rename(source){const item=get(source);if(!item)return;const key=source.kind==='folder'?'name':'title';form(t('Rinomina'),[{name:'name',label:t('Nome'),required:true,value:item[key]}],async v=>{const name=v.name.trim();if(!name||name.length>1000)throw Error('Scegli un nome valido.');if(source.kind==='folder'&&state.folders.some(f=>f.id!==item.id&&!f.deleted&&f.parent===item.parent&&normalize(f.name)===normalize(name)))throw Error('Esiste già una cartella con questo nome.');await apply([{...source,before:{[key]:item[key]},after:{[key]:name}}]);message(t('Archivio aggiornato.'));});}
 const command=(label,glyph,run,disabled=false,danger=false)=>({label:t(label),icon:glyph,run,disabled,danger});
 function items(source){
  if(source.kind==='tag')return [];
  const item=get(source);if(!item)return [];const locked=state.readOnly,rows=[];
  if(history.length)rows.push(command('Annulla spostamento','undo',undo,locked),null);
  if(item.deleted){rows.push(command('Ripristina','undo',()=>perform(source,'restore'),locked),command('Sposta in…','move',()=>moveDialog(source),locked));return rows;}
  if(source.kind==='note')rows.push(command('Apri nota','notes',()=>openNote(source.id)),command('Duplica nota','copy',()=>duplicate(source),locked));
  else rows.push(command('Nuova nota','plus',()=>createNote(source.id),locked),command('Nuova cartella','folder',()=>form(t('Nuova cartella'),[{name:'name',label:t('Nome'),required:true}],v=>addFolder(v.name,source.id)),locked));
  rows.push(command('Rinomina','rename',()=>rename(source),locked),command('Sposta in…','move',()=>moveDialog(source),locked));
  if(source.kind==='note')rows.push(command(item.pinned?'Rimuovi dai preferiti':'Aggiungi ai preferiti','star',()=>apply([{...source,before:{pinned:!!item.pinned},after:{pinned:!item.pinned}}]),locked));
  rows.push(null,command('Sposta nel cestino','trash',()=>perform(source,'trash'),locked,true));return rows;
 }
 document.querySelector('#note-tree').addEventListener('contextmenu',e=>{if(e.target.closest('[role=treeitem]'))return;e.preventDefault();menu.show([command('Nuova nota','plus',()=>createNote(null),state.readOnly),command('Nuova cartella','folder',()=>form(t('Nuova cartella'),[{name:'name',label:t('Nome'),required:true}],v=>addFolder(v.name,null)),state.readOnly),...(history.length?[null,command('Annulla spostamento','undo',undo,state.readOnly)]:[])],{x:e.clientX,y:e.clientY,anchor:document.querySelector('#note-tree')});});
 const interactions=new LibraryInteractions({root:document.querySelector('#note-tree'),state,tree,menu,items,move:(source,parent)=>perform(source,'move',parent),report,drop:async(source,target)=>{
  const n=get(source);if(!n)return;
  if(target.type==='trash')return perform(source,'trash');
  if(target.type==='pin')return apply([{...source,before:{pinned:!!n.pinned},after:{pinned:true}}]);
  if(target.type==='tag'){const group=state.tagIndex.groups.get(target.key);if(group)return apply([{...source,before:{tags:n.tags??null},after:{tags:normalizeTags([...(n.tags||[]),group.name])}}]);}
  if(target.type==='link'){
   if(n.deleted||!state.notes.some(x=>x.id===state.current&&!x.deleted))return;
   const pos=editor.markdownView.posAtCoords({x:target.x,y:target.y});if(pos===null)return;
   const label=(n.title||t('Senza titolo')).replace(/[\[\]\r\n]/g,' ');edit(`[${label}](note:${n.id})`,pos,pos);
  }
 }});
 // Editor selection stays in CodeMirror while focus moves through the menu.
 const documentRoot=document.querySelector('#document');
 documentRoot.addEventListener('mousedown',e=>{if(e.button===2&&e.target.closest('#editor')&&editor.selectionStart!==editor.selectionEnd)e.preventDefault();},true);
 function editorMenu(e){
  if(e.target.closest('#note-title,input,button,a')&&!e.target.closest('#preview a,#preview [data-note-link]'))return;
  const current=state.notes.find(n=>n.id===state.current);if(!current)return;
  e.preventDefault();e.stopPropagation();const noteId=current.id,start=editor.selectionStart,end=editor.selectionEnd,scroll=document.querySelector('#document-scroll').scrollTop,editing=!!e.target.closest('#editor'),selected=editing?editor.value.slice(start,end):window.getSelection()?.toString()||'',locked=state.readOnly||current.deleted;
  const run=id=>()=>{if(state.current!==noteId)return;editor.setSelectionRange(start,end);editor.focus({preventScroll:true});document.querySelector('#document-scroll').scrollTop=scroll;return execute(id);};
  const rows=[];
  if(editing){rows.push(command('Annulla modifica','undo',run('undo'),locked||!state.undo.get(noteId)?.length),command('Ripeti','redo',run('redo'),locked||!state.redo.get(noteId)?.length),null,
   command('Taglia','cut',run('cut'),locked||!selected),command('Copia','copy',async()=>{state.clipboard=selected;try{await navigator.clipboard.writeText(selected);}catch{/* The session clipboard remains available. */}},!selected),command('Incolla','paste',run('paste'),locked),null,
   command('Grassetto','bold',run('bold'),locked),command('Corsivo','italic',run('italic'),locked),command('Collegamento','link',run('link'),locked),command('Seleziona tutto','notes',run('selectAll')),null,command('Trova e sostituisci','search',run('replace'),locked));}
  else if(selected)rows.push(command('Copia','copy',async()=>{state.clipboard=selected;await navigator.clipboard.writeText(selected);}),null);
  const internal=e.target.closest('#preview [data-note-link]');if(internal)rows.push(command('Apri nota','notes',()=>openNote(internal.dataset.noteLink)),null);
  const link=e.target.closest('#preview a');if(link){const url=link.getAttribute('href');if(/^https?:\/\//i.test(url))rows.push(command('Apri collegamento','link',()=>window.open(url,'_blank','noopener,noreferrer')),command('Copia collegamento','copy',()=>navigator.clipboard.writeText(link.href)),null);}
  rows.push(null,...items({kind:'note',id:noteId}).filter(x=>x?.label!==t('Apri nota')));
  const keyboard=e.type==='keydown';menu.show(rows,{x:keyboard?undefined:e.clientX,y:keyboard?undefined:e.clientY,anchor:editing?editor:e.target.closest('#preview')||documentRoot});
 }
 documentRoot.addEventListener('contextmenu',editorMenu);
 documentRoot.addEventListener('keydown',e=>{if(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey)editorMenu(e);});
 return {perform,duplicate,undo,moveDialog,menu,interactions,apply,get busy(){return busy;}};
}
