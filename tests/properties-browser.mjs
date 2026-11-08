import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
await mkdir('tests/reports/properties',{recursive:true});const errors=[];
try{
 for(const [width,locale,theme] of [[280,'it-IT','light'],[390,'en-US','light'],[1440,'en-US','light'],[390,'en-US','dark']]){
  const context=await browser.newContext({viewport:{width,height:900},locale,reducedMotion:'reduce',colorScheme:theme}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/__i18nqa.html');
  const id=await page.evaluate(async()=>{const a=await import('/js/app.js');await a.appReady;await a.dailyBackup.enable(false);await a.spoken.a.create('Quiet ideas');const e=document.querySelector('#editor');e.value='A quiet thought.\n\n**Room to grow.**';e.dispatchEvent(new Event('input'));await a.flush();return a.state.current;});
  await page.locator('#setup-dismiss').click();await page.locator('#note-properties').click();
  assert.equal(await page.locator('#property-emoji').count(),0);
  await page.locator('.emoji-categories button[data-category="0"]').waitFor();await page.screenshot({path:`tests/reports/properties/${width}-${theme}-catalog.png`});
  await page.locator('.emoji-categories button[data-category="7"]').click();
  assert.equal(await page.locator('.emoji-categories button[aria-pressed=true]').getAttribute('data-category'),'7');
  await page.locator('#emoji-search').fill(locale.startsWith('it')?'cuore':'heart');
  assert.ok(await page.locator('.emoji-grid button[data-emoji="❤️"]').count());
  await page.locator('#emoji-search').fill('zzzznotanemoji');assert.equal(await page.locator('.emoji-grid button').count(),0);assert.ok(await page.locator('.emoji-status').innerText());
  await page.locator('#emoji-search').fill(locale.startsWith('it')?'lampadina':'light bulb');
  await page.locator('.emoji-grid button[data-emoji="💡"]').click();await page.locator('#property-tags').fill('Ideas, Work, ideas');
  await page.screenshot({path:`tests/reports/properties/${width}-${theme}-picker.png`});
  assert.equal(await page.locator('#modal').evaluate(e=>e.scrollWidth>e.clientWidth),false);
  await page.locator('.properties-form [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);
  const props=()=>page.evaluate(async id=>{const a=await import('/js/app.js');return a.state.notes.find(n=>n.id===id);},id);
  assert.deepEqual((await props()).tags,['Ideas','Work']);assert.equal((await props()).emoji,'💡');assert.equal(await page.locator('#note-title').inputValue(),'Quiet ideas');assert.equal(await page.locator('#editor').evaluate(e=>e.value),'A quiet thought.\n\n**Room to grow.**');
  // A single note appears under both virtual tag folders, with unique keyboard identities.
  if(width<=760)await page.locator('#library-toggle').click();await page.locator('[data-filter=tags]').click();
  assert.equal(await page.locator('[data-filter=pinned] + [data-filter=tags]').count(),1);
  assert.equal(await page.locator('#tag-count').innerText(),'2');assert.equal(await page.locator(`[data-note-id="${id}"]`).count(),2);
  assert.equal(await page.locator(`[data-note-id="${id}"] .tree-emoji`).first().innerText(),'💡');
  await page.locator('[data-tag-key=ideas] > .tree-row').click();assert.equal(await page.locator(`[data-note-id="${id}"]`).count(),1);
  await page.locator('[data-tag-key=ideas]').press('ArrowRight');assert.equal(await page.locator(`[data-note-id="${id}"]`).count(),2);
  await page.screenshot({path:`tests/reports/properties/${width}-${theme}-tags.png`});
  await page.locator(`[data-note-id="${id}"]`).first().click();await page.waitForFunction(()=>!document.querySelector('#app').classList.contains('library-open'));
  assert.equal(await page.evaluate(async()=>(await import('/js/app.js')).state.filter),'tags');
  await page.screenshot({path:`tests/reports/properties/${width}-${theme}-note.png`});
  // Export, OPFS mirror and import preserve metadata, never putting emoji in the filename.
  const downloadReady=page.waitForEvent('download');await page.evaluate(async()=>{await(await import('/js/app.js')).execute('export');});const download=await downloadReady;
  assert.equal(download.suggestedFilename(),'Quiet ideas.md');const exported=await readFile(await download.path(),'utf8');assert.ok(exported.startsWith('<!-- th.ink-note-v1 '));assert.ok(exported.includes('💡'));
  const mirror=await page.evaluate(async id=>{const a=await import('/js/app.js');await a.flush();if(!a.db.files)return null;return (await(await a.db.files.getFileHandle(id+'.md')).getFile()).text();},id);if(mirror!==null)assert.equal(mirror,exported);
  await page.locator('#import-files').setInputFiles({name:'Quiet ideas.md',mimeType:'text/markdown',buffer:Buffer.from(exported)});
  await page.waitForFunction(()=>/1 (?:note importate|notes imported)/.test(document.querySelector('#toast').textContent));
  await page.evaluate(async()=>{await(await import('/js/app.js')).flush();});
  const imported=await page.evaluate(async()=>{const a=await import('/js/app.js');return a.state.notes.filter(n=>n.title==='Quiet ideas');});assert.equal(imported.length,2);assert.ok(imported.every(n=>n.emoji==='💡'&&n.tags.join(',')==='Ideas,Work'));
  // Clear metadata, undo it, reload, and keep all properties out of zen mode.
  await page.locator('#note-properties').click();assert.equal(await page.locator('.tag-suggestions .note-tag').count(),2);await page.locator('.emoji-reset').click();await page.locator('#property-tags').fill('');await page.locator('.properties-form [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);
  assert.equal(await page.locator('#note-properties .note-emoji').count(),0);assert.equal(await page.locator('#note-tags .note-tag').count(),0);
  await page.locator('.format-bar [data-action=undo]').click();assert.equal(await page.locator('#note-properties .note-emoji').innerText(),'💡');
  await page.evaluate(async()=>{await(await import('/js/app.js')).flush();});await page.reload();await page.evaluate(async()=>{await(await import('/js/app.js')).appReady;});assert.equal(await page.locator('#note-properties .note-emoji').innerText(),'💡');assert.equal(await page.locator('#note-tags .note-tag').count(),2);
  await page.locator('[data-action=focus]').click();assert.equal(await page.locator('#note-properties').isVisible(),false);assert.equal(await page.locator('#note-tags').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log('PASS note properties',width,locale,theme);await context.close();
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
