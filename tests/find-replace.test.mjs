import test from 'node:test';
import assert from 'node:assert/strict';
import {textMatches,replacementEdit,searchNotes} from '../src/js/find-replace.js';
test('search is literal, optionally case sensitive, and uses original Unicode offsets',()=>{
 assert.deepEqual(textMatches('👩‍💻 Café café','CAFÉ'),[{from:6,to:10},{from:11,to:15}]);
 assert.deepEqual(textMatches('a.* axy a.*','a.*'),[{from:0,to:3},{from:8,to:11}]);
 assert.equal(textMatches('A a','a',true).length,1);assert.deepEqual(textMatches('abc',''),[]);
});
test('replacement treats dollar patterns literally and maps the selection',()=>{
 const original='one cat two cat';
 assert.deepEqual(replacementEdit(original,textMatches(original,'cat'),'$&',[8,15]),{text:'one $& two $&',selection:[7,13]});
 assert.equal(replacementEdit(original,textMatches(original,'cat'),'').text,'one  two ');
});
test('universal search excludes Trash and local search only scans the chosen body',()=>{
 const notes=[{id:'a',title:'needle',body:'nothing'},{id:'b',body:'needle Needle'},{id:'c',body:'needle',deleted:true}];
 assert.deepEqual(searchNotes(notes,'needle').map(n=>n.id),['b']);
 assert.equal(searchNotes(notes,'needle',{scope:'note',current:'a'}).length,0);
 assert.equal(searchNotes(notes,'needle',{scope:'note',current:'b'})[0].matches.length,2);
});
