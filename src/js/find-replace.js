import {t} from './i18n.js';
export function textMatches(body,query,matchCase=false){
 if(!query)return [];
 const escaped=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return [...body.matchAll(new RegExp(escaped,matchCase?'gu':'giu'))].map(m=>({from:m.index,to:m.index+m[0].length}));
}
export function replacementEdit(body,matches,replacement,selection=[0,0]){
 let text='',at=0;
 for(const m of matches){text+=body.slice(at,m.from)+replacement;at=m.to;}
 text+=body.slice(at);
 const map=position=>{let delta=0;for(const m of matches){if(position<m.from)break;if(position<=m.to)return m.from+delta+Math.min(position-m.from,replacement.length);delta+=replacement.length-(m.to-m.from);}return position+delta;};
 return {text,selection:selection.map(map)};
}
export function searchNotes(notes,query,{scope='all',current,matchCase=false}={}){
 return notes.filter(n=>!n.deleted&&(scope==='all'||n.id===current)).map(n=>({id:n.id,title:n.title,body:n.body,matches:textMatches(n.body,query,matchCase)})).filter(n=>n.matches.length);
}
export function mountFindReplace(parent,{scope,notes,current,memory,readOnly,replace,locate}){
 const el=(tag,content,cls)=>{const e=document.createElement(tag);if(content)e.textContent=content;if(cls)e.className=cls;return e;};
 const panel=el('div',null,'find-panel');parent.append(panel);
 panel.append(el('p',t(scope==='all'?'Contenuto di tutte le note, escluso il cestino.':'Contenuto della nota corrente.')));
 const fields=el('div',null,'find-fields');panel.append(fields);
 const field=(id,label,value)=>{const group=el('label',t(label));group.htmlFor=id;const input=el('input');input.id=id;input.type='text';input.autocomplete='off';input.value=value||'';group.append(input);fields.append(group);return input;};
 const query=field('find-query','Trova',memory.query),replacement=field('find-replacement','Sostituisci con',memory.replacement);
 const caseLabel=el('label',null,'find-case'),matchCase=el('input');matchCase.type='checkbox';matchCase.checked=!!memory.matchCase;caseLabel.append(matchCase,document.createTextNode(t('Distingui maiuscole e minuscole')));panel.append(caseLabel);
 const status=el('p',null,'find-status');status.setAttribute('role','status');panel.append(status);
 const results=el('div',null,'find-results');panel.append(results);
 const actions=el('div',null,'find-actions'),all=el('button',t('Sostituisci tutto'),'primary');all.id='find-replace-all';actions.append(all);panel.append(actions);
 let busy=false,hits=[];
 function render(){
  memory.query=query.value;memory.replacement=replacement.value;memory.matchCase=matchCase.checked;
  hits=searchNotes(notes(),query.value,{scope,current:current(),matchCase:matchCase.checked});
  const count=hits.reduce((n,h)=>n+h.matches.length,0);
  status.textContent=query.value?t('Occorrenze: {matches} · Note: {notes}',{matches:count,notes:hits.length}):t('Scrivi il testo da cercare.');
  all.disabled=busy||readOnly()||!count;results.replaceChildren();
  let shown=0;
  for(const note of hits)for(const match of note.matches){
   if(shown++>=20)break;
   const row=el('button',null,'find-result'),name=el('strong',note.title||t('Senza titolo')),excerpt=el('span');
   excerpt.append(document.createTextNode((match.from>44?'…':'')+note.body.slice(Math.max(0,match.from-44),match.from)),el('mark',note.body.slice(match.from,match.to)),document.createTextNode(note.body.slice(match.to,match.to+64)+(match.to+64<note.body.length?'…':'')));
   row.append(name,excerpt);row.onclick=()=>locate(note,match);results.append(row);
  }
  if(count>20)results.append(el('p',t('Mostrate le prime 20 occorrenze. La sostituzione comprende tutti i risultati.')));
 }
 for(const input of [query,replacement,matchCase])input.addEventListener('input',render);
 all.onclick=async()=>{
  if(busy||all.disabled)return;busy=true;
  const targets=hits.map(h=>({...h,matches:h.matches.map(m=>({...m}))})),value=replacement.value;
  for(const control of panel.querySelectorAll('input,button'))control.disabled=true;
  try{await replace(targets,value);render();status.textContent=t('Sostituzioni: {matches} · Note aggiornate: {notes}',{matches:targets.reduce((n,h)=>n+h.matches.length,0),notes:targets.length});}
  catch(error){status.textContent=t(error.message);}
  finally{busy=false;for(const control of panel.querySelectorAll('input,button'))control.disabled=false;all.disabled=readOnly()||!searchNotes(notes(),query.value,{scope,current:current(),matchCase:matchCase.checked}).length;}
 };
 panel.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target===query){event.preventDefault();results.querySelector('button')?.click();}});
 render();query.focus({preventScroll:true});query.select();
}
