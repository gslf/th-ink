import {backupArchive} from './daily-backup.js';
self.onmessage=({data})=>{try{self.postMessage({blob:backupArchive(data.snapshot,new Date(data.at))});}catch(error){self.postMessage({error:error.message});}};
