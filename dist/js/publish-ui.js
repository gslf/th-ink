import {t,getLanguage,getLocale} from './i18n.js';
import {folderPath} from './core.js';
import {selectPublishedNotes} from './publish-model.js';
import {download} from './archive.js';
const el=(tag,value='',cls='')=>{const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;};
export function publishSettings({modal,publisher,folders,notes,readOnly}){
 const root=modal(t('Il tuo journal.')),form=el('form','','publish-form');form.id='publish-settings';
 root.append(el('p',t('Una cartella di pensieri, un sito da condividere. HTML pronto da caricare sul tuo hosting.')),form);
 const fields={};
 function field(key,label,type='text',value=publisher.config[key]){const wrap=el('label',t(label)),input=document.createElement(type==='textarea'?'textarea':type==='select'?'select':'input');if(!['textarea','select'].includes(type))input.type=type;input.id='publish-'+key;input.name=key;input.value=value||'';wrap.htmlFor=input.id;wrap.append(input);form.append(wrap);fields[key]=input;return input;}
 form.append(el('h3',t('Contenuti')));
 const folder=field('folder','Cartella da pubblicare','select');const placeholder=el('option',t('Scegli una cartella'));placeholder.value='';folder.append(placeholder);
 for(const f of folders.filter(f=>!f.deleted).sort((a,b)=>folderPath(a.id,folders).join('/').localeCompare(folderPath(b.id,folders).join('/'),getLocale()))){const option=el('option',folderPath(f.id,folders).join(' / '));option.value=f.id;folder.append(option);}folder.value=publisher.config.folder;folder.required=true;
 const count=el('p','','publish-selection');form.append(count);const selection=()=>{let n=0;try{n=selectPublishedNotes(notes,folders,folder.value).length;}catch{}count.textContent=t('{count} articoli · sottocartelle incluse · cestino escluso',{count:n});};folder.onchange=selection;selection();
 const title=field('title','Titolo del sito');title.required=true;title.maxLength=120;
 const description=field('description','Descrizione del sito','textarea');description.rows=2;description.maxLength=320;
 field('author','Autore').maxLength=120;
 const language=field('language','Lingua del sito','select');for(const [value,label] of [['it','Italiano'],['en','English']]){const o=el('option',label);o.value=value;language.append(o);}language.value=publisher.config.folder?publisher.config.language:getLanguage();
 form.append(el('h3',t('Pubblicazione')));
 const url=field('url','Indirizzo pubblico del sito','url');url.placeholder='https://gslf.it/journal/';url.required=true;url.inputMode='url';
 form.append(el('p',t('L’indirizzo serve per i link SEO e il feed. Nessun file viene caricato sul server.')));
 form.append(el('p',t('Esporta il sito come ZIP. Il browser gestisce il download; estrai i file e caricali manualmente sul server.')));
 const status=el('p','','publish-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');form.append(status);
 const warnings=el('p','','publish-warnings');form.append(warnings);
 const actions=el('div','','buttons publish-actions'),exportButton=el('button',t('Esporta sito · ZIP'),'primary');exportButton.type='submit';exportButton.id='publish-export';actions.append(exportButton);form.append(actions);
 let pending=false;
 function update(){status.textContent=t(publisher.message);for(const control of form.elements)control.disabled=publisher.busy||pending||readOnly;warnings.textContent=publisher.result?.warnings?.length?t('{count} articoli contengono link o immagini locali non risolti. I riferimenti non pubblicati restano testo.',{count:publisher.result.warnings.length}):'';}
 const listen=()=>{if(!form.isConnected){publisher.removeEventListener('change',listen);return;}update();};publisher.addEventListener('change',listen);update();
 form.onsubmit=async event=>{event.preventDefault();if(pending||publisher.busy)return;const config=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value]));pending=true;update();try{await publisher.configure(config);download(await publisher.generate(),'th-ink-site.zip');}catch(error){publisher.notify(error.message);}finally{pending=false;update();}};
}
