import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:320,height:740}});
 const network=[];page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await page.goto(new URL('../tools/reminder-keys.html',import.meta.url).href);
 await page.getByRole('button',{name:'Generate a new key'}).click();
 await page.locator('#result').waitFor({state:'visible'});
 const key=await page.locator('#key').inputValue(),digest=await page.locator('#digest').inputValue(),config=await page.locator('#config').inputValue();
 assert.match(key,/^[a-f0-9]{64}$/);assert.equal(digest,createHash('sha256').update(key).digest('hex'));
 assert(config.includes(digest)&&!config.includes(key));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.getByRole('button',{name:'Generate a new key'}).click();
 await page.waitForFunction(old=>document.getElementById('key').value!==old,key);
 assert.deepEqual(network,[]);
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 assert.equal(await page.locator('#key').inputValue(),'');
 console.log('PASS: offline key generation, hash-only config, fresh entropy, no network requests, mobile layout and secret cleanup');
}finally{await browser.close();}
