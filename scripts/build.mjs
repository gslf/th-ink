import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync,cpSync,copyFileSync,mkdirSync,renameSync,readdirSync,lstatSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,relative,dirname,resolve} from 'node:path';
import {projectRoot} from './build-paths.mjs';
import {updateServiceWorker} from './pwa-assets.mjs';
process.chdir(projectRoot);
const source=join(projectRoot,'src'),destination=join(projectRoot,'dist');
const cache=join(projectRoot,'.cache');mkdirSync(cache,{recursive:true});
const staging=mkdtempSync(join(cache,'build-')),previous=staging+'-previous';
const rust=`${homedir()}/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/lib/rustlib/x86_64-unknown-linux-gnu/bin/rust-lld`;
const object=join(cache,'search.o');
function run(command,args){
 const result=spawnSync(command,args,{stdio:'inherit',env:{...process.env,THINK_BUILD_DIR:staging}});
 if(result.error)throw result.error;if(result.status!==0)throw Error(`${command} exited with status ${result.status}.`);
}
function publicSource(path){
 const stat=lstatSync(path),name=relative(source,path);
 if(stat.isSymbolicLink())throw Error(`Source symlinks cannot be published: ${name}`);
 if(/(?:^|\/)(?:config\.php|config\.local\.[^/]+|\.env(?:\.[^/]+)?|\.npmrc|auth\.json|credentials[^/]*|think-private)(?:\/|$)|\.(?:pem|key|sqlite(?:3)?|db|sql|dump|bak)$/i.test(name))throw Error(`Private file found in public sources: ${name}`);
 if(stat.isDirectory())for(const entry of readdirSync(path))publicSource(join(path,entry));
}
try{
 publicSource(source);
 // Downloaded runtimes and models have their own ignored, checksum-verified cache.
 run(process.env.PYTHON_BINARY||'python3',['scripts/setup-voice.py']);
 for(const entry of readdirSync(source)){if(['editor','native'].includes(entry))continue;cpSync(join(source,entry),join(staging,entry),{recursive:true});}
 cpSync('licenses',join(staging,'licenses'),{recursive:true});
 for(const file of ['LICENSE','THIRD_PARTY.md'])copyFileSync(file,join(staging,file));
 const runtimeFiles=JSON.parse(readFileSync('scripts/voice-lock.json','utf8')).flatMap(p=>Object.values(p.files).map(f=>f.path));
 const modelFiles=Object.values(JSON.parse(readFileSync('src/models/manifest.json','utf8'))).map(m=>join(cache,'voice',m.url));
 for(const path of [...runtimeFiles,...modelFiles]){const name=relative(join(cache,'voice'),resolve(path));if(name.startsWith('..'))throw Error('Speech asset is outside its cache.');const target=join(staging,name);mkdirSync(dirname(target),{recursive:true});copyFileSync(path,target);}
 run(process.execPath,['scripts/build-filen.mjs']);
 run(process.execPath,['scripts/build-highlight.mjs']);
 run(process.execPath,['scripts/build-editor.mjs']);
 run(process.execPath,['scripts/build-emoji.mjs']);
 run(process.execPath,['scripts/build-backend.mjs']);
 run('clang',['--target=wasm32','-O3','-nostdlib','-fno-builtin','-c','src/native/search.c','-o',object]);
 const linker=process.env.WASM_LD||(existsSync(rust)?rust:'wasm-ld');
 run(linker,[...(linker.includes('rust-lld')?['-flavor','wasm']:[]),'--no-entry','--export-memory','--export=__heap_base','--initial-memory=131072','--max-memory=268435456','-z','stack-size=65536',object,'-o',join(staging,'assets/search.wasm')]);
 updateServiceWorker(staging);
 // Publish only a complete build. Failures leave the previous distribution intact.
 if(existsSync(destination))renameSync(destination,previous);
 try{renameSync(staging,destination);}catch(error){if(existsSync(previous))renameSync(previous,destination);throw error;}
 rmSync(previous,{recursive:true,force:true});
 console.log('dist/ regenerated from src/. Ready to distribute.');
}finally{rmSync(staging,{recursive:true,force:true});rmSync(object,{force:true});}
