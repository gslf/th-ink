import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalize,parseMarkdown,markdown,paragraphRange,previousParagraphRange,parseCommand,voiceIntent,renderMarkdown,folderPath} from '../dist/js/core.js';
import {zipFiles} from '../dist/js/archive.js';
test('Interoperable Markdown, Unicode, and folders',()=>{
 const n={title:'Idee è bello',body:'## Punti\n\n- [ ] Caffè\n\n```c\nint x;\n```\n'};
 assert.deepEqual(parseMarkdown(markdown(n)),n);
 assert.deepEqual(parseMarkdown('testo senza titolo','appunto.md'),{title:'appunto',body:'testo senza titolo'});
 assert.equal(normalize('CAFFÈ'),'caffe');
 assert.deepEqual(folderPath('b',[{id:'a',name:'Progetti',parent:null},{id:'b',name:'Privato',parent:'a'}]),['Progetti','Privato']);
});
test('editing at paragraph boundaries',()=>{
 const s='Uno.\n\nDue.\n\nTre.';
 assert.deepEqual(paragraphRange(s,0),[0,4]);
 assert.deepEqual(paragraphRange(s,7),[6,10]);
 assert.deepEqual(previousParagraphRange(s,7),[0,4]);
 assert.deepEqual(previousParagraphRange(s,0),[0,0]);
 assert.deepEqual(paragraphRange(s,s.length),[12,16]);
 assert.deepEqual(paragraphRange('',0),[0,0]);
});
test('dictation is separate from commands: no accidental deletion',()=>{
 assert.deepEqual(voiceIntent('cancella paragrafo'),{mode:'dictation',text:'cancella paragrafo'});
 assert.deepEqual(voiceIntent('Ehi think, cancella il paragrafo precedente'),{mode:'commands',command:{id:'deletePrevious'}});
 assert.deepEqual(voiceIntent('Hey think read note'),{mode:'commands',command:{id:'read'}});
 assert.equal(voiceIntent('frase non riconosciuta','commands').command,null);
 assert.equal(parseCommand('annulla comando').id,'cancel');
 assert.deepEqual(parseCommand('replace hello with hi'),{id:'replace',from:'hello',to:'hi'});
 assert.deepEqual(parseCommand('sostituisci ciao con salve'),{id:'replace',from:'ciao',to:'salve'});
 assert.deepEqual(parseCommand('sposta in Progetti'),{id:'move',value:'Progetti'});
});
test('preview does not execute HTML or active URLs',()=>{
 const output=renderMarkdown('<img src=x onerror=alert(1)>\n[x](javascript:alert(1))\n**ciao**\n`<script>`\n- [x] fatto');
 assert.ok(!output.includes('<img'));assert.ok(!output.includes('href="javascript:'));assert.ok(output.includes('<strong>ciao</strong>'));assert.ok(output.includes('&lt;script&gt;'));assert.ok(output.includes('type="checkbox" disabled checked'));assert.ok(output.includes('class="task-text">fatto'));assert.ok(!output.includes('☑'));
 assert.ok(renderMarkdown('[x](https://example.com)').includes('rel="noopener noreferrer"'));
});
test('C/WASM search: equivalence with includes for UTF-8 and edge cases',async()=>{
 const {instance:{exports:e}}=await WebAssembly.instantiate(await readFile(new URL('../dist/assets/search.wasm',import.meta.url)));
 const encoder=new TextEncoder(),heap=Number(e.__heap_base.value);
 let seed=42;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
 const corpus=['','caffè italiano e English','🍃 idee senza rumore','x'.repeat(10000), ...Array.from({length:500},()=>Array.from({length:random()%600},()=>String.fromCharCode(32+random()%94)).join(''))];
 for(const text of corpus){for(const query of ['',Array.from(text).slice(1,8).join(''),'italiano','xyz','🍃','fè']){const a=encoder.encode(text),b=encoder.encode(query);const memory=new Uint8Array(e.memory.buffer);memory.set(a,heap);memory.set(b,heap+a.length);assert.equal(!!e.contains(heap,a.length,heap+a.length,b.length),text.includes(query));}}
});
test('Dependency-free UTF-8 ZIP, headers, and content',async()=>{
 const blob=zipFiles([{path:'Pensieri/caffè.md',text:'# Caffè\n\nUn pensiero.'}]);const bytes=new Uint8Array(await blob.arrayBuffer());const v=new DataView(bytes.buffer);
 assert.equal(v.getUint32(0,true),0x04034b50);assert.equal(v.getUint16(6,true),0x800);assert.equal(v.getUint32(bytes.length-22,true),0x06054b50);
 const nameLength=v.getUint16(26,true);assert.equal(new TextDecoder().decode(bytes.slice(30,30+nameLength)),'Pensieri/caffè.md');
});

test('Markdown table with safe cells',()=>{const html=renderMarkdown('| Nome | Valore |\n| --- | --- |\n| **Caffè** | <script> |');assert.ok(html.includes('<table>'));assert.ok(html.includes('<strong>Caffè</strong>'));assert.ok(html.includes('&lt;script&gt;'));});
