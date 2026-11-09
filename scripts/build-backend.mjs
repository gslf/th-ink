import {readFileSync,existsSync,cpSync,copyFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {projectRoot,outputPath} from './build-paths.mjs';
const server=resolve(projectRoot,'server'),vendor=resolve(server,'vendor');
function installed(){
 try{
  const lock=JSON.parse(readFileSync(resolve(server,'composer.lock'),'utf8'));
  const packages=JSON.parse(readFileSync(resolve(vendor,'composer/installed.json'),'utf8')).packages;
  return existsSync(resolve(vendor,'autoload.php'))&&packages.length===lock.packages.length&&lock.packages.every(p=>packages.some(i=>i.name===p.name&&i.version===p.version&&i.dist?.reference===p.dist?.reference));
 }catch{return false;}
}
if(!installed()){
 const composer=process.env.COMPOSER_BINARY||'composer',args=['install','--no-dev','--prefer-dist','--no-interaction','--no-progress','--no-plugins','--no-scripts'];
 const result=composer.endsWith('.phar')?spawnSync(process.env.PHP_BINARY||'php',[composer,...args],{cwd:server,stdio:'inherit'}):spawnSync(composer,args,{cwd:server,stdio:'inherit'});
 if(result.error||result.status!==0)throw Error('PHP dependencies could not be installed. Composer and PHP 8.2+ are required for the reminders backend.');
 if(!installed())throw Error('PHP dependencies do not match server/composer.lock.');
}
mkdirSync(outputPath('api'),{recursive:true});cpSync(vendor,outputPath('api/vendor'),{recursive:true});
copyFileSync(resolve(server,'vendor.htaccess'),outputPath('api/vendor/.htaccess'));
console.log('Pinned PHP dependencies packaged. Private configuration stays outside the build.');
