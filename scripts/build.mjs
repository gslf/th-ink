import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {updateServiceWorker} from './pwa-assets.mjs';
const rust = `${homedir()}/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/lib/rustlib/x86_64-unknown-linux-gnu/bin/rust-lld`;
const dir=mkdtempSync(join(tmpdir(),'think-build-'));const object=join(dir,'search.o');
function run(cmd,args){const r=spawnSync(cmd,args,{stdio:'inherit'});if(r.error)console.error(r.error.message);if(r.status!==0)process.exit(r.status||1);}
try{
 run(process.execPath,['scripts/build-filen.mjs']);
 run(process.execPath,['scripts/build-editor.mjs']);
 run(process.execPath,['scripts/build-emoji.mjs']);
 run('clang',['--target=wasm32','-O3','-nostdlib','-fno-builtin','-c','native/search.c','-o',object]);
 const linker=process.env.WASM_LD || (existsSync(rust)?rust:'wasm-ld');
 run(linker,[...(linker.includes('rust-lld')?['-flavor','wasm']:[]),'--no-entry','--export-memory','--export=__heap_base','--initial-memory=131072','--max-memory=268435456','-z','stack-size=65536',object,'-o','dist/assets/search.wasm']);
 updateServiceWorker('dist');
 console.log('C → WebAssembly compiled. Cache updated; vendored speech engines remain local.');
}finally{rmSync(dir,{recursive:true,force:true});}
