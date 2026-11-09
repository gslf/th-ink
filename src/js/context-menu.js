import {icon} from './icons.js';
import {t} from './i18n.js';
export class ContextMenu {
 constructor(report){
  this.report=report;this.element=document.createElement('div');this.element.className='context-menu';this.element.id='context-menu';this.element.hidden=true;this.element.setAttribute('role','menu');this.element.setAttribute('aria-label',t('Azioni'));this.element.setAttribute('popover','manual');document.body.append(this.element);
  document.addEventListener('pointerdown',e=>{if(!this.element.contains(e.target))this.close(false);},true);
  window.addEventListener('resize',()=>this.close());document.addEventListener('scroll',e=>{if(!this.element.contains(e.target))this.close(false);},true);
  this.element.addEventListener('keydown',e=>{
   e.stopPropagation();const buttons=[...this.element.querySelectorAll('button:not(:disabled)')],at=buttons.indexOf(document.activeElement);let next;
   if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();this.close();return;}
   if(e.key==='ArrowDown')next=(at+1)%buttons.length;if(e.key==='ArrowUp')next=(at+buttons.length-1)%buttons.length;if(e.key==='Home')next=0;if(e.key==='End')next=buttons.length-1;
   if(next!==undefined){e.preventDefault();buttons[next]?.focus({preventScroll:true});}
   else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey){const ordered=[...buttons.slice(at+1),...buttons.slice(0,at+1)];ordered.find(b=>b.textContent.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase()))?.focus({preventScroll:true});}
  });
 }
 show(items,{x,y,anchor=document.activeElement,label=t('Azioni')}={}){
  this.close(false);this.anchor=anchor;const menu=this.element;menu.replaceChildren();menu.setAttribute('aria-label',label);
  for(const item of items){if(!item){const line=document.createElement('div');line.setAttribute('role','separator');menu.append(line);continue;}const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.tabIndex=-1;b.disabled=!!item.disabled;b.classList.toggle('danger',!!item.danger);b.append(icon(item.icon||'notes'));const text=document.createElement('span');text.textContent=item.label;b.append(text);if(item.shortcut){const key=document.createElement('kbd');key.textContent=item.shortcut;b.append(key);}b.onclick=()=>{this.close();Promise.resolve().then(item.run).catch(this.report);};menu.append(b);}
  const rect=anchor?.getBoundingClientRect?.();x??=rect?.left||12;y??=rect?.bottom||12;menu.hidden=false;menu.style.left='0px';menu.style.top='0px';menu.showPopover?.();
  const viewport=window.visualViewport,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||innerWidth,height=viewport?.height||innerHeight;
  menu.style.maxHeight=Math.max(80,height-24)+'px';menu.style.left=Math.max(left+8,Math.min(x,left+width-menu.offsetWidth-8))+'px';menu.style.top=Math.max(top+8,Math.min(y,top+height-menu.offsetHeight-8))+'px';menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
 }
 close(restore=true){if(this.element.hidden)return;this.element.hidePopover?.();this.element.hidden=true;if(restore&&this.anchor?.isConnected)this.anchor.focus({preventScroll:true});}
}
