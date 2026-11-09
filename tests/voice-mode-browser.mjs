// Interface tests use a simulated capture device; test:voice:csp covers real engines.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
const base=process.env.QA_URL||'http://127.0.0.1:4173';
const screenshots=new URL('../src/screenshots/',import.meta.url),reports=new URL('./reports/voice-mode/',import.meta.url);
await mkdir(reports,{recursive:true});const errors=[];
try{
 for(const [width,height,locale,theme] of [[280,653,'it-IT','light'],[320,568,'en-US','dark'],[390,844,'en-US','light'],[760,900,'it-IT','dark'],[1440,960,'en-US','light'],[844,390,'it-IT','light']]){
  const context=await browser.newContext({viewport:{width,height},locale,colorScheme:theme,reducedMotion:'reduce'}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/__i18nqa.html');
  await page.evaluate(async()=>{const app=await import('/js/app.js');await app.appReady;await app.dailyBackup.enable(false);window.starts=0;app.voice.start=async()=>{window.starts++;app.voice.active=true;app.voice.emit('state',true);};});
  await page.locator('#setup-dismiss').click();
  const voice=page.locator('[data-mode=voice]'),write=page.locator('[data-mode=keyboard]');
  await voice.click();await page.waitForFunction(async()=>(await import('/js/app.js')).voice.active);
  assert.equal(await page.evaluate(()=>window.starts),1);await voice.click();assert.equal(await page.evaluate(()=>window.starts),1);
  assert.equal(await page.locator('#voice-start,#voice-close,#voice-command,#voice-language,.voice-options').count(),0);
  assert.ok(await page.locator('#voice-level').isVisible());assert.ok(await page.locator('#voice-help').isVisible());assert.ok(await page.locator('#voice-status').isHidden());
  await page.evaluate(async()=>{(await import('/js/app.js')).voice.emit('level',{rms:.04,speech:true});});
  assert.equal(await page.locator('#voice-level').getAttribute('aria-valuenow'),'0.6');
  const layout=await page.evaluate(()=>{const b=s=>document.querySelector(s).getBoundingClientRect(),m=b('.mode-switch'),f=b('.editor-footer'),l=b('#voice-level'),h=b('#voice-help');return {center:Math.abs((m.left+m.right-f.left-f.right)/2),left:l.right<=m.left,right:h.left>=m.right,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert.ok(layout.left&&layout.right&&!layout.overflow);
  const preview=page.locator('#transcript');
  const emptyPreview=await preview.boundingBox();
  await page.evaluate(async()=>{(await import('/js/app.js')).voice.emit('interim','A little room for a thought, before it finds its place on the page.');});
  assert.equal(await preview.textContent(),'A little room for a thought, before it finds its place on the page.');
  const previewLayout=await preview.evaluate(el=>{const r=el.getBoundingClientRect(),m=document.querySelector('#voice-level').getBoundingClientRect(),toggle=document.querySelector('.mode-switch').getBoundingClientRect();return {height:r.height,width:r.width,below:r.top>=m.bottom&&Math.abs(r.left-m.left)<1&&r.right<=toggle.left,clipped:getComputedStyle(el).clipPath};});
  assert.equal(previewLayout.height,emptyPreview.height);
  assert.ok(previewLayout.below&&previewLayout.width>40&&previewLayout.clipped==='none');
  await page.evaluate(async()=>{const app=await import('/js/app.js');app.voice.speak=async()=>{};app.voice.emit('recognition',{text:'command mode',confidence:1});});
  await page.waitForFunction(()=>document.querySelector('[data-mode=voice]').classList.contains('command-mode'));
  assert.ok(await page.locator('.voice-command').isVisible());
  assert.match(await voice.getAttribute('aria-label'),locale.startsWith('en')?/Command mode/:/Modalità comandi/);
  assert.equal(await voice.getAttribute('aria-pressed'),'true');
  if(locale==='en-US'&&theme==='light')await page.screenshot({path:new URL(width===390?'mobile-voice-en.png':'desktop-voice-en.png',screenshots).pathname});
  await page.locator('#voice-help').click();assert.ok(await page.locator('#modal').isVisible());await page.locator('#modal [data-close]').click();
  await page.locator('.top-actions [data-action=focus]').click();assert.ok(await page.locator('#voice-underline').isVisible());assert.ok(await page.locator('#voice-level').isHidden());
  assert.equal((await preview.boundingBox()).height,1);
  assert.ok(await page.locator('.voice-command').isVisible());
  await voice.click();assert.equal(await page.evaluate(()=>window.starts),1);
  await page.evaluate(async()=>{(await import('/js/app.js')).voice.emit('level',{rms:.01,speech:true});});
  assert.equal(await page.locator('#voice-underline').getAttribute('aria-valuenow'),'0.3');
  if(locale==='en-US'&&theme==='light')await page.screenshot({path:new URL(width===390?'mobile-focus-voice-en.png':'desktop-focus-voice-en.png',screenshots).pathname});
  await page.evaluate(async()=>{(await import('/js/app.js')).voice.emit('recognition',{text:'dictation',confidence:1});});
  await page.waitForFunction(()=>!document.querySelector('[data-mode=voice]').classList.contains('command-mode'));
  assert.ok(await page.locator('.voice-command').isHidden());
  await write.click();assert.equal(await page.evaluate(async()=>(await import('/js/app.js')).voice.active),false);assert.ok(await page.locator('#voice-help').isHidden());assert.equal(await page.locator('#voice-underline').getAttribute('aria-valuenow'),'0');
  // A pending permission/model load is cancelled by Write, never by Voice.
  await page.evaluate(async()=>{const {voice}=await import('/js/app.js');const stop=voice.stop.bind(voice);voice.start=()=>new Promise(resolve=>{window.starts++;window.finish=resolve;});voice.stop=()=>{window.finish?.();stop();};});
  await voice.click();await page.waitForFunction(()=>document.querySelector('[data-mode=voice]').getAttribute('aria-busy')==='true');
  const starts=await page.evaluate(()=>window.starts);await voice.click();assert.equal(await page.evaluate(()=>window.starts),starts);
  await write.click();await page.waitForFunction(()=>document.querySelector('[data-mode=voice]').getAttribute('aria-busy')==='false');
  if(width===390){
   await page.evaluate(async()=>{
    const app=await import('/js/app.js');window.captureLanguages=[];
    app.voice.start=async()=>{window.captureLanguages.push(app.voice.lang);app.voice.active=true;app.voice.emit('state',true);};
    await app.setMode('voice');await app.changeLanguage('it');
   });
   assert.deepEqual(await page.evaluate(()=>window.captureLanguages),['en-US','it-IT']);
   assert.equal(await voice.getAttribute('aria-pressed'),'true');
   await write.click();
   await page.evaluate(async()=>{
    const app=await import('/js/app.js');
    app.voice.start=async()=>{app.voice.active=true;app.voice.emit('state',true);};
    const first=app.setMode('voice');const stop=app.setMode('keyboard');const last=app.setMode('voice');
    await Promise.all([first,stop,last]);
   });
   assert.equal(await page.evaluate(async()=>(await import('/js/app.js')).voice.active),true);
   await write.click();
  }
  // Errors return to Write and remain readable without exposing another panel.
  await page.evaluate(async()=>{(await import('/js/app.js')).voice.start=async()=>{throw Error('Microphone permission denied');};});
  await voice.click();await page.waitForFunction(()=>document.querySelector('[data-mode=keyboard]').getAttribute('aria-pressed')==='true');
  assert.equal(await page.locator('#voice-status').innerText(),'Microphone permission denied');
  console.log('PASS voice modes',width,height,locale,theme);await context.close();
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
