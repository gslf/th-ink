import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
const base=process.env.QA_URL||'http://127.0.0.1:4173';
await mkdir('tests/reports/editor',{recursive:true});
const errors=[];
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const value=page=>page.locator('#editor').evaluate(el=>el.value);
async function load(page,text,position=text.length){await page.evaluate(({text,position})=>{const e=document.querySelector('#editor');e.value=text;e.setSelectionRange(position,position);e.dispatchEvent(new Event('input'));e.focus();e.ensureCaretVisible();},{text,position});await settle(page);}
async function geometry(page){return page.evaluate(()=>{const e=document.querySelector('#editor'),v=e.markdownView,c=v.coordsAtPos(v.state.selection.main.head),s=document.querySelector('#document-scroll'),r=s.getBoundingClientRect();return {scroll:s.scrollTop,caret:c&&{top:c.top,bottom:c.bottom},top:r.top,bottom:r.bottom};});}
try{
 for(const [width,height] of [[280,653],[390,844],[760,900],[1440,960],[844,390]]){
  if(process.env.EDITOR_WIDTH&&width!==Number(process.env.EDITOR_WIDTH))continue;
  const context=await browser.newContext({viewport:{width,height},locale:'en-US',reducedMotion:'reduce'}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/__i18nqa.html');
  await page.evaluate(async()=>{const a=await import('/js/app.js');await a.appReady;await a.dailyBackup.enable(false);a.voice.start=async()=>{a.voice.active=true;a.voice.emit('state',true);};a.voice.speak=async()=>{};});
  await page.locator('#setup-dismiss').click();
  const text=Array.from({length:90},(_,i)=>`Paragraph ${i+1}. A calm place for **important ideas**, without losing your place.`).join('\n\n');
  const pos=text.indexOf('Paragraph 45');
  for(const mode of ['write','zen','voice']){
   if(mode==='zen')await page.locator('.top-actions [data-action=focus]').click();
   if(mode==='voice')await page.locator('[data-mode=voice]').click();
   await load(page,text,pos+10);await page.evaluate(()=>{const e=document.querySelector('#editor');e.setSelectionRange(e.selectionStart-4,e.selectionStart);e.ensureCaretVisible();});await settle(page);
   const before=await geometry(page);assert.ok(before.caret&&before.caret.top>=before.top&&before.caret.bottom<=before.bottom,JSON.stringify({width,mode,before}));
   await page.locator('.format-bar [data-action=bold]').click();await settle(page);
   const after=await geometry(page);assert.ok(Math.abs(after.scroll-before.scroll)<3,'bold must not jump: '+JSON.stringify({width,mode,before,after}));
   assert.ok(after.caret.top>=after.top&&after.caret.bottom<=after.bottom);
   await page.locator('.format-bar [data-action=undo]').click();await settle(page);assert.equal(await value(page),text);assert.ok(Math.abs((await geometry(page)).scroll-before.scroll)<3,'undo preserves the viewport '+JSON.stringify({before,after:await geometry(page)}));
   await page.locator('#heading-toggle').click();assert.ok(await page.locator('#heading-menu').isVisible());
   await page.locator('#heading-menu [data-level="3"]').click();await settle(page);assert.ok((await value(page)).includes('### Paragraph 45'));assert.ok(await page.locator('#heading-menu').isHidden());
   const headed=await geometry(page);assert.ok(headed.caret.top>=headed.top&&headed.caret.bottom<=headed.bottom);
   const toolbar=await page.locator('.format-bar').evaluate(el=>{const box=el.getBoundingClientRect();return {overflow:el.scrollWidth>el.clientWidth+1,buttons:[...el.querySelectorAll(':scope > button,:scope > .heading-control > button')].map(b=>{const r=b.getBoundingClientRect();return r.left>=box.left&&r.right<=box.right&&r.top>=box.top&&r.bottom<=box.bottom;})};});
   assert.equal(toolbar.overflow,false);assert.equal(toolbar.buttons.length,10);assert.ok(toolbar.buttons.every(Boolean));
  }
  await page.locator('[data-mode=keyboard]').click();
  // Keyboard editing, navigation and modal formatting retain the same document position.
  await load(page,text,pos+10);
  const typingBefore=await geometry(page);await page.locator('.cm-content').press('x');await settle(page);
  assert.ok(Math.abs((await geometry(page)).scroll-typingBefore.scroll)<3,'typing preserves viewport '+JSON.stringify({width,before:typingBefore,after:await geometry(page)}));
  await page.locator('.cm-content').press('Control+z');assert.equal(await value(page),text);
  await page.locator('.cm-content').press('Control+End');await settle(page);
  let edge=await geometry(page);assert.ok(edge.caret&&edge.caret.top>=edge.top&&edge.caret.bottom<=edge.bottom,'end is visible');
  await page.locator('.cm-content').press('Enter');await settle(page);edge=await geometry(page);assert.ok(edge.caret&&edge.caret.top>=edge.top&&edge.caret.bottom<=edge.bottom,'new line stays visible');
  await page.locator('.cm-content').press('Control+Home');await settle(page);edge=await geometry(page);assert.ok(edge.caret&&edge.caret.top>=edge.top&&edge.caret.bottom<=edge.bottom,'start is visible');
  await load(page,text,pos+10);await page.locator('#heading-toggle').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');await page.keyboard.press('Enter');assert.ok((await value(page)).includes('#### Paragraph 45'));
  await page.locator('.format-bar [data-action=link]').click();await page.locator('#field-label').fill('A link');await page.locator('#field-url').fill('https://example.com');await page.locator('#modal button[type=submit]').click();await settle(page);
  edge=await geometry(page);assert.ok(edge.caret&&edge.caret.top>=edge.top&&edge.caret.bottom<=edge.bottom,'link insertion keeps cursor visible');
  for(const list of ['- item','- [x] item','9. item']){
   await load(page,list);await page.locator('.cm-content').press('Enter');assert.match(await value(page),/\n(?:- (?:\[ \] )?|10\. )$/);
   await page.locator('.cm-content').press('Enter');assert.equal(await value(page),list+'\n');
  }
  await load(page,'- touch');
  await page.locator('.cm-content').evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertParagraph',bubbles:true,cancelable:true})));
  assert.equal(await value(page),'- touch\n- ');
  await page.locator('.cm-content').evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertParagraph',bubbles:true,cancelable:true})));
  assert.equal(await value(page),'- touch\n');
  await page.locator('[data-mode=voice]').click();await load(page,'- item');
  await page.evaluate(async()=>{const a=await import('/js/app.js');a.voice.mode='dictation';await a.spoken.receive('new line');});assert.equal(await value(page),'- item\n- ');
  await page.evaluate(async()=>{await(await import('/js/app.js')).spoken.receive('new line');});assert.equal(await value(page),'- item\n');
  await load(page,'- [ ] task');await page.evaluate(async()=>{const a=await import('/js/app.js');a.voice.mode='commands';await a.spoken.receive('new line');});assert.equal(await value(page),'- [ ] task\n- [ ] ');
  await page.locator('[data-mode=keyboard]').click();await page.locator('.top-actions [data-action=focus]').click();
  await load(page,'# Room to think\n\nA little **bold**, a little *italic*, and `code`.\n\n## Small steps\n\n- [ ] Gather an idea\n- [ ] Give it some space\n\n### Nothing hidden\n\nThe Markdown stays visible.');
  const styles=await page.locator('.cm-content').evaluate(el=>{const spans=[...el.querySelectorAll('span')];return {heading:spans.some(s=>s.textContent.includes('Room')&&parseFloat(getComputedStyle(s).fontSize)>24),bold:spans.some(s=>s.textContent.includes('bold')&&+getComputedStyle(s).fontWeight>=650),italic:spans.some(s=>s.textContent.includes('italic')&&getComputedStyle(s).fontStyle==='italic')};});assert.ok(styles.heading&&styles.bold&&styles.italic,JSON.stringify(styles));
  await page.evaluate(()=>document.querySelector('#document-scroll').scrollTop=0);await settle(page);
  await page.screenshot({path:`tests/reports/editor/${width}.png`});
  if([390,1440].includes(width))await page.screenshot({path:`src/screenshots/${width===390?'mobile':'desktop'}-en.png`});
  await page.evaluate(async()=>{await(await import('/js/app.js')).flush();});const saved=await value(page);await page.reload();await page.evaluate(async()=>{await(await import('/js/app.js')).appReady;});assert.equal(await value(page),saved);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log('PASS editor',width,height);await context.close();
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
