// Optional end-to-end QA. Start npm run test:browser, then run this with Playwright
// available (or set PLAYWRIGHT_MODULE to its absolute module path).
import assert from 'node:assert/strict';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.QA_URL||'http://127.0.0.1:4173';
const output=fileURLToPath(new URL('../src/screenshots/',import.meta.url));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const results=[],errors=[];
const record=(name)=>{results.push(name);console.log('PASS',name);};
const boot=page=>page.evaluate(async()=>{const app=await import('/js/app.js');await app.appReady;await app.dailyBackup.enable(false);app.voice.start=async()=>{window.__testedRecognitionLanguage=app.voice.lang;app.voice.active=true;app.voice.emit('state',true);};});
async function fresh(languages,viewport={width:1440,height:960}){
 const context=await browser.newContext({locale:languages[0],viewport,colorScheme:'light',reducedMotion:'reduce'});
 await context.addInitScript(langs=>{Object.defineProperty(navigator,'languages',{get:()=>langs});},languages);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/__i18nqa.html');await boot(page);return {context,page};
}
async function language(page,expected){
 await page.waitForFunction(lang=>document.documentElement.lang===lang,expected);
 assert.equal(await page.evaluate(async()=>{return (await import('/js/app.js')).voice.lang;}),expected==='it'?'it-IT':'en-US');
 assert.match(await page.locator('link[rel=manifest]').getAttribute('href'),expected==='it'?/manifest-it/:/manifest\.webmanifest/);
}
async function layout(page){
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
}
try{
 await mkdir(output,{recursive:true});
 for(const [prefs,expected] of [[['it-IT','en-US'],'it'],[['en-GB','it-IT'],'en'],[['fr-FR','it-CH'],'it'],[['de-DE'],'en']]){
  const {page,context}=await fresh(prefs);await language(page,expected);
  assert.match(await page.locator('#note-title').inputValue(),expected==='it'?/Uno spazio/:/Room to think/);
  record('Browser preferences '+prefs.join(', ')+' → '+expected);await context.close();
 }
 const {page,context}=await fresh(['en-US','it-IT']);
 // Installation is disabled in Playwright's incognito contexts. Validate it in
 // a separate disposable persistent profile, never in the user's browser profile.
 const profile=await mkdtemp(join(tmpdir(),'think-install-qa-'));
 const installContext=await chromium.launchPersistentContext(profile,{headless:true,locale:'en-US',...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const installPage=await installContext.newPage();await installPage.goto(base+'/__i18nqa.html');await boot(installPage);
  const cdp=await installContext.newCDPSession(installPage);await cdp.send('Page.enable');
  const manifest=await cdp.send('Page.getAppManifest');assert.deepEqual(manifest.errors,[]);assert.equal(JSON.parse(manifest.data).lang,'en');
  const installability=await cdp.send('Page.getInstallabilityErrors');assert.deepEqual(installability.installabilityErrors,[]);
  record('Chromium accepts the English manifest and reports no installability errors');
 }finally{await installContext.close();await rm(profile,{recursive:true,force:true});}
 await page.locator('#setup-dismiss').click();
 await page.locator('#editor .cm-content').fill('An English note.\n\nUna nota italiana. Café 👩‍💻');
 await page.locator('#editor').evaluate(el=>el.setSelectionRange(3,10));
 const original=await page.locator('#editor').evaluate(el=>el.value);
 await page.locator('[data-action=settings]').click();await page.locator('#app-language').selectOption('it');await language(page,'it');
 await page.waitForFunction(()=>document.querySelector('#modal-content h2').textContent==='Come ti piace.');
 assert.equal(await page.locator('#editor').evaluate(el=>el.value),original);
 assert.deepEqual(await page.locator('#editor').evaluate(el=>[el.selectionStart,el.selectionEnd]),[3,10]);
 assert.equal(await page.locator('#app-language').inputValue(),'it');
 record('Settings switch translates UI and voice while preserving note text and selection');
 await page.reload();await boot(page);await language(page,'it');assert.equal(await page.locator('#editor').evaluate(el=>el.value),original);
 record('Explicit language and edited notes survive reload');
 await page.locator('[data-action=settings]').click();await page.locator('#app-language').selectOption('auto');await language(page,'en');
 await page.waitForFunction(()=>document.querySelector('#modal-content h2').textContent==='Make it yours.');
 await page.locator('#modal [data-close]').click();
 for(const lang of ['en','it']){
  await page.locator('[data-action=settings]').click();await page.locator('#app-language').selectOption(lang);await language(page,lang);await page.locator('#modal [data-close]').click();
  await page.locator('[data-mode=voice]').click();await page.waitForFunction(()=>window.__testedRecognitionLanguage);
  assert.equal(await page.evaluate(()=>window.__testedRecognitionLanguage),lang==='it'?'it-IT':'en-US');
  await page.locator('[data-mode=keyboard]').click();await page.evaluate(()=>{delete window.__testedRecognitionLanguage;});
 }
 record('Voice start loads the language selected for the interface (no microphone recording)');
 await page.locator('[data-action=settings]').click();assert.equal(await page.locator('#app-language').inputValue(),'it');
 await page.locator('#app-language').selectOption('en');await language(page,'en');
 await page.waitForFunction(()=>document.querySelector('#modal-content h2').textContent==='Make it yours.');
 await page.locator('#modal [data-close]').click();
 await page.locator('[data-action=palette]').first().click();await page.locator('#palette-input').fill('bold');assert.match(await page.locator('#palette-results').innerText(),/Bold/);await page.locator('#palette [data-close]').click();
 record('Command search uses translated labels');
 await context.setOffline(true);await page.goto(base+'/');await boot(page);await language(page,'en');
 // Offline navigation uses the cached production document, whose archive is separate.
 await page.locator('[data-action=settings]').click();await page.locator('#app-language').selectOption('it');await language(page,'it');
 record('Cached PWA opens and switches both languages without network');await context.close();
 // Capture real, fresh English UI, without altering user archives or image contents.
 const capture=async(name,viewport,{dark=false,view='read'}={})=>{
  const {page,context}=await fresh(['en-US'],viewport);
  await page.locator('#setup-dismiss').click();
  if(dark)await page.evaluate(async()=>{await (await import('/js/app.js')).appearance.set('dark');});
  if(view==='read')await page.locator('#preview-tab').click();
  if(view==='settings'){if(viewport.width<=760)await page.locator('#library-toggle').click();await page.locator('[data-action=settings]').click();}
  if(view==='library')await page.locator('#library-toggle').click();
  if(view==='voice'){await page.locator('#editor .cm-content').press('Control+Home');await page.locator('[data-mode=voice]').click();await page.waitForFunction(()=>!document.querySelector('#voice-status').textContent.startsWith('Checking'));}
  await layout(page);
  await page.screenshot({path:output+name+'.png',animations:'disabled'});
  record('English screenshot '+name+' '+viewport.width+'×'+viewport.height);await context.close();
 };
 await capture('desktop-en',{width:1440,height:960});
 await capture('mobile-en',{width:390,height:844});
 await capture('tablet-en',{width:1024,height:1366});
 await capture('desktop-dark-en',{width:1440,height:960},{dark:true});
 await capture('mobile-dark-en',{width:390,height:844},{dark:true});
 await capture('desktop-settings-en',{width:1440,height:960},{view:'settings'});
 await capture('mobile-library-en',{width:390,height:844},{view:'library'});
 await capture('mobile-voice-en',{width:390,height:844},{view:'voice'});
 for(const viewport of [{width:320,height:568},{width:844,height:390},{width:768,height:1024},{width:1920,height:1080}]){
  const {page,context}=await fresh(['it-IT'],viewport);await page.locator('#setup-dismiss').click();await layout(page);await page.locator('[data-mode=voice]').click();await layout(page);assert.ok(await page.locator('#voice-dock').evaluate(el=>[...el.children].every(child=>{const r=child.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})),'voice controls fit the viewport');
  await page.locator('[data-mode=keyboard]').click();if(viewport.width<=760)await page.locator('#library-toggle').click();await page.locator('[data-action=settings]').click();await layout(page);
  record('Italian layout, voice and settings '+viewport.width+'×'+viewport.height);await context.close();
 }
 assert.deepEqual(errors,[],'browser exceptions');
 await mkdir(new URL('./reports/',import.meta.url),{recursive:true});
 await writeFile(new URL('./reports/i18n-pwa.json',import.meta.url),JSON.stringify({browser:browser.version(),results,errors},null,2)+'\n');
 console.log(`${results.length} browser checks passed; no uncaught exceptions.`);
}finally{await browser.close();}
