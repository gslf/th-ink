// Optional asset maintenance: requires librsvg (rsvg-convert) and ImageMagick.
// SVG paths are the source of truth; no installed font is needed to render them.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const assets=fileURLToPath(new URL('../src/assets/',import.meta.url));
function run(command,args){const result=spawnSync(command,args,{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw Error(`${command} failed (${result.status})`);}
function png(source,name,size){run('rsvg-convert',['--width',String(size),'--height',String(size),'--output',join(assets,name),join(assets,source)]);}
for(const size of [192,512]){
 png('icon.svg',`icon-${size}.png`,size);
 png('icon-maskable.svg',`icon-maskable-${size}.png`,size);
}
for(const size of [152,167,180])png('icon-maskable.svg',`apple-touch-icon-${size}.png`,size);
for(const size of [16,32,48])png('icon.svg',`favicon-${size}.png`,size);
run('magick',[...([16,32,48].map(size=>join(assets,`favicon-${size}.png`))),join(assets,'favicon.ico')]);
console.log('PWA icons regenerated from outlined SVG artwork.');
