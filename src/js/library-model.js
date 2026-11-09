// Library operations describe metadata patches, never replacements of note text.
// Trash groups let restoring a folder leave previously trashed items untouched.
export function libraryIndex(notes,folders){
 const noteById=new Map(notes.map(n=>[n.id,n])),folderById=new Map(folders.map(f=>[f.id,f])),children=new Map();
 for(const f of folders){if(!children.has(f.parent))children.set(f.parent,[]);children.get(f.parent).push(f.id);}
 return {noteById,folderById,children};
}
export function descendants(index,id){const result=new Set(),pending=[id];while(pending.length){const next=pending.pop();if(result.has(next))continue;result.add(next);pending.push(...index.children.get(next)||[]);}return result;}
export function validateMove(index,source,parent){
 const item=(source.kind==='folder'?index.folderById:index.noteById).get(source.id);
 if(!item)throw Error('Elemento non disponibile.');
 if(parent&&!index.folderById.has(parent)||parent&&index.folderById.get(parent).deleted)throw Error('Scegli una cartella disponibile.');
 if(source.kind==='folder'){
  let at=parent;const seen=new Set();while(at){if(at===source.id||seen.has(at))throw Error('Una cartella non può contenere sé stessa.');seen.add(at);at=index.folderById.get(at)?.parent;}
  if([...index.folderById.values()].some(f=>f.id!==item.id&&!f.deleted&&f.parent===parent&&f.name.normalize('NFKC').toLowerCase()===item.name.normalize('NFKC').toLowerCase()))throw Error('Esiste già una cartella con questo nome.');
 }
 return item;
}
export function libraryPlan(notes,folders,source,action,parent=null){
 const index=libraryIndex(notes,folders),item=(source.kind==='folder'?index.folderById:index.noteById).get(source.id);
 if(!item)throw Error('Elemento non disponibile.');
 const changes=[];
 const patch=(kind,value,fields)=>{const before={},after={};for(const [key,next] of Object.entries(fields)){const previous=value[key]??(key==='deleted'?false:null);if(JSON.stringify(previous)===JSON.stringify(next))continue;before[key]=previous;after[key]=next;}if(Object.keys(after).length)changes.push({kind,id:value.id,before,after});};
 if(action==='trash'){
  if(item.deleted)return changes;
  const group=source.kind==='folder'?source.id:null,ids=source.kind==='folder'?descendants(index,source.id):new Set();
  for(const id of ids){const f=index.folderById.get(id);if(!f.deleted)patch('folder',f,{deleted:true,trashGroup:group});}
  for(const n of notes)if(!n.deleted&&(source.kind==='note'?n.id===source.id:ids.has(n.folder)))patch('note',n,{deleted:true,trashGroup:group});
 }else if(action==='move'||action==='restore'){
  if(action==='restore'){parent=source.kind==='folder'?item.parent:item.folder;if(parent&&index.folderById.get(parent)?.deleted)parent=null;}
  validateMove(index,source,parent);
  patch(source.kind,item,{[source.kind==='folder'?'parent':'folder']:parent,deleted:false,trashGroup:null});
  if(source.kind==='folder'&&item.deleted){
   const ids=descendants(index,item.id),group=item.trashGroup||item.id;
   for(const id of ids){const f=index.folderById.get(id);if(f.deleted&&f.trashGroup===group)patch('folder',f,{deleted:false,trashGroup:null});}
   for(const n of notes)if(ids.has(n.folder)&&n.deleted&&n.trashGroup===group)patch('note',n,{deleted:false,trashGroup:null});
  }
 }else throw Error('Operazione non disponibile.');
 // Merge a root's move and restoration into one patch.
 const merged=new Map();for(const c of changes){const key=c.kind+':'+c.id,old=merged.get(key);if(old){Object.assign(old.after,c.after);for(const k in c.before)if(!(k in old.before))old.before[k]=c.before[k];}else merged.set(key,c);}return [...merged.values()];
}
