import {renderCodeBlock} from './code-highlight.js';
// Export-only Markdown renderer. Raw HTML is always text; links resolve only
// inside the public selection or to explicitly allowed external protocols.
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const headingSlug=value=>String(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'')||'section';
export function plainText(value){return String(value).replace(/^<!--[\s\S]*?-->\s*/,'').replace(/!?(?:\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/g,(_,a,b)=>b||a).replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,' ').replace(/^[ \t]*(?:#{1,6}\s+|>\s*|[-+*]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/gm,'').replace(/[`*_~]/g,'').replace(/\s+/g,' ').trim();}
export function renderPublishedMarkdown(source,{link=()=>null}={}){
 const headings=[],links=new Set(),warnings=new Set(),used=new Map();
 const inline=text=>{
  const tokens=[];const hold=html=>{tokens.push(html);return `\0${tokens.length-1}\0`;};
  const linked=(label,url,image=false)=>{
   const title=escapeHTML(label);url=url.trim().replace(/^<|>$/g,'');
   if(/^reminder:/i.test(url))return title;
   if(!/[\x00-\x20\x7f]/.test(url)&&/^https?:\/\//i.test(url)){
    try{const parsed=new URL(url);if(parsed.username||parsed.password)throw Error();
     return image?`<img src="${escapeHTML(parsed.href)}" alt="${title}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:`<a href="${escapeHTML(parsed.href)}" target="_blank" rel="noopener noreferrer">${title}</a>`;
    }catch{return title;}
   }
   if(!image&&/^mailto:[^\s<>]+$/i.test(url))return `<a href="${escapeHTML(url)}">${title}</a>`;
   if(image){warnings.add('image');return title;}
   if(url.startsWith('#')){let fragment=url.slice(1);try{fragment=decodeURIComponent(fragment);}catch{}return `<a href="#${escapeHTML(headingSlug(fragment))}">${title}</a>`;}
   const resolved=link(url);
   if(resolved){links.add(resolved.key);return `<a href="${escapeHTML(resolved.href)}">${title}</a>`;}
   warnings.add('link');return `<span class="unpublished-link">${title}</span>`;
  };
  text=String(text).replace(/\0/g,'').replace(/`([^`]+)`/g,(_,v)=>hold(`<code>${escapeHTML(v)}</code>`));
  text=text.replace(/(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_,image,url,label)=>hold(linked(label||url.split('/').at(-1).replace(/\.md$/i,''),url,!!image)));
  text=text.replace(/(!?)\[([^\]]*)\]\((<[^>\n]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g,(_,image,label,url)=>hold(linked(label,url,!!image)));
  text=escapeHTML(text).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/__(.+?)__/g,'<strong>$1</strong>').replace(/~~(.+?)~~/g,'<del>$1</del>').replace(/\*([^*]+)\*/g,'<em>$1</em>').replace(/_([^_]+)_/g,'<em>$1</em>');
  // Tokens are expanded only once, so source text cannot become executable markup.
  return text.replace(/\0(\d+)\0/g,(_,i)=>tokens[+i]||'');
 };
 const lines=String(source).replace(/\r/g,'').split('\n');let html='',fence=null,language='',code=[],paragraph=[],lists=[];
 const endParagraph=()=>{if(paragraph.length){html+='<p>'+inline(paragraph.join('\n')).replace(/\n/g,'<br>')+'</p>';paragraph=[];}};
 const popList=()=>{html+=`</li></${lists.pop().type}>`;};const endLists=()=>{while(lists.length)popList();};
 for(let row=0;row<lines.length;row++){
  const line=lines[row],f=line.match(/^\s{0,3}(`{3,}|~{3,})([^`]*)$/);
  if(fence){if(f&&f[1][0]===fence[0]&&f[1].length>=fence.length&&!f[2].trim()){html+=renderCodeBlock(code.join('\n'),language);code=[];fence=null;}else code.push(line);continue;}
  if(f){endParagraph();endLists();fence=f[1];language=f[2];continue;}
  if(!line.trim()){endParagraph();continue;}
  if(line.includes('|')&&/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[row+1]||'')){
   endParagraph();endLists();const cells=v=>v.trim().replace(/^\||\|$/g,'').split('|').map(x=>inline(x.trim()));
   html+='<div class="table-scroll" tabindex="0"><table><thead><tr>'+cells(line).map(x=>'<th scope="col">'+x+'</th>').join('')+'</tr></thead><tbody>';row++;
   while(lines[row+1]?.includes('|')&&lines[row+1].trim()){row++;html+='<tr>'+cells(lines[row]).map(x=>'<td>'+x+'</td>').join('')+'</tr>';}
   html+='</tbody></table></div>';continue;
  }
  const item=line.match(/^([ \t]*)([-+*]|\d+[.)]) (.*)$/);
  if(item){endParagraph();const indent=[...item[1]].reduce((n,c)=>c==='\t'?n+4-n%4:n+1,0),type=/^\d/.test(item[2])?'ol':'ul';
   while(lists.length&&lists.at(-1).indent>indent)popList();
   if(lists.length&&lists.at(-1).indent===indent&&lists.at(-1).type!==type)popList();
   if(!lists.length||lists.at(-1).indent<indent){html+=`<${type}${type==='ol'?` start="${parseInt(item[2])}"`:''}>`;lists.push({indent,type});}else html+='</li>';
   const task=item[3].match(/^\[([ xX])\](?: (.*))?$/);html+=task?`<li class="task"><input type="checkbox" disabled${task[1]===' '?'':' checked'} aria-label="${escapeHTML(plainText(task[2]||'Task'))}"><span>${inline(task[2]||'')}</span>`:`<li>${inline(item[3])}`;continue;
  }
  endLists();const h=line.match(/^(#{1,6})\s+(.*)$/);
  if(h){endParagraph();const title=plainText(h[2]),base=headingSlug(title),count=used.get(base)||0;used.set(base,count+1);const id=base+(count?'-'+(count+1):''),level=Math.max(2,h[1].length);headings.push({title,id,level});html+=`<h${level} id="${escapeHTML(id)}">${inline(h[2])}<a class="heading-anchor" href="#${escapeHTML(id)}" aria-label="${escapeHTML(title)}">#</a></h${level}>`;}
  else if(/^> ?/.test(line)){endParagraph();html+='<blockquote>'+inline(line.replace(/^> ?/,''))+'</blockquote>';}
  else if(/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)){endParagraph();html+='<hr>';}
  else paragraph.push(line);
 }
 endParagraph();endLists();if(fence)html+=renderCodeBlock(code.join('\n'),language);
 return {html,headings,links:[...links],warnings:[...warnings]};
}
