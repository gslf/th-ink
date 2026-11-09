import {getLanguage,t} from './i18n.js';
import {icon} from './icons.js';
const catalogs=new Map();
const fold=value=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
export async function emojiCatalog(language){
 if(!catalogs.has(language))catalogs.set(language,fetch(new URL(`../assets/emoji/${language}.json`,import.meta.url)).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>({...data,entries:data.entries.map(e=>({...e,search:fold([e.label,...e.keywords,e.emoji].join(' '))}))})).catch(e=>{catalogs.delete(language);throw e;}));
 return catalogs.get(language);
}
export function searchEmoji(entries,query){const terms=fold(query).trim().split(/\s+/).filter(Boolean);return entries.filter(e=>terms.every(term=>e.search.includes(term)));}
export function mountEmojiPicker(parent,value,onchange){
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const root=el('section',null,'emoji-picker'),identity=el('div',null,'emoji-identity'),preview=el('span',null,'emoji-preview'),selected=el('span',null,'emoji-selected');preview.setAttribute('aria-hidden','true');selected.setAttribute('role','status');
 const reset=el('button',t('Usa icona predefinita'),'emoji-reset');reset.type='button';reset.onclick=()=>choose('');identity.append(preview,selected,reset);root.append(identity);
 const search=el('input');search.type='search';search.id='emoji-search';search.placeholder=t('Cerca emoji…');search.setAttribute('aria-label',t('Cerca emoji'));search.autocomplete='off';root.append(search);
 const categories=el('div',null,'emoji-categories');categories.setAttribute('role','group');categories.setAttribute('aria-label',t('Categorie emoji'));root.append(categories);
 const tools=el('div',null,'emoji-tools'),heading=el('span',t('Caricamento…')),tone=el('select');tone.setAttribute('aria-label',t('Carnagione'));for(const [i,glyph] of ['✋','✋🏻','✋🏼','✋🏽','✋🏾','✋🏿'].entries()){const o=el('option',glyph);o.value=i;o.label=glyph+' '+t(['Predefinita','Chiara','Medio-chiara','Media','Medio-scura','Scura'][i]);tone.append(o);}tools.append(heading,tone);root.append(tools);
 const results=el('div',null,'emoji-results'),grid=el('div',null,'emoji-grid'),status=el('p',null,'emoji-status');status.setAttribute('role','status');results.append(grid,status);root.append(results);parent.append(root);
 let data,category=-1,selection=value,visible=[],shown=0;
 const icons=['✦','😀','👋','🌿','🍋','🌍','⚽','💡','♡','🏳️'];
 function variant(e){return e.skins.find(s=>s.tone===Number(tone.value))||e;}
 function choose(emoji){selection=emoji;updateIdentity();for(const b of grid.children)b.setAttribute('aria-pressed',String(b.dataset.emoji===selection));onchange(emoji);}
 function updateIdentity(){preview.replaceChildren(selection?document.createTextNode(selection):icon('notes'));const entry=data?.entries.flatMap(e=>[e,...e.skins]).find(e=>e.emoji===selection);selected.textContent=selection?(entry?.label||t('Emoji della nota')):t('Icona predefinita');}
 function more(){const fragment=document.createDocumentFragment();for(const e of visible.slice(shown,shown+90)){const v=variant(e),b=el('button',v.emoji);b.type='button';b.dataset.emoji=v.emoji;b.title=v.label;b.setAttribute('aria-label',v.label);b.setAttribute('aria-pressed',String(selection===v.emoji));b.onclick=()=>choose(v.emoji);fragment.append(b);}shown=Math.min(shown+90,visible.length);grid.append(fragment);}
 function render(){if(!data)return;const query=search.value.trim();const common=['📝','💡','📚','💼','🎯','🌿','🎨','🧪','🚀','❤️','📌','✨','🗓️','✅','🎵','🌍','☕','🏠','💻','🧠'];
  visible=query?searchEmoji(data.entries,query):category===-1?common.map(v=>data.entries.find(e=>e.emoji===v)).filter(Boolean):data.entries.filter(e=>e.group===category);
  heading.textContent=query?t('{count} emoji',{count:visible.length}):category===-1?t('Per le tue note'):data.groups.find(g=>g.order===category)?.message;
  for(const b of categories.children)b.setAttribute('aria-pressed',String(!query&&Number(b.dataset.category)===category));
  shown=0;grid.replaceChildren();results.scrollTop=0;status.textContent=visible.length?'':t('Nessuna emoji trovata.');more();
 }
 search.oninput=render;tone.onchange=render;search.onkeydown=e=>{if(e.key==='Enter'||e.key==='ArrowDown'){e.preventDefault();const first=grid.querySelector('button');if(e.key==='Enter')first?.click();else first?.focus();}};
 results.addEventListener('scroll',()=>{if(results.scrollTop+results.clientHeight>=results.scrollHeight-100&&shown<visible.length)more();},{passive:true});
 grid.addEventListener('keydown',e=>{const b=e.target.closest('button');if(!b)return;const buttons=[...grid.children],i=buttons.indexOf(b),cols=Math.max(1,getComputedStyle(grid).gridTemplateColumns.split(' ').length);let next;if(e.key==='ArrowRight')next=i+1;else if(e.key==='ArrowLeft')next=i-1;else if(e.key==='ArrowDown')next=i+cols;else if(e.key==='ArrowUp')next=i-cols;else return;e.preventDefault();if(next>=shown&&shown<visible.length)more();grid.children[Math.max(0,Math.min(next,grid.children.length-1))]?.focus();});
 async function load(){try{data=await emojiCatalog(getLanguage());if(!root.isConnected)return;categories.replaceChildren();const groups=[{order:-1,message:t('Per le tue note')},...data.groups];groups.forEach((g,i)=>{const b=el('button',icons[i]);b.type='button';b.dataset.category=g.order;b.title=g.message;b.setAttribute('aria-label',g.message);b.onclick=()=>{category=g.order;search.value='';render();};categories.append(b);});updateIdentity();render();}catch{heading.textContent=t('Emoji non disponibili.');const retry=el('button',t('Riprova'));retry.type='button';retry.onclick=()=>{status.replaceChildren();load();};status.replaceChildren(retry);}}
 updateIdentity();void load();return {get value(){return selection;}};
}
