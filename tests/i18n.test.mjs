import test from 'node:test';
import assert from 'node:assert/strict';
import {detectLanguage,resolveLanguage,validPreference,translate,setLanguagePreference,getLocale} from '../src/js/i18n.js';
import english from '../src/js/locales/en.js';

test('language detection respects browser priority, regional tags, and English fallback',()=>{
 assert.equal(detectLanguage(['it-CH','en-US']),'it');
 assert.equal(detectLanguage(['en-GB','it-IT']),'en');
 assert.equal(detectLanguage(['fr-FR','it-IT','en']),'it');
 assert.equal(detectLanguage(['de-DE']),'en');
 assert.equal(detectLanguage([]),'en');
 assert.equal(detectLanguage(['IT_it']),'it');
});
test('an explicit app language overrides browser preferences; auto follows them',()=>{
 assert.equal(resolveLanguage('en',['it-IT']),'en');
 assert.equal(resolveLanguage('it',['en-US']),'it');
 assert.equal(resolveLanguage('auto',['it-IT']),'it');
 for(const value of ['auto','it','en'])assert.ok(validPreference(value));
 for(const value of ['fr','it-IT',null,undefined,''])assert.equal(validPreference(value),false);
 assert.throws(()=>setLanguagePreference('fr',{persist:false}),RangeError);
 setLanguagePreference('it',{persist:false});assert.equal(getLocale(),'it-IT');
 setLanguagePreference('en',{persist:false});assert.equal(getLocale(),'en-US');
 setLanguagePreference('auto',{persist:false});
});
test('translations preserve named placeholders and do not interpret user text as markup',()=>{
 for(const [source,target] of Object.entries(english)){
  assert.ok(target.trim(),source);
  assert.deepEqual([...source.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...target.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),source);
 }
 const title='<img onerror=alert(1)> {number}';
 assert.equal(translate('Aperta {title}.',{title},'en'),`Opened ${title}.`);
 assert.equal(translate('Aperta {title}.',{title},'it'),`Aperta ${title}.`);
 assert.equal(translate('personal note body',{},'en'),'personal note body');
 assert.equal(translate('2 copie recuperate: entrambe le modifiche conservate.',{},'en'),'2 recovered copies: both edits preserved.');
});
