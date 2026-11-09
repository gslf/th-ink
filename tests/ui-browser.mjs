// Visual/interaction regression checks use disposable archives, never personal notes.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.QA_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const reports=new URL('./reports/ui-review/',import.meta.url),screenshots=new URL('../src/screenshots/',import.meta.url);
await mkdir(reports,{recursive:true});await mkdir(screenshots,{recursive:true});const results=[],errors=[];
const profiles=[{width:280,height:653},{width:320,height:568},{width:390,height:844},{width:768,height:1024},{width:1440,height:960},{width:844,height:390}];
async function alignedBanner(page){
 const r=await page.locator('#setup-toast').evaluate(el=>{
  const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,cy:r.y+r.height/2};};
  return {panel:box(el),button:box(el.querySelector('button')),message:box(el.querySelector('p')),close:box(el.querySelector('#setup-dismiss')),textFits:el.querySelector('p').scrollHeight<=el.querySelector('p').clientHeight+1};
 });
 assert.ok(r.button.right<=r.message.x&&r.message.right<=r.close.x,'install action stays left of message and dismissal');
 for(const item of [r.button,r.message,r.close])assert.ok(Math.abs(item.cy-r.panel.cy)<1,'install row is vertically centered');
 assert.ok(r.button.height>=44&&r.close.height>=44,'install touch targets');assert.ok(r.textFits,'complete install message');
}
async function fits(page,selector){
 const failures=await page.locator(selector).evaluateAll(elements=>elements.filter(el=>el.getClientRects().length&&!el.hidden).flatMap(el=>{const r=el.getBoundingClientRect();return r.left<-.5||r.right>innerWidth+.5?[el.id||el.textContent.trim()]:[];}));
 assert.deepEqual(failures,[],selector+' fits viewport');
}
async function openSettings(page){if(await page.locator('#library-toggle').isVisible())await page.locator('#library-toggle').click();await page.locator('[data-action=settings]').click();}
async function invoke(page,id){await page.evaluate(async id=>{await (await import('/js/app.js')).execute(id);},id);}
async function close(page){await page.locator('#modal [data-close]').click();}
async function snap(page,name){await page.screenshot({path:new URL(name+'.png',reports).pathname,animations:'disabled'});}
try{
 for(const viewport of profiles)for(const locale of ['it-IT','en-US'])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport,locale,colorScheme:theme,reducedMotion:'reduce',isMobile:viewport.width<761,hasTouch:viewport.width<761});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/__i18nqa.html');await page.evaluate(async()=>{const app=await import('/js/app.js');await app.appReady;await app.dailyBackup.enable(false);app.voice.start=async()=>{app.voice.active=true;app.voice.emit('state',true);};});
  await alignedBanner(page);await fits(page,'#setup-toast,#setup-toast button,.top-actions');
  const center=await page.locator('.mode-switch').evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('footer').getBoundingClientRect();return Math.abs((a.left+a.right-b.left-b.right)/2);});assert.ok(center<1,'input mode is truly centered');
  if(viewport.width===390&&theme==='light'){
   await snap(page,'mobile-install-'+locale);
   if(locale==='en-US')await page.screenshot({path:new URL('mobile-install-en.png',screenshots).pathname,animations:'disabled'});
  }
  if(viewport.width===320){
   const style=await page.addStyleTag({content:'#setup-message,#setup-action{font-size:18px}'});await alignedBanner(page);await fits(page,'#setup-toast button');await style.evaluate(el=>el.remove());
  }
  await page.locator('#setup-dismiss').click();
  // All formatting actions remain visible, wrapping into centered rows when needed.
  await fits(page,'.format-bar');
  await fits(page,'.format-bar > button,#heading-toggle');
  assert.ok(await page.locator('.format-bar').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.locator('#preview-tab').click();assert.ok(await page.locator('.format-bar').isHidden());await page.locator('#write-tab').click();
  await invoke(page,'palette');await page.locator('#palette-input').press('ArrowDown');
  const active=await page.locator('#palette-input').getAttribute('aria-activedescendant');assert.equal(await page.locator('#'+active).getAttribute('aria-selected'),'true');await fits(page,'#palette,.palette-result');
  if(viewport.width===390&&locale==='en-US'&&theme==='light')await snap(page,'mobile-palette');
  await page.locator('#palette-input').press('Escape');assert.ok(await page.locator('#palette').isHidden());await page.waitForFunction(()=>document.querySelector('#palette-input').getAttribute('aria-expanded')==='false');
  await invoke(page,'search');await page.waitForFunction(()=>document.querySelectorAll('#palette-results [role=option]').length>0);await fits(page,'.palette-result,.palette-result small');
  await page.locator('#palette-input').fill('No matching note 9z8y7x');await page.locator('#palette-results .empty-list').waitFor();assert.equal(await page.locator('#palette-input').getAttribute('aria-activedescendant'),null);await fits(page,'#palette,.empty-list');await page.locator('#palette-input').press('Escape');
  await openSettings(page);await fits(page,'#modal,.setting-row>button,.theme-options label,#app-language');
  const rows=await page.locator('.setting-row').evaluateAll(rows=>rows.map(row=>{const a=row.firstElementChild.getBoundingClientRect(),b=row.lastElementChild.getBoundingClientRect();return {gap:b.left-a.right,center:Math.abs((a.top+a.bottom-b.top-b.bottom)/2)};}));
  for(const row of rows){assert.ok(row.gap>=7,'settings columns do not overlap');assert.ok(row.center<1,'settings actions are vertically centered');}
  if(viewport.width===390&&locale==='en-US'&&theme==='light'){await snap(page,'mobile-settings');await page.screenshot({path:new URL('mobile-settings-en.png',screenshots).pathname,animations:'disabled'});}
  await page.locator('.settings-extra>summary').click();await fits(page,'.settings-extra .setting-row>button');await page.locator('.settings-extra>summary').click();
  // The label is the full checkbox target; the input never occupies a separate line.
  const check=await page.locator('.backup-label').evaluate(label=>{const checkbox=label.querySelector('input').getBoundingClientRect(),r=label.getBoundingClientRect();return {size:checkbox.width,gap:checkbox.left-r.left};});assert.equal(check.size,18);assert.ok(Math.abs(check.gap)<1);
  await page.locator('.setting-row').filter({hasText:'Filen'}).locator('button').click();await fits(page,'#modal,.filen-form input,.filen-form button');
  assert.equal(await page.locator('.remember-access').evaluate(el=>getComputedStyle(el).display),'grid');
  if(viewport.width===390&&locale==='en-US'&&theme==='light')await snap(page,'mobile-filen');await close(page);
  if(await page.locator('#close-library').isVisible())await page.locator('#close-library').click();
  for(const id of ['folder','rename','move','link','replace','history','help']){
   await invoke(page,id);await fits(page,'#modal,#modal-content input,#modal-content select,.buttons button');
   assert.ok(await page.locator('#modal-title').innerText());
   if(viewport.width===390&&locale==='en-US'&&theme==='light')await snap(page,'mobile-'+id);
   await page.locator('#modal').press('Escape');assert.ok(await page.locator('#modal').isHidden());
  }
  await page.locator('[data-mode=voice]').click();await page.waitForFunction(async()=>(await import('/js/app.js')).voice.active);
  await fits(page,'#voice-level,#voice-help,.mode-switch');
  await page.locator('#voice-help').click();await fits(page,'#modal');await close(page);
  await page.evaluate(async()=>{(await import('/js/app.js')).voice.localVoices=()=>[];});
  for(const id of ['commands','dictation'])await invoke(page,id);
  if(viewport.width===390&&locale==='en-US'&&theme==='light')await snap(page,'mobile-voice');
  await page.locator('[data-mode=keyboard]').click();
  await invoke(page,'save');await fits(page,'#toast');
  // New long titles wrap without colliding with the tabs, favorite action, or viewport.
  await page.locator('#note-title').fill('A long thought worth keeping — '+ 'room to think '.repeat(5));await page.locator('#note-title').press('Tab');await fits(page,'#note-title,.document-tabs');
  await invoke(page,'focus');await fits(page,'.document,.editor-topbar');await invoke(page,'focus');
  await page.evaluate(async()=>{const app=await import('/js/app.js');await app.flush();app.state.notes=[];app.state.folders=[];await app.openNote(null);});
  assert.ok(await page.locator('#empty-state').isVisible());await fits(page,'#empty-state button');
  if(viewport.width===390&&locale==='en-US'&&theme==='light')await snap(page,'mobile-empty');
  const key=`${viewport.width}×${viewport.height} ${locale} ${theme}`;results.push(key);console.log('PASS',key,'— install, editor, toolbar, library, palette, settings, Filen, forms, history, help, voice, focus, empty');
  await context.close();
 }
 // Motion must be present for ordinary use and absent when reduced motion is requested.
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'en-US',reducedMotion:'no-preference'}),page=await context.newPage();
 await page.goto(base+'/__i18nqa.html');await page.evaluate(async()=>{await (await import('/js/app.js')).appReady;});
 for(const selector of ['#setup-action','#editor','#voice-help','.new-note'])assert.notEqual(await page.locator(selector).evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const selector of ['#setup-action','#editor','#voice-help','.new-note'])assert.equal(await page.locator(selector).evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 await context.close();assert.deepEqual(errors,[]);
 await writeFile(new URL('report.json',reports),JSON.stringify({browser:browser.version(),profiles:results,errors,motion:'regular and reduced verified'},null,2)+'\n');
 console.log(`${results.length} complete interface profiles passed; motion preferences passed.`);
}finally{await browser.close();}
