// A modal lives above all ordinary z-index layers. Keep feedback in its
// accessible subtree and promote it above the backdrop without moving focus.
export function createToast(element){
 let timer,dialogs=[...document.querySelectorAll('dialog[open]')];
 const supportsPopover=typeof element.showPopover==='function';
 if(supportsPopover)element.setAttribute('popover','manual');
 function dismissLayer(){if(supportsPopover&&element.matches(':popover-open'))element.hidePopover();}
 function present(){
  dialogs=dialogs.filter(dialog=>dialog.isConnected&&dialog.open);
  const dialog=dialogs.at(-1),parent=dialog||document.body;
  dismissLayer();
  element.toggleAttribute('data-inline',!!dialog&&!supportsPopover);
  if(element.parentElement!==parent){if(dialog&&!supportsPopover)parent.prepend(element);else parent.append(element);}
  element.hidden=false;
  if(supportsPopover)element.showPopover();
 }
 new MutationObserver(records=>{
  for(const {target} of records)if(target.matches('dialog')){
   dialogs=dialogs.filter(dialog=>dialog!==target);
   if(target.open)dialogs.push(target);
  }
  if(!element.hidden)present();
 }).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
 function hide(){clearTimeout(timer);dismissLayer();element.hidden=true;}
 return {hide,show(message,duration=5000){
  clearTimeout(timer);element.textContent=message;present();timer=setTimeout(hide,duration);
 }};
}
