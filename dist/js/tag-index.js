import {normalizeTags,tagKey} from './note-properties.js';
// Membership changes touch only the affected note and its old/new tags.
export class TagIndex {
 constructor(){this.notes=new Map();this.groups=new Map();this.active=0;this.pinned=0;this.version=0;this.groupCache=null;}
 upsert(note){
  const old=this.notes.get(note.id),raw=JSON.stringify(note.tags||[]),keys=old?.raw===raw?old.keys:normalizeTags(note.tags).map(name=>[tagKey(name),name]);
  const next={raw,keys,deleted:!!note.deleted,pinned:!!note.pinned,title:note.title,updated:note.updated,emoji:note.emoji};
  if(old&&old.raw===raw&&old.deleted===next.deleted&&old.pinned===next.pinned&&old.title===next.title&&old.updated===next.updated&&old.emoji===next.emoji)return false;
  if(old&&!old.deleted){this.active--;if(old.pinned)this.pinned--;}
  if(!next.deleted){this.active++;if(next.pinned)this.pinned++;}
  const wanted=new Set(next.deleted?[]:keys.map(([key])=>key));
  if(old&&!old.deleted)for(const [key] of old.keys)if(!wanted.has(key)){const group=this.groups.get(key);group.members.delete(note.id);group.cache=null;if(!group.members.size){this.groups.delete(key);this.groupCache=null;}}
  if(!next.deleted)for(const [key,name] of keys){let group=this.groups.get(key);if(!group){group={id:'tag:'+encodeURIComponent(key),key,name,tag:true,members:new Map(),cache:null};this.groups.set(key,group);this.groupCache=null;}group.members.set(note.id,note);group.cache=null;}
  this.notes.set(note.id,next);this.version++;return true;
 }
 compare(locale){if(this.collator?.locale!==locale)this.collator={locale,compare:new Intl.Collator(locale).compare};return this.collator.compare;}
 ordered(locale){if(!this.groupCache||this.groupCache.locale!==locale){const compare=this.compare(locale);this.groupCache={locale,values:[...this.groups.values()].sort((a,b)=>compare(a.name,b.name))};}return this.groupCache.values;}
 members(group,sort,locale){if(!group.cache||group.cache.sort!==sort||group.cache.locale!==locale){const compare=this.compare(locale);group.cache={sort,locale,values:[...group.members.values()].sort(sort==='title'?(a,b)=>compare(a.title,b.title)||a.id.localeCompare(b.id):(a,b)=>b.updated-a.updated||a.id.localeCompare(b.id))};}return group.cache.values;}
 suggestions(locale,limit=12){return this.ordered(locale).slice(0,limit).map(g=>g.name);}
}
