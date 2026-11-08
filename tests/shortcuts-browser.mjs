import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
await mkdir('tests/reports/shortcuts',{recursive:true});const errors=[];
try{
 for(const [width,locale] of [[280,'it-IT'],[390,'en-US'],[1440,'en-US']]){
  const context=await browser.newContext({viewport:{width,height:900},locale,reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/__i18nqa.html');await page.evaluate(async()=>{const a=await import('/js/app.js');await a.appReady;await a.dailyBackup.enable(false);for(const [title,body] of [['alpha title','alpha Alpha one'],['second','alpha two'],['trash','alpha hidden']]){await a.spoken.a.create(title);const e=document.querySelector('#editor');e.value=body;e.dispatchEvent(new Event('input'));await a.flush();if(title==='trash')await a.execute('trash');}await a.openNote(a.state.notes.find(n=>n.title==='alpha title').id);});
  await page.locator('#setup-dismiss').click();
  const editor=page.locator('.cm-content');await page.locator('#editor').evaluate(e=>{e.setSelectionRange(0,5);e.focus();});
  await editor.press('Control+x');assert.equal(await page.evaluate(()=>{const event=new KeyboardEvent('keydown',{key:'s',ctrlKey:true,repeat:true,bubbles:true,cancelable:true});document.dispatchEvent(event);return event.defaultPrevented;}),true);assert.ok(await page.locator('#palette').isVisible());assert.equal(await page.locator('#editor').evaluate(e=>e.value),'alpha Alpha one');
  await page.locator('#palette-input').press('Escape');await page.keyboard.press('Control+s');assert.ok(await page.locator('#find-query').isVisible());assert.equal(await page.locator('#palette').isVisible(),false);
  await page.locator('#find-query').fill('alpha');assert.equal(await page.locator('.find-result').count(),2);await page.locator('#find-replacement').fill('beta');await page.locator('#find-replace-all').click();await page.waitForFunction(()=>/^(Sostituzioni:|Replacements:)/.test(document.querySelector('.find-status').textContent));await page.waitForFunction(()=>document.querySelector('#editor').value==='beta beta one');
  const bodies=()=>page.evaluate(async()=>{const a=await import('/js/app.js');return a.state.notes.filter(n=>['alpha title','second','trash'].includes(n.title)).map(n=>[n.title,n.body]);});
  assert.deepEqual(await bodies(),[['alpha title','beta beta one'],['second','alpha two'],['trash','alpha hidden']]);
  // Shortcuts switch dialogs without stacking them, including while a field is focused.
  await page.locator('#find-replacement').press('Alt+s');assert.match(await page.locator('#modal-title').innerText(),locale==='it-IT'?/tutte le note/:/all notes/);
  await page.locator('#find-query').fill('alpha');assert.equal(await page.locator('.find-result').count(),1);await page.locator('#find-replacement').fill('$&');await page.locator('#find-replace-all').click();await page.waitForFunction(()=>/^(Sostituzioni:|Replacements:)/.test(document.querySelector('.find-status').textContent));await page.waitForFunction(async()=>(await import('/js/app.js')).state.notes.find(n=>n.title==='second').body==='$& two');
  await page.locator('#find-query').fill('beta');await page.locator('#find-replacement').fill('calm');
  await page.screenshot({path:`tests/reports/shortcuts/${width}-find.png`});
  await page.locator('#find-replace-all').click();await page.waitForFunction(()=>/^(Sostituzioni:|Replacements:)/.test(document.querySelector('.find-status').textContent));await page.waitForFunction(()=>document.querySelector('#editor').value==='calm calm one');
  await page.locator('#modal [data-close]').click();await page.locator('.format-bar [data-action=undo]').click();assert.equal(await page.locator('#editor').evaluate(e=>e.value),'beta beta one');
  await page.keyboard.press('Alt+s');await page.locator('#find-query').fill('$&');await page.locator('.find-result').click();await page.waitForFunction(()=>document.querySelector('#note-title').value==='second');assert.equal(await page.locator('#note-title').inputValue(),'second');assert.deepEqual(await page.locator('#editor').evaluate(e=>[e.selectionStart,e.selectionEnd]),[0,2]);
  await page.locator('.format-bar [data-action=undo]').click();assert.equal(await page.locator('#editor').evaluate(e=>e.value),'alpha two');
  // One universal action changes two distinct notes and excludes the deleted one.
  await page.evaluate(async()=>{const a=await import('/js/app.js');await a.openNote(a.state.notes.find(n=>n.title==='alpha title').id);await a.execute('undo');});
  await page.keyboard.press('Alt+s');await page.locator('#find-query').fill('alpha');assert.equal(await page.locator('.find-result').count(),3);
  await page.locator('#find-replacement').fill('shared');await page.locator('#find-replace-all').click();await page.waitForFunction(()=>/^(Sostituzioni:|Replacements:)/.test(document.querySelector('.find-status').textContent));await page.waitForFunction(async()=>(await import('/js/app.js')).state.notes.find(n=>n.title==='second').body==='shared two');
  assert.deepEqual(await bodies(),[['alpha title','shared shared one'],['second','shared two'],['trash','alpha hidden']]);
  await page.locator('#modal [data-close]').click();await page.locator('.format-bar [data-action=undo]').click();
  await page.evaluate(async()=>{const a=await import('/js/app.js');await a.openNote(a.state.notes.find(n=>n.title==='second').id);await a.execute('undo');});
  const button=page.locator('.shortcut-button');assert.equal(await button.locator('span').isVisible(),width>760);assert.equal(await button.locator('span').textContent(),'C-x');assert.ok(await button.locator('svg').isVisible());const geometry=await button.evaluate(el=>{const b=el.getBoundingClientRect(),f=el.closest('footer').getBoundingClientRect(),m=document.querySelector('.mode-switch').getBoundingClientRect();return {left:b.right<=m.left,center:Math.abs((m.left+m.right-f.left-f.right)/2)};});assert.ok(geometry.left&&geometry.center<1);
  await button.click();assert.ok(await page.locator('#palette').isVisible());await page.locator('#palette-input').press('Control+s');assert.ok(await page.locator('#palette').isHidden());
  await page.locator('#find-query').fill('alpha');await page.evaluate(async()=>{(await import('/js/app.js')).state.readOnly=true;});await page.locator('#find-query').fill('Alpha');assert.ok(await page.locator('#find-replace-all').isDisabled());await page.evaluate(async()=>{(await import('/js/app.js')).state.readOnly=false;});
  await page.locator('#modal [data-close]').click();await page.evaluate(async()=>{await(await import('/js/app.js')).flush();});await page.reload();await page.evaluate(async()=>{await(await import('/js/app.js')).appReady;});assert.equal(await page.locator('#editor').evaluate(e=>e.value),'alpha two');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log('PASS shortcuts and replacement',width,locale);await context.close();
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
