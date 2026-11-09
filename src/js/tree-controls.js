import {icon} from './icons.js';
import {t} from './i18n.js';
export function treeControls(row,{tag=false}={}){
 if(tag)return;
 if(!tag){const handle=document.createElement('button');handle.type='button';handle.className='tree-grip';handle.tabIndex=-1;handle.setAttribute('aria-label',t('Trascina per spostare'));handle.title=t('Trascina per spostare');handle.append(icon('grip'));row.append(handle);}
 const more=document.createElement('button');more.type='button';more.className='tree-options';more.tabIndex=-1;more.setAttribute('aria-label',t('Azioni'));more.setAttribute('aria-haspopup','menu');more.append(icon('more'));row.append(more);
}
