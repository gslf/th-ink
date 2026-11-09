import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildPublishedSite,selectPublishedNotes,validatePublishConfig,MANIFEST,managedPath,PAGE_SIZE} from '../src/js/publish-model.js';
import {renderPublishedMarkdown} from '../src/js/publish-markdown.js';
import {Publisher} from '../src/js/publisher.js';
const config={folder:'public',title:'Quiet journal',description:'Ideas, with room to breathe.',author:'Test Author',url:'https://example.test/journal/',language:'en',automatic:true};
const folders=[{id:'public',name:'Journal'},{id:'sub',name:'Research',parent:'public'},{id:'private',name:'Private'},{id:'deleted',name:'Deleted',parent:'public',deleted:true},{id:'orphan',name:'Orphan',parent:'deleted'}];
const note=(id,created,extra={})=>({id,title:id,body:'Hello **world**.',folder:'public',created,updated:created,...extra});
const assets=Object.fromEntries(await Promise.all(['site.css','site.js','code.css','favicon.svg'].map(async name=>[name,await readFile(new URL('../src/assets/publish/'+name,import.meta.url),'utf8')])));
const build=(notes,extra={})=>buildPublishedSite({notes:selectPublishedNotes(notes,folders,'public'),config,assets,...extra});
test('publishing selects only the live subtree, strips private properties and sorts by creation',()=>{
 const selected=selectPublishedNotes([note('old',1,{updated:9999}),note('new',9,{folder:'sub'}),note('private',8,{folder:'private',body:'SECRET'}),note('trash',10,{deleted:true}),note('orphan',20,{folder:'orphan'})],folders,'public');
 assert.deepEqual(selected.map(n=>n.id),['new','old']);assert.equal(selected[0].path,'Research/new');assert.throws(()=>selectPublishedNotes([],folders,'missing'));
 for(const url of ['javascript:alert(1)','http://example.test','https://user:password@example.test','https://example.test/?key=secret','https://example.test/#fragment'])assert.throws(()=>validatePublishConfig({...config,url}));
 assert.equal(validatePublishConfig({...config,url:'https://example.test/journal'}).url,config.url);
});
test('static pages include indexable content, metadata, feeds, internal links and stable routes',async()=>{
 const notes=[note('A',10,{title:'A & <title>',body:'## First heading\n\n**Visible** content.\n\n[[B#Second heading|Read B]]\n\n[Private](../Private/Secret.md)\n\n## First heading'}),note('B',5,{body:'## Second heading\n\n[Older A](A & <title>.md)\n\n[Wake up](reminder:PRIVATE-ID)',tags:['thoughts']})];
 const result=await build([...notes,note('Secret',1,{folder:'private',body:'NEVER_PUBLISH_THIS'})]);
 const a=result.files.find(f=>f.path.includes('/a-title-')),b=result.files.find(f=>f.path.includes('/b-'));
 assert(a.text.includes('<strong>Visible</strong>'));assert(a.text.includes('first-heading-2'));assert(a.text.includes(b.path.slice(6)+'#second-heading'));
 assert(a.text.includes('rel="canonical" href="https://example.test/journal/'+a.path+'"'));assert.equal((a.text.match(/<h1>/g)||[]).length,1);
 for(const field of ['BlogPosting','datePublished','dateModified','og:title','application/rss+xml'])assert(a.text.includes(field));
 const all=result.files.map(f=>f.text).join('\n');assert(!all.includes('NEVER_PUBLISH_THIS'));assert(!all.includes('reminder:PRIVATE-ID'));assert(!all.includes('password_hash'));assert(!all.includes('href="../Private'));
 assert(result.files.find(f=>f.path==='feed.xml').text.includes('A &amp; &lt;title&gt;'));assert(result.files.find(f=>f.path==='sitemap.xml').text.includes(a.path));
 const renamed=await build([{...notes[0],title:'Renamed',updated:999},notes[1]],{previous:result.manifest});assert(renamed.files.some(f=>f.path===a.path));
 assert.deepEqual(Object.keys(result.manifest.routes).map(k=>k.length),[16,16]);
});
test('publisher escapes hostile HTML, JSON-LD and link schemes without exposing hidden reminder metadata',async()=>{
 const rendered=renderPublishedMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![bad](file:///private/key)\n\n[secret](https://user:pass@example.test/)\n\n```\n[[B]] <img onerror=x>\n```');
 assert(!rendered.html.includes('<script>'));assert(!rendered.html.includes('href="javascript'));assert(!rendered.html.includes('src="file'));assert(!rendered.html.includes('href="https://user'));assert(rendered.html.includes('&lt;img onerror=x&gt;'));
 const result=await build([note('attack',5,{title:'</script><script>alert(1)</script>',body:'Safe'})],{config:{...config,title:'</script><script>bad</script>'}});
 const html=result.files.find(f=>f.path.startsWith('posts/')).text;
 assert(!html.includes('<script>alert(1)</script>'));assert(!html.includes('<script>bad</script>'));
 const data=html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];assert.equal(JSON.parse(data).headline,'</script><script>alert(1)</script>');
});
test('archives bound sidebar size and retain creation order on every page',async()=>{
 const result=await build(Array.from({length:101},(_,i)=>note('n'+i,i+1,{updated:1000-i})));
 assert(result.files.some(f=>f.path==='archive-3.html'));
 const index=result.files.find(f=>f.path==='index.html').text;const nav=index.match(/<nav class="article-list"[^>]*>(.*?)<\/nav>/s)[1];
 assert.equal((nav.match(/<time /g)||[]).length,PAGE_SIZE);assert(nav.indexOf('>n100<')<nav.indexOf('>n99<'));
 const search=JSON.parse(result.files.find(f=>f.path==='search-index.json').text);assert.equal(search[0].title,'n100');assert.equal(search.at(-1).title,'n0');
});
test('ZIP builds omit private headers and remove unpublished pages from the next archive',async()=>{
 const body='<!-- th.ink-note-v1 {"tags":["HIDDEN_HEADER_VALUE"]} -->\nA public paragraph.';
 const first=await build([note('one',1,{body})]);assert(!first.files.some(f=>f.text.includes('HIDDEN_HEADER_VALUE')));
 const empty=await build([],{previous:first.manifest});assert(!empty.files.some(f=>f.path.startsWith('posts/')));assert.equal(JSON.parse(empty.files.find(f=>f.path==='search-index.json').text).length,0);
});
test('publisher migration forgets directory handles and automatic exports without touching notes',async()=>{
 const stored=new Map([['publish-directory',{value:'obsolete handle'}],['publish-config',{value:{...config,automatic:true}}]]),removed=[];
 const db={get:async(_,id)=>stored.get(id),put:async(_,row)=>stored.set(row.id,row),remove:async(_,id)=>{removed.push(id);stored.delete(id);}};
 const p=new Publisher({db,before:async()=>{},snapshot:()=>({notes:[],folders}),enabled:()=>true});await p.restore();
 assert.deepEqual(removed,['publish-directory']);assert(!('automatic' in p.config));assert(!('automatic' in stored.get('publish-config').value));assert.equal(p.worker,undefined);assert.equal(p.config.folder,'public');
});
