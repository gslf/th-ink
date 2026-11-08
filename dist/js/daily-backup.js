import {zipFiles,download} from './archive.js';
import {safeName,folderPath,markdown} from './core.js';
export const localDay=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function backupArchive(snapshot,at=new Date()){
 const {notes,folders,history}=snapshot;
 const files=notes.map(n=>({path:[n.deleted?'Cestino':'Note',...folderPath(n.folder,folders).map(safeName),`${safeName(n.title)}--${n.id}.md`].join('/'),text:markdown(n)}));
 files.push({path:'th-ink-backup.json',text:JSON.stringify({format:'th.ink-backup',version:1,at:at.toISOString(),notes,folders,history})});
 files.push({path:'README.txt',text:'th.ink — local backup\n\nNote contains Markdown files; Cestino contains deleted notes.\nTo restore notes, folders, and history, extract the ZIP and import th-ink-backup.json through Preferences > Import notes (Preferenze > Importa note in the Italian interface). Restoration creates copies and does not overwrite existing notes.\nThis backup contains no passwords, Filen keys, or sign-in settings.\n'});
 return zipFiles(files);
}
async function buildArchive(snapshot,date){
 if(typeof Worker==='undefined')return backupArchive(snapshot,date);
 const worker=new Worker(new URL('./backup-worker.js',import.meta.url),{type:'module'});
 try{return await new Promise((resolve,reject)=>{worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.blob);worker.onerror=()=>reject(Error('Preparazione backup non riuscita.'));worker.postMessage({snapshot,at:date.toISOString()});});}finally{worker.terminate();}
}
export class DailyBackup extends EventTarget {
 constructor({db,before=async()=>{},send=download,now=()=>new Date()}){super();Object.assign(this,{db,before,send,now});this.config={id:'daily-backup',enabled:true,lastRequested:''};}
 async restore(){this.config={...this.config,...await this.db.get('settings','daily-backup')};}
 changed(){this.dispatchEvent(new Event('change'));}
 get due(){return this.config.enabled&&this.config.lastRequested!==localDay(this.now());}
 async enable(value){this.config.enabled=value;await this.db.put('settings',this.config);this.changed();if(value)await this.prepare();}
 invalidate(){this.blob=null;this.generation=(this.generation||0)+1;clearTimeout(this.timer);if(this.due)this.timer=setTimeout(()=>this.prepare().catch(()=>{}),1200);}
 async prepare(){
  if(this.preparing)return this.preparing;
  this.preparing=(async()=>{
   for(;;){
    await this.before();const generation=this.generation||0,snapshot=await this.db.snapshot();
    const date=this.now(),blob=await buildArchive(snapshot,date);
    if(generation===(this.generation||0)){this.blob=blob;this.day=localDay(date);this.changed();break;}
   }
  })().finally(()=>{this.preparing=null;});return this.preparing;
 }
 // Invoke synchronously from a trusted interaction, after preparing the ZIP.
 // A click requests a browser download; no browser API confirms its completion.
 request({automatic=false}={}){
  if(!this.blob||this.day!==localDay(this.now())||this.sending||automatic&&!this.due)return false;
  this.send(this.blob,`th-ink-backup-${this.day}.zip`);
  this.config.lastRequested=this.day;this.sending=true;
  this.db.put('settings',this.config).catch(()=>{this.config.lastRequested='';}).finally(()=>{this.sending=false;this.changed();});return true;
 }
}
