// Reminder metadata travels with Markdown exports, backups and Filen revisions.
export const reminderId=/^[a-zA-Z0-9_-]{1,64}$/;
export function normalizeReminders(values=[]){
 if(!Array.isArray(values)||values.length>32)throw Error('Massimo 32 reminder per nota.');
 const seen=new Set();return values.map(r=>{
  if(!r||!reminderId.test(r.id)||seen.has(r.id))throw Error('Reminder non valido.');seen.add(r.id);
  const at=new Date(r.at);if(!Number.isFinite(+at)||at.getUTCFullYear()<2000||at.getUTCFullYear()>2100)throw Error('Data non valida.');
  const zone=String(r.zone||'UTC');try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{throw Error('Fuso orario non valido.');}
  if(!['none','daily','weekdays','weekly','monthly','yearly'].includes(r.repeat)||!Number.isInteger(r.interval)||r.interval<1||r.interval>99)throw Error('Ricorrenza non valida.');
  const text=String(r.text||'').trim();if(!text||text.length>240)throw Error('Inserisci un testo fino a 240 caratteri.');
  const until=r.until?new Date(r.until):null;if(until&&(!Number.isFinite(+until)||+until<+at))throw Error('La fine deve seguire la data del reminder.');
  const snooze=r.snooze?new Date(r.snooze):null;if(snooze&&!Number.isFinite(+snooze))throw Error('Data non valida.');
  return {id:r.id,text,at:at.toISOString(),zone,repeat:r.repeat,interval:r.interval,until:until?.toISOString()||'',done:!!r.done,snooze:snooze?.toISOString()||''};
 });
}
export function reminderMarkers(body){
 const result=new Map();let offset=0,fence=null;
 for(const line of body.split('\n')){
  const f=line.match(/^\s*(`{3,}|~{3,})/);if(f){if(!fence)fence=f[1][0];else if(fence===f[1][0])fence=null;offset+=line.length+1;continue;}
  if(!fence&&(!/^( {4}|\t)/.test(line)||/^\s*(?:[-+*]|\d+[.)]) /.test(line))){
   const code=/(`+)[\s\S]*?\1/g;const spans=[...line.matchAll(code)].map(m=>[m.index,m.index+m[0].length]);
   for(const m of line.matchAll(/\[[^\]\n]+\]\(reminder:([a-zA-Z0-9_-]{1,64})\)/g))if(!spans.some(([a,b])=>m.index>=a&&m.index<b)&&!result.has(m[1]))result.set(m[1],{from:offset+m.index,to:offset+m.index+m[0].length});
  }offset+=line.length+1;
 }return result;
}
// Remove properties only when their reference is gone. Moving a reference into
// a code example pauses it; deleting the reference removes the properties.
export function pruneReminderMetadata(note){
 if(!note.reminders?.length)return [];
 const removed=note.reminders.filter(r=>!note.body.includes('(reminder:'+r.id+')'));
 if(removed.length)note.reminders=note.reminders.filter(r=>!removed.includes(r));
 return removed.map(r=>r.id);
}
export function freshRestoredReminders(saved,current){
 const restored=structuredClone(saved),present=new Set((current.reminders||[]).map(r=>r.id));
 for(const r of restored.reminders||[])if(!present.has(r.id)){
  const id=crypto.randomUUID();restored.body=restored.body.split('(reminder:'+r.id+')').join('(reminder:'+id+')');r.id=id;
 }
 return restored;
}
export const reminderLink=r=>`[${r.text.replace(/[\[\]\r\n]/g,' ')}](reminder:${r.id})`;
export class ReminderIndex{
 constructor(){this.notes=new Map();this.rows=new Map();this.version=0;}
 upsert(n){
  const rs=normalizeReminders(n.reminders),old=this.notes.get(n.id);
  if(!rs.length&&!old)return false;
  const markers=reminderMarkers(n.body),signature=JSON.stringify([n.deleted,n.title,rs,[...markers.keys()]]);
  if(old?.signature===signature){old.updated=n.updated;old.markers=markers;return false;}
  for(const r of old?.reminders||[])this.rows.delete(n.id+':'+r.id);
  const entry={id:n.id,title:n.title,updated:n.updated,deleted:!!n.deleted,reminders:rs,markers,signature};this.notes.set(n.id,entry);
  for(const r of rs)if(!n.deleted&&markers.has(r.id))this.rows.set(n.id+':'+r.id,{...r,noteId:n.id,title:n.title});
  this.version++;return true;
 }
 payload(id){const n=this.notes.get(id);return {id:n.id,title:n.title.slice(0,200),updated:n.updated,reminders:n.reminders.map(r=>({...r,active:!n.deleted&&n.markers.has(r.id)}))};}
}
