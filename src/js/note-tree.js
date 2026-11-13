import {TagTree} from './tag-tree.js';
import {normalizeTags,tagKey} from './note-properties.js';
import {t, getLocale} from './i18n.js';
import {icon} from './icons.js';
import {treeControls} from './tree-controls.js';
// One index per render; children are built only for expanded branches.
export function treeModel(notes,folders,filter='all',sort='updated'){
 if(filter==='tags'){
  const groups=new Map();for(const n of notes){if(n.deleted)continue;for(const name of normalizeTags(n.tags)){const id='tag:'+encodeURIComponent(tagKey(name));if(!groups.has(id))groups.set(id,{id,name,tag:true,notes:[]});groups.get(id).notes.push(n);}}
  const branches=[...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,getLocale()));
  return {children:new Map([[null,branches]]),leaves:new Map(branches.map(g=>[g.id,g.notes.sort((a,b)=>sort==='title'?a.title.localeCompare(b.title,getLocale()):b.updated-a.updated)]))};
 }
 const compare=new Intl.Collator(getLocale()).compare;
 folders=folders.filter(f=>filter==='trash'||!f.deleted);
 const byId=new Map(folders.map(f=>[f.id,f])),children=new Map(),leaves=new Map(),included=new Set();
 const add=(map,key,value)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(value);};
 for(const n of notes){if(filter==='trash'?!n.deleted:n.deleted||filter==='pinned'&&!n.pinned)continue;const parent=byId.has(n.folder)?n.folder:null;add(leaves,parent,n);let id=parent;const seen=new Set();while(id&&byId.has(id)&&!seen.has(id)){seen.add(id);included.add(id);id=byId.get(id).parent;}}
 if(filter==='trash')for(const f of folders)if(f.deleted){let id=f.id;const seen=new Set();while(id&&byId.has(id)&&!seen.has(id)){seen.add(id);included.add(id);id=byId.get(id).parent;}}
 for(const f of folders)if(!['pinned','trash'].includes(filter)||included.has(f.id))add(children,byId.has(f.parent)?f.parent:null,f);
 for(const list of children.values())list.sort((a,b)=>compare(a.name,b.name));
 for(const list of leaves.values())list.sort((a,b)=>sort==='title'?compare(a.title,b.title):b.updated-a.updated);
 return {children,leaves};
}
export class NoteTree {
 constructor(root,{open,choose,save}){this.root=root;this.open=open;this.choose=choose;this.save=save;this.collapsed=new Set();
 this.tags=new TagTree(root,{open,toggle:item=>this.toggle(item)});
 root.addEventListener('click',e=>{if(e.target.closest('button'))return;if(this.tags.enabled)return this.tags.click(e);const item=e.target.closest('[role=treeitem]');if(!item)return;this.focus(item);this.activate(item);});
 root.addEventListener('keydown',e=>this.tags.enabled?this.tags.key(e):this.key(e));
 }
 items(){return [...this.root.querySelectorAll('[role=treeitem]')];}
 focus(item){if(!item)return;for(const el of this.items())el.tabIndex=el===item?0:-1;item.focus();}
 persist(){this.save([...this.collapsed]);}
 reveal(folder,folders){const seen=new Set();while(folder&&!seen.has(folder)){seen.add(folder);this.collapsed.delete(folder);folder=folders.find(f=>f.id===folder)?.parent;}}
 activate(item){if(item.dataset.folderId)this.toggle(item);else this.open(item.dataset.noteId);}
 toggle(item){const id=item.dataset.folderId;if(this.collapsed.has(id))this.collapsed.delete(id);else this.collapsed.add(id);this.persist();this.toggled=id;try{this.choose(id);}finally{this.toggled=null;}}
 render(data){this.data=data;if(data.filter==='tags'&&data.tagIndex)return this.tags.render(data,this.collapsed);if(data.tagIndex&&data.notes.length>500)return this.tags.renderArchive(data,this.collapsed,()=>treeModel(data.notes,data.folders,data.filter,data.sort));this.tags.stop();const {notes,folders,current,filter,sort}=data,focused=this.root.contains(document.activeElement)?document.activeElement.dataset.key:null;
 const {children,leaves}=treeModel(notes,folders,filter,sort);const fragment=document.createDocumentFragment();const visited=new Set();
 const item=(kind,id,label,depth)=>{const el=document.createElement('li');el.setAttribute('role','treeitem');el.setAttribute('aria-label',label);el.setAttribute('aria-level',depth+1);el.dataset.key=kind+id;el.tabIndex=-1;const row=document.createElement('div');row.className='tree-row';row.style.paddingLeft=8+Math.min(depth,8)*16+'px';const name=document.createElement('span');name.className='tree-name';name.textContent=label;row.append(icon(kind==='folder'?'folder':'notes'),name);el.append(row);return el;};
 const branch=(parent,target,depth)=>{
  for(const f of children.get(parent)||[]){if(visited.has(f.id))continue;visited.add(f.id);const el=item('folder',f.id,f.name,depth);el.dataset.folderId=f.id;if(f.tag){el.dataset.tagKey=tagKey(f.name);el.firstChild.querySelector('svg').replaceWith(icon('tag'));}else if(f.emoji){const emoji=document.createElement('span');emoji.className='tree-emoji';emoji.setAttribute('aria-hidden','true');emoji.textContent=f.emoji;el.firstChild.querySelector('svg').replaceWith(emoji);}if(this.toggled===f.id)el.classList.add('tree-toggled');el.setAttribute('aria-expanded',String(!this.collapsed.has(f.id)));el.classList.toggle('folder-context',filter===f.id);const chevron=document.createElement('span');chevron.className='tree-chevron';chevron.textContent='›';chevron.setAttribute('aria-hidden','true');el.firstChild.prepend(chevron);target.append(el);if(!this.collapsed.has(f.id)){const group=document.createElement('ul');group.setAttribute('role','group');el.append(group);branch(f.id,group,depth+1);}}
  for(const n of leaves.get(parent)||[]){const el=item('note',n.id,n.title||t('Senza titolo'),depth);if(filter==='tags')el.dataset.key='note:'+parent+':'+n.id;if(n.emoji){const emoji=document.createElement('span');emoji.className='tree-emoji';emoji.setAttribute('aria-hidden','true');emoji.textContent=n.emoji;el.firstChild.querySelector('svg').replaceWith(emoji);}el.dataset.noteId=n.id;el.setAttribute('aria-selected',String(n.id===current));if(n.pinned){const star=document.createElement('span');star.className='tree-star';star.textContent='✦';star.setAttribute('aria-label',t('Preferita'));el.firstChild.append(star);}target.append(el);}
 };
 branch(null,fragment,0);for(const row of fragment.querySelectorAll('.tree-row'))treeControls(row,{tag:!!row.parentElement.dataset.tagKey});this.root.replaceChildren(fragment);
 if(!this.root.childElementCount){const empty=document.createElement('li');empty.setAttribute('role','none');empty.className='empty-list';empty.textContent=filter==='trash'?t('Il cestino è vuoto.'):filter==='tags'?t('Nessun tag. Aggiungilo dalle proprietà di una nota.'):t('Nessuna nota.');this.root.append(empty);}
 const items=this.items(),active=items.find(el=>el.dataset.key===focused)||items.find(el=>el.dataset.noteId===current)||items[0];if(active){active.tabIndex=0;if(focused)active.focus({preventScroll:true});}
 }
 key(e){const current=e.target.closest('[role=treeitem]');if(!current)return;const items=this.items(),i=items.indexOf(current);let next;
 if(e.key==='ArrowDown')next=items[Math.min(i+1,items.length-1)];else if(e.key==='ArrowUp')next=items[Math.max(0,i-1)];else if(e.key==='Home')next=items[0];else if(e.key==='End')next=items.at(-1);
 else if(e.key==='ArrowRight'){if(current.dataset.folderId){if(current.getAttribute('aria-expanded')==='false')this.toggle(current);else next=current.querySelector('[role=treeitem]');}}
 else if(e.key==='ArrowLeft'){if(current.getAttribute('aria-expanded')==='true')this.toggle(current);else next=current.parentElement.closest('[role=treeitem]');}
 else if(e.key==='Enter'||e.key===' '){this.activate(current);}else return;
 e.preventDefault();if(next)this.focus(next);
 }
}
