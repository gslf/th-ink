import english from './locales/en.js';

export const supportedLanguages=['it','en'];
export function detectLanguage(languages=[]){
 for(const tag of languages){const code=String(tag).toLowerCase().split(/[-_]/)[0];if(supportedLanguages.includes(code))return code;}
 return 'en';
}
export const validPreference=value=>['auto',...supportedLanguages].includes(value);
export function resolveLanguage(preference,languages){return supportedLanguages.includes(preference)?preference:detectLanguage(languages);}
const browserLanguages=()=>globalThis.navigator?.languages?.length?Array.from(navigator.languages):[globalThis.navigator?.language||'en'];
let preference='auto',language=detectLanguage(browserLanguages()),storageKey='th-ink-language';
export const getLanguage=()=>language;
export const getLocale=()=>language==='it'?'it-IT':'en-US';
export const getLanguagePreference=()=>preference;
export function configureLanguage(key='th-ink-language'){
 storageKey=key;let saved;try{saved=globalThis.localStorage?.getItem(key);}catch{}
 setLanguagePreference(validPreference(saved)?saved:'auto',{persist:false});return language;
}
export function setLanguagePreference(value,{persist=true}={}){
 if(!validPreference(value))throw new RangeError('Unsupported language preference');
 if(persist)globalThis.localStorage?.setItem(storageKey,value);
 preference=value;language=resolveLanguage(value,browserLanguages());return language;
}
export function translate(source,values={},lang=language){
 let message=lang==='en'?(english[source]??source):source;
 if(lang==='en'&&!Object.hasOwn(english,source)){
  const conflicts=String(source).match(/^(\d+) copie recuperate: entrambe le modifiche conservate\.$/);
  const missing=String(source).match(/^Modello locale mancante \((\d+)\)\. Esegui npm run setup:voice\.$/);
  if(conflicts){message=english['{count} copie recuperate: entrambe le modifiche conservate.'];values={count:conflicts[1]};}
  if(missing){message=english['Modello locale mancante ({status}). Esegui npm run setup:voice.'];values={status:missing[1]};}
 }
 return String(message).replace(/\{(\w+)\}/g,(match,key)=>Object.hasOwn(values,key)?String(values[key]):match);
}
export const t=translate;
// Capture only initial, authored interface nodes. Never scan notes or imported text.
export function bindStaticTranslations(root){
 const bindings=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){
  const node=walker.currentNode,source=node.textContent.trim();
  if(!Object.hasOwn(english,source)||node.parentElement.closest('script,style,textarea'))continue;
  const before=node.textContent.match(/^\s*/)[0],after=node.textContent.match(/\s*$/)[0];bindings.push(()=>{if(node.isConnected)node.textContent=before+t(source)+after;});
 }
 for(const el of root.querySelectorAll('*'))for(const attr of ['title','aria-label','placeholder']){
  const source=el.getAttribute(attr);if(Object.hasOwn(english,source))bindings.push(()=>el.setAttribute(attr,t(source)));
 }
 return ()=>bindings.forEach(apply=>apply());
}
export function updateLanguageMetadata(doc=document){
 doc.documentElement.lang=language;
 doc.title=language==='it'?'th.ink — spazio al pensiero':'th.ink — room to think';
 doc.querySelector('meta[name="description"]').content=language==='it'?'Note Markdown locali. Uno spazio essenziale per i tuoi pensieri.':'Local Markdown notes. A quiet space for your thoughts.';
 doc.querySelector('link[rel="manifest"]').href=language==='it'?'./manifest-it.webmanifest':'./manifest.webmanifest';
}
