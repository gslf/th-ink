import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
test('the distributable includes generated runtimes and PHP, without build inputs or private configuration',()=>{
 for(const path of ['index.html','js/app.js','js/markdown-editor.js','assets/search.wasm','assets/emoji/en.json','assets/emoji/it.json','api/index.php','api/vendor/autoload.php','api/vendor/.htaccess','LICENSE','THIRD_PARTY.md'])assert(existsSync(resolve(root,'dist',path)),path);
 for(const path of ['editor/entry.js','native/search.c','api/config.php','.env','node_modules','server'])assert(!existsSync(resolve(root,'dist',path)),path);
 for(const package_ of JSON.parse(readFileSync(resolve(root,'scripts/voice-lock.json'))))for(const file of Object.values(package_.files))assert(existsSync(resolve(root,'dist',file.path.replace('.cache/voice/',''))));
 for(const model of Object.values(JSON.parse(readFileSync(resolve(root,'src/models/manifest.json')))))assert(existsSync(resolve(root,'dist',model.url)));
});
test('source and generated service workers have separate lifecycles',()=>{
 const source=readFileSync(resolve(root,'src/sw.js'),'utf8'),built=readFileSync(resolve(root,'dist/sw.js'),'utf8');
 assert.match(source,/const CACHE='th-ink-shell-version';/);assert.match(source,/const ASSETS=\[\];/);
 assert.match(built,/const CACHE='th-ink-shell-[a-f0-9]{12}';/);assert(built.includes('./js/app.js'));
 for(const path of ['js/markdown-editor.js','assets/search.wasm','assets/emoji/en.json','vendor/vosk/vosk.js'])assert(!existsSync(resolve(root,'src',path)),path);
});
