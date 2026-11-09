import {defaultPublishConfig,validatePublishConfig,selectPublishedNotes} from './publish-model.js';
export class Publisher extends EventTarget {
 constructor({db,before,snapshot,enabled}){super();Object.assign(this,{db,before,snapshot,enabled});this.config={...defaultPublishConfig};this.busy=false;this.message='Scegli una cartella e crea il tuo journal.';this.result=null;}
 notify(message){this.message=message;this.dispatchEvent(new Event('change'));}
 async restore(){
  const saved=(await this.db.get('settings','publish-config'))?.value||{};
  this.config=Object.fromEntries(Object.entries(defaultPublishConfig).map(([key,value])=>[key,saved[key]??value]));
  const legacyTitle=saved.title==='Journal'&&!saved.titleChosen;if(legacyTitle)this.config.title='';
  this.previous=(await this.db.get('settings','publish-routes'))?.value||{};
  // Drop obsolete filesystem permissions; exports never write to a chosen folder.
  await this.db.remove('settings','publish-directory');
  if(Object.hasOwn(saved,'automatic')||legacyTitle)await this.db.put('settings',{id:'publish-config',value:{...this.config,...(saved.titleChosen?{titleChosen:true}:{})}});
 }
 async configure(config){if(this.busy)throw Error('Attendi la fine della generazione.');const next=validatePublishConfig(config);await this.db.put('settings',{id:'publish-config',value:{...next,titleChosen:true}});this.config=next;}
 async generate(){
  if(this.busy)throw Error('Attendi la fine della generazione.');if(!this.enabled())throw Error('Archivio in sola lettura.');
  this.busy=true;this.notify('Generazione del sito…');
  try{
   const config=validatePublishConfig(this.config);await this.before();const snapshot=this.snapshot(),notes=selectPublishedNotes(snapshot.notes,snapshot.folders,config.folder);
   this.assets??=Promise.all(['site.css','site.js','code.css','favicon.svg'].map(async name=>{const r=await fetch(new URL('../assets/publish/'+name,import.meta.url));if(!r.ok)throw Error('Risorse del sito non disponibili. Riprova online.');return [name,await r.text()];})).then(Object.fromEntries).catch(e=>{this.assets=null;throw e;});
   const assets=await this.assets;
   const result=await new Promise((resolve,reject)=>{
    this.worker??=new Worker(new URL('./publish-worker.js',import.meta.url),{type:'module'});
    this.worker.onmessage=({data})=>{if(data.stage){this.notify('Preparazione dello ZIP…');return;}data.error?reject(Error(data.error)):resolve(data.result);};
    this.worker.onerror=()=>{this.worker.terminate();this.worker=null;reject(Error('Generazione non riuscita. Riprova.'));};
    this.worker.postMessage({notes,config,previous:this.previous,assets});
   });
   this.previous=result.manifest;await this.db.put('settings',{id:'publish-routes',value:result.manifest});this.result={count:result.count,warnings:result.warnings};
   this.notify('ZIP pronto. Carica manualmente i file sul server.');return result.blob;
  }catch(error){this.notify(error.message);throw error;}finally{this.busy=false;this.dispatchEvent(new Event('change'));}
 }
}
