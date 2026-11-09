import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const root=new URL('../dist/',import.meta.url),built=await readFile(new URL('sw.js',root),'utf8');
const assets=JSON.parse(built.match(/const ASSETS=(\[.*?\]);/)[1]);
const files=new Map(await Promise.all(assets.map(async name=>[name,await readFile(new URL(name==='./'?'index.html':name,root))])));
const oldHTML=files.get('./index.html').toString().replace('<link rel="stylesheet" href="./assets/publish/code.css">','');
const oldCSS=files.get('./style.css').toString().split('/* Reading preferences affect note content')[0];
// Exercise production behavior on localhost: no development cache bypass or skipWaiting.
const production=text=>text.replaceAll("['localhost','127.0.0.1'].includes(self.location.hostname)",'false').replaceAll("['localhost','127.0.0.1'].includes(url.hostname)",'false');
const oldFiles=new Map(files);oldFiles.set('./',Buffer.from(oldHTML));oldFiles.set('./index.html',Buffer.from(oldHTML));oldFiles.set('./style.css',Buffer.from(oldCSS));
const oldIntegrity=Object.fromEntries([...oldFiles].map(([name,data])=>[name,'sha256-'+createHash('sha256').update(data).digest('base64')]));
const oldWorker=production(built).replace(/const CACHE='[^']+';/,"const CACHE='th-ink-shell-stale-font-test';").replace(/const INTEGRITY=\{.*?\};/,`const INTEGRITY=${JSON.stringify(oldIntegrity)};`);
let current=oldFiles,worker=oldWorker;
const server=createServer(async(req,res)=>{const name='.'+req.url.split('?')[0];res.setHeader('Cache-Control','no-cache');res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')||name==='./'?'text/html':name.endsWith('.wasm')?'application/wasm':'application/octet-stream');if(name==='./sw.js')return res.end(worker);if(current.has(name))return res.end(current.get(name));try{res.end(await readFile(new URL(name,root)));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(4199,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const context=await browser.newContext({locale:'en-US'}),page=await context.newPage();await page.goto('http://127.0.0.1:4199/');await page.evaluate(async()=>{const a=await import('./js/app.js');await a.appReady;await a.dailyBackup.enable(false);await a.execute('settings');});
 await page.locator('#note-font').selectOption('mono');await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--note-font').includes('ui-monospace'));await page.keyboard.press('Escape');
 assert(!(await page.locator('#editor').evaluate(e=>getComputedStyle(e).fontFamily)).includes('ui-monospace'));
 await page.evaluate(async()=>{const a=await import('./js/app.js'),e=document.querySelector('#editor');e.value='PRESERVE_THIS_NOTE\n\n```text\n+---+\n|   |\n+---+\n```';e.dispatchEvent(new Event('input'));await a.flush();});
 await page.reload();await page.evaluate(async()=>{await(await import('./js/app.js')).appReady;});
 current=files;worker=production(built);
 await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
 await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
 await page.reload();await page.evaluate(async()=>{await(await import('./js/app.js')).appReady;});
 assert(!(await page.locator('#editor').evaluate(e=>getComputedStyle(e).fontFamily)).includes('ui-monospace'),'Ordinary reload reproduces stale CSS with a waiting worker');
 const cdp=await context.newCDPSession(page),navigation=page.waitForNavigation({waitUntil:'load'});await cdp.send('Page.reload',{ignoreCache:true});await navigation;await page.evaluate(async()=>{await(await import('./js/app.js')).appReady;});
 assert((await page.locator('#editor').evaluate(e=>getComputedStyle(e).fontFamily)).includes('ui-monospace'));
 assert((await page.locator('#editor').evaluate(e=>e.value)).includes('PRESERVE_THIS_NOTE'));
 assert.equal(await page.locator('.cm-code-line').first().evaluate(e=>getComputedStyle(e).lineHeight),'21px');
 // Closing the controlled tab permits the already verified update to activate.
 await page.close();const next=await context.newPage();await next.goto('http://127.0.0.1:4199/');await next.evaluate(async()=>{await(await import('./js/app.js')).appReady;});
 assert((await next.locator('#editor').evaluate(e=>getComputedStyle(e).fontFamily)).includes('ui-monospace'));
 assert((await next.locator('#editor').evaluate(e=>e.value)).includes('PRESERVE_THIS_NOTE'));
 console.log('PASS reproduced stale styles; bypass reload restores font and code spacing; note and preference survive normal reopening');
}finally{await browser.close();await new Promise(r=>server.close(r));}
