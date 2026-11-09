import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryPlan,libraryIndex,validateMove} from '../src/js/library-model.js';
import {treeModel} from '../src/js/note-tree.js';
import {cleanItem} from '../src/js/filen-sync.js';
import {restoreBackup} from '../src/js/restore-backup.js';
import {renderMarkdown} from '../src/js/core.js';
const fixture=()=>({folders:[{id:'a',name:'A',parent:null},{id:'b',name:'B',parent:'a'},{id:'c',name:'C',parent:'b'},{id:'d',name:'D',parent:null}],notes:[{id:'n',title:'N',body:'Keep this text',folder:'c',created:1,updated:1,deleted:false},{id:'old',title:'Old',body:'Already in trash',folder:'b',created:1,updated:1,deleted:true}]});
const apply=(data,changes)=>{for(const c of changes)Object.assign((c.kind==='folder'?data.folders:data.notes).find(x=>x.id===c.id),c.after);};
test('folder moves reject cycles, descendants, missing and trashed targets',()=>{
 const data=fixture(),index=libraryIndex(data.notes,data.folders);
 for(const parent of ['a','b','c','missing'])assert.throws(()=>validateMove(index,{kind:'folder',id:'a'},parent));
 assert.equal(validateMove(index,{kind:'folder',id:'b'},'d').id,'b');
 data.folders[3].deleted=true;assert.throws(()=>validateMove(index,{kind:'note',id:'n'},'d'));
});
test('moving at the same level is a no-op and never renames a note',()=>{
 const data=fixture();assert.deepEqual(libraryPlan(data.notes,data.folders,{kind:'note',id:'n'},'move','c'),[]);
 const patches=libraryPlan(data.notes,data.folders,{kind:'note',id:'n'},'move',null);apply(data,patches);assert.equal(data.notes[0].folder,null);assert.equal(data.notes[0].title,'N');assert.equal(data.notes[0].body,'Keep this text');
});
test('trash and restore a folder recursively without reviving previously trashed notes',()=>{
 const data=fixture(),source={kind:'folder',id:'a'};apply(data,libraryPlan(data.notes,data.folders,source,'trash'));
 assert(data.folders.slice(0,3).every(f=>f.deleted));assert(data.notes.every(n=>n.deleted));assert(!data.folders[3].deleted);
 assert(!treeModel(data.notes,data.folders).children.get(null).some(f=>f.id==='a'));
 apply(data,libraryPlan(data.notes,data.folders,source,'restore'));
 assert(data.folders.slice(0,3).every(f=>!f.deleted));assert(!data.notes[0].deleted);assert(data.notes[1].deleted);
});
test('restoring one child from a deleted folder moves it safely to the root',()=>{
 const data=fixture();apply(data,libraryPlan(data.notes,data.folders,{kind:'folder',id:'a'},'trash'));
 apply(data,libraryPlan(data.notes,data.folders,{kind:'note',id:'n'},'restore'));assert.equal(data.notes[0].folder,null);assert.equal(data.notes[0].deleted,false);assert(data.folders[0].deleted);
});
test('moving a trashed subtree restores only its own group and preserves parent changes',()=>{
 const data=fixture();apply(data,libraryPlan(data.notes,data.folders,{kind:'folder',id:'a'},'trash'));
 apply(data,libraryPlan(data.notes,data.folders,{kind:'folder',id:'b'},'move','d'));assert.equal(data.folders[1].parent,'d');assert(!data.folders[2].deleted);assert(!data.notes[0].deleted);assert(data.folders[0].deleted);assert(data.notes[1].deleted);
});
test('empty deleted folders are visible in trash and excluded from the archive',()=>{
 const data=fixture();apply(data,libraryPlan(data.notes,data.folders,{kind:'folder',id:'d'},'trash'));
 assert(treeModel(data.notes,data.folders,'trash').children.get(null).some(f=>f.id==='d'));
 assert(!treeModel(data.notes,data.folders).children.get(null).some(f=>f.id==='d'));
});
test('trash metadata survives cloud cleaning and backup ID remapping',()=>{
 const data=fixture();apply(data,libraryPlan(data.notes,data.folders,{kind:'folder',id:'a'},'trash'));
 const folder=cleanItem({...data.folders[0],kind:'folder'});assert.equal(folder.deleted,true);assert.equal(folder.trashGroup,'a');
 const restored=restoreBackup(JSON.stringify({format:'th.ink-backup',version:1,...data,history:[]}));const a=restored.folders.find(f=>f.name==='A');assert.equal(a.trashGroup,a.id);assert.equal(restored.notes.find(n=>n.title==='N').trashGroup,a.id);
 assert.throws(()=>cleanItem({...folder,trashGroup:'bad/path'}));
});
test('conflicting folder names are rejected without changing data',()=>{
 const data=fixture();data.folders.push({id:'other',name:'B',parent:'d'});assert.throws(()=>libraryPlan(data.notes,data.folders,{kind:'folder',id:'b'},'move','d'));assert.equal(data.folders[1].parent,'a');
});
test('dragged note links render safely and survive archive ID remapping',()=>{
 const data=fixture();data.notes[0].body='[Old](note:old)';
 assert.match(renderMarkdown(data.notes[0].body),/data-note-link="old"/);
 assert(!renderMarkdown('[bad](note:bad" onclick="alert) ').includes('data-note-link'));
 const restored=restoreBackup(JSON.stringify({format:'th.ink-backup',version:1,...data,history:[]}));
 assert.equal(restored.notes.find(n=>n.title==='N').body,'[Old](note:'+restored.notes.find(n=>n.title==='Old').id+')');
});
