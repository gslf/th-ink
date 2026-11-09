import {optionalProperties} from './note-properties.js';
import {safeName} from './core.js';
const encode=new TextEncoder();
export const signature=item=>JSON.stringify(item);
export const keyOf=item=>item.kind+':'+item.id;
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encode.encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function b64(text){return btoa(Array.from(encode.encode(text),v=>String.fromCharCode(v)).join(''));}
function unb64(text){return new TextDecoder().decode(Uint8Array.from(atob(text),v=>v.charCodeAt(0)));}
export function cleanItem(value){
 if(!value||!['note','folder'].includes(value.kind)||typeof value.id!=='string'||!/^[A-Za-z0-9_-]{1,180}$/.test(value.id))throw Error('Elemento cloud non valido.');
 if(value.kind==='folder'){
  if(typeof value.name!=='string'||value.name.length>1000||value.parent!==null&&typeof value.parent!=='string')throw Error('Cartella cloud non valida.');
  return {kind:'folder',id:value.id,name:value.name,parent:value.parent};
 }
 if(typeof value.title!=='string'||typeof value.body!=='string'||value.body.length>10*1024*1024||value.folder!==null&&typeof value.folder!=='string'||!Number.isFinite(value.created)||!Number.isFinite(value.updated))throw Error('Nota cloud non valida.');
 return {kind:'note',id:value.id,title:value.title,body:value.body,folder:value.folder,created:value.created,updated:value.updated,pinned:!!value.pinned,deleted:!!value.deleted,...optionalProperties(value)};
}
export async function eventFor(item,parents=[]){
 const data={format:1,parents:[...new Set(parents)].sort(),item:cleanItem(item)};
 return {...data,revision:await digest(JSON.stringify(data))};
}
export function serializeEvent(event){
 const {revision,...data}=event;
 if(data.item.kind==='folder')return JSON.stringify(data);
 const {body,...meta}=data.item;
 return `<!-- th.ink-sync-v1 ${b64(JSON.stringify({format:1,parents:data.parents,item:meta}))} -->\n${body}`;
}
export async function parseEvent(content,revision){
 let data;
 if(content.startsWith('<!-- th.ink-sync-v1 ')){
  const end=content.indexOf(' -->\n');if(end<0)throw Error('Metadati cloud non validi.');
  data=JSON.parse(unb64(content.slice(19,end)));data.item.body=content.slice(end+5);
 }else data=JSON.parse(content);
 if(data.format!==1||!Array.isArray(data.parents)||data.parents.some(p=>!/^([a-f0-9]{64})$/.test(p)))throw Error('Formato cloud non supportato.');
 const event=await eventFor(data.item,data.parents);
 if(event.revision!==revision)throw Error('Versione cloud alterata o incompleta: sincronizzazione interrotta.');
 return event;
}
export function headsOf(index){
 const referenced=new Set(index.flatMap(e=>e.parents)),groups=new Map();
 for(const entry of index)if(!referenced.has(entry.revision)){const group=groups.get(entry.key)||[];group.push(entry.revision);groups.set(entry.key,group);}
 for(const heads of groups.values())heads.sort();return groups;
}
// Append-only revisions avoid lost writes: there is no shared mutable manifest or
// last-writer-wins overwrite. Only headers are cached locally; text stays in notes.
export class FilenSync extends EventTarget {
 constructor({db,local,apply,before=async()=>{},enabled=()=>true}){super();Object.assign(this,{db,local,apply,before,enabled});this.status='disconnected';this.lastSync=0;this.message='Non collegato';}
 notify(status,message){this.status=status;this.message=message;this.dispatchEvent(new Event('change'));}
 async attach(provider){
  const generation=this.attachGeneration=(this.attachGeneration||0)+1;
  const account=provider.account;
  const record=await this.db.get('settings','filen-state:'+account)||{id:'filen-state:'+account,baseline:{},lastSync:0};
  if(generation!==this.attachGeneration)return;this.provider=provider;this.account=account;this.record=record;
  this.lastSync=this.record.lastSync;this.notify('ready','Collegato');
 }
 async detach(){this.attachGeneration=(this.attachGeneration||0)+1;clearTimeout(this.timer);this.stopping=true;await this.running?.catch(()=>{});this.provider=null;this.stopping=false;this.notify('disconnected','Non collegato');}
 schedule(){if(!this.provider||this.stopping)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.sync().catch(()=>{}),3500);}
 async sync(){
  if(this.running)return this.running;
  if(!this.provider||this.stopping||!this.enabled())return;
  this.running=this.run().catch(e=>{this.notify(e.code==='session_expired'||['api_key_invalid','invalid_api_key'].includes(e.code)?'expired':'error',e.message||'Sincronizzazione non riuscita. Riproverò.');throw e;}).finally(()=>{this.running=null;});
  return this.running;
 }
 async run(){
  this.notify('syncing','Sincronizzazione…');await this.before();
  const provider=this.provider,account=this.account;
  const remote=new Set(await provider.list());
  const cached=(await this.db.all('filen-revisions')).filter(r=>r.account===account);
  // Missing revisions are not interpreted as note deletions. Recreate them only
  // through an explicit reconnect/recovery; never erase local text on listing loss.
  if(cached.some(r=>!remote.has(r.revision)))throw Error('Mancano versioni nella cartella Filen. Le note locali sono al sicuro; ripristina la cartella cloud prima di sincronizzare.');
  const index=new Map(cached.map(r=>[r.revision,r])),bodies=new Map();
  const remember=async event=>{
   const header={id:account+':'+event.revision,account,revision:event.revision,key:keyOf(event.item),parents:event.parents};
   await this.db.put('filen-revisions',header);index.set(event.revision,header);bodies.set(event.revision,event);
  };
  const unknown=[...remote].filter(rev=>!index.has(rev));
  // Bound concurrent decryptions/downloads to keep the editor responsive.
  for(let at=0;at<unknown.length;at+=4)await Promise.all(unknown.slice(at,at+4).map(async rev=>remember(await parseEvent(await provider.read(rev),rev))));
  for(const entry of index.values())for(const parent of entry.parents)if(!index.has(parent)||index.get(parent).key!==entry.key)throw Error('Cronologia cloud incompleta: riprova quando la connessione è stabile.');
  const get=async rev=>{if(!bodies.has(rev))bodies.set(rev,await parseEvent(await provider.read(rev),rev));return bodies.get(rev);};
  const publish=async(item,parents)=>{
   const event=await eventFor(item,parents),content=serializeEvent(event);
   if(encode.encode(content).byteLength>16*1024*1024)throw Error('Nota troppo grande per Filen (limite 16 MB). La copia locale resta salvata.');
   if(!remote.has(event.revision))await provider.write(event.revision,`${safeName(item.kind==='note'?item.title:item.name).slice(0,80)}--${event.revision}.${item.kind==='note'?'md':'json'}`,content);
   remote.add(event.revision);await remember(event);return event;
  };
  let heads=headsOf([...index.values()]);
  // Upload only edits relative to the last applied baseline. If another device
  // edited offline too, these revisions remain siblings and are recovered below.
  const observed=new Map(this.local().map(item=>[keyOf(item),item]));
  for(const item of observed.values()){
   if(this.stopping)return;
   const key=keyOf(item),base=this.record.baseline[key],current=heads.get(key)||[];
   if(base?.hash===await digest(signature(item)))continue;
   if(!base&&current.length===1&&signature((await get(current[0])).item)===signature(item))continue;
   await publish(item,base?.heads||[]);
  }
  heads=headsOf([...index.values()]);let conflicts=0;
  for(const [key,revisions] of [...heads].sort(([a],[b])=>a.localeCompare(b))){
   if(this.stopping)return;
   const local=observed.get(key),expected=local?signature(local):null;
   const base=this.record.baseline[key];
   if(base&&base.heads.join()===revisions.join()&&base.hash===await digest(expected||''))continue;
   const versions=await Promise.all(revisions.map(get));
   // Deterministic winner on every device; every distinct losing note is copied.
   const winner=versions.at(-1),seen=new Set([signature({...winner.item,id:'',updated:0})]);
   if(winner.item.kind==='note')for(const event of versions.slice(0,-1)){
    const equivalent=signature({...event.item,id:'',updated:0});if(seen.has(equivalent))continue;seen.add(equivalent);
    const copy=cleanItem({...event.item,id:'recovered-'+event.revision,title:event.item.title+' · copia recuperata',deleted:false});
    const copyKey=keyOf(copy),existing=this.local().find(n=>keyOf(n)===copyKey);
    // Never recreate an already edited/deleted recovery copy.
    if(!heads.has(copyKey)&&!this.record.baseline[copyKey]){
     const saved=await publish(copy,[]);
     if(!existing&&!await this.apply(copy,null))continue;
     this.record.baseline[copyKey]={heads:[saved.revision],hash:await digest(signature(copy))};conflicts++;
    }
   }
   let merged=winner;
   if(versions.length>1)merged=await publish(winner.item,revisions);
   // apply performs a compare-and-swap against current in-memory editor content;
   // typing during any network wait is never overwritten.
   if(await this.apply(merged.item,expected))this.record.baseline[key]={heads:[merged.revision],hash:await digest(signature(merged.item))};
  }
  this.record.lastSync=Date.now();await this.db.put('settings',this.record);this.lastSync=this.record.lastSync;
  this.notify('ready',conflicts?`${conflicts} copie recuperate: entrambe le modifiche conservate.`:'Sincronizzato');
 }
}
