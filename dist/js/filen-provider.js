export async function createFilen(config){
 const {FilenSDK,APIClientDefaults}=await import('../vendor/filen/sdk.js');
 Object.assign(APIClientDefaults,{gatewayTimeout:15000,egestTimeout:30000,ingestTimeout:30000,maxRetries:2,retryTimeout:750});
 return new FilenSDK({...config,connectToSocket:false});
}
export class FilenProvider {
 constructor(sdk){this.sdk=sdk;this.account=String(sdk.config.userId);this.files=new Map();}
 async connect(){
  if(!await this.sdk.user().checkAPIKeyValidity()){const e=Error('Accedi di nuovo a Filen.');e.code='session_expired';throw e;}
  // A separate format directory prevents old experimental archives being misread.
  const root=await this.sdk.cloud().createDirectory({parent:this.sdk.config.baseFolderUUID,name:'th.ink'});
  this.root=await this.sdk.cloud().createDirectory({parent:root,name:'revisioni-v1'});
 }
 async list(){
  if(!this.root)await this.connect();
  const items=await this.sdk.cloud().listDirectory({uuid:this.root});
  this.files=new Map();
  for(const file of items){const match=file.type==='file'&&file.name.match(/--([a-f0-9]{64})\.(md|json)$/);if(match)this.files.set(match[1],file);}
  return [...this.files.keys()];
 }
 async read(revision){
  const file=this.files.get(revision);if(!file)throw Error('Versione cloud non disponibile: riprova.');
  if(file.size>16*1024*1024)throw Error('Nota cloud troppo grande (limite 16 MB).');
  const reader=this.sdk.cloud().downloadFileToReadableStream(file).getReader(),parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16*1024*1024)throw Error('Nota cloud troppo grande.');parts.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  return new Blob(parts).text();
 }
 async write(revision,name,content){
  if(this.files.has(revision))return;
  const file=await this.sdk.cloud().uploadWebFile({parent:this.root,name,file:new File([content],name,{type:name.endsWith('.md')?'text/markdown':'application/json'})});
  this.files.set(revision,file);
 }
}
