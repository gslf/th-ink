import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {outputPath} from './build-paths.mjs';
const root='node_modules/emojibase-data';
mkdirSync(outputPath('assets/emoji'),{recursive:true});
for(const locale of ['en','it']){
 const data=JSON.parse(readFileSync(`${root}/${locale}/data.json`)),messages=JSON.parse(readFileSync(`${root}/${locale}/messages.json`));
 const entries=data.filter(e=>e.group!==2&&e.group!==undefined).map(e=>({emoji:e.emoji,label:e.label,group:e.group,keywords:e.tags||[],skins:(e.skins||[]).map(s=>({emoji:s.emoji,label:s.label,tone:s.tone}))}));
 writeFileSync(outputPath(`assets/emoji/${locale}.json`),JSON.stringify({groups:messages.groups.filter(g=>g.order!==2),entries}));
 console.log(`Emoji catalog ${locale}: ${entries.length} entries`);
}
copyFileSync(`${root}/LICENSE`,outputPath('licenses/emojibase.txt'));
copyFileSync(`${root}/LICENSE`,outputPath('assets/emoji/LICENSE.txt'));
