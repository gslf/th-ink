import {build} from 'esbuild';
import {polyfillNode} from 'esbuild-plugin-polyfill-node';
import {mkdir,copyFile,writeFile,readFile} from 'node:fs/promises';
const output='dist/vendor/filen';
await mkdir(output,{recursive:true});
const result=await build({stdin:{contents:'export {FilenSDK} from "@filen/sdk"; export {APIClientDefaults} from "./node_modules/@filen/sdk/dist/browser/api/client.js";',resolveDir:process.cwd(),sourcefile:'filen-browser-entry.js'},outfile:output+'/sdk.js',bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',metafile:true,legalComments:'linked',define:{global:'globalThis'},plugins:[{name:'unused-node-services',setup(b){b.onResolve({filter:/^(fs-extra|agentkeepalive|progress-stream|dotenv)$/},args=>({path:args.path,namespace:'node-only'}));b.onLoad({filter:/.*/,namespace:'node-only'},()=>({contents:'export const HttpsAgent=class {}; export default new Proxy(function(){throw Error("Node-only SDK API unavailable in browser")},{get(){return ()=>{throw Error("Node-only SDK API unavailable in browser")}}});'}));}},polyfillNode({polyfills:{crypto:'empty',fs:'empty'}})]});
await copyFile('node_modules/@filen/sdk/LICENSE',output+'/LICENSE');
const packages=new Set(Object.keys(result.metafile.inputs).filter(p=>p.includes('node_modules/')).map(p=>{const tail=p.split('node_modules/').at(-1).split('/');return tail[0].startsWith('@')?tail.slice(0,2).join('/'):tail[0];}));
let notices='Official Filen SDK browser bundle, built locally. No CDN.\n';
for(const name of [...packages].sort())try{const p=JSON.parse(await readFile('node_modules/'+name+'/package.json','utf8'));notices+=`\n${name} ${p.version} — ${p.license||'see package'}\n`;for(const file of ['LICENSE','LICENSE.md','LICENSE.txt','license'])try{notices+=await readFile('node_modules/'+name+'/'+file,'utf8');break;}catch{}}catch{}
await writeFile(output+'/THIRD_PARTY.txt',notices);
console.log('Filen browser SDK compiled.');
