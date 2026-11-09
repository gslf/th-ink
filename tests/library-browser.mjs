import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const makeNote=(id,title,folder=null)=>({id,title,folder,body:'A quiet paragraph.\n\n'+Array.from({length:80},(_,i)=>'Line '+i+' of this note.').join('\n\n'),created:1,updated:1,deleted:false,pinned:false});
const folders=[{id:'a',name:'Alpha',parent:null},{id:'b',name:'Beta',parent:null},{id:'child',name:'Child',parent:'a'}];
const notes=[makeNote('one','First note','a'),makeNote('two','Second note','child'),makeNote('root','Root note')];
async function start(options={}){
 const context=await browser.newContext({viewport:{width:1360,height:900},locale:'en-US',...options}),page=await context.newPage();
 await page.addInitScript(()=>{delete Navigator.prototype.serviceWorker;});
 await page.goto('http://127.0.0.1:4173/__i18nqa.html');
 await page.evaluate(async({notes,folders})=>{const a=await import('./js/app.js');await a.appReady;window.a=a;a.state.tagIndex=new (await import('./js/tag-index.js')).TagIndex();for(const n of notes)a.state.tagIndex.upsert(n);await a.dailyBackup.enable(false);for(const n of await a.db.all('notes'))await a.db.remove('notes',n.id);for(const f of await a.db.all('folders'))await a.db.remove('folders',f.id);a.state.notes=notes;a.state.folders=folders;for(const n of notes)await a.db.saveNote(n);for(const f of folders)await a.db.put('folders',f);await a.openNote('one');},{notes,folders});return {context,page};
}
const row=(page,kind,id)=>page.locator(`[data-${kind}-id="${id}"] > .tree-row`).first();
async function drag(page,source,target,{part=.5,check}={}){const s=await source.boundingBox(),d=await target.boundingBox();await page.mouse.move(s.x+Math.min(s.width/2,90),s.y+s.height/2);await page.mouse.down();await page.mouse.move(s.x+100,s.y+s.height/2+12,{steps:5});await page.mouse.move(d.x+d.width/2,d.y+d.height*part,{steps:10});if(check)await check();await page.mouse.up();await page.waitForFunction(()=>!a.library.busy&&!a.state.saving);}
try{
 const {context,page}=await start();
 await row(page,'note','two').click({button:'right'});
 await page.getByRole('menuitem',{name:'Duplicate note',exact:true}).click();
 await page.waitForFunction(()=>!a.library.busy&&a.state.notes.length===4);
 assert.equal(await page.evaluate(()=>a.state.current),'one','Right click must not open a different note');
 assert.equal(await page.evaluate(()=>a.state.notes.at(-1).title),'Second note — copy');
 await row(page,'folder','a').click({button:'right'});await page.getByRole('menuitem',{name:'Move to trash',exact:true}).click();
 await page.waitForFunction(()=>!a.library.busy&&a.state.folders.find(f=>f.id==='a').deleted);
 assert.equal(await row(page,'folder','a').count(),0);
 await page.locator('[data-filter="trash"]').click();await row(page,'folder','a').click({button:'right'});await page.getByRole('menuitem',{name:'Restore',exact:true}).click();
 await page.waitForFunction(()=>!a.library.busy&&!a.state.folders.find(f=>f.id==='a').deleted);assert.equal(await page.evaluate(()=>a.state.notes.filter(n=>n.deleted).length),0);
 await page.locator('[data-filter="all"]').click();
 await drag(page,row(page,'note','one'),row(page,'folder','b'),{check:async()=>{assert.equal(await page.locator('.drop-inside').count(),1);assert.match(await page.locator('.library-drag-ghost').textContent(),/Inside: Beta/);}});
 await page.waitForFunction(()=>!a.library.busy&&a.state.notes.find(n=>n.id==='one').folder==='b');
 await page.locator('.library-feedback button').click();await page.waitForFunction(()=>!a.library.busy&&a.state.notes.find(n=>n.id==='one').folder==='a');
 await drag(page,row(page,'folder','child'),row(page,'folder','b'),{part:.08,check:async()=>{assert(await page.locator('.library-drop-line').isVisible());assert.match(await page.locator('.library-drag-ghost').textContent(),/Same level as: Beta/);}});
 await page.waitForFunction(()=>!a.library.busy&&a.state.folders.find(f=>f.id==='child').parent===null);
 await drag(page,row(page,'folder','child'),row(page,'folder','a'));await page.waitForFunction(()=>!a.library.busy&&a.state.folders.find(f=>f.id==='child').parent==='a');
 await drag(page,row(page,'folder','a'),row(page,'folder','child'),{check:async()=>assert.match(await page.locator('.library-drag-ghost').textContent(),/Choose a destination/)});
 assert.equal(await page.evaluate(()=>a.state.folders.find(f=>f.id==='a').parent),null);
 await drag(page,row(page,'note','two'),page.locator('[data-filter="trash"]'));await page.waitForFunction(()=>!a.library.busy&&a.state.notes.find(n=>n.id==='two').deleted);
 await page.locator('.library-feedback button').click();await page.waitForFunction(()=>!a.library.busy&&!a.state.notes.find(n=>n.id==='two').deleted);
 // Tags accept notes, and editor drops insert navigable internal links.
 await page.evaluate(async()=>{await a.library.apply([{kind:'note',id:'one',before:{tags:null},after:{tags:['Work']}},{kind:'note',id:'two',before:{tags:null},after:{tags:['Ideas']}}]);});
 await page.locator('[data-filter="tags"]').click();await drag(page,row(page,'note','one'),row(page,'folder','tag:ideas'));await page.waitForFunction(()=>!a.library.busy&&a.state.notes.find(n=>n.id==='one').tags.includes('Ideas'));await page.locator('[data-filter="all"]').click();
 await drag(page,row(page,'note','two'),page.locator('#editor .cm-line').first());await page.waitForFunction(()=>a.state.notes.find(n=>n.id==='one').body.includes('](note:two)'));
 await page.locator('#preview-tab').click();await page.locator('[data-note-link="two"]').click();await page.waitForFunction(()=>a.state.current==='two');await page.evaluate(()=>a.openNote('one'));await page.locator('#write-tab').click();
 // Hovering opens a closed folder; Escape cancels without moving the source.
 if(await row(page,'folder','b').locator('..').getAttribute('aria-expanded')==='true')await row(page,'folder','b').click();assert.equal(await row(page,'folder','b').locator('..').getAttribute('aria-expanded'),'false');
 const hoverSource=await row(page,'note','one').boundingBox(),hoverTarget=await row(page,'folder','b').boundingBox();await page.mouse.move(hoverSource.x+70,hoverSource.y+20);await page.mouse.down();await page.mouse.move(hoverTarget.x+80,hoverTarget.y+hoverTarget.height/2,{steps:12});await page.waitForTimeout(800);assert.equal(await row(page,'folder','b').locator('..').getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await page.evaluate(()=>a.state.notes.find(n=>n.id==='one').folder),'a');
 // The same menu works from the keyboard and never scrolls the editor on escape.
 await row(page,'note','one').locator('..').focus();await page.keyboard.press('Shift+F10');assert(await page.locator('#context-menu').isVisible());await page.keyboard.press('Escape');assert(!await page.locator('#context-menu').isVisible());
 const selection=await page.evaluate(()=>{const text=a.state.notes.find(n=>n.id==='one').body,from=text.indexOf('Line 35');document.querySelector('#editor').setSelectionRange(from,from+7);document.querySelector('#editor').focus();document.querySelector('#editor').ensureCaretVisible();return {from};});
 await page.waitForTimeout(80);
 const scroll=await page.locator('#document-scroll').evaluate(el=>el.scrollTop);
 const caret=await page.evaluate(()=>document.querySelector('#editor').markdownView.coordsAtPos(document.querySelector('#editor').selectionStart));
 await page.mouse.click(caret.left+12,caret.top+5,{button:'right'});await page.getByRole('menuitem',{name:'Bold',exact:true}).click();
 assert(await page.evaluate(()=>a.state.notes.find(n=>n.id==='one').body.includes('**Line 35**')));
 assert(Math.abs(await page.locator('#document-scroll').evaluate(el=>el.scrollTop)-scroll)<70,'Formatting should preserve the visible selection');
 await page.evaluate(()=>a.flush());await page.reload();await page.evaluate(async()=>{window.a=await import('./js/app.js');await a.appReady;});assert.equal(await page.evaluate(()=>a.state.notes.length),4);
 await mkdir('tests/reports/library',{recursive:true});await row(page,'folder','a').click({button:'right'});await page.waitForTimeout(180);await page.screenshot({path:'tests/reports/library/desktop-menu.png'});
 await context.close();console.log('PASS context targeting, duplicate, recursive trash/restore, mouse drag destinations, undo, cycle prevention, editor selection and reload');
 // Real touch events exercise the dedicated handle without preventing normal scrolling.
 const mobile=await start({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=mobile.page;await p.locator('#library-toggle').click();
 await row(p,'note','two').locator('.tree-options').tap();assert(await p.locator('#context-menu').isVisible());const box=await p.locator('#context-menu').boundingBox();assert(box.x>=0&&box.x+box.width<=390&&box.y+box.height<=844);await p.waitForTimeout(180);await p.screenshot({path:'tests/reports/library/mobile-menu.png'});await p.keyboard.press('Escape');
 const grip=await row(p,'note','two').locator('.tree-grip').boundingBox(),target=await row(p,'folder','b').boundingBox(),session=await mobile.context.newCDPSession(p);
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:grip.x+grip.width/2,y:grip.y+grip.height/2}]});
 for(let i=1;i<=12;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:grip.x+grip.width/2+(target.x+target.width/2-grip.x-grip.width/2)*i/12,y:grip.y+grip.height/2+(target.y+target.height/2-grip.y-grip.height/2)*i/12}]});
 assert(await p.locator('.library-drag-ghost').isVisible());assert.equal(await p.locator('.drop-inside').count(),1);await p.screenshot({path:'tests/reports/library/mobile-drag.png'});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForFunction(()=>!a.library.busy&&a.state.notes.find(n=>n.id==='two').folder==='b');
 const longRow=await row(p,'note','one').boundingBox();await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:longRow.x+90,y:longRow.y+20}]});await p.waitForTimeout(650);assert(await p.locator('#context-menu').isVisible());await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.keyboard.press('Escape');
 await mobile.context.close();console.log('PASS mobile menu bounds, long press and touch handle drag');
 const large=await start(),q=large.page;
 await q.evaluate(async()=>{const notes=Array.from({length:10000},(_,i)=>({id:'large-'+i,title:'Note '+String(i).padStart(5,'0'),body:'Text',folder:'a',created:1,updated:1,pinned:false,deleted:false}));a.state.notes=notes;a.state.tagIndex=new (await import('./js/tag-index.js')).TagIndex();for(const n of notes)a.state.tagIndex.upsert(n);await a.db.saveLibraryChanges({notes});await a.openNote('large-0');});
 assert(await q.locator('#note-tree [role=treeitem]').count()<50,'Large archives must remain virtualized');
 await row(q,'note','large-0').locator('.tree-options').click();await q.getByRole('menuitem',{name:'Move to…',exact:true}).click();await q.locator('#field-folder').selectOption('b');await q.getByRole('button',{name:'Confirm',exact:true}).click();await q.waitForFunction(()=>!a.library.busy&&a.state.notes[0].folder==='b');
 // Storage failure must not lose or move a note in memory.
 const failure=await q.evaluate(async()=>{const original=a.db.saveLibraryChanges;a.db.saveLibraryChanges=async()=>{throw Error('Simulated disk failure')};let rejected=false;try{await a.library.perform({kind:'note',id:'large-0'},'move',null)}catch{rejected=true}finally{a.db.saveLibraryChanges=original}return {rejected,folder:a.state.notes[0].folder};});assert.deepEqual(failure,{rejected:true,folder:'b'});
 await q.evaluate(async()=>{await a.library.perform({kind:'note',id:'large-0'},'move','a');await a.openNote('large-0');});
 const first=await row(q,'note','large-0').boundingBox();await q.mouse.move(first.x+70,first.y+20);await q.mouse.down();await q.mouse.move(first.x+110,first.y+35);await q.keyboard.press('Escape');await q.mouse.up();assert(!await q.locator('.library-drag-ghost').isVisible());assert.equal(await q.evaluate(()=>a.state.notes[0].folder),'a');
 const scroller=await q.locator('#note-tree').boundingBox(),source=await row(q,'note','large-0').boundingBox();await q.mouse.move(source.x+70,source.y+20);await q.mouse.down();await q.mouse.move(scroller.x+100,scroller.y+scroller.height-8,{steps:10});await q.waitForTimeout(400);assert(await q.locator('#note-tree').evaluate(el=>el.scrollTop)>0);await q.keyboard.press('Escape');await q.mouse.up();
 const timing=await q.evaluate(async()=>{const start=performance.now();await a.library.perform({kind:'folder',id:'a'},'trash');const trashed=a.state.notes.filter(n=>n.deleted).length;await a.library.undo();return {milliseconds:Math.round(performance.now()-start),trashed,restored:a.state.notes.every(n=>!n.deleted)};});assert.equal(timing.trashed,10000);assert(timing.restored);console.log('Large folder trash + undo:',timing.milliseconds,'ms');
 await large.context.close();console.log('PASS 10,000-note virtual archive, keyboard move alternative, failed-write rollback, Escape cancellation and auto-scroll');
}finally{await browser.close();}
