import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TagIndex} from '../src/js/tag-index.js';
import {treeModel} from '../src/js/note-tree.js';
import {normalizeEmoji} from '../src/js/note-properties.js';
const note=(id,tags)=>({id,title:id,tags,updated:1});
test('incremental tags preserve memberships, counts, caches and deletions',()=>{
 const index=new TagIndex(),a=note('a',['Ideas','Work','ideas']),b={...note('b',['work']),pinned:true};index.upsert(a);index.upsert(b);
 assert.equal(index.active,2);assert.equal(index.pinned,1);assert.equal(index.groups.size,2);assert.equal(index.groups.get('work').members.size,2);
 const ideas=index.groups.get('ideas'),ordered=index.ordered('en'),cached=index.members(ideas,'title','en');
 assert.equal(index.upsert(a),false);b.title='renamed';b.updated++;index.upsert(b);assert.equal(index.ordered('en'),ordered);assert.equal(index.members(ideas,'title','en'),cached);
 a.tags=['Garden'];index.upsert(a);assert.equal(index.groups.has('ideas'),false);assert.equal(index.groups.get('work').members.size,1);
 b.deleted=true;index.upsert(b);assert.equal(index.groups.has('work'),false);assert.equal(index.active,1);assert.equal(index.pinned,0);
 b.deleted=false;index.upsert(b);assert.equal(index.active,2);assert.equal(index.pinned,1);
});
test('incremental tags match a fresh tree model after mixed mutations',()=>{
 const index=new TagIndex(),notes=Array.from({length:500},(_,i)=>note(String(i),['All','Group '+i%17]));for(const n of notes)index.upsert(n);
 for(let i=0;i<notes.length;i+=3){const n=notes[i];n.deleted=i%2===0;n.tags=['Other','Group '+i%7];n.title='Z '+i;n.updated=1000-i;index.upsert(n);}
 const model=treeModel(notes,[],'tags','updated');for(const group of index.ordered('en-US'))assert.deepEqual(new Set(index.members(group,'updated','en-US').map(n=>n.id)),new Set(model.leaves.get(group.id).map(n=>n.id)));
 assert.equal(index.groups.size,model.children.get(null).length);
});
test('local emoji catalogs include all categories, bilingual keywords and valid compound emoji',()=>{
 for(const locale of ['en','it']){const data=JSON.parse(readFileSync(`dist/assets/emoji/${locale}.json`));assert.equal(data.groups.length,9);assert.ok(data.entries.length>1900);for(const e of data.entries){assert.equal(normalizeEmoji(e.emoji),e.emoji);for(const skin of e.skins)assert.equal(normalizeEmoji(skin.emoji),skin.emoji);}assert.match(data.entries.find(e=>e.emoji==='💡').label,locale==='it'?/lampadina/:/light bulb/);}
});
