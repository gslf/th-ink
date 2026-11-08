import {buildPublishedSite,hashText,MANIFEST} from './publish-model.js';
import {zipFiles} from './archive.js';
// Keep only the finished Blob and its small manifest, not thousands of HTML strings.
let cached=null,cachedKey='';
const signature=data=>hashText(JSON.stringify([data.notes,data.config,data.assets,data.previous?.routes||{}]));
self.onmessage=async({data})=>{
 try{
  const key=await signature(data);
  if(cached&&key===cachedKey){self.postMessage({result:cached});return;}
  const site=await buildPublishedSite(data);
  if(site.files.length>=65535)throw Error('Troppi file per uno ZIP. Scegli una cartella di note più piccola.');
  self.postMessage({stage:'zip'});
  const blob=zipFiles([...site.files,{path:MANIFEST,text:JSON.stringify({...site.manifest,complete:true})}]);
  cached={blob,manifest:site.manifest,count:site.count,warnings:site.warnings};
  cachedKey=await signature({...data,previous:site.manifest});self.postMessage({result:cached});
 }catch(error){self.postMessage({error:error.message});}
};
