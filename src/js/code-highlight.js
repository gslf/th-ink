import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import java from 'highlight.js/lib/languages/java';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';
import ini from 'highlight.js/lib/languages/ini';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
for(const [name,grammar] of Object.entries({javascript,typescript,python,bash,json,xml,css,sql,yaml,cpp,c,java,csharp,go,rust,php,ruby,swift,kotlin,ini,diff,dockerfile}))hljs.registerLanguage(name,grammar);
// xCDN: typed strings, tags and annotations extend its JSON-like structure.
hljs.registerLanguage('xcdn',h=>({name:'xCDN',unicodeRegex:true,contains:[
 h.C_LINE_COMMENT_MODE,h.C_BLOCK_COMMENT_MODE,
 {scope:'string',begin:/"""/,end:/"""/,contains:[h.BACKSLASH_ESCAPE]},
 {scope:'string',begin:/\b[dutrb]"/,end:/"/,contains:[h.BACKSLASH_ESCAPE]},
 {scope:'attr',begin:/"(?:\\.|[^"\\])*"(?=\s*:)/},h.QUOTE_STRING_MODE,
 {scope:'attr',begin:/[$\p{L}_][\p{L}\p{N}_$.-]*(?=\s*:)/u},
 {scope:'meta',begin:/[@#][\p{L}_][\p{L}\p{N}_.-]*/u},
 {scope:'literal',begin:/\b(?:true|false|null)\b/},h.C_NUMBER_MODE
 ]}));
const aliases={js:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',py:'python',sh:'bash',shell:'bash',zsh:'bash',html:'xml',svg:'xml',yml:'yaml',cs:'csharp','c++':'cpp','c#':'csharp',rs:'rust',rb:'ruby',toml:'ini',jsonc:'json'};
export function codeLanguage(info=''){const name=String(info).trim().split(/\s+/)[0].toLowerCase();return aliases[name]||name;}
const escape=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;'}[c]));
const cache=new Map();let cacheSize=0;
// A bounded cache avoids highlighting unchanged blocks on every edit/export.
// Unlabelled and very large blocks stay plain: ASCII art is never guessed as code.
export function highlightCode(source,info=''){
 const text=String(source),language=codeLanguage(info);
 if(!hljs.getLanguage(language)||text.length>100000)return escape(text);
 const key=language+'\0'+text;if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
 let html;try{html=hljs.highlight(text,{language,ignoreIllegals:true}).value;}catch{html=escape(text);}
 const size=key.length+html.length;if(size<=500000){while(cache.size&&(cacheSize+size>500000||cache.size>=64)){const oldest=cache.keys().next().value;cacheSize-=oldest.length+cache.get(oldest).length;cache.delete(oldest);}cache.set(key,html);cacheSize+=size;}return html;
}
export function renderCodeBlock(text,info=''){const lang=codeLanguage(info),label=hljs.getLanguage(lang)?` class="language-${lang}"`:'';return `<pre tabindex="0"><code${label}>${highlightCode(text,info)}</code></pre>`;}
// Highlight.js emits only escaped text and span tags. Convert those spans to
// source offsets for CodeMirror, without parsing or modifying the note's DOM.
export function codeTokens(text,info){
 if(!hljs.getLanguage(codeLanguage(info))||text.length>100000)return [];
 const html=highlightCode(text,info),stack=[],ranges=[];let offset=0;
 for(const match of html.matchAll(/<span class="([^"]+)">|<\/span>|([^<]+)/g)){
  if(match[1])stack.push(match[1]);else if(match[0]==='</span>')stack.pop();else{
   const value=match[2].replace(/&(amp|lt|gt|quot|#x27|#39);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"','#x27':"'",'#39':"'"}[entity]));
   if(stack.length&&value.length)ranges.push({from:offset,to:offset+value.length,class:stack.join(' ')});offset+=value.length;
  }
 }
 return offset===text.length?ranges:[];
}
