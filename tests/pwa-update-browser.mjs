import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {updateServiceWorker} from '../scripts/pwa-assets.mjs';
const dir=await mkdtemp(join(tmpdir(),'think-update-')),template=await readFile('src/sw.js','utf8');
const html='<!doctype html><title>Update integrity test</title>',oldCSS='body { color: black; }',newCSS='body { color: blue; }';
await writeFile(join(dir,'index.html'),html);await writeFile(join(dir,'style.css'),oldCSS);await writeFile(join(dir,'sw.js'),template);
const oldVersion=updateServiceWorker(dir).version,oldWorker=await readFile(join(dir,'sw.js'),'utf8');
await writeFile(join(dir,'style.css'),newCSS);await writeFile(join(dir,'sw.js'),template);
const newVersion=updateServiceWorker(dir).version,newWorker=await readFile(join(dir,'sw.js'),'utf8');
let worker=oldWorker,css=oldCSS;
const server=createServer((req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',req.url==='/sw.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/sw.js'?worker:req.url==='/style.css'?css:html);});
await new Promise(r=>server.listen(4198,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:4198/');
 await page.evaluate(async()=>{window.registration=await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;});
 assert((await page.evaluate(()=>caches.keys())).includes('th-ink-shell-'+oldVersion));
 // Publish the new worker first, but leave the previous stylesheet on the server.
 worker=newWorker;
 const rejected=await page.evaluate(async()=>{const r=window.registration;const result=new Promise(resolve=>r.addEventListener('updatefound',()=>{const w=r.installing;w.addEventListener('statechange',()=>{if(['activated','redundant'].includes(w.state))resolve(w.state);});},{once:true}));await r.update();return result;});
 assert.equal(rejected,'redundant');
 assert.equal(await page.evaluate(async key=>(await(await caches.open(key)).match('./style.css')).text(),'th-ink-shell-'+oldVersion),oldCSS);
 assert.equal(await page.evaluate(async key=>(await(await caches.open(key)).keys()).length,'th-ink-shell-'+newVersion),0);
 // Complete the upload; retrying the identical worker must now succeed.
 css=newCSS;
 const installed=await page.evaluate(async()=>{const r=window.registration;const result=new Promise(resolve=>r.addEventListener('updatefound',()=>{const w=r.installing;w.addEventListener('statechange',()=>{if(['activated','redundant'].includes(w.state))resolve(w.state);});},{once:true}));await r.update();return result;});
 assert.equal(installed,'activated');
 assert.equal(await page.evaluate(async key=>(await(await caches.open(key)).match('./style.css')).text(),'th-ink-shell-'+newVersion),newCSS);
 assert(!(await page.evaluate(()=>caches.keys())).includes('th-ink-shell-'+oldVersion));
 console.log('PASS incomplete upload rejected, previous cache preserved, completed upload retried successfully');
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
