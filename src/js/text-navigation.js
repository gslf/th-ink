// All ranges are original UTF-16 offsets, matching textarea selection APIs.
const segmenters=new Map();
function segments(text,unit,lang){
 if(typeof Intl.Segmenter==='function'){
  const key=lang+unit;if(!segmenters.has(key))segmenters.set(key,new Intl.Segmenter(lang,{granularity:unit}));
  return [...segmenters.get(key).segment(text)].filter(s=>unit!=='word'||s.isWordLike).map(s=>[s.index,s.index+s.segment.length]);
 }
 const pattern=unit==='sentence'?/[^.!?\n]+(?:[.!?]+[”’"»)]*|$)/gu:unit==='word'?/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu:/\P{M}\p{M}*|\p{M}+/gu;
 return [...text.matchAll(pattern)].map(m=>[m.index,m.index+m[0].length]);
}
export function textUnits(text,unit='sentence',lang='it'){
 if(unit==='note')return text.length?[[0,text.length]]:[];
 if(unit==='character')return segments(text,'grapheme',lang);
 const paragraphs=[];let start=0;
 for(const m of text.matchAll(/\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/g)){paragraphs.push([start,m.index]);start=m.index+m[0].length;}paragraphs.push([start,text.length]);
 const trim=([s,e])=>{while(s<e&&/\s/u.test(text[s]))s++;while(e>s&&/\s/u.test(text[e-1]))e--;return [s,e];};
 const blocks=paragraphs.map(trim).filter(([s,e])=>s<e);
 if(unit==='paragraph')return blocks;
 return blocks.flatMap(([s,e])=>segments(text.slice(s,e),unit,lang).map(([a,b])=>trim([s+a,s+b])).filter(([a,b])=>a<b));
}
export function unitIndex(ranges,cursor){
 // Blank separators belong to the preceding unit; the exact next start belongs to the next unit.
 let at=ranges.findIndex(([s,e])=>s<=cursor&&cursor<e);
 if(at<0){at=ranges.findIndex(([s])=>s>cursor);at=at<0?ranges.length-1:Math.max(0,at-1);}return at;
}
export function textPosition(text,cursor,lang='it'){
 const paragraphs=textUnits(text,'paragraph',lang),p=unitIndex(paragraphs,cursor),r=paragraphs[p];
 const sentences=r?textUnits(text.slice(...r),'sentence',lang):[];
 return {paragraph:r?p+1:0,sentence:r&&sentences.length?unitIndex(sentences,cursor-r[0])+1:0};
}
export function resolveNavigation(text,selection,c,lang='it'){
 const count=c.count||1;if(!Number.isInteger(count)||count<1||count>100)return {error:'count'};
 const cursor=c.direction<0?selection[0]:(c.direction>0||['moveUnits','extendUnits'].includes(c.id))?selection[1]:selection[0];
 if(c.id==='collapseSelection'){const at=c.edge==='start'?selection[0]:selection[1];return {range:[at,at]};}
 let ranges=textUnits(text,c.unit,lang);
 if(c.scope==='paragraph'&&c.unit!=='paragraph'){
  const paragraphs=textUnits(text,'paragraph',lang),p=paragraphs[unitIndex(paragraphs,selection[0])];
  ranges=p?ranges.filter(([s,e])=>s>=p[0]&&e<=p[1]):[];
 }
 if(!ranges.length)return {error:'empty'};
 const at=unitIndex(ranges,cursor);
 if(c.id==='moveUnits'||c.id==='extendUnits'){
  const destinations=c.direction<0?ranges.map(r=>r[0]).filter(p=>p<ranges[at][0]).reverse():ranges.map(r=>r[0]).filter(p=>p>cursor);
  const target=destinations[count-1]??(c.direction<0?0:text.length);
  const anchor=c.direction<0?selection[1]:selection[0];
  return {range:c.id==='extendUnits'?[Math.min(anchor,target),Math.max(anchor,target)]:[target,target],boundary:count>destinations.length};
 }
 let index=c.number?c.number-1:c.which==='first'?0:c.which==='last'?ranges.length-count:at+(c.direction||0);
 if(index<0||index>=ranges.length)return {error:'boundary'};
 if(c.direction<0&&count>1)index-=count-1;
 if(index<0)return {error:'boundary'};
 const end=index+count-1;
 if(end>=ranges.length)return {error:'boundary'};
 const range=[ranges[index][0],ranges[end][1]];
 if(c.id==='extendEdge'){const target=range[c.edge==='end'?1:0];return {range:[Math.min(cursor,target),Math.max(cursor,target)]};}
 if(c.id==='moveEdge')return {range:[range[c.edge==='end'?1:0],range[c.edge==='end'?1:0]]};
 if(c.id==='gotoUnit')return {range:[range[0],range[0]]};
 return {range};
}
const units={frase:'sentence',frasi:'sentence',sentence:'sentence',sentences:'sentence',parola:'word',parole:'word',word:'word',words:'word',paragrafo:'paragraph',paragrafi:'paragraph',paragraph:'paragraph',paragraphs:'paragraph',carattere:'character',caratteri:'character',character:'character',characters:'character',nota:'note',note:'note'};
const numberWords=['uno','due','tre','quattro','cinque','sei','sette','otto','nove','dieci'];
const enNumbers=['one','two','three','four','five','six','seven','eight','nine','ten'];
const number=value=>/^\d+$/.test(value)?Number(value):['un','una','a'].includes(value)?1:Math.max(numberWords.indexOf(value),enNumbers.indexOf(value))+1;
export function parseNavigation(input){
 const v=input.toLowerCase().trim().replace(/^highlight /,'select ').replace(/^evidenzia /,'seleziona ').replace(/[.!?]+$/,'').replace(/[’']/g,' ').replace(/\s+/g,' ');
 let m;
 if(m=v.match(/^(avanti|indietro|forward|backward) (\w+) (frase|frasi|parola|parole|paragrafo|paragrafi|carattere|caratteri|sentences?|words?|paragraphs?|characters?)$/))return parseNavigation(`move ${m[2]} ${m[3]} ${m[1]==='avanti'||m[1]==='forward'?'forward':'backward'}`);
 if(m=v.match(/^(?:seleziona da qui |select from here )(?:all |alla |to the )(inizio|fine|start|end) (?:del |della |of the )(frase|paragrafo|nota|sentence|paragraph|note)$/))return {id:'extendEdge',unit:units[m[2]],edge:['fine','end'].includes(m[1])?'end':'start'};
 if(/^(?:deseleziona|deselect|annulla selezione|clear selection)$/.test(v))return {id:'collapseSelection',edge:'end'};
 if(m=v.match(/^(?:cursore|cursor) (?:all |alla |at the )?(inizio|fine|start|end) (?:della selezione|of selection)$/))return {id:'collapseSelection',edge:['inizio','start'].includes(m[1])?'start':'end'};
 if(m=v.match(/^(?:spostati|vai|muoviti|move|go|estendi selezione|extend selection) (?:di )?(\w+) (frase|frasi|parola|parole|paragrafo|paragrafi|carattere|caratteri|sentences?|words?|paragraphs?|characters?) (?:in )?(avanti|indietro|forward|backward|back)$/)){
  const count=number(m[1]);if(!count||count>100)return null;
  return {id:/^(estendi|extend)/.test(v)?'extendUnits':'moveUnits',unit:units[m[2]],count,direction:['avanti','forward'].includes(m[3])?1:-1};
 }
 if(m=v.match(/^(?:spostati |vai |muoviti |move |go )?(?:(?:al|alla|a|to the|to) )?(?:(frase|paragrafo|parola|sentence|paragraph|word) (successiv[oa]|precedente)|(next|previous) (sentence|paragraph|word))$/))return {id:'moveUnits',unit:units[m[1]||m[4]],count:1,direction:/successiv|next/.test(v)?1:-1};
 if(m=v.match(/^(?:vai |spostati |go |move )?(?:all |alla |a |to the |to )?(inizio|fine|start|end) (?:del |della |di |of the |of )?(frase|paragrafo|parola|nota|sentence|paragraph|word|note)$/))return {id:'moveEdge',unit:units[m[2]],edge:['fine','end'].includes(m[1])?'end':'start'};
 if(m=v.match(/^(?:vai alla frase|frase|go to sentence|sentence) (\w+)(?: (del paragrafo|della nota|in the paragraph|in the note))?$/)){
  const n=number(m[1]);if(n&&n<=100)return {id:'gotoUnit',unit:'sentence',number:n,scope:/nota|note/.test(m[2]||'')?'note':'paragraph'};
 }
 // IT and EN positional selection/read/edit/delete; scope is explicit for first/last.
 if(m=v.match(/^(seleziona|leggi|modifica|cancella|select|read|edit|delete) (.+)$/)){
  const action=({seleziona:'selectUnit',leggi:'readUnit',modifica:'editUnit',cancella:'deleteUnit',select:'selectUnit',read:'readUnit',edit:'editUnit',delete:'deleteUnit'})[m[1]];
  let rest=m[2].replace(/^(?:l |la |il |le |i |the )/,'');let scope;
  rest=rest.replace(/ (del paragrafo|della nota|in the paragraph|of the paragraph|in the note|of the note)$/,(_,s)=>{scope=/paragra|paragraph/.test(s)?'paragraph':'note';return '';});
  const tokens=rest.split(' '),u=tokens.find(t=>units[t]);if(!u||tokens.some(t=>!units[t]&&!/^(ultima|ultimo|ultime|ultimi|prima|primo|prime|primi|last|first|successiva|successivo|successive|successivi|precedente|precedenti|next|previous|corrente|current)$/.test(t)&&!number(t)))return null;
  const ordinal=tokens.find(t=>/^(ultima|ultimo|ultime|ultimi|prima|primo|prime|primi|last|first)$/.test(t));
  const direction=tokens.some(t=>/^successiv|^next$/.test(t))?1:tokens.some(t=>/^precedent|^previous$/.test(t))?-1:0;
  const n=tokens.find(t=>number(t)>0);const count=n?number(n):1;if(count>100)return null;
  if(n&&!direction&&!ordinal&&['frase','sentence','paragrafo','paragraph','parola','word'].includes(u))return {id:action,unit:units[u],number:count,scope:scope||(units[u]==='sentence'?'paragraph':'note')};
  return {id:action,unit:units[u],which:ordinal?/^(ultima|ultimo|ultime|ultimi|last)$/.test(ordinal)?'last':'first':'current',scope:scope||(ordinal?'paragraph':'note'),direction,count};
 }
 return null;
}
export function navigationGrammar(en=false){
 const out=en?['deselect','cursor at the start of selection','cursor at the end of selection']:['deseleziona','cursore all’inizio della selezione','cursore alla fine della selezione'];
 out.push(...(en?['select from here to the end of the paragraph','select from here to the start of the sentence']:['seleziona da qui alla fine del paragrafo','seleziona da qui all’inizio della frase']));
 const singular=en?['sentence','paragraph','word']:['frase','paragrafo','parola'];
 for(const u of singular){
  out.push(...(en?[`move to the next ${u}`,`move to the previous ${u}`,`start of ${u}`,`end of ${u}`]:[`spostati ${u==='paragrafo'?'al':'alla'} ${u} successiv${u==='paragrafo'?'o':'a'}`,`spostati ${u==='paragrafo'?'al':'alla'} ${u} precedente`,`inizio ${u}`,`fine ${u}`]));
 }
 for(const a of en?['select','read','edit','delete']:['seleziona','leggi','modifica','cancella']){
  for(const pos of en?['','first ','last ','next ','previous ']:['','prima ','ultima ','successiva ','precedente '])out.push(en?`${a} ${pos}sentence`:`${a} ${pos}frase`);
  for(const pos of en?['first','last']:['prima','ultima'])for(const scope of en?['paragraph','note']:['paragrafo','nota'])out.push(en?`${a} the ${pos} sentence in the ${scope}`:`${a} ${pos} frase ${scope==='nota'?'della':'del'} ${scope}`);
 }
 for(const [i,n] of (en?enNumbers:numberWords).entries()){
  const count=i+1;for(const u of en?['sentences','words','paragraphs','characters']:['frasi','parole','paragrafi','caratteri']){
   for(const direction of en?['forward','backward']:['avanti','indietro'])for(const action of en?['move','extend selection']:['spostati','estendi selezione'])out.push(`${action} ${n} ${u} ${direction}`);
   for(const direction of en?['next','previous']:['successive','precedenti'])out.push(en?`select the ${direction} ${n} ${u}`:`seleziona ${n} ${u} ${direction}`);
  }
  out.push(en?`go to sentence ${n}`:`vai alla frase ${n}`);
 }
 return [...out,...out.filter(p=>p.startsWith(en?'select ':'seleziona ')).map(p=>p.replace(en?/^select /:/^seleziona /,en?'highlight ':'evidenzia '))];
}
