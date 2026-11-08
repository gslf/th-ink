import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
const root = resolve('dist');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.wasm':'application/wasm','.ico':'image/x-icon','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{
 try {
  const url = new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'The static preview does not run PHP. Configure the reminders backend on your HTTPS hosting.'}));return;}
  if(url.pathname==='/__i18nqa.html'&&process.argv.includes('--qa')){const html=(await readFile('dist/index.html','utf8')).replace('id="app"','id="app" data-test-database="think-i18n-qa"');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  if(url.pathname==='/__filenqa.html'&&process.argv.includes('--qa')){const html=(await readFile('dist/index.html','utf8')).replace('id="app"','id="app" data-test-database="think-filen-ux-qa"').replace('</body>','<script type="module" src="/__filenqa.js"></script></body>');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  if(url.pathname==='/__filenqa.js'&&process.argv.includes('--qa')){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile('tests/filen-browser.js'));return;}
  if(url.pathname==='/__uxqa.html'&&process.argv.includes('--qa')){const html=(await readFile('dist/index.html','utf8')).replace('id="app"','id="app" data-test-database="think-ux-qa"').replace('</body>','<script type="module" src="/__uxqa.js"></script></body>');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  if(url.pathname==='/__uxqa.js'&&process.argv.includes('--qa')){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile('tests/ux-browser.js'));return;}
  if(url.pathname==='/__dictationqa.html'&&process.argv.includes('--qa')){const html=(await readFile('dist/index.html','utf8')).replace('id="app"','id="app" data-test-database="think-dictation-qa"').replace('<script type="module" src="./js/app.js"></script>','<script type="module" src="/__dictationqa.js"></script>');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  if(url.pathname==='/__dictationqa.js'&&process.argv.includes('--qa')){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile('tests/dictation-browser.js'));return;}
  if(url.pathname==='/__screenlessqa.html'&&process.argv.includes('--qa')){const html=(await readFile('dist/index.html','utf8')).replace('id="app"','id="app" data-test-database="think-screenless-qa"').replace('<script type="module" src="./js/app.js"></script>','<script type="module" src="/__screenlessqa.js"></script>');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  if(url.pathname==='/__screenlessqa.js'&&process.argv.includes('--qa')){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile('tests/screenless-browser.js'));return;}
  if(url.pathname==='/__voiceqa.html'&&process.argv.includes('--qa')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile('tests/voice-browser.html'));return;}
  if(url.pathname==='/__qa.html'&&process.argv.includes('--qa')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile('tests/browser.html'));return;}
  const path = resolve(root, '.'+decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!path.startsWith(root+sep)) throw Error('path');
  const data = await readFile(path);
  res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(data);
 } catch {res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.PORT || 4173),'127.0.0.1',()=>console.log('th.ink → http://127.0.0.1:4173'));
