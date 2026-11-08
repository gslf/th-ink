import test from 'node:test';
import assert from 'node:assert/strict';
import {noteProperties,normalizeEmoji,normalizeTags,propertiesHeader} from '../dist/js/note-properties.js';
import {markdown,parseMarkdown,safeName} from '../dist/js/core.js';
import {treeModel} from '../dist/js/note-tree.js';
import {cleanItem,eventFor,serializeEvent,parseEvent} from '../dist/js/filen-sync.js';
import {Storage} from '../dist/js/storage.js';
import {restoreBackup} from '../dist/js/restore-backup.js';
const n={kind:'note',id:'n1',title:'Garden',body:'A quiet thought.\n',folder:null,created:1,updated:2,pinned:false,deleted:false};
test('note properties accept compound emoji and normalize duplicate tags',()=>{
 for(const emoji of ['💡','👩🏽‍💻','👨‍👩‍👧‍👦','🇮🇹','1️⃣','❤️',''])assert.equal(normalizeEmoji(emoji),emoji);
 for(const emoji of ['hello','a💡','💡💡',42])assert.throws(()=>normalizeEmoji(emoji));
 assert.deepEqual(normalizeTags([' Work ','work','Ideas','  Daily   notes ','ＷＯＲＫ']),['Work','Ideas','Daily notes']);
 assert.throws(()=>normalizeTags(['bad,tag']));assert.throws(()=>normalizeTags(['a'.repeat(65)]));assert.throws(()=>normalizeTags('Work'));
});
test('Markdown properties round trip without changing title, body or filename',()=>{
 const note={...n,emoji:'🌿',tags:['Garden','Ideas','<x> -->']},encoded=markdown(note);
 assert.ok(encoded.startsWith('<!-- th.ink-note-v1 '));assert.equal(encoded.split('\n')[0].match(/-->/g).length,1);
 assert.deepEqual(parseMarkdown(encoded),{title:n.title,body:n.body,emoji:note.emoji,tags:note.tags});
 assert.equal(safeName(note.title)+'.md','Garden.md');
 assert.equal(markdown(n),'# Garden\n\nA quiet thought.\n');
 assert.deepEqual(parseMarkdown(markdown(n)),{title:n.title,body:n.body});
 assert.equal(propertiesHeader({...n,emoji:'',tags:[]}), '');
 assert.throws(()=>parseMarkdown('<!-- th.ink-note-v1 {broken} -->\n# Garden\n'),/Proprietà/);
});
test('tag folders group by identity, repeat references and exclude trash and untagged notes',()=>{
 const first={...n,tags:['Work','Ideas']},second={...n,id:'n2',tags:['work'],updated:3};
 const model=treeModel([first,second,{...n,id:'trash',tags:['Hidden'],deleted:true},{...n,id:'plain'}],[],'tags');
 assert.deepEqual(model.children.get(null).map(f=>f.name),['Ideas','Work']);
 assert.deepEqual(model.leaves.get('tag:work').map(n=>n.id),['n2','n1']);
 assert.equal(model.leaves.get('tag:ideas')[0],first);
 assert.equal(model.leaves.get('tag:work')[1],first);
});
test('cloud revisions preserve properties and keep old hashes when properties are empty',async()=>{
 assert.deepEqual(cleanItem({...n,emoji:'',tags:[]}),n);
 assert.equal((await eventFor(n)).revision,(await eventFor({...n,emoji:'',tags:[]})).revision);
 const event=await eventFor({...n,emoji:'💡',tags:['Ideas']});assert.deepEqual(await parseEvent(serializeEvent(event),event.revision),event);
 assert.notEqual(event.revision,(await eventFor(n)).revision);
});
test('history records metadata-only changes and backup restoration retains note and history properties',async()=>{
 const db=new Storage();let record;db.get=async()=>record;db.put=async(_store,value)=>{record=structuredClone(value);};
 await db.revision(n);await db.revision({...n,emoji:'💡',tags:['Ideas']});await db.revision({...n,emoji:'💡',tags:['Ideas']});
 assert.equal(record.items.length,2);assert.deepEqual(noteProperties(record.items[1]),{emoji:'💡',tags:['Ideas'],reminders:[]});
 const restored=restoreBackup(JSON.stringify({format:'th.ink-backup',version:1,notes:[{...n,emoji:'🌿',tags:['Garden']}],folders:[],history:[record]}));
 assert.deepEqual(noteProperties(restored.notes[0]),{emoji:'🌿',tags:['Garden'],reminders:[]});assert.deepEqual(noteProperties(restored.history[0].items[1]),{emoji:'💡',tags:['Ideas'],reminders:[]});
});
