import {pruneReminderMetadata} from './reminder-model.js';
import {propertiesHeader,readPropertiesHeader} from './note-properties.js';
export const normalize = value => value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase().replace(/[’]/g,"'");
export const uid = () => crypto.randomUUID();
export const markdown = note => {const clean={...note};pruneReminderMetadata(clean);return propertiesHeader(clean)+`# ${note.title || 'Senza titolo'}\n\n${note.body}`;};
export function parseMarkdown(text, name = 'Senza titolo') {
 const decoded=readPropertiesHeader(text);text=decoded.text;
 const match = text.match(/^# ([^\r\n]+)\r?\n(?:\r?\n)?/);
 return {title:match ? match[1] : name.replace(/\.md$/i,''), body:match ? text.slice(match[0].length) : text,...decoded.properties};
}
export function safeName(name) { return name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/,'').slice(0,100) || 'Senza titolo'; }
export function folderPath(id, folders) {
 const parts=[], seen=new Set();
 while(id && !seen.has(id)) { seen.add(id); const f=folders.find(f=>f.id===id); if(!f) break; parts.unshift(f.name); id=f.parent; }
 return parts;
}
export function paragraphRange(text, cursor) {
 const position = Math.min(Math.max(cursor,0),text.length);
 const left=text.lastIndexOf('\n\n',Math.max(0,position-1));
 const start=left < 0 ? 0 : left+2;
 const right=text.indexOf('\n\n',position);
 return [start, right < 0 ? text.length : right];
}
export function previousParagraphRange(text,cursor) {
 const [start] = paragraphRange(text,cursor);
 if(!start) return [0,0];
 return paragraphRange(text,start-2);
}
export function replaceRange(text,start,end,replacement) {return text.slice(0,start)+replacement+text.slice(end);}
const escape = text => text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function inline(text) {
 // Escape all source first; only permit generated markup and safe link protocols.
 let tokens=[];
 const token=value=>{tokens.push(value);return `\u0000${tokens.length-1}\u0000`;};
 text=text.replace(/\u0000/g,'');
 text=text.replace(/`([^`]+)`/g,(_,x)=>token(`<code>${escape(x)}</code>`));
 text=escape(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_,label,url)=> (/^note:[a-zA-Z0-9_-]{1,180}$/.test(url) ? token(`<button type="button" class="note-inline-link" data-note-link="${url.slice(5)}">${label}</button>`) : /^reminder:[a-zA-Z0-9_-]{1,64}$/.test(url) ? token(`<button type="button" class="reminder-inline" data-reminder="${url.slice(9)}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="14" r="8"/><path d="M9 2h6M12 2v4m6 1 2-2M12 10v4l2 2"/></svg><span>${label}</span></button>`) : /^(https?:\/\/|mailto:)/i.test(url) ? token(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`) : `${label} (${url})`));
 text=text.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/~~(.+?)~~/g,'<del>$1</del>').replace(/\*([^*]+)\*/g,'<em>$1</em>');
 return text.replace(/\u0000(\d+)\u0000/g,(_,n)=>tokens[Number(n)]);
}
export function renderMarkdown(text) {
 const lines=text.replace(/\r/g,'').split('\n');let html='',code=false,buf=[],lists=[];
 const popList=()=>{const list=lists.pop();html+=`</li></${list.type}>`;};
 const close=()=>{while(lists.length)popList();};
 for(let row=0;row<lines.length;row++){
  const line=lines[row];
  if(/^```/.test(line)){close();if(code){html+=`<pre><code>${escape(buf.join('\n'))}</code></pre>`;buf=[];}code=!code;continue;}
  if(code){buf.push(line);continue;}
  if(line.includes('|') && row+1<lines.length && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[row+1])){
   close();const cells=value=>value.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
   html+='<div class="table-scroll"><table><thead><tr>'+cells(line).map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>';row++;
   while(row+1<lines.length&&lines[row+1].includes('|')&&lines[row+1].trim()){row++;html+='<tr>'+cells(lines[row]).map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>';}
   html+='</tbody></table></div>';continue;
  }
  if(!line.trim()&&lists.length)continue;
  const item=line.match(/^([ \t]*)([-+*]|\d+[.)]) (.*)$/);
  if(item){
   const indent=[...item[1]].reduce((n,c)=>c==='\t'?n+4-n%4:n+1,0),type=/^\d/.test(item[2])?'ol':'ul';
   while(lists.length&&lists.at(-1).indent>indent)popList();
   if(lists.length&&lists.at(-1).indent===indent&&lists.at(-1).type!==type)popList();
   if(!lists.length||lists.at(-1).indent<indent){const start=type==='ol'&&parseInt(item[2])!==1?` start="${parseInt(item[2])}"`:'';const marker=type==='ul'&&lists.length?` class="list-${lists.length%2?'circle':'square'}"`:'';html+=`<${type}${start}${marker}>`;lists.push({indent,type});}
   else html+='</li>';
   const task=item[3].match(/^\[([ xX])\](?: (.*))?$/);
   html+=task?`<li class="task"><label class="task-label"><span class="task-marker"><input type="checkbox" disabled${task[1]===' '?'':' checked'}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3.5 3.5L15 7"/></svg></span><span class="task-text">${inline(task[2]||'')}</span></label>`:`<li>${inline(item[3])}`;continue;
  }
  close();const heading=line.match(/^(#{1,6})\s+(.*)$/);
  if(heading){const n=heading[1].length;html+=`<h${n}>${inline(heading[2])}</h${n}>`;}
  else if(/^> ?/.test(line))html+=`<blockquote>${inline(line.replace(/^> ?/,''))}</blockquote>`;
  else if(/^---+$/.test(line))html+='<hr>';
  else if(line)html+=`<p>${inline(line)}</p>`;
 }
 close();if(code)html+=`<pre><code>${escape(buf.join('\n'))}</code></pre>`;return html;
}
const commands = [
 ['copy',['copia','copy']],['cut',['taglia','cut']],['paste',['incolla','paste']],['indent',['rientra','indent']],['outdent',['riduci rientro','outdent']],['table',['tabella','table']],['clearFormat',['rimuovi formattazione','clear formatting']],['duplicateParagraph',['duplica paragrafo','duplicate paragraph']],['moveUp',['sposta paragrafo sopra','move paragraph up']],['moveDown',['sposta paragrafo sotto','move paragraph down']],['undo',['annulla','undo']],['redo',['ripeti','redo']],['new',['nuova nota','new note']],
 ['selectAll',['seleziona tutto','select all']],['selectParagraph',['seleziona paragrafo','select paragraph']],
 ['previous',['paragrafo precedente','previous paragraph']],['next',['paragrafo successivo','next paragraph']],
 ['deletePrevious',['cancella il paragrafo precedente','cancella paragrafo precedente','delete previous paragraph']],
 ['deleteParagraph',['cancella paragrafo','delete paragraph']],['deleteSelection',['cancella selezione','delete selection']],
 ['read',['leggi nota','rileggi nota','read note']],['readParagraph',['leggi paragrafo','rileggi paragrafo','read paragraph']],
 ['readPrevious',['leggi il paragrafo precedente','rileggi il paragrafo precedente','read previous paragraph']],
 ['readSelection',['leggi selezione','read selection']],['stopReading',['ferma lettura','stop reading']],
 ['bold',['grassetto','bold']],['italic',['corsivo','italic']],['strike',['barrato','strikethrough']],
 ['heading',['titolo','heading']],['bullet',['elenco','bullet list']],['numbered',['elenco numerato','numbered list']],
 ['task',['casella','checklist']],['toggleTask',['spunta casella','toggle checkbox']],['quote',['citazione','quote']],
 ['code',['codice','code']],['codeBlock',['blocco codice','code block']],['link',['collegamento','link']],
 ['newline',['a capo','new line']],['paragraph',['nuovo paragrafo','new paragraph']],
 ['start',['inizio nota','start of note']],['end',['fine nota','end of note']],['where',['dove sono','where am i']],
 ['save',['salva','save']],['focus',['concentrazione','focus']],['help',['aiuto','help']],
 ['dictation',['dettatura','scrivi','dictation']],['commands',['comandi','commands']],['stop',['stop','ferma ascolto','stop listening']],
 ['confirm',['conferma','confirm']],['cancel',['annulla comando','cancel']],
 ['pin',['preferita','pin note']],['duplicate',['duplica nota','duplicate note']],['trash',['cestina nota','trash note']],
 ['export',['esporta nota','export note']],['date',['inserisci data','insert date']]
];
export function parseCommand(input) {
 const value=normalize(input).trim().replace(/[.!?]+$/,'');
 for(const [id, aliases] of commands)if(aliases.includes(value))return {id};
 const replace=input.trim().match(/^(?:sostituisci|replace)\s+(.+?)\s+(?:con|with)\s+(.+?)[.!?]?$/i);
 if(replace)return {id:'replace',from:replace[1],to:replace[2]};
 for(const [id,pattern] of [['selectText',/^(?:seleziona testo|select text)\s+(.+)$/i],['openResult',/^(?:apri risultato|open result)\s+(\d+)$/i],['search',/^(?:cerca|search for)\s+(.+)$/i],['rename',/^(?:rinomina nota|rename note)\s+(.+)$/i],['insert',/^(?:inserisci|insert)\s+(.+)$/i],['open',/^(?:apri nota|open note)\s+(.+)$/i],['move',/^(?:sposta in|move to)\s+(.+)$/i],['folder',/^(?:crea cartella|create folder)\s+(.+)$/i]]){const m=input.trim().match(pattern);if(m)return {id,value:m[1]};}
 return null;
}
export function voiceIntent(input,mode='dictation') {
 const wake=input.match(/^(?:ehi\s+think|hey\s+think|hey\s+th[ .]?ink|modalit[aà]\s+comando|command\s+mode)[,.:!]?\s*(.*)$/i);
 if(wake)return {mode:'commands',command:wake[1]?parseCommand(wake[1]):{id:'commands'}};
 if(mode==='commands')return {mode,command:parseCommand(input)};
 return {mode,text:input};
}
