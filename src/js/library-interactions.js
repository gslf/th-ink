import {t} from './i18n.js';
import {icon} from './icons.js';
import {libraryIndex,validateMove} from './library-model.js';

// Pointer dragging keeps mouse and touch behavior identical, without hijacking
// native text selection or external file drops in the editor.
export class LibraryInteractions {
 constructor({root,state,tree,menu,items,move,drop,report}){
  Object.assign(this,{root,state,tree,menu,items,move,drop,report});this.pending=null;this.drag=null;this.suppressUntil=0;
  this.ghost=document.createElement('div');this.ghost.className='library-drag-ghost';this.ghost.hidden=true;document.body.append(this.ghost);
  this.indicator=document.createElement('div');this.indicator.className='library-drop-line';this.indicator.hidden=true;document.body.append(this.indicator);
  this.live=document.createElement('span');this.live.className='visually-hidden';this.live.setAttribute('role','status');document.body.append(this.live);
  root.addEventListener('contextmenu',e=>{const source=this.source(e.target);if(!source||source.kind==='tag')return;e.preventDefault();e.stopPropagation();this.cancel();this.open(source,e.clientX,e.clientY,e.target.closest('[role=treeitem]'));});
  root.addEventListener('keydown',e=>{const source=this.source(e.target);if(!source)return;if(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey){e.preventDefault();e.stopPropagation();this.open(source,undefined,undefined,e.target.closest('[role=treeitem]'));}});
  root.addEventListener('click',e=>{if(performance.now()<this.suppressUntil){e.preventDefault();e.stopImmediatePropagation();return;}const button=e.target.closest('.tree-options,.tree-grip');if(!button)return;e.preventDefault();e.stopImmediatePropagation();this.open(this.source(button),undefined,undefined,button);},true);
  root.addEventListener('pointerdown',e=>this.down(e));
  root.addEventListener('dragstart',e=>{if(this.source(e.target))e.preventDefault();});
  document.addEventListener('pointermove',e=>this.motion(e),{passive:false});
  document.addEventListener('pointerup',e=>this.up(e));document.addEventListener('pointercancel',()=>this.cancel());
  root.addEventListener('lostpointercapture',e=>{if(e.target===root&&this.drag&&!root.hasPointerCapture(this.drag.id))this.cancel();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(this.drag||this.pending)){e.preventDefault();e.stopImmediatePropagation();this.cancel();}},true);
  window.addEventListener('blur',()=>this.cancel());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.cancel();});
 }
 source(element){const item=element.closest('[role=treeitem]');if(!item)return null;if(item.dataset.noteId)return {kind:'note',id:item.dataset.noteId};if(item.dataset.tagKey)return {kind:'tag',id:item.dataset.folderId,key:item.dataset.tagKey};if(item.dataset.folderId)return {kind:'folder',id:item.dataset.folderId};return null;}
 open(source,x,y,anchor){if(!source)return;const items=this.items(source);if(items.length)this.menu.show(items,{x,y,anchor});}
 down(e){
  // Suppress only the click emitted by the finished drag, never a new gesture.
  if(e.button===0)this.suppressUntil=0;
  if(e.button!==0||!e.isPrimary||e.target.closest('.tree-options'))return;
  const source=this.source(e.target);if(!source)return;
  const handle=e.target.closest('.tree-grip'),touch=e.pointerType!=='mouse';
  this.pending={source,id:e.pointerId,x:e.clientX,y:e.clientY,element:e.target,handle,touch};
  if(touch&&!handle){this.longPress=setTimeout(()=>{if(!this.pending)return;this.suppressUntil=performance.now()+700;this.open(source,e.clientX,e.clientY,e.target.closest('[role=treeitem]'));this.pending=null;},550);return;}
  if(this.state.readOnly||source.kind==='tag'){this.pending=null;return;}
  if(handle)e.preventDefault();
 }
 motion(e){
  if(!this.pending&&!this.drag)return;const p=this.pending||this.drag;if(e.pointerId!==p.id)return;
  if(e.pointerType==='mouse'&&!e.buttons){this.cancel();return;}
  if(!this.drag){if(Math.hypot(e.clientX-p.x,e.clientY-p.y)<8)return;clearTimeout(this.longPress);if(p.touch&&!p.handle){this.pending=null;return;}this.start(p);}
  e.preventDefault();this.drag.x=e.clientX;this.drag.y=e.clientY;this.update();
 }
 start(p){
  this.menu.close(false);this.pending=null;this.drag={...p,index:libraryIndex(this.state.notes,this.state.folders)};
  const item=(p.source.kind==='note'?this.drag.index.noteById:this.drag.index.folderById).get(p.source.id);if(!item)return this.cancel();
  this.drag.name=item.title||item.name||t('Senza titolo');if(item.emoji){const glyph=document.createElement('span');glyph.className='tree-emoji';glyph.textContent=item.emoji;this.ghost.replaceChildren(glyph);}else this.ghost.replaceChildren(icon(p.source.kind==='note'?'notes':'folder'));const label=document.createElement('strong');label.textContent=this.drag.name;this.hint=document.createElement('span');this.ghost.append(label,this.hint);this.ghost.hidden=false;
  document.body.classList.add('library-dragging');this.root.querySelectorAll(`[data-${p.source.kind}-id="${p.source.id}"]`).forEach(el=>el.classList.add('drag-source'));
  try{this.root.setPointerCapture(p.id);}catch{}this.frame=requestAnimationFrame(()=>this.tick());
 }
 targetAt(x,y){
  const el=document.elementFromPoint(x,y);if(!el)return null;const source=this.drag.source,index=this.drag.index;
  const nav=el.closest('[data-filter]');
  if(nav){const filter=nav.dataset.filter;if(filter==='trash')return {type:'trash',el:nav,label:t('Sposta nel cestino')};if(filter==='all')return {type:'move',parent:null,el:nav,label:t('Sposta al livello principale')};if(filter==='pinned'&&source.kind==='note')return {type:'pin',el:nav,label:t('Aggiungi ai preferiti')};return null;}
  if(el.closest('#editor')&&source.kind==='note'&&!this.state.preview&&!this.state.readOnly){const current=index.noteById.get(this.state.current),n=index.noteById.get(source.id);if(current&&!current.deleted&&!n.deleted)return {type:'link',el:document.querySelector('#editor-surface'),x,y,label:t('Inserisci collegamento alla nota')};return null;}
  const row=el.closest('.tree-row');if(row&&this.root.contains(row)){
   const target=this.source(row);if(!target)return null;
   if(target.kind==='tag'){if(source.kind!=='note'||index.noteById.get(source.id)?.deleted)return null;return {type:'tag',key:target.key,el:row,label:t('Aggiungi tag: {name}',{name:row.querySelector('.tree-name').textContent})};}
   const item=(target.kind==='folder'?index.folderById:index.noteById).get(target.id);if(!item||item.deleted||source.kind===target.kind&&source.id===target.id)return null;
   const rect=row.getBoundingClientRect(),ratio=(y-rect.top)/rect.height;
   if(target.kind==='folder'&&ratio>.23&&ratio<.77)return {type:'move',parent:target.id,el:row,inside:true,label:t('Dentro: {name}',{name:item.name})};
   return {type:'move',parent:target.kind==='folder'?item.parent:item.folder,el:row,edge:ratio<.5?'top':'bottom',label:t('Stesso livello di: {name}',{name:item.title||item.name})};
  }
  if(el===this.root||el.closest('.empty-list'))return {type:'move',parent:null,el:this.root,label:t('Sposta al livello principale')};return null;
 }
 update(){
  if(!this.drag)return;const d=this.drag,target=this.targetAt(d.x,d.y);let valid=!!target;
  if(target?.type==='move'){
   d.validParents??=new Map();if(!d.validParents.has(target.parent)){try{validateMove(d.index,d.source,target.parent);d.validParents.set(target.parent,true);}catch{d.validParents.set(target.parent,false);}}
   valid=d.validParents.get(target.parent);
  }
  if(target?.type==='trash'&&(d.source.kind==='note'?d.index.noteById:d.index.folderById).get(d.source.id)?.deleted)valid=false;
  this.clearTarget();this.target=valid?target:null;
  const text=valid?target.label+(target.edge?' · '+t('Ordinamento automatico'):''):t('Scegli una destinazione');this.hint.textContent=text;
  this.ghost.classList.toggle('invalid',!valid);this.ghost.style.left=Math.max(8,Math.min(d.x+18,innerWidth-this.ghost.offsetWidth-8))+'px';this.ghost.style.top=Math.max(8,Math.min(d.y+(d.touch?-88:18),innerHeight-this.ghost.offsetHeight-8))+'px';
  if(this.live.textContent!==text)this.live.textContent=text;
  const hover=valid&&target.inside?target.parent:null;
  if(hover!==this.hover){clearTimeout(this.expandTimer);this.hover=hover;if(hover&&this.tree.collapsed.has(hover))this.expandTimer=setTimeout(()=>{if(!this.drag||this.hover!==hover)return;this.tree.collapsed.delete(hover);this.tree.render(this.state);this.update();},650);}
  if(!valid)return;
  if(target.edge){const rect=target.el.getBoundingClientRect();this.indicator.hidden=false;this.indicator.style.left=(rect.left+parseFloat(target.el.style.paddingLeft||8))+'px';this.indicator.style.top=(target.edge==='top'?rect.top:rect.bottom)-1+'px';this.indicator.style.width=Math.max(20,rect.width-parseFloat(target.el.style.paddingLeft||8)-6)+'px';}
  else target.el.classList.add('drop-inside');
 }
 clearTarget(){this.target?.el?.classList.remove('drop-inside');this.indicator.hidden=true;}
 tick(){
  if(!this.drag)return;const r=this.root.getBoundingClientRect(),{x,y}=this.drag;
  if(x>=r.left&&x<=r.right&&y>r.top-12&&y<r.bottom+12){const speed=y<r.top+44?-Math.ceil((r.top+44-y)/4):y>r.bottom-44?Math.ceil((y-r.bottom+44)/4):0;if(speed){this.root.scrollTop+=speed;this.update();}}
  this.frame=requestAnimationFrame(()=>this.tick());
 }
 up(e){
  clearTimeout(this.longPress);if(!this.drag){this.pending=null;return;}if(e.pointerId!==this.drag.id)return;
  this.drag.x=e.clientX;this.drag.y=e.clientY;this.update();const source=this.drag.source,target=this.target;this.cancel();if(!target)return;
  Promise.resolve().then(()=>target.type==='move'?this.move(source,target.parent):this.drop(source,target)).catch(this.report);
 }
 cancel(){
  clearTimeout(this.longPress);clearTimeout(this.expandTimer);cancelAnimationFrame(this.frame);this.clearTarget();
  if(this.drag){this.suppressUntil=performance.now()+400;try{this.root.releasePointerCapture(this.drag.id);}catch{}}
  this.root.querySelectorAll('.drag-source').forEach(el=>el.classList.remove('drag-source'));this.ghost.hidden=true;document.body.classList.remove('library-dragging');this.pending=this.drag=this.target=null;this.hover=null;
 }
}
