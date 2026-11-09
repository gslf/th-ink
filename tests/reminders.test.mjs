import test from 'node:test';
import assert from 'node:assert/strict';
import {ReminderIndex,pruneReminderMetadata,freshRestoredReminders,normalizeReminders,reminderMarkers,reminderLink} from '../src/js/reminder-model.js';
import {markdown,parseMarkdown,renderMarkdown} from '../src/js/core.js';
import {cleanItem,eventFor,serializeEvent,parseEvent} from '../src/js/filen-sync.js';
const r={id:'reminder-1',text:'Call Alice',at:'2026-11-10T09:00:00.000Z',zone:'Europe/Rome',repeat:'weekly',interval:2,until:'',done:false,snooze:''};
const n={id:'note-1',title:'Work',body:reminderLink(r),reminders:[r],updated:100,created:100,deleted:false,pinned:false,folder:null};
test('reminders survive Markdown, cloud serialization and safe rendering',async()=>{
 const decoded=parseMarkdown(markdown(n));assert.deepEqual(decoded.reminders,[r]);assert.equal(decoded.body,n.body);
 const event=await eventFor(cleanItem({...n,kind:'note'}));const restored=await parseEvent(serializeEvent(event),event.revision);assert.deepEqual(restored.item.reminders,[r]);
 const html=renderMarkdown(n.body);assert.match(html,/data-reminder="reminder-1"/);assert.match(html,/<svg/);assert(!html.includes('href="reminder:'));
 assert(!renderMarkdown('[unsafe](reminder:\"><img src=x>)').includes('<img'));
});
test('reminder index ignores examples in code and updates only affected notes',()=>{
 const index=new ReminderIndex();assert(index.upsert(n));assert.equal(index.rows.size,1);assert(!index.upsert({...n,updated:101}));
 index.upsert({...n,body:'```md\n'+n.body+'\n```',updated:102});assert.equal(index.rows.size,0);assert.equal(index.payload(n.id).reminders[0].active,false);
 index.upsert({...n,body:'`'+n.body+'`'});assert.equal(index.rows.size,0);
 index.upsert({...n,body:'    '+n.body});assert.equal(index.rows.size,0);
 index.upsert({...n,body:'- Parent\n    + '+n.body});assert.equal(index.rows.size,1);
 index.upsert({...n,body:'Intro\n'+n.body});assert.equal(index.notes.get(n.id).markers.get(r.id).from,6);
 index.upsert({...n,deleted:true});assert.equal(index.rows.size,0);
 index.upsert({...n,reminders:[]});assert.deepEqual(index.payload(n.id).reminders,[]);
});
test('reminders reject malformed metadata and duplicate IDs',()=>{
 for(const change of [{id:'../x'},{at:'oops'},{zone:'not/a/zone'},{repeat:'hourly'},{interval:0},{text:''},{until:'2020-01-01'}])assert.throws(()=>normalizeReminders([{...r,...change}]));
 assert.throws(()=>normalizeReminders([r,r]));assert.equal(reminderMarkers(n.body+'\n'+n.body).size,1);
});
test('large note archives only retain notes with reminders in the index',()=>{
 const index=new ReminderIndex();for(let i=0;i<50000;i++)index.upsert({id:'plain-'+i,title:'Plain',body:'Some text',updated:100});assert.equal(index.notes.size,0);
 for(let i=0;i<2000;i++)index.upsert({...n,id:'with-'+i});assert.equal(index.rows.size,2000);assert.equal(index.upsert({...n,id:'with-3',updated:300}),false);
});

test('deleting a reference prunes hidden properties and Markdown exports',()=>{
 const removed={...structuredClone(n),body:'Only regular text.'};assert.deepEqual(pruneReminderMetadata(removed),[r.id]);assert.deepEqual(removed.reminders,[]);assert(!markdown({...n,body:'No marker'}).includes('th.ink-note-v1'));
 const kept=structuredClone(n);assert.deepEqual(pruneReminderMetadata(kept),[]);assert.equal(kept.reminders.length,1);
 const partial={...structuredClone(n),body:'[](reminder:'+r.id+')'};assert.deepEqual(pruneReminderMetadata(partial),[],'Editing the label must not erase the schedule');
});
test('explicit restoration gives removed reminders new identities and preserves existing ones',()=>{
 const saved=freshRestoredReminders(n,{reminders:[]});assert.notEqual(saved.reminders[0].id,r.id);assert(saved.body.includes(saved.reminders[0].id));assert(!saved.body.includes('(reminder:'+r.id+')'));
 assert.equal(freshRestoredReminders(n,n).reminders[0].id,r.id);
});
