import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const base=process.env.REMINDER_TEST_URL||'http://127.0.0.1:4192';
await mkdir('tests/reports/reminders',{recursive:true});
try{
 for(const width of [320,390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'en-US',reducedMotion:'reduce'}),page=await context.newPage();const apiCalls=[];page.on('request',r=>{if(r.url().includes('/api/'))apiCalls.push(r.url());});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/');
  await page.evaluate(async()=>{const a=await import('./js/app.js');await a.appReady;await a.dailyBackup.enable(false);await a.execute('new');document.querySelector('#note-title').value='Reminder test';document.querySelector('#note-title').dispatchEvent(new Event('input'));});
  await page.locator('.format-bar [data-action=reminder]').click();
  await page.locator('#reminder-text').fill('Call Alice');await page.locator('#reminder-at').fill('2027-01-15T10:00');await page.locator('#reminder-repeat').selectOption('weekly');await page.locator('.reminder-form [type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#modal').open);
  const r=await page.evaluate(async()=>{const a=await import('./js/app.js');await a.flush();return a.state.notes.find(n=>n.id===a.state.current).reminders[0];});assert.equal(r.repeat,'weekly');
  await page.locator('#preview-tab').click();await page.locator('.reminder-inline').click();assert.equal(await page.locator('#reminder-text').inputValue(),'Call Alice');await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(apiCalls.length,0,'Anonymous users must not contact the backend');
  // Login uses the actual PHP backend, not a mocked response.
  await page.evaluate(async()=>{const a=await import('./js/app.js');await a.reminders.account();});
  await page.locator('#reminder-email').fill(process.env.REMINDER_TEST_EMAIL);await page.locator('#reminder-password').fill(process.env.REMINDER_TEST_PASSWORD);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Enable this device',exact:true}).waitFor();
  await page.getByText('Last delivery run: 1 accepted, 1 unsuccessful attempts, 1 expired subscriptions removed.',{exact:false}).waitFor();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;Notification.requestPermission=async()=>'granted';ServiceWorkerRegistration.prototype.showNotification=async function(title,options){window.localNotice={title,...options};};});
  await page.getByText('Check device notifications',{exact:true}).click();
  const beforeLocal=apiCalls.length;await page.getByRole('button',{name:'Show local notification',exact:true}).click();
  await page.waitForFunction(()=>window.localNotice?.body==='Local notification test.');assert.equal(apiCalls.length,beforeLocal,'Local check must bypass the backend');
  assert(!(await page.locator('#modal').evaluate(e=>e.scrollWidth>e.clientWidth+1)));
  await page.screenshot({path:`tests/reports/reminders/${width}-account.png`});
  await page.locator('#modal [data-close]').click();
  await page.evaluate(async()=>{const a=await import('./js/app.js');await a.reminders.sync();a.state.filter='reminders';document.querySelector('[data-filter=reminders]').click();});
  if(width<=760)await page.locator('#library-toggle').click();
  await page.locator('.reminder-open').filter({hasText:'Call Alice'}).first().click();
  await page.locator('#editor-surface').waitFor({state:'visible'});assert(await page.evaluate(()=>{const e=document.querySelector('#editor');return e.value.slice(e.selectionStart,e.selectionEnd).includes('reminder:');}));
  const toolbar=await page.locator('.format-bar').evaluate(e=>({overflow:e.scrollWidth>e.clientWidth,visible:[...e.querySelectorAll(':scope>button,:scope>.heading-control>button')].every(b=>{const r=b.getBoundingClientRect(),p=e.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom;})}));assert(!toolbar.overflow&&toolbar.visible);
  await page.locator('.format-bar [data-action=reminder]').click();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.evaluate(async()=>{const a=await import('./js/app.js');await a.reminders.edit(a.state.notes.find(n=>n.id===a.state.current).reminders[0].id);});
  await page.screenshot({path:`tests/reports/reminders/${width}-dialog.png`});assert(!(await page.locator('#modal').evaluate(e=>e.scrollWidth>e.clientWidth+1)));
  await page.getByRole('button',{name:'Snooze 10 minutes',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#modal').open);
  assert(await page.evaluate(async()=>{const a=await import('./js/app.js');return !!a.state.notes.find(n=>n.id===a.state.current).reminders[0].snooze;}));
  // A deletion from another device is reconciled even if this note was not edited.
  await page.waitForFunction(async()=>!(await import('./js/app.js')).reminders.busy);
  await page.evaluate(async()=>{const a=await import('./js/app.js');const n=a.state.notes.find(n=>n.id===a.state.current);window.deletedReminderId=n.reminders[0].id;await a.reminders.api('delete',{ids:[n.id+':'+window.deletedReminderId]});await a.reminders.sync();if(n.reminders.length||n.body.includes(window.deletedReminderId))throw Error('Stale device not cleaned');});
  // Explicit Undo is a new reminder identity, not a resurrection by an old copy.
  await page.evaluate(async()=>{const a=await import('./js/app.js');await a.execute('undo');await a.flush();const n=a.state.notes.find(n=>n.id===a.state.current);if(!n.reminders.length||n.reminders[0].id===window.deletedReminderId)throw Error('Undo reused a deleted identity');await a.reminders.sync();});
  // Removing a marker offline must survive reload in the durable outbox.
  await context.setOffline(true);await page.evaluate(async width=>{const a=await import('./js/app.js');if(width===390){const copy=await a.db.get('notes',a.state.current);copy.body='Removed immediately before closing';await a.db.saveNote(copy);}else{const e=document.querySelector('#editor');e.value='Removed offline';e.dispatchEvent(new Event('input'));await a.flush();const q=await a.db.get('settings','reminder-outbox');if(!q.value.some(n=>n.reminders.length===0))throw Error('Missing clean note outbox');}const pending=(await a.db.all('settings')).filter(r=>r.id.startsWith('reminder-deletion:'));if(!pending.length)throw Error('Missing durable cancellation');const n=await a.db.get('notes',a.state.current);if(n.reminders?.length)throw Error('Orphan metadata retained');const {markdown}=await import('./js/core.js');if(markdown(n).includes('th.ink-note-v1'))throw Error('Orphan header exported');},width);
  await context.setOffline(false);await page.reload();await page.evaluate(async()=>{const a=await import('./js/app.js');await a.appReady;await a.reminders.initializing;await a.reminders.sync();});
  await page.evaluate(async()=>{const a=await import('./js/app.js');await a.reminders.sync();if((await a.db.all('settings')).some(r=>r.id.startsWith('reminder-deletion:')))throw Error('Cancellation acknowledgement not cleaned');if((await a.reminders.api('list')).items.some(r=>r.note_id===a.state.current))throw Error('Deleted reminder retained on server');});
  assert.equal(errors.length,0,errors.join('\n'));await context.close();console.log('PASS reminders UI '+width);
 }
}finally{await browser.close();}
