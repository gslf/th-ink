export const noteFonts=[
 {id:'georgia',label:'Georgia',family:"Georgia, 'Times New Roman', serif"},
 {id:'system',label:'System Sans',family:"-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"},
 {id:'arial',label:'Arial',family:'Arial, Helvetica, sans-serif'},
 {id:'times',label:'Times New Roman',family:"'Times New Roman', Times, serif"},
 {id:'mono',label:'System Mono',family:"ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace"},
 {id:'courier',label:'Courier New',family:"'Courier New', Courier, 'Liberation Mono', monospace"}
];
export const noteSizes=[14,15,16,17,18,19,20,22,24];
export const defaultNoteSize=19;
export class NoteFont {
 constructor({db,root,onChange=()=>{}}){Object.assign(this,{db,root,onChange});this.preference='georgia';this.size=defaultNoteSize;this.queue=Promise.resolve();}
 async restore(){await this.setSize((await this.db.get('settings','note-font-size'))?.value,{persist:false});return this.set((await this.db.get('settings','note-font'))?.value,{persist:false});}
 async set(value,{persist=true}={}){
  const font=noteFonts.find(f=>f.id===value)||noteFonts[0];
  // Persist before applying, serialize rapid changes, and leave the old choice on failure.
  const change=async()=>{if(persist)await this.db.put('settings',{id:'note-font',value:font.id});this.preference=font.id;this.root.style.setProperty('--note-font',font.family);this.onChange();};
  this.queue=this.queue.catch(()=>{}).then(change);return this.queue;
 }
 async setSize(value,{persist=true}={}){
  const size=noteSizes.includes(Number(value))?Number(value):defaultNoteSize;
  const change=async()=>{if(persist)await this.db.put('settings',{id:'note-font-size',value:size});this.size=size;this.root.style.setProperty('--note-size',size+'px');this.onChange();};
  this.queue=this.queue.catch(()=>{}).then(change);return this.queue;
 }
}
