import {normalizeReminders} from './reminder-model.js';
// File properties are separate from the title, body, and filesystem name.
export const tagKey=value=>value.normalize('NFKC').trim().toLowerCase();
export function normalizeTags(values=[]){
 if(!Array.isArray(values)||values.length>32)throw Error('Puoi assegnare fino a 32 tag per nota.');
 const seen=new Set(),tags=[];
 for(const value of values){if(typeof value!=='string')throw Error('Tag non valido.');const tag=value.normalize('NFKC').trim().replace(/\s+/g,' ');if(!tag)continue;if(tag.length>64||/[\x00-\x1f,]/.test(tag))throw Error('Ogni tag deve contenere da 1 a 64 caratteri, senza virgole.');const key=tagKey(tag);if(!seen.has(key)){seen.add(key);tags.push(tag);}}
 return tags;
}
export function normalizeEmoji(value=''){
 if(typeof value!=='string')throw Error('Scegli una sola emoji.');value=value.trim();if(!value)return '';
 if(value.length>64||[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(value)].length!==1||!/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(value))throw Error('Scegli una sola emoji.');
 return value;
}
export function noteProperties(value={}){return {emoji:normalizeEmoji(value.emoji??''),tags:normalizeTags(value.tags??[]),reminders:normalizeReminders(value.reminders??[])};}
export function optionalProperties(value){const p=noteProperties(value);return {...(p.emoji?{emoji:p.emoji}:{}),...(p.tags.length?{tags:p.tags}:{}),...(p.reminders.length?{reminders:p.reminders}:{})};}
const prefix='<!-- th.ink-note-v1 ';
export function propertiesHeader(note){const properties=optionalProperties(note);return Object.keys(properties).length?prefix+JSON.stringify(properties).replace(/</g,'\\u003c').replace(/>/g,'\\u003e')+' -->\n':'';}
export function readPropertiesHeader(text){
 if(!text.startsWith(prefix))return {text,properties:{}};
 const end=text.indexOf(' -->');if(end<0||end>65536)throw Error('Proprietà della nota non valide.');
 try{const raw=JSON.parse(text.slice(prefix.length,end));if(!raw||Array.isArray(raw)||typeof raw!=='object')throw Error();const properties=optionalProperties(raw);return {text:text.slice(end+4).replace(/^\r?\n/,''),properties};}catch{throw Error('Proprietà della nota non valide.');}
}
