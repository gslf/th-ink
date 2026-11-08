import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
await mkdir('tests/reports/emoji',{recursive:true});
try{for(const [width,height,locale,theme] of [[280,568,'it-IT','light'],[390,844,'en-US','light'],[844,390,'en-US','dark'],[1440,960,'en-US','light']]){
 const context=await browser.newContext({viewport:{width,height},locale,colorScheme:theme,reducedMotion:'reduce'}),page=await context.newPage(),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4173/')&&!r.url().startsWith('blob:'))external.push(r.url());});
 await page.goto('http://127.0.0.1:4173/');await page.evaluate(async()=>{const a=await import('/js/app.js');await a.appReady;await a.dailyBackup.enable(false);await navigator.serviceWorker.ready;});await page.locator('#setup-dismiss').click();
 // First-ever catalog opening must work from the PWA cache, even offline.
 await page.reload();await page.evaluate(async()=>{await(await import('/js/app.js')).appReady;});await context.setOffline(true);await page.locator('#note-properties').click();await page.locator('.emoji-categories button').first().waitFor();assert.equal(await page.locator('.emoji-categories button').count(),10);
 await page.screenshot({path:`tests/reports/emoji/${width}-catalog.png`});
 assert.equal(await page.locator('#modal').evaluate(e=>e.scrollWidth>e.clientWidth),false);
 const sizes=await page.locator('.emoji-categories button,.emoji-grid button').evaluateAll(nodes=>nodes.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})));assert.ok(sizes.every(s=>s.w>=36&&s.h>=44));
 await page.locator('.emoji-categories button[data-category="1"]').click();const before=await page.locator('.emoji-grid button').count();await page.locator('.emoji-results').evaluate(e=>e.scrollTop=e.scrollHeight);await page.waitForFunction(before=>document.querySelectorAll('.emoji-grid button').length>before,before);assert.ok(await page.locator('.emoji-grid button').count()>before);
 await page.locator('#emoji-search').fill(locale.startsWith('it')?'pollice in su':'thumbs up');
 // Use the Unicode glyph as a locale-independent query when testing tone variants.
 await page.locator('#emoji-search').fill('👍');await page.locator('.emoji-tools select').selectOption('3');await page.locator('#emoji-search').press('Enter');assert.ok(await page.locator('#modal').isVisible());assert.equal(await page.locator('.emoji-preview').innerText(),'👍🏽');
 await page.locator('.properties-form [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);assert.equal(await page.locator('#note-properties .note-emoji').innerText(),'👍🏽');
 await page.reload();await page.evaluate(async()=>{await(await import('/js/app.js')).appReady;});assert.equal(await page.locator('#note-properties .note-emoji').innerText(),'👍🏽');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS offline emoji, categories, tones and touch layout',width,height,locale);await context.close();
}}finally{await browser.close();}
