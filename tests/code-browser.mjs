import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {buildPublishedSite,selectPublishedNotes} from '../src/js/publish-model.js';
const art='  +------------+\n  | /\\    /\\  |\n  | ( o  o )   |\n\n  +------------+\n\tTAB     END';
const long='|'+'.'.repeat(140)+'|';
const source='# Typography\n\nA quiet **paragraph** with `inline code`.\n\n```text\n'+art+'\n'+long+'\n```\n\n```json\n{ "name": "th.ink", "enabled": true, "count": 42 }\n```\n\n```xcdn\nserver: #host @port(80) { timeout: r"PT30S", cost: d"2.50" }\n```\n\nBack to normal prose.';
await mkdir('tests/reports/code',{recursive:true});
const assets=Object.fromEntries(await Promise.all(['site.css','site.js','code.css','favicon.svg'].map(async name=>[name,await readFile('src/assets/publish/'+name,'utf8')])));
const site=await buildPublishedSite({notes:selectPublishedNotes([{id:'n',folder:'f',title:'Code and typography',body:source,created:1}], [{id:'f',name:'Public'}],'f'),config:{folder:'f',title:'Code notes',url:'https://example.test/'},assets});
const files=new Map(site.files.map(f=>['/'+f.path,f.text]));
const server=createServer((req,res)=>{const path=req.url==='/'?'/index.html':req.url;res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':path.endsWith('.json')?'application/json':'text/html');res.end(files.get(path)||'');});
await new Promise(r=>server.listen(4197,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
try{
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:960},locale:'en-US',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/__i18nqa.html');
  await page.evaluate(async source=>{const a=await import('./js/app.js');await a.appReady;await a.dailyBackup.enable(false);const e=document.querySelector('#editor');e.value=source;e.dispatchEvent(new Event('input'));await a.flush();},source);
  if(await page.locator('#setup-dismiss').isVisible())await page.locator('#setup-dismiss').click();
  const gui=await page.locator('.format-bar').evaluate(e=>getComputedStyle(e).fontFamily);
  await page.evaluate(async()=>{const a=await import('./js/app.js');await a.execute('settings');});
  for(const font of ['mono','courier','arial']){await page.locator('#note-font').selectOption(font);await page.waitForFunction(font=>document.documentElement.style.getPropertyValue('--note-font').includes(font==='arial'?'Arial':font==='courier'?'Courier':'ui-monospace'),font);assert.equal(await page.locator('.format-bar').evaluate(e=>getComputedStyle(e).fontFamily),gui);}
  await page.keyboard.press('Escape');await settle(page);
  assert((await page.locator('#editor').evaluate(e=>getComputedStyle(e).fontFamily)).includes('Arial'));
  const metrics=await page.locator('.cm-code-line:not(.cm-code-fence)').first().evaluate(e=>{const s=getComputedStyle(e);return {family:s.fontFamily,size:s.fontSize,line:s.lineHeight,white:s.whiteSpace,spacing:s.letterSpacing};});
  assert(metrics.family.includes('monospace'));assert.equal(metrics.line,'21px');assert.equal(metrics.white,'pre');
  assert(await page.locator('#editor .hljs-attr').count()>0);
  const json=await page.locator('#editor .hljs-attr').first().evaluate(e=>({size:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight,color:getComputedStyle(e).color,parent:getComputedStyle(e.closest('.cm-code-line')).color}));assert.equal(json.size,'14px');assert.equal(json.line,'21px');assert.notEqual(json.color,json.parent);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await page.locator('#editor').evaluate(e=>{const prose=[...e.querySelectorAll('.cm-line')].find(line=>line.textContent.startsWith('A quiet'));return prose.getBoundingClientRect().width<=e.clientWidth+1;}),'Wide code must not expand normal prose');
  // Long code stays on one line; the editor scrolls horizontally to reveal the caret.
  await page.evaluate(long=>{const e=document.querySelector('#editor'),at=e.value.indexOf(long)+long.length;e.setSelectionRange(at,at);e.focus();e.ensureCaretVisible();},long);await settle(page);
  assert(await page.locator('.cm-scroller').evaluate(e=>e.scrollLeft>0));
  const caret=await page.locator('#editor').evaluate(e=>{const v=e.markdownView,r=v.scrollDOM.getBoundingClientRect(),c=v.coordsAtPos(v.state.selection.main.head);return {left:r.left,right:r.right,caret:c.right};});assert(caret.caret<=caret.right+1&&caret.caret>=caret.left);
  await page.evaluate(()=>{const e=document.querySelector('#editor');e.setSelectionRange(0);e.focus();e.ensureCaretVisible();});await settle(page);await page.screenshot({path:`tests/reports/code/write-${width}.png`});
  await page.locator('#preview-tab').click();await settle(page);
  assert.equal(await page.locator('#preview pre').first().textContent(),art+'\n'+long);
  const read=await page.locator('#preview pre').first().evaluate(e=>{const s=getComputedStyle(e),c=getComputedStyle(e.firstElementChild);return {line:s.lineHeight,codeLine:c.lineHeight,family:c.fontFamily,overflow:e.scrollWidth>e.clientWidth};});assert.equal(read.line,'21px');assert.equal(read.codeLine,'21px');assert(read.overflow);assert(read.family.includes('monospace'));
  assert(await page.locator('#preview .hljs-attr').count()>0);await page.screenshot({path:`tests/reports/code/read-${width}.png`});
  await page.reload();await page.evaluate(async()=>{await(await import('./js/app.js')).appReady;});assert((await page.locator('#editor').evaluate(e=>getComputedStyle(e).fontFamily)).includes('Arial'));
  await page.evaluate(async()=>{const a=await import('./js/app.js');await a.execute('focus');await a.appearance.set('dark');});await settle(page);assert.equal(await page.locator('.cm-code-line:not(.cm-code-fence)').first().evaluate(e=>getComputedStyle(e).lineHeight),'21px');await page.screenshot({path:`tests/reports/code/zen-${width}.png`});
  assert.deepEqual(errors,[]);await context.close();console.log('PASS fonts, GUI isolation, write/read/zen code, caret visibility and persistence '+width);
  const exported=await browser.newContext({viewport:{width,height:960},javaScriptEnabled:false}),post=await exported.newPage();await post.goto('http://127.0.0.1:4197/'+site.files.find(f=>f.path.startsWith('posts/')).path);assert.equal(await post.locator('.prose pre').first().textContent(),art+'\n'+long);assert(await post.locator('.prose .hljs-attr').count()>0);assert.equal(await post.locator('.prose pre code').first().evaluate(e=>getComputedStyle(e).lineHeight),'21px');assert(await post.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await post.screenshot({path:`tests/reports/code/export-${width}.png`});await exported.close();console.log('PASS static highlighting without JavaScript '+width);
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
