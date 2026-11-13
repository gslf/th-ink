// Focus-mode behavior is verified with disposable archives and a simulated microphone.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
const base=process.env.QA_URL||'http://127.0.0.1:4173';
const captures=new URL('./reports/focus/',import.meta.url);
await mkdir(captures,{recursive:true});
const errors=[];
try{
 for(const [width,height,locale,theme] of [[280,653,'it-IT','light'],[320,568,'en-US','dark'],[390,844,'en-US','light'],[760,900,'it-IT','dark'],[768,1024,'en-US','light'],[1440,960,'en-US','light'],[1440,960,'it-IT','dark'],[844,390,'en-US','light']]){
  const context=await browser.newContext({viewport:{width,height},locale,colorScheme:theme,reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/__i18nqa.html');
  await page.evaluate(async()=>{const app=await import('/js/app.js');await app.appReady;await app.dailyBackup.enable(false);});
  const body=await page.locator('#editor').evaluate(el=>el.value),title=await page.locator('#note-title').inputValue();
  await page.locator('#editor').evaluate(el=>el.setSelectionRange(3,8));
  await page.locator('#preview-tab').click();
  const focus=page.locator('.top-actions [data-action=focus]');await focus.click();
  assert.equal(await focus.getAttribute('aria-pressed'),'true');
  assert.equal(await focus.getAttribute('aria-label'),locale==='it-IT'?'Esci dalla concentrazione':'Exit focus mode');
  for(const selector of ['.sidebar','.breadcrumb','#save-state','[data-action=more]','.document-meta','#note-title','.document-tabs','#setup-toast','#word-count','.shortcut-button','#voice-dock','.format-bar [data-action=palette]'])assert.ok(await page.locator(selector).isHidden(),selector);
  for(const selector of ['#editor','.format-bar','.mode-switch'])assert.ok(await page.locator(selector).isVisible(),selector);
  assert.deepEqual(await page.locator('#editor').evaluate(el=>[el.selectionStart,el.selectionEnd]),[3,8]);
  assert.equal(await page.locator('#editor').evaluate(el=>el.value),body);assert.equal(await page.locator('#note-title').inputValue(),title);
  const geometry=await page.evaluate(()=>{
   const box=s=>document.querySelector(s).getBoundingClientRect(),editor=box('#editor'),tools=box('.format-bar'),footer=box('.editor-footer'),mode=box('.mode-switch'),exit=box('.top-actions [data-action=focus]');
   return {overflow:document.documentElement.scrollWidth>innerWidth,toolsBelow:tools.top>=exit.bottom,toolsAbove:tools.bottom<=footer.top,center:Math.abs((mode.left+mode.right)/2-innerWidth/2),editorWidth:editor.width,exitSize:[exit.width,exit.height]};
  });
  assert.equal(geometry.overflow,false);assert.ok(geometry.toolsBelow&&geometry.toolsAbove);assert.ok(geometry.center<1);assert.ok(geometry.editorWidth<=720);{const target=await page.evaluate(()=>matchMedia('(pointer:coarse),(max-width:760px)').matches?44:32);assert.deepEqual(geometry.exitSize,[target,target]);}
  await page.screenshot({path:new URL(`${width}-${height}-${locale}-${theme}.png`,captures).pathname,animations:'disabled'});
  if(locale==='en-US'&&theme==='light'&&[390,1440].includes(width))await page.screenshot({path:new URL(`../src/screenshots/${width===390?'mobile':'desktop'}-focus-en.png`,import.meta.url).pathname,animations:'disabled'});
  // A virtual keyboard must not remove either input mode or the exit action.
  if(width<=760){await page.evaluate(()=>document.body.classList.add('keyboard-open'));assert.ok(await page.locator('.mode-switch').isVisible());await page.evaluate(()=>document.body.classList.remove('keyboard-open'));}
  await focus.click();assert.ok(await page.locator('#preview').isVisible());assert.ok(await page.locator('#note-title').isVisible());
  await page.keyboard.press('Control+Shift+f');assert.equal(await focus.getAttribute('aria-pressed'),'true');
  await page.locator('.format-bar [data-action=bold]').click();
  assert.equal(await page.locator('#editor').evaluate(el=>el.value),body.slice(0,3)+'**'+body.slice(3,8)+'**'+body.slice(8));
  await page.locator('.format-bar [data-action=undo]').click();assert.equal(await page.locator('#editor').evaluate(el=>el.value),body);
  // No hardware microphone, permission prompt, or model download is used by this test.
  await page.evaluate(async()=>{
   const {voice}=await import('/js/app.js');window.starts=0;voice.availability=async()=> 'available';
   voice.start=async()=>{window.starts++;voice.active=true;voice.emit('state',true);};
   voice.stop=()=>{voice.active=false;voice.emit('state',false);};
  });
  const voiceButton=page.locator('[data-mode=voice]');await voiceButton.click();
  await page.waitForFunction(async()=>(await import('/js/app.js')).voice.active);
  assert.ok(await page.locator('#voice-underline').isVisible());assert.ok(await page.locator('.format-bar').isVisible());assert.ok(await page.locator('.mode-switch').isVisible());
  await voiceButton.click();assert.equal(await page.evaluate(()=>window.starts),1);
  await page.locator('[data-mode=keyboard]').click();assert.equal(await page.evaluate(async()=>(await import('/js/app.js')).voice.active),false);
  await voiceButton.click();await focus.click();assert.ok(await page.locator('#voice-level').isVisible());
  await page.locator('[data-mode=keyboard]').click();await focus.click();
  if(width===390){
   await page.evaluate(async()=>{await(await import('/js/app.js')).changeLanguage('it');});
   assert.equal(await focus.getAttribute('aria-label'),'Esci dalla concentrazione');
   await page.keyboard.press('Control+Alt+n');await page.waitForFunction(()=>document.querySelector('#editor').contains(document.activeElement));
  }
  await page.evaluate(async()=>{await(await import('/js/app.js')).openNote(null);});
  assert.equal(await focus.getAttribute('aria-pressed'),'false');assert.ok(await focus.isDisabled());assert.ok(await page.locator('#empty-state').isVisible());
  console.log('PASS focus',width,height,locale,theme);await context.close();
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
