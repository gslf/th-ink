import {pruneReminderMetadata} from './reminder-model.js';
import {noteProperties} from './note-properties.js';
import {markdown} from './core.js';
export class Storage {
 async open(name='think-v1') {
  this.db=await new Promise((resolve,reject)=>{
   const r=indexedDB.open(name,4);
   r.onupgradeneeded=()=>{
    for(const store of ['notes','folders','history','settings','filen-revisions'])if(!r.result.objectStoreNames.contains(store))r.result.createObjectStore(store,{keyPath:'id'});
    // Drop obsolete connection settings only; preserve every note, folder and revision.
    const cursor=r.transaction.objectStore('settings').openCursor();
    cursor.onsuccess=()=>{const item=cursor.result;if(!item)return;if(['device-folder','cloud-sync','cloud-client-ids'].includes(item.key)||String(item.key).startsWith('device-file:'))item.delete();item.continue();};
   };
   r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  this.db.onversionchange=()=>this.db.close();
  try{this.root=await navigator.storage.getDirectory();this.files=await this.root.getDirectoryHandle('markdown',{create:true});}catch{this.files=null;}
  return this;
 }
 async transaction(store,mode,action){return new Promise((resolve,reject)=>{let tx;try{tx=mode==='readwrite'?this.db.transaction(store,mode,{durability:'strict'}):this.db.transaction(store,mode);}catch(error){if(error instanceof TypeError)tx=this.db.transaction(store,mode);else throw error;}let value;const request=action(tx.objectStore(store));if(request)request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Salvataggio annullato'));});}
 all(store){return this.transaction(store,'readonly',s=>s.getAll());}
 get(store,id){return this.transaction(store,'readonly',s=>s.get(id));}
 put(store,value){return this.transaction(store,'readwrite',s=>s.put(structuredClone(value)));}
 remove(store,id){return this.transaction(store,'readwrite',s=>s.delete(id));}
 async saveLibraryChanges({notes=[],folders=[],mirrors=[]}){
  // One transaction prevents half-moved or half-trashed folder trees.
  await new Promise((resolve,reject)=>{
   let tx;try{tx=this.db.transaction(['notes','folders'],'readwrite',{durability:'strict'});}catch(error){if(!(error instanceof TypeError))throw error;tx=this.db.transaction(['notes','folders'],'readwrite');}
   for(const n of notes)tx.objectStore('notes').put(structuredClone(n));
   for(const f of folders)tx.objectStore('folders').put(structuredClone(f));
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Salvataggio annullato'));
  });
  for(const note of mirrors)await this.mirrorNote(note);
 }
 async saveNote(note){
  const incoming=(note.reminders||[]).map(r=>r.id);pruneReminderMetadata(note);
  const copy=structuredClone(note),kept=new Set((copy.reminders||[]).map(r=>r.id));
  // Persist the cancellation IDs atomically with the note. A crash or reload
  // cannot leave a server reminder alive after its only local reference is gone.
  await new Promise((resolve,reject)=>{
   let tx;try{tx=this.db.transaction(['notes','settings'],'readwrite',{durability:'strict'});}catch(error){if(!(error instanceof TypeError))throw error;tx=this.db.transaction(['notes','settings'],'readwrite');}const notes=tx.objectStore('notes'),settings=tx.objectStore('settings');
   const request=notes.get(copy.id);
   request.onsuccess=()=>{const previous=(request.result?.reminders||[]).map(r=>r.id);
    for(const id of new Set([...previous,...incoming]))if(!kept.has(id))settings.put({id:'reminder-deletion:'+copy.id+':'+id,value:copy.id+':'+id});
    notes.put(copy);
   };
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Salvataggio annullato'));
  });
  // IndexedDB is the atomic source of truth. OPFS is a recoverable plain Markdown mirror.
  return this.mirrorNote(copy);
 }
 async mirrorNote(note){
  if(this.files){try{const handle=await this.files.getFileHandle(`${note.id}.md`,{create:true});const writer=await handle.createWritable();await writer.write(markdown(note));await writer.close();return true;}catch{return false;}}
  return false;
 }
 async snapshot(){return new Promise((resolve,reject)=>{const names=['notes','folders','history'],tx=this.db.transaction(names,'readonly'),snapshot={};for(const name of names){const r=tx.objectStore(name).getAll();r.onsuccess=()=>snapshot[name]=r.result;}tx.oncomplete=()=>resolve(snapshot);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Backup interrotto'));});}
 async revision(note){
  const previous=await this.get('history',note.id)||{id:note.id,items:[]};
  if(previous.items.at(-1)?.body===note.body && previous.items.at(-1)?.title===note.title&&JSON.stringify(noteProperties(previous.items.at(-1)))===JSON.stringify(noteProperties(note)))return;
  previous.items.push({title:note.title,body:note.body,...noteProperties(note),at:Date.now()});
  previous.items=previous.items.slice(-30);await this.put('history',previous);
 }
}
