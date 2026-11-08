// Installation is the only setup notice. Dismissal lasts for this app opening.
export class SetupPrompts extends EventTarget {
 constructor({installed=false}={}){super();this.installed=installed;this.installEvent=null;this.dismissed=new Set();this.busy=false;}
 changed(){this.dispatchEvent(new Event('change'));}
 get next(){
  if(!this.installed&&!this.dismissed.has('install'))return 'install';
  return null;
 }
 dismiss(kind){this.dismissed.add(kind);this.changed();}
 setInstalled(value){this.installed=value;if(value)this.installEvent=null;this.changed();}
 offer(event){this.installEvent=event;this.changed();}
 async install(){
  if(this.installed)return 'installed';
  if(!this.installEvent)return 'manual';
  const event=this.installEvent;this.installEvent=null;
  // prompt() is called directly from the click, while user activation is available.
  await event.prompt();const choice=await event.userChoice;
  if(choice?.outcome==='accepted'){this.dismiss('install');return 'accepted';}
  this.dismiss('install');return 'dismissed';
 }
}
