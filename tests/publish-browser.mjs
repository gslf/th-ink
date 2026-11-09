import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {buildPublishedSite,selectPublishedNotes} from '../src/js/publish-model.js';
const assets=Object.fromEntries(await Promise.all(['site.css','site.js','code.css','favicon.svg'].map(async name=>[name,await readFile(new URL('../src/assets/publish/'+name,import.meta.url),'utf8')])));
const folders=[{id:'journal',name:'Journal'},{id:'research',name:'Research',parent:'journal'},{id:'private',name:'Private'}],start=Date.UTC(2026,10,8);
const sample=[{id:'small',title:'Small tools. Room for bigger ideas.',body:'The best tool is the one that leaves you with more space to think.\n\n## A quieter kind of software\n\nWe spend so much time adding things. Another view, another button, another way to measure what we have done. Sometimes the useful question is what we can take away.\n\n> Clarity comes from choosing what deserves our attention.\n\n## Keep the signal\n\n- Start with a real question.\n- Make something small.\n    - Leave room for the unexpected.\n- Come back and listen.\n\n[[Listening between the signals|Notes from the radio room]]\n\n```rust\nfn main() {\n    println!("less, but better.");\n}\n```',folder:'journal',created:start,updated:start,tags:['Design','Technology']},{id:'radio',title:'Listening between the signals',body:'A notebook from the radio room. On noise, patience, and the things we only hear when we slow down.\n\n## The quiet frequencies\n\nThe room is dark. A small green display lights up the desk.\n\n- [x] Listen first\n- [ ] Write down what matters\n    - [ ] Leave a little silence',folder:'research',created:start-86400000,updated:start+2000},{id:'code',title:'A small language for human ideas',body:'Exploring how a few deliberate constraints can make technology feel more human. Code is also a way of thinking.',folder:'journal',created:start-172800000,updated:start},{id:'private-note',title:'Private',body:'DO_NOT_EXPORT_PRIVATE_CONTENT',folder:'private',created:start+1000,updated:start}];
const result=await buildPublishedSite({notes:selectPublishedNotes(sample,folders,'journal'),config:{folder:'journal',title:'Field notes',description:'Code, signals, and ideas. A quiet place to think out loud.',author:'Gioele SL Fierro',url:'https://example.test/journal/',language:'en'},assets});
await mkdir('tests/reports/publish',{recursive:true});
const files=new Map(result.files.map(f=>[f.path,f.text]));
const server=createServer((req,res)=>{const path=decodeURIComponent(req.url.split('?')[0]).replace(/^\/journal\//,'')||'index.html';if(!files.has(path)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':path.endsWith('.json')?'application/json':path.endsWith('.svg')?'image/svg+xml':'text/html');res.end(files.get(path));});
await new Promise(resolve=>server.listen(4196,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 for(const width of [320,390,1440]){
  const context=await browser.newContext({viewport:{width,height:920},locale:'en-US',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.showDirectoryPicker=()=>{throw Error('Directory picker must never be called');};});
  await page.goto('http://127.0.0.1:4173/__i18nqa.html');
  await page.evaluate(async({folders,notes})=>{const a=await import('./js/app.js');await a.appReady;await a.dailyBackup.enable(false);a.state.folders=folders;a.state.notes=notes;for(const f of folders)await a.db.put('folders',f);for(const n of notes)await a.db.saveNote(n);await a.execute('settings');},{folders,notes:sample});
  await page.locator('.setting-row').filter({hasText:'Static site'}).getByRole('button',{name:'Manage'}).click();
  await page.locator('#publish-folder').selectOption('journal');await page.locator('#publish-title').fill('Field notes');await page.locator('#publish-description').fill('Code, signals, and ideas. A quiet place to think out loud.');await page.locator('#publish-author').fill('Gioele SL Fierro');await page.locator('#publish-url').fill('https://example.test/journal/');
  assert.equal(await page.locator('#publish-settings button').count(),1);
  const downloadPromise=page.waitForEvent('download');await page.locator('#publish-export').click();const download=await downloadPromise,zip=await readFile(await download.path());assert(zip.includes(Buffer.from('sitemap.xml')));assert(!zip.includes(Buffer.from('DO_NOT_EXPORT_PRIVATE_CONTENT')));
  assert(!(await page.locator('#modal').evaluate(e=>e.scrollWidth>e.clientWidth+1)));await page.screenshot({path:`tests/reports/publish/settings-${width}.png`});
  // A repeat export reuses the worker's ZIP; edits invalidate that cache.
  const repeated=await page.evaluate(async()=>{const a=await import('./js/app.js');const blob=await a.publisher.generate();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');});
  assert.equal(repeated,createHash('sha256').update(zip).digest('hex'),'Repeated export preserves the completed ZIP');
  await page.evaluate(async()=>{const a=await import('./js/app.js');a.state.notes.find(n=>n.id==='radio').deleted=true;});
  const next=await page.evaluate(async()=>{const a=await import('./js/app.js'),blob=await a.publisher.generate();return {count:a.publisher.result.count,text:await blob.text()};});assert.equal(next.count,2);assert(!next.text.includes('The quiet frequencies'));
  if(width===390){await context.setOffline(true);const bytes=await page.evaluate(async()=>{const a=await import('./js/app.js');return(await a.publisher.generate()).size;});assert(bytes>1000,'Offline export must include static pages');await context.setOffline(false);}
  assert.deepEqual(errors,[]);await context.close();console.log('PASS single-button ZIP export, worker cache, privacy and offline export '+width);
 }
 {
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'it-IT'}),page=await context.newPage();
  await page.addInitScript(()=>{window.showDirectoryPicker=undefined;});await page.goto('http://127.0.0.1:4173/__i18nqa.html');
  await page.evaluate(async()=>{const a=await import('./js/app.js');await a.appReady;await a.execute('settings');});await page.locator('.setting-row').filter({hasText:'Sito statico'}).getByRole('button',{name:'Gestisci'}).click();
  assert.equal(await page.locator('#publish-choose,#publish-automatic').count(),0);
  await page.locator('#publish-folder').selectOption({index:1});await page.locator('#publish-url').fill('https://example.test/diario/');
  const downloaded=page.waitForEvent('download');await page.locator('#publish-export').click();assert((await readFile(await(await downloaded).path())).includes(Buffer.from('lang="it"')));
  await page.reload();await page.evaluate(async()=>{const a=await import('./js/app.js');await a.appReady;a.showPublish();});assert.equal(await page.locator('#publish-url').inputValue(),'https://example.test/diario/');
  await context.close();console.log('PASS Italian UI, ZIP without directory APIs and saved settings');
 }
 for(const width of [320,390,1440]){
  const context=await browser.newContext({viewport:{width,height:920},locale:'en-US',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4196/journal/');await page.screenshot({path:`tests/reports/publish/site-${width}.png`});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const path=result.files.find(f=>f.path.startsWith('posts/small-tools')).path;await page.goto('http://127.0.0.1:4196/journal/'+path);await page.screenshot({path:`tests/reports/publish/article-${width}.png`});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('h1').count(),1);
  if(width<800){await page.locator('.menu-toggle').click();assert(await page.locator('main').evaluate(e=>e.inert));}
  await page.locator('#site-search').fill('quiet frequencies');await page.getByText('1 results',{exact:true}).waitFor();assert.equal(await page.locator('.article-list>a').count(),1);await page.locator('.article-list>a').click();await page.locator('h1').filter({hasText:'Listening between the signals'}).waitFor();
  if(width<800){await page.locator('.menu-toggle').click();await page.keyboard.press('Escape');assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'false');assert(!(await page.locator('main').evaluate(e=>e.inert)));await page.locator('.menu-toggle').click();}
  await page.locator('.theme-toggle').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await page.screenshot({path:`tests/reports/publish/dark-${width}.png`});assert.deepEqual(errors,[]);await context.close();console.log('PASS static journal layout, search, navigation, accessibility and theme '+width);
 }
 const context=await browser.newContext({javaScriptEnabled:false}),page=await context.newPage();const path=result.files.find(f=>f.path.startsWith('posts/small-tools')).path;await page.goto('http://127.0.0.1:4196/journal/'+path);assert(await page.getByRole('heading',{name:'A quieter kind of software',exact:false}).isVisible());assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://example.test/journal/'+path);await context.close();console.log('PASS content and metadata without JavaScript');
 for(const file of result.files){const path=new URL('../tests/reports/publish/demo/'+file.path,import.meta.url);await mkdir(new URL('.',path),{recursive:true});await writeFile(path,file.text);}
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
