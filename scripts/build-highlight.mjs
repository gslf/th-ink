import {build} from 'esbuild';
import {copyFile,mkdir} from 'node:fs/promises';
import {outputPath} from './build-paths.mjs';
await build({entryPoints:['src/js/code-highlight.js'],outfile:outputPath('js/code-highlight.js'),bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',legalComments:'inline'});
await mkdir(outputPath('licenses'),{recursive:true});
await copyFile('node_modules/highlight.js/LICENSE',outputPath('licenses/highlight.js.txt'));
console.log('Offline code highlighting compiled.');
