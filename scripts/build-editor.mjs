import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {outputPath} from './build-paths.mjs';
await mkdir(outputPath('licenses'),{recursive:true});
const result=await build({entryPoints:['src/editor/entry.js'],outfile:outputPath('js/markdown-editor.js'),bundle:true,external:['../js/code-highlight.js'],minify:true,format:'esm',platform:'browser',target:'es2022',metafile:true,legalComments:'linked'});
const packages=new Set(Object.keys(result.metafile.inputs).filter(p=>p.includes('node_modules/')).map(p=>{const parts=p.split('node_modules/').at(-1).split('/');return parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0];}));
let notices='CodeMirror Markdown editor, bundled locally for offline use.\n';
for(const name of [...packages].sort()){
 const root='node_modules/'+name+'/',pkg=JSON.parse(await readFile(root+'package.json','utf8'));
 notices+=`\n${name} ${pkg.version} — ${pkg.license}\n`;
 for(const file of ['LICENSE','LICENSE.md','LICENSE.txt'])try{notices+=await readFile(root+file,'utf8');break;}catch{}
}
await writeFile(outputPath('licenses/codemirror.txt'),notices);
console.log('Offline Markdown editor compiled.');
