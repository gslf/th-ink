import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {inflateSync} from 'node:zlib';
import {shellAssets,updateServiceWorker} from '../scripts/pwa-assets.mjs';
const dist=new URL('../dist/',import.meta.url);
const read=path=>readFile(new URL(path,dist));
function pngDimensions(buffer){assert.equal(buffer.subarray(0,8).toString('hex'),'89504e470d0a1a0a');return [buffer.readUInt32BE(16),buffer.readUInt32BE(20)];}
function rgbaPNG(buffer){
 const [width,height]=pngDimensions(buffer),channels=buffer[25]===6?4:3;
 assert.ok([2,6].includes(buffer[25]));assert.equal(buffer[24],8);assert.equal(buffer[28],0);
 const chunks=[];for(let offset=8;offset<buffer.length;){const length=buffer.readUInt32BE(offset);if(buffer.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(buffer.subarray(offset+8,offset+8+length));offset+=12+length;}
 const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels,pixels=Buffer.alloc(width*height*channels);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];assert.ok(filter<=4);for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,b=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0;pixels[i]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
 return {width,height,channels,pixels};
}

test('localized manifests share application identity and provide desktop/mobile install metadata',async()=>{
 const manifests=await Promise.all(['manifest.webmanifest','manifest-it.webmanifest'].map(async path=>JSON.parse(await read(path))));
 assert.deepEqual(manifests.map(m=>m.lang),['en','it']);
 for(const manifest of manifests){
  assert.equal(manifest.id,'/th-ink/');assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');assert.equal(manifest.display,'standalone');assert.equal(manifest.short_name,'th.ink');assert.ok(manifest.name.startsWith('th.ink'));assert.ok(manifest.description.length>30);
  for(const size of [192,512])for(const purpose of ['any','maskable']){const icon=manifest.icons.find(i=>i.sizes===`${size}x${size}`&&i.purpose===purpose);assert.ok(icon);assert.deepEqual(pngDimensions(await read(icon.src)),[size,size]);}
  assert.ok(manifest.icons.some(i=>i.sizes==='any'&&i.type==='image/svg+xml'));
  assert.ok(manifest.screenshots.some(s=>s.form_factor==='wide'));assert.ok(manifest.screenshots.some(s=>s.form_factor==='narrow'));
  const ratios=new Map();
  for(const screenshot of manifest.screenshots){assert.match(screenshot.src,/-en\.png$/);assert.ok(screenshot.label.startsWith('English '));const sizes=screenshot.sizes.split('x').map(Number);assert.deepEqual(pngDimensions(await read(screenshot.src)),sizes);const ratio=sizes[0]/sizes[1];if(ratios.has(screenshot.form_factor))assert.equal(ratio,ratios.get(screenshot.form_factor));ratios.set(screenshot.form_factor,ratio);}
 }
 assert.deepEqual(manifests[0].icons,manifests[1].icons);assert.deepEqual(manifests[0].screenshots,manifests[1].screenshots);
});

test('manifest identity resolves from the origin and cannot collide with sibling PWAs',async()=>{
 const origin='https://gslf.it';
 const resolve=(manifest,path)=>{const start=new URL(manifest.start_url,origin+path);return new URL(manifest.id,start.origin+'/').href;};
 const cwtty=resolve({id:'.',start_url:'.'},'/cwtty/manifest.webmanifest');
 const blacksquelch=resolve({id:'blacksquelch',start_url:'./'},'/blacksquelch/manifest.webmanifest');
 assert.equal(cwtty,origin+'/');
 assert.equal(resolve({id:'./',start_url:'./'},'/th-ink/manifest.webmanifest'),cwtty,'Regression fixture reproduces the old collision');
 for(const name of ['manifest.webmanifest','manifest-it.webmanifest']){
  const manifest=JSON.parse(await read(name)),identity=resolve(manifest,'/th-ink/'+name);
  assert.equal(identity,origin+'/th-ink/');assert.notEqual(identity,cwtty);assert.notEqual(identity,blacksquelch);
  assert.equal(new URL(manifest.start_url,origin+'/th-ink/'+name).pathname,'/th-ink/');
  assert.equal(new URL(manifest.scope,origin+'/th-ink/'+name).pathname,'/th-ink/');
 }
});

test('maskable artwork stays within its safe circle; Apple and adaptive icons are opaque',async()=>{
 for(const path of ['assets/icon-maskable-192.png','assets/icon-maskable-512.png','assets/apple-touch-icon-152.png','assets/apple-touch-icon-167.png','assets/apple-touch-icon-180.png']){
  const {width,height,channels,pixels}=rgbaPNG(await read(path));assert.equal(width,height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=(y*width+x)*channels;if(channels===4)assert.equal(pixels[i+3],255,`${path}: transparent pixel`);
   if(Math.hypot(x+.5-width/2,y+.5-height/2)>.4*width)assert.deepEqual([...pixels.subarray(i,i+3)],[244,212,77],`${path}: artwork outside the maskable safe zone`);
  }
 }
 const ico=await read('assets/favicon.ico');assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),3);assert.deepEqual([0,1,2].map(i=>ico[6+i*16]),[16,32,48]);
 assert.ok(!(await read('assets/icon.svg')).toString().includes('<text'),'The icon must not depend on local fonts.');
});

test('offline asset discovery includes nested translations and all manifests without caching screenshots or models',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'think-pwa-test-'));
 try{
  for(const file of ['index.html','style.css','manifest.webmanifest','manifest-it.webmanifest','js/app.js','js/locales/en.js','locales/it.json','assets/icons/sample.png','vendor/filen/sdk.js','screenshots/desktop-en.png','models/test.tar.gz']){
   await mkdir(dirname(join(directory,file)),{recursive:true});await writeFile(join(directory,file),file);
  }
  await writeFile(join(directory,'sw.js'),"const CACHE='th-ink-shell-old';\nconst ASSETS=[];\nself.addEventListener('fetch',()=>{});\n");
  const assets=shellAssets(directory);for(const file of ['js/locales/en.js','locales/it.json','manifest-it.webmanifest','assets/icons/sample.png'])assert.ok(assets.includes('./'+file));
  assert.ok(!assets.some(a=>a.includes('/screenshots/')||a.includes('/models/')||a.endsWith('/sw.js')));
  const first=updateServiceWorker(directory);assert.equal(updateServiceWorker(directory).version,first.version);
  await writeFile(join(directory,'js/locales/en.js'),'updated translations');const second=updateServiceWorker(directory);assert.notEqual(second.version,first.version);
  const worker=await readFile(join(directory,'sw.js'),'utf8');await writeFile(join(directory,'sw.js'),worker.replace("'fetch'","'activate'"));assert.notEqual(updateServiceWorker(directory).version,second.version);
 }finally{await rm(directory,{recursive:true,force:true});}
});
