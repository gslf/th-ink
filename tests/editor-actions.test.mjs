import test from 'node:test';
import assert from 'node:assert/strict';
import {newlineEdit,headingEdit} from '../src/js/editor-actions.js';
const enter=text=>{const c=newlineEdit(text,text.length);return text.slice(0,c.start)+c.text+text.slice(c.end);};
test('Enter continues bullets, ordered lists and unchecked tasks; an empty item exits',()=>{
 for(const [text,next] of [['- hello','- '],['  * hello','  * '],['9. hello','10. '],['2) hello','3) '],['- [x] done','- [ ] ']]){
  assert.equal(enter(text),text+'\n'+next);assert.equal(enter(enter(text)),text+'\n');
 }
});
test('newlines preserve plain text and fenced code; replacing a selection keeps its suffix',()=>{
 assert.equal(enter('hello'),'hello\n');assert.equal(enter('```\n- code'),'```\n- code\n');
 assert.deepEqual(newlineEdit('- first last',7,11),{start:7,end:11,text:'\n- '});
});
test('headings replace the existing level without stacking markers',()=>{
 assert.deepEqual(headingEdit('## Hello\nworld',4,4,1),{start:0,end:8,text:'# Hello',selection:[3,3]});
 assert.deepEqual(headingEdit('Hello\nworld',0,6,4),{start:0,end:5,text:'#### Hello',selection:[5,11]});
});
test('empty nested items climb exactly one real parent at each Enter',()=>{
 const value='- Parent\n    + Child\n        * Grandchild\n            + ';
 const a=enter(value);assert.equal(a,'- Parent\n    + Child\n        * Grandchild\n        * ');
 const b=enter(a);assert.equal(b,'- Parent\n    + Child\n        * Grandchild\n    + ');
 const c=enter(b);assert.equal(c,'- Parent\n    + Child\n        * Grandchild\n- ');
 assert.equal(enter(c),'- Parent\n    + Child\n        * Grandchild\n');
 assert.equal(enter('- root\n  * '),'- root\n- ');
 assert.equal(enter('3. parent\n    - '),'3. parent\n4. ');
 assert.equal(enter('- [x] parent\n    + [ ] '),'- [x] parent\n- [ ] ');
});
import {indentEdit} from '../src/js/editor-actions.js';
import {renderMarkdown} from '../src/js/core.js';
const indent=(text,position,outdent=false)=>{const c=indentEdit(text,position,position,outdent);return {value:text.slice(0,c.start)+c.text+text.slice(c.end),position:c.selection[1]};};
test('Tab uses four spaces, alternates valid Markdown markers, and retains the caret',()=>{
 let text='- parent\n- child',position=text.length;
 for(const [spaces,marker] of [[4,'+'],[8,'*'],[12,'+'],[16,'*']]){const r=indent(text,position);text=r.value;position=r.position;assert.equal(text,'- parent\n'+' '.repeat(spaces)+marker+' child');assert.equal(position,text.length);}
 for(let i=0;i<4;i++){const r=indent(text,position,true);text=r.value;position=r.position;}
 assert.equal(text,'- parent\n- child');
});
test('indent moves descendants and preserves checkbox state; unindent follows imported parents',()=>{
 const text='- parent\n- [x] child\n    + grandchild';
 const r=indent(text,text.indexOf('child')+2);assert.equal(r.value,'- parent\n    + [x] child\n        * grandchild');assert.equal(r.value.slice(r.position-2,r.position),'ch');
 assert.equal(indent('- parent\n  + child',19,true).value,'- parent\n- child');
});
test('reading keeps lists nested, accepts every marker, and escapes list text',()=>{
 const html=renderMarkdown('- root\n    + child\n        * deep\n    + [ ] task\n- next');
 assert.equal(html,'<ul><li>root<ul class="list-circle"><li>child<ul class="list-square"><li>deep</li></ul></li><li class="task"><label class="task-label"><span class="task-marker"><input type="checkbox" disabled><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3.5 3.5L15 7"/></svg></span><span class="task-text">task</span></label></li></ul></li><li>next</li></ul>');
 assert.ok(renderMarkdown('- <script>alert(1)</script>').includes('&lt;script&gt;'));
});
