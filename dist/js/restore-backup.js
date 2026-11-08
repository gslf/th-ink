import {noteProperties} from './note-properties.js';
import {cleanItem} from './filen-sync.js';
export function restoreBackup(text){
 if(text.length>100*1024*1024)throw Error('Backup troppo grande (massimo 100 MB).');
 const data=JSON.parse(text);
 if(data.format!=='th.ink-backup'||data.version!==1||!Array.isArray(data.notes)||!Array.isArray(data.folders)||!Array.isArray(data.history))throw Error('Questo file non è un backup di th.ink.');
 const folders=data.folders.map(f=>cleanItem({...f,kind:'folder',parent:f.parent||null})),notes=data.notes.map(n=>cleanItem({...n,kind:'note',folder:n.folder||null}));
 const ids=new Map(folders.map(f=>[f.id,crypto.randomUUID()])),noteIds=new Map(notes.map(n=>[n.id,crypto.randomUUID()]));
 if(ids.size!==folders.length||noteIds.size!==notes.length)throw Error('Backup con identificativi duplicati.');
 for(const f of folders){const seen=new Set([f.id]);let parent=f.parent;while(parent){if(seen.has(parent)||!ids.has(parent))throw Error('Struttura cartelle del backup non valida.');seen.add(parent);parent=folders.find(f=>f.id===parent).parent;}}
 for(const n of notes)if(n.folder&&!ids.has(n.folder))throw Error('Cartella della nota non presente nel backup.');
 const history=data.history.filter(h=>noteIds.has(h.id)).map(h=>{if(!Array.isArray(h.items)||h.items.some(i=>typeof i.title!=='string'||typeof i.body!=='string'||!Number.isFinite(i.at)))throw Error('Cronologia del backup non valida.');return {id:noteIds.get(h.id),items:h.items.slice(-30).map(i=>({...i,...noteProperties(i)}))};});
 return {folders:folders.map(({kind,...f})=>({...f,id:ids.get(f.id),parent:ids.get(f.parent)||null})),notes:notes.map(({kind,...n})=>({...n,id:noteIds.get(n.id),folder:ids.get(n.folder)||null})),history};
}
