import {t,getLocale} from './i18n.js';
import {icon} from './icons.js';
import {treeControls} from './tree-controls.js';
const OVERSCAN=5;
// Row height follows the density set in CSS (--tree-row), compact or touch.
let HEIGHT=44;
const measure=root=>{const value=parseFloat(getComputedStyle(root).getPropertyValue('--tree-row'));HEIGHT=value>0?value:44;};
// Prefix sums allow direct access to any row without flattening duplicated notes.
export class TagTree {
 constructor(root,{open,toggle}){this.root=root;this.open=open;this.toggle=toggle;this.segments=[];this.total=0;this.active=0;this.frame=0;root.addEventListener('scroll',()=>{if(!this.enabled||this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.paint();});},{passive:true});this.resize=new ResizeObserver(()=>{if(this.enabled){measure(root);this.paint();}});this.resize.observe(root);}
 render({tagIndex,current,sort},collapsed){
  measure(this.root);
  if(this.mode!=='tags')this.root.scrollTop=0;this.enabled=true;this.current=current;this.collapsed=collapsed;this.mode='tags';this.filter='tags';this.root.classList.add('virtual-tags');
  const focused=this.root.contains(document.activeElement),old=this.row(this.active),anchor=this.row(Math.floor(this.root.scrollTop/HEIGHT)),offset=this.root.scrollTop%HEIGHT;
  let start=0;this.segments=tagIndex.ordered(getLocale()).map((group,position)=>{group.depth=0;group.position=position+1;group.parent=null;const notes=collapsed.has(group.id)?[]:tagIndex.members(group,sort,getLocale()),segment={group,notes,header:true,start,end:start+1+notes.length};group.start=start;start=segment.end;return segment;});this.total=start;for(const s of this.segments)s.group.siblings=this.segments.length;
  const find=row=>{if(!row)return -1;const segment=this.segments.find(s=>s.group.id===row.group.id);if(!segment)return -1;if(!row.note)return segment.start;const i=segment.notes.findIndex(n=>n.id===row.note.id);return i<0?segment.start:segment.start+1+i;};
  this.active=Math.max(0,find(old));const anchorIndex=find(anchor);this.paint();if(anchorIndex>=0)this.root.scrollTop=anchorIndex*HEIGHT+offset;
  this.paint();if(focused)this.focus(this.active,false);
 }
 renderArchive(data,collapsed,model){
  measure(this.root);
  const focused=this.root.contains(document.activeElement),old=this.row(this.active),anchor=this.row(Math.floor(this.root.scrollTop/HEIGHT)),offset=this.root.scrollTop%HEIGHT;
  if(this.mode!=='archive'||this.filter!==data.filter)this.root.scrollTop=0;this.enabled=true;this.mode='archive';this.current=data.current;this.filter=data.filter;this.collapsed=collapsed;this.root.classList.add('virtual-tags');
  const cacheKey=[data.tagIndex.version,data.sort,getLocale(),data.filter,JSON.stringify(data.folders),JSON.stringify([...collapsed])].join('|');
  if(this.archiveCache?.key!==cacheKey){
   const {children,leaves}=model(),segments=[],visited=new Set();let start=0;
   const branch=(id,depth,parent)=>{
    const folders=children.get(id)||[];
    for(const [position,f] of folders.entries()){if(visited.has(f.id))continue;visited.add(f.id);const group={...f,depth,position:position+1,siblings:folders.length+(leaves.get(id)?.length||0),parent:parent?.start??null,start};segments.push({group,notes:[],header:true,start,end:++start});if(!collapsed.has(f.id))branch(f.id,depth+1,group);}
    const notes=leaves.get(id)||[];if(notes.length){const group=parent||{id:null,depth:-1,start:null};segments.push({group,notes,header:false,offset:folders.length,siblings:folders.length+notes.length,start,end:start+notes.length});start+=notes.length;}
   };branch(null,0,null);this.archiveCache={key:cacheKey,segments,total:start};
  }
  this.segments=this.archiveCache.segments;this.total=this.archiveCache.total;
  const find=row=>{if(!row)return -1;for(const segment of this.segments){if(segment.group.id!==row.group.id)continue;if(!row.note&&segment.header)return segment.start;const i=row.note?segment.notes.findIndex(n=>n.id===row.note.id):-1;if(i>=0)return segment.start+(segment.header?1:0)+i;}return -1;};
  this.active=Math.max(0,find(old));const anchored=find(anchor);this.paint();if(anchored>=0)this.root.scrollTop=anchored*HEIGHT+offset;this.paint();if(focused)this.focus(this.active,false);
 }
 row(index){let lo=0,hi=this.segments.length-1;while(lo<=hi){const mid=(lo+hi)>>1,s=this.segments[mid];if(index<s.start)hi=mid-1;else if(index>=s.end)lo=mid+1;else return {group:s.group,note:s.header&&index===s.start?null:s.notes[index-s.start-(s.header?1:0)],segment:s,index};}return null;}
 paint(){if(!this.enabled)return;const focused=this.root.contains(document.activeElement),start=Math.max(0,Math.min(Math.floor(this.root.scrollTop/HEIGHT),Math.max(0,this.total-1))-OVERSCAN),end=Math.min(this.total,start+Math.ceil((this.root.clientHeight||440)/HEIGHT)+OVERSCAN*2),fragment=document.createDocumentFragment();
  const spacer=height=>{const li=document.createElement('li');li.setAttribute('role','presentation');li.style.height=height+'px';li.className='tree-spacer';return li;};fragment.append(spacer(start*HEIGHT));
  for(let i=start;i<end;i++){const {group,note,segment}=this.row(i),li=document.createElement('li'),row=document.createElement('div'),label=document.createElement('span');li.setAttribute('role','treeitem');li.dataset.row=i;li.dataset.key=note?`note:${group.id}:${note.id}`:'folder'+group.id;li.tabIndex=i===this.active?0:-1;li.setAttribute('aria-level',group.depth+(note?2:1));li.setAttribute('aria-posinset',note?i-segment.start+(segment.header?0:1)+(segment.offset||0):group.position);li.setAttribute('aria-setsize',note?(segment.siblings??segment.notes.length):group.siblings);row.className='tree-row';row.style.paddingLeft=8+Math.min(group.depth+(note?1:0),8)*16+'px';label.className='tree-name';label.textContent=note?(note.title||t('Senza titolo')):group.name;li.setAttribute('aria-label',label.textContent);
   if(note){li.dataset.noteId=note.id;li.setAttribute('aria-selected',String(note.id===this.current));const glyph=note.emoji?document.createElement('span'):icon('notes');if(note.emoji){glyph.className='tree-emoji';glyph.textContent=note.emoji;glyph.setAttribute('aria-hidden','true');}row.append(glyph,label);if(note.pinned){const star=document.createElement('span');star.className='tree-star';star.textContent='✦';star.setAttribute('aria-label',t('Preferita'));row.append(star);}}
   else{li.dataset.folderId=group.id;if(group.tag)li.dataset.tagKey=group.key;li.classList.toggle('folder-context',this.filter===group.id);li.setAttribute('aria-expanded',String(!this.collapsed.has(group.id)));const arrow=document.createElement('span');arrow.className='tree-chevron';arrow.textContent='›';arrow.setAttribute('aria-hidden','true');const count=document.createElement('span');count.className='tag-note-count';count.textContent=group.members?.size||'';let glyph=icon(group.tag?'tag':'folder');if(!group.tag&&group.emoji){glyph=document.createElement('span');glyph.className='tree-emoji';glyph.textContent=group.emoji;glyph.setAttribute('aria-hidden','true');}row.append(arrow,glyph,label);if(group.tag)row.append(count);}treeControls(row,{tag:!!li.dataset.tagKey});li.append(row);fragment.append(li);
  }
  fragment.append(spacer(Math.max(0,(this.total-end)*HEIGHT)));this.root.replaceChildren(fragment);
  if(!this.total){const empty=document.createElement('li');empty.className='empty-list';empty.setAttribute('role','none');empty.textContent=t(this.mode==='tags'?'Nessun tag. Aggiungilo dalle proprietà di una nota.':'Nessuna nota.');this.root.append(empty);}
  if(focused){const item=this.root.querySelector(`[data-row="${this.active}"]`);if(item)item.focus({preventScroll:true});else{this.root.tabIndex=0;this.root.focus({preventScroll:true});}}
  this.root.tabIndex=this.root.querySelector('[tabindex="0"]')?-1:0;
 }
 focus(index,reveal=true){this.active=Math.max(0,Math.min(index,this.total-1));if(reveal){const top=this.active*HEIGHT;if(top<this.root.scrollTop)this.root.scrollTop=top;else if(top+HEIGHT>this.root.scrollTop+this.root.clientHeight)this.root.scrollTop=top+HEIGHT-this.root.clientHeight;}this.paint();this.root.querySelector(`[data-row="${this.active}"]`)?.focus({preventScroll:true});}
 click(event){const item=event.target.closest('[data-row]');if(!item)return;const index=Number(item.dataset.row);this.focus(index,false);const row=this.row(index);if(row.note)this.open(row.note.id);else this.toggle(item);}
 key(event){const row=this.row(this.active);if(!row)return;let next=this.active;switch(event.key){case 'ArrowDown':next++;break;case 'ArrowUp':next--;break;case 'Home':next=0;break;case 'End':next=this.total-1;break;case 'ArrowLeft':if(row.note)next=row.group.start??this.active;else if(!this.collapsed.has(row.group.id))this.toggle({dataset:{folderId:row.group.id}});else next=row.group.parent??this.active;break;case 'ArrowRight':if(!row.note){if(this.collapsed.has(row.group.id))this.toggle({dataset:{folderId:row.group.id}});else if(this.row(next+1)?.group.depth>row.group.depth||this.row(next+1)?.note&&this.row(next+1)?.group.id===row.group.id)next++;}break;case 'Enter':case ' ':if(row.note)this.open(row.note.id);else this.toggle({dataset:{folderId:row.group.id}});break;default:return;}event.preventDefault();this.focus(next);}
 reveal(id){const segment=this.segments.find(s=>s.group.id===id&&s.header);if(segment)this.focus(segment.start);}
 stop(){this.enabled=false;this.root.classList.remove('virtual-tags');this.root.removeAttribute('tabindex');}
}
