import {escapeHTML as esc} from './publish-markdown.js';
export const folderKey=parts=>parts.map(encodeURIComponent).join('/');
// Build once; the shared navigation file avoids copying every article into every page.
export function navigationTree(rows){
 const root={folders:[],notes:[]},nodes=new Map([['',root]]);
 for(const row of rows){const parts=row.folders||row.path.split('/').slice(0,-1);let parent=root;
  for(let i=0;i<parts.length;i++){const key=folderKey(parts.slice(0,i+1));let node=nodes.get(key);if(!node){node={name:parts[i],key,folders:[],notes:[]};nodes.set(key,node);parent.folders.push(node);}parent=node;}
  parent.notes.push({title:row.title,path:row.route,created:row.created});
 }
 const compare=new Intl.Collator('en',{numeric:true,sensitivity:'base'}).compare;for(const node of nodes.values())node.folders.sort((a,b)=>compare(a.name,b.name));
 return root;
}
export const folderIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11H3Z"/></svg>';
export function navigationHTML(rows,{prefix,current,formatDate,dateISO}){
 const tree=navigationTree(rows),active=new Set();const row=rows.find(r=>r.route===current);if(row){const parts=row.folders||row.path.split('/').slice(0,-1);for(let i=1;i<=parts.length;i++)active.add(folderKey(parts.slice(0,i)));}
 const branch=node=>node.folders.map(f=>`<details class="archive-folder" data-folder="${esc(f.key)}"${active.has(f.key)?' open':''}><summary>${folderIcon}<span>${esc(f.name)}</span></summary><div class="folder-children">${branch(f)}</div></details>`).join('')+node.notes.map(n=>`<a class="archive-note" href="${prefix+n.path}"${n.path===current?' aria-current="page"':''}><time datetime="${dateISO(n.created)}">${esc(formatDate(n.created))}</time><span>${esc(n.title)}</span></a>`).join('');
 return branch(tree);
}
