import {mountEmojiPicker} from './emoji-picker.js';
import {t} from './i18n.js';
import {noteProperties,normalizeTags} from './note-properties.js';
export function mountNoteProperties(parent,note,knownTags,{save,cancel}){
 const el=(tag,value,cls)=>{const node=document.createElement(tag);if(value)node.textContent=value;if(cls)node.className=cls;return node;};
 const form=el('form',null,'properties-form'),error=el('p',null,'properties-error');error.setAttribute('role','alert');parent.append(form);
 const emoji=mountEmojiPicker(form,note.emoji||'',()=>{error.textContent='';});
 const details=el('div',null,'property-details');form.append(details);
 const tagLabel=el('label',t('Tags'));tagLabel.htmlFor='property-tags';const tags=el('input');tags.id='property-tags';tags.value=(note.tags||[]).join(', ');tags.autocomplete='off';tags.placeholder=t('Lavoro, Idee, Personale');tagLabel.append(tags);details.append(tagLabel);
 details.append(el('p',t('Separa i tag con una virgola. La nota apparirà sotto ciascun tag.'),'properties-hint'));
 if(knownTags.length){const suggestions=el('div',null,'tag-suggestions');suggestions.setAttribute('role','group');suggestions.setAttribute('aria-label',t('Tag esistenti'));for(const tag of knownTags){const button=el('button',tag,'note-tag');button.type='button';button.onclick=()=>{try{tags.value=normalizeTags([...tags.value.split(','),tag]).join(', ');error.textContent='';}catch(e){error.textContent=t(e.message);}};suggestions.append(button);}details.append(suggestions);}
 tags.oninput=()=>{error.textContent='';};details.append(error);
 const actions=el('div',null,'buttons'),back=el('button',t('Annulla')),submit=el('button',t('Salva'),'primary');back.type='button';back.onclick=cancel;submit.type='submit';actions.append(back,submit);form.append(actions);
 form.onsubmit=async event=>{event.preventDefault();if(submit.disabled)return;try{const properties=noteProperties({emoji:emoji.value,tags:tags.value.split(',')});submit.disabled=true;await save(properties);}catch(e){error.textContent=t(e.message);}finally{submit.disabled=false;}};
}
