import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
await mkdir('tests/reports/lists',{recursive:true});
const errors=[];
try{
 for(const width of [280,390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'en-US',reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/__i18nqa.html');await page.evaluate(async()=>{const a=await import('/js/app.js');await a.appReady;await a.dailyBackup.enable(false);a.voice.start=async()=>{a.voice.active=true;a.voice.emit('state',true);};a.voice.speak=async()=>{};});await page.locator('#setup-dismiss').click();
  const input=page.locator('.cm-content');
  const load=async text=>{await page.evaluate(text=>{const e=document.querySelector('#editor');e.value=text;e.setSelectionRange(text.length,text.length);e.dispatchEvent(new Event('input'));e.focus();},text);};
  const value=()=>page.locator('#editor').evaluate(e=>e.value);
  await load('- parent\n- child');await input.press('Tab');assert.equal(await value(),'- parent\n    + child');
  await input.press('Enter');await input.press('Tab');await input.press('g');assert.equal(await value(),'- parent\n    + child\n        * g');
  await input.press('Enter');await input.press('Enter');assert.equal(await value(),'- parent\n    + child\n        * g\n    + ');
  await input.press('Enter');assert.equal(await value(),'- parent\n    + child\n        * g\n- ');
  await input.press('Enter');assert.equal(await value(),'- parent\n    + child\n        * g\n');
  await load('- [ ] root\n    + [x] child');await input.press('Shift+Tab');assert.equal(await value(),'- [ ] root\n- [x] child');
  // Eight real ancestors are removed one at a time, including through speech.
  const rows=Array.from({length:8},(_,i)=>' '.repeat(i*4)+(i===0?'-':i%2?'+':'*')+' level '+i);
  await load(rows.join('\n')+'\n'+' '.repeat(32)+'* ');
  await page.locator('[data-mode=voice]').click();await page.evaluate(async()=>{(await import('/js/app.js')).voice.mode='dictation';});
  for(let i=7;i>=0;i--){await page.evaluate(async()=>{await(await import('/js/app.js')).spoken.receive('new line');});assert.equal((await value()).split('\n').at(-1),' '.repeat(i*4)+(i===0?'-':i%2?'+':'*')+' ');}
  await page.evaluate(async()=>{await(await import('/js/app.js')).spoken.receive('new line');});assert.equal((await value()).split('\n').at(-1),'');
  await page.locator('[data-mode=keyboard]').click();
  const sample='Ordinary text\n\n- Root item\n    + Nested item\n        * Deeper item\n            + Another level\n    + [ ] Nested task\n- Another root item\n\nOrdinary text\n- ';
  for(const zen of [false,true]){
   if(zen)await page.locator('.top-actions [data-action=focus]').click();await load(sample);
   const fonts=await input.evaluate(el=>{const base=parseFloat(getComputedStyle(el).fontSize);return {base,sizes:[...el.querySelectorAll('.cm-line,.cm-line span')].map(n=>parseFloat(getComputedStyle(n).fontSize))};});assert.ok(fonts.sizes.every(size=>size===fonts.base),JSON.stringify(fonts));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(zen)await page.locator('.top-actions [data-action=focus]').click();
  }
  await page.locator('#preview-tab').click();assert.equal(await page.locator('#preview ul ul ul ul').count(),1);assert.equal(await page.locator('#preview .task').count(),1);
  const readingFonts=await page.locator('#preview').evaluate(el=>({base:getComputedStyle(el).fontSize,sizes:[...el.querySelectorAll('li')].map(n=>getComputedStyle(n).fontSize)}));assert.ok(readingFonts.sizes.every(size=>size===readingFonts.base));
  await page.locator('#write-tab').click();await page.evaluate(()=>document.querySelector('#document-scroll').scrollTop=0);await page.screenshot({path:`tests/reports/lists/${width}.png`});
  console.log('PASS nested lists and typography',width);await context.close();
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
