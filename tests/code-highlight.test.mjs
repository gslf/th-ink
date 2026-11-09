import test from 'node:test';
import assert from 'node:assert/strict';
import {highlightCode,codeTokens} from '../src/js/code-highlight.js';
import {renderMarkdown} from '../src/js/core.js';
import {renderPublishedMarkdown} from '../src/js/publish-markdown.js';
import {NoteFont,noteFonts} from '../src/js/note-font.js';
const plain=html=>html.replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|#x27|#39);/g,(_,e)=>({amp:'&',lt:'<',gt:'>',quot:'"','#x27':"'",'#39':"'"}[e]));
const samples={js:'const answer = "<safe>"; // hello',ts:'interface Item { size: number }',python:'def hello():\n    return True',json:'{ "hello": true, "n": 42 }',xCDN:'$schema: "v1",\nserver: #host @port(80) { timeout: r"PT30S", cost: d"2.50", note: """two\nlines""", enabled: true } // xcdn',xml:'<root attr="value">&amp;</root>',bash:'#!/bin/bash\necho "$HOME"',css:'.box { color: red; }',sql:'SELECT * FROM notes WHERE id = 1;',yaml:'name: test\nport: 42',c:'int main(void) { return 0; }',cpp:'std::string name = "test";',java:'class Note { int n = 1; }',cs:'public class Note { }',go:'package main\nfunc main() {}',rust:'fn main() { let x = 42; }',php:'<?php echo "hello";',ruby:'def hello\n  puts "hi"\nend',swift:'let x: Int = 42',kotlin:'val x: Int = 42',toml:'[server]\nport = 8080',diff:'-old\n+new',dockerfile:'FROM alpine\nRUN echo hi'};
test('supported languages highlight without changing source text or offsets',()=>{
 for(const [language,code] of Object.entries(samples)){
  const html=highlightCode(code,language);assert(html.includes('hljs-'),language);assert.equal(plain(html),code,language);
  const ranges=codeTokens(code,language);assert(ranges.length,language);for(const r of ranges)assert(r.from>=0&&r.to<=code.length&&r.to>r.from,language);
 }
});
test('read and static export preserve ASCII art, whitespace, tabs and nested fence text',()=>{
 const art='  +--------+\n  | /\\  /\\ |\n\n\t+--------+  \n<>&"\'';
 for(const render of [renderMarkdown,s=>renderPublishedMarkdown(s).html]){
  for(const language of ['', 'text','unknown','json']){
   const html=render('````'+language+'\n'+art+'\n```\n````');
   assert.equal(plain(html),art+'\n```');assert(!html.includes('<>&'));
  }
  assert.equal(plain(render('~~~text\nhello\n~~~')),'hello');
  assert.equal(plain(render('```text\nunterminated')),'unterminated');
  assert(render('```json\n{"x": 1}\n```').includes('hljs-attr'));
 }
 assert(!highlightCode(art).includes('hljs-'));assert(!highlightCode(art,'ascii').includes('hljs-'));
 assert.equal(plain(highlightCode('<script>alert(1)</script>','xml')),'<script>alert(1)</script>');
});
test('font preferences persist, reject arbitrary CSS and serialize rapid changes',async()=>{
 const saved=new Map(),applied=[];let fail=false;
 const db={get:async(_,id)=>saved.get(id),put:async(_,row)=>{if(fail)throw Error('disk full');saved.set(row.id,row);}};
 const font=new NoteFont({db,root:{style:{setProperty:(key,value)=>applied.push([key,value])}}});
 await font.restore();assert.equal(font.preference,'georgia');await Promise.all([font.set('mono'),font.set('courier')]);assert.equal(font.preference,'courier');
 await font.restore();assert.equal(font.preference,'courier');assert.equal(saved.get('note-font').value,'courier');
 assert(applied.every(([key])=>key==='--note-font'));assert.equal(noteFonts.filter(f=>f.family.includes('monospace')).length,2);
 await font.set('url(https://bad.test/font)');assert.equal(font.preference,'georgia');
 fail=true;await assert.rejects(font.set('arial'));assert.equal(font.preference,'georgia');
});
