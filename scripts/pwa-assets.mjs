import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

function files(directory,prefix=''){
 return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const relative=prefix+entry.name;
  return entry.isDirectory()?files(join(directory,entry.name),relative+'/'):[relative];
 });
}

// Keep all maintained code and install metadata offline, including nested locales.
// Large downloaded models and promotional screenshots have separate lifecycles.
export function shellAssets(directory){
 const all=files(directory);
 const included=all.filter(path=>['index.html','style.css'].includes(path)||/^[^/]+\.webmanifest$/.test(path)||/^(js|assets|locales)\//.test(path)||path==='vendor/filen/sdk.js');
 return ['./',...included.sort().map(path=>'./'+path)];
}

export function updateServiceWorker(directory){
 const assets=shellAssets(directory),workerPath=join(directory,'sw.js');
 const original=readFileSync(workerPath,'utf8');
 if(!/^const CACHE='th-ink-shell-[a-z0-9]+';/m.test(original)||!/^const ASSETS=\[.*?\];/ms.test(original))throw Error('Service-worker cache declarations were not found.');
 const normalized=original.replace(/^const CACHE='th-ink-shell-[a-z0-9]+';/m,"const CACHE='th-ink-shell-version';").replace(/^const ASSETS=\[.*?\];/ms,`const ASSETS=${JSON.stringify(assets)};`);
 const hash=createHash('sha256').update(normalized);
 for(const asset of assets){if(asset==='./')continue;hash.update(asset).update('\0').update(readFileSync(join(directory,asset)));}
 const version=hash.digest('hex').slice(0,12);
 writeFileSync(workerPath,normalized.replace('th-ink-shell-version',`th-ink-shell-${version}`));
 return {version,assets};
}
