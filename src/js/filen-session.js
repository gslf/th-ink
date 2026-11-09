// Passwords and 2FA codes never enter persistent storage or archive exports.
const fields=['email','apiKey','masterKeys','publicKey','privateKey','authVersion','baseFolderUUID','userId'];
export function sessionConfig(config){
 const value=Object.fromEntries(fields.map(k=>[k,structuredClone(config[k])]));
 if(!value.apiKey||!value.privateKey||!value.publicKey||!value.masterKeys?.length||!value.userId||!value.baseFolderUUID)throw Error('Sessione Filen incompleta.');
 return {...value,connectToSocket:false};
}
export class FilenSession {
 constructor(db){this.db=db;this.remembered=false;}
 async save(config){
  const value=sessionConfig(config);
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('th.ink/filen/session/v1')},key,new TextEncoder().encode(JSON.stringify(value)));
  await this.db.put('settings',{id:'filen-session-v1',key,iv,ciphertext});this.remembered=true;
 }
 async load(){
  const saved=await this.db.get('settings','filen-session-v1');if(!saved)return null;
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv,additionalData:new TextEncoder().encode('th.ink/filen/session/v1')},saved.key,saved.ciphertext);
  this.remembered=true;return sessionConfig(JSON.parse(new TextDecoder().decode(bytes)));
 }
 async clear(){await this.db.remove('settings','filen-session-v1');this.remembered=false;}
}
