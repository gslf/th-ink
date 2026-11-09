import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {zipFiles} from '../src/js/archive.js';
const modulePath=process.argv[2]?pathToFileURL(process.argv[2]):new URL('../src/js/publish-model.js',import.meta.url);
const {buildPublishedSite}=await import(modulePath);
const assets=Object.fromEntries(await Promise.all(['site.css','site.js','favicon.svg'].map(async n=>[n,await readFile(new URL('../src/assets/publish/'+n,import.meta.url),'utf8')])));
const notes=Array.from({length:3000},(_,i)=>({id:'benchmark-'+i,title:'Thought number '+i,body:'A short public article about software and design.\n\n## An idea\n\n'+('A useful paragraph with **Markdown**, a little breathing room and a link to [the web](https://example.org).\n\n').repeat(8),path:'Thought number '+i,tags:[],created:Date.UTC(2026,0,1)+i*1000,updated:Date.UTC(2026,0,1)+i*1000}));
const samples=[];for(let i=0;i<3;i++){const start=performance.now(),r=await buildPublishedSite({notes,config:{folder:'test',title:'Benchmark',url:'https://example.test/journal/'},assets}),generated=performance.now(),zip=zipFiles(r.files);samples.push({generateMs:Math.round(generated-start),zipMs:Math.round(performance.now()-generated),totalMs:Math.round(performance.now()-start),bytes:zip.size});}
console.log(JSON.stringify({notes:notes.length,samples,medianTotalMs:samples.map(s=>s.totalMs).sort((a,b)=>a-b)[1]}));
