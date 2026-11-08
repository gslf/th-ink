// Best-effort background request. No application UI depends on its result.
export class Persistence {
 constructor(storage=globalThis.navigator?.storage){this.storage=storage;this.status='checking';this.pending=null;}
 ensure(request=true){
  if(this.pending)return this.pending;
  this.pending=this.check(request).finally(()=>{this.pending=null;});return this.pending;
 }
 async check(request){
  try{
   if(!this.storage?.persisted||!this.storage?.persist)this.status='unsupported';
   else if(await this.storage.persisted())this.status='granted';
   else {if(request)await this.storage.persist();this.status=await this.storage.persisted()?'granted':'denied';}
  }catch{this.status='error';}
  return this.status;
 }
}
