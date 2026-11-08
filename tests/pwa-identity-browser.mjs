// Chromium's own manifest parser, isolated context: never installs/uninstalls OS apps.
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const english=JSON.parse(await readFile('dist/manifest.webmanifest','utf8'));
const italian=JSON.parse(await readFile('dist/manifest-it.webmanifest','utf8'));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 async function identity(path,manifest){
  const context=await browser.newContext();await context.route('https://pwa-identity.test/**',route=>route.fulfill({contentType:route.request().url().endsWith('.webmanifest')?'application/manifest+json':'text/html',body:route.request().url().endsWith('.webmanifest')?JSON.stringify(manifest):'<html><head><link rel="manifest" href="manifest.webmanifest"></head><body>Isolated identity check</body></html>'}));
  const page=await context.newPage();await page.goto('https://pwa-identity.test/'+path+'/');const cdp=await context.newCDPSession(page);await cdp.send('Page.enable');const m=await cdp.send('Page.getAppManifest');assert.deepEqual(m.errors,[]);const result=await cdp.send('Page.getAppId');await context.close();return result.appId;
 }
 const cw=await identity('cwtty',{id:'.',name:'CWtty',start_url:'.',scope:'.',display:'standalone'});
 const old=await identity('th-ink',{...english,id:'./'});
 assert.equal(old,cw,'Chromium reproduces the old shared identity');
 const en=await identity('th-ink',english),it=await identity('th-ink',italian),black=await identity('blacksquelch',{id:'blacksquelch',name:'BlackSquelch',start_url:'./',scope:'./',display:'standalone'});
 assert.equal(en,'https://pwa-identity.test/th-ink/');assert.equal(en,it);assert.equal(new Set([en,cw,black]).size,3);
 console.log(JSON.stringify({oldCollisionReproduced:true,thInkEnglish:en,thInkItalian:it,cwtty:cw,blacksquelch:black,distinct:true}));
}finally{await browser.close();}
