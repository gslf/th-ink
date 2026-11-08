// Isolated archives; no real notifications, subscriptions or user data.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
await mkdir('tests/reports/toast',{recursive:true});
try{
 for(const width of [320,390,1440])for(const fallback of [false,true]){
  const context=await browser.newContext({viewport:{width,height:800},locale:'en-US',reducedMotion:'reduce'}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(fallback)await page.addInitScript(()=>{HTMLElement.prototype.showPopover=undefined;});
  await page.goto('http://127.0.0.1:4173/__i18nqa.html');
  await page.evaluate(async()=>{const a=await import('./js/app.js');await a.appReady;await a.dailyBackup.enable(false);await a.execute('settings');document.querySelector('#modal [data-close]').focus();});
  const before=await page.evaluate(()=>({focus:document.activeElement.outerHTML,scroll:document.querySelector('#modal').scrollTop}));
  await page.evaluate(async()=>{const a=await import('./js/app.js');a.reminders.h.report(Error('Unsupported push endpoint.'));});
  await page.locator('#toast').waitFor({state:'visible'});
  const state=await page.locator('#toast').evaluate((e,fallback)=>({parent:e.parentElement.id,top:fallback||e.matches(':popover-open'),filter:getComputedStyle(e).filter,focus:document.activeElement.outerHTML,scroll:document.querySelector('#modal').scrollTop,rect:e.getBoundingClientRect().toJSON(),text:e.textContent}),fallback);
  assert.equal(state.parent,'modal');assert(state.top);assert.equal(state.filter,'none');assert.equal(state.focus,before.focus);if(!fallback)assert.equal(state.scroll,before.scroll);
  assert(state.rect.x>=0&&state.rect.right<=width&&state.rect.y>=0&&state.rect.bottom<=800);assert.equal(state.text,'Unsupported push endpoint.');
  await page.screenshot({path:`tests/reports/toast/${width}-${fallback?'fallback':'popover'}.png`});
  // Opening another modal must promote the existing message above its new backdrop.
  await page.evaluate(()=>{document.querySelector('#palette').showModal();document.querySelector('#palette-input').focus();});
  await page.waitForFunction(()=>document.querySelector('#toast').parentElement.id==='palette');
  if(!fallback)assert(await page.locator('#toast').evaluate(e=>e.matches(':popover-open')));
  await page.evaluate(()=>document.querySelector('#palette').close());
  await page.waitForFunction(()=>document.querySelector('#toast').parentElement.id==='modal');
  // Voice mode must not redirect modal errors into its hidden editor status.
  await page.evaluate(async()=>{const a=await import('./js/app.js');a.state.mode='voice';document.body.classList.add('voice-mode');a.reminders.h.report(Error('The notification service is unavailable. Please try again.'));});
  assert(await page.locator('#toast').isVisible());assert.equal(await page.locator('#toast').textContent(),'The notification service is unavailable. Please try again.');
  await page.evaluate(()=>document.querySelector('#modal').close());
  await page.waitForFunction(()=>document.querySelector('#toast').parentElement===document.body);
  await page.evaluate(async()=>{const a=await import('./js/app.js');a.state.mode='write';document.body.classList.remove('voice-mode');await a.execute('save');});
  assert(await page.locator('#toast').isVisible());assert.deepEqual(errors,[]);
  await context.close();console.log(`PASS toast above modal, nested dialogs, voice, focus and bounds: ${width}, fallback=${fallback}`);
 }
}finally{await browser.close();}
