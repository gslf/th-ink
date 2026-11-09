// Shared by physical/virtual keyboards and spoken editing commands.
export const LIST_INDENT=4;
export const bulletForDepth=depth=>depth===0?'-':depth%2?'+':'*';
const indentWidth=text=>[...text].reduce((n,c)=>c==='\t'?n+LIST_INDENT-n%LIST_INDENT:n+1,0);
const listItem=line=>{const m=line.match(/^([ \t]*)([-+*]|\d+[.)]) ([\s\S]*)$/);if(!m)return null;const task=m[3].match(/^\[([ xX])\](?: |$)/);return {indent:indentWidth(m[1]),space:m[1],marker:m[2],task:task?.[0]||'',checked:task?.[1],body:m[3].slice(task?.[0].length||0)};};
const nextMarker=marker=>/^\d/.test(marker)?String(parseInt(marker)+1)+marker.slice(-1):marker;
function contextBefore(value,position){
 const stack=[];let fence=null;
 for(const line of value.slice(0,position).split('\n')){
  const delimiter=line.match(/^ {0,3}(`{3,}|~{3,})/);
  if(delimiter){if(!fence)fence=delimiter[1];else if(delimiter[1][0]===fence[0]&&delimiter[1].length>=fence.length)fence=null;continue;}
  if(fence)continue;
  const item=listItem(line);
  if(item){while(stack.length&&stack.at(-1).indent>=item.indent)stack.pop();stack.push({...item,depth:stack.length});}
  else if(line.trim()&&!/^[ \t]/.test(line))stack.length=0;
 }
 return {stack,fence};
}
export function newlineEdit(value,start,end=start){
 const lineStart=value.lastIndexOf('\n',start-1)+1;
 const before=value.slice(lineStart,start),after=value.slice(end).split('\n')[0];
 const context=contextBefore(value,lineStart),item=context.fence?null:listItem(before);
 if(!item)return {start,end,text:'\n'};
 if(!item.body.trim()&&!after.trim()){
  const parent=context.stack.findLast(p=>p.indent<item.indent);
  // Imported lists can use two spaces or tabs: follow their actual parent.
  const prefix=parent?parent.space+nextMarker(parent.marker)+' '+(parent.task?'[ ] ':''):item.indent>=LIST_INDENT?' '.repeat(item.indent-LIST_INDENT)+(/^\d/.test(item.marker)?'1'+item.marker.slice(-1):bulletForDepth(Math.max(0,Math.ceil(item.indent/LIST_INDENT)-1)))+' '+(item.task?'[ ] ':''):'';
  return {start:lineStart,end:end+after.length,text:prefix};
 }
 return {start,end,text:'\n'+item.space+nextMarker(item.marker)+' '+(item.task?'[ ] ':'')};
}
export function indentEdit(value,start,end=start,outdent=false){
 const from=value.lastIndexOf('\n',start-1)+1;
 const last=end>start&&value[end-1]==='\n'?end-1:end;
 let to=value.indexOf('\n',last);if(to<0)to=value.length;
 const first=listItem(value.slice(from,value.indexOf('\n',from)<0?value.length:value.indexOf('\n',from)));
 // Move an item's descendants with it, including when only its label is selected.
 if(first){let at=to+1;while(at<value.length){let next=value.indexOf('\n',at);if(next<0)next=value.length;const line=value.slice(at,next);if(line.trim()&&indentWidth(line.match(/^[ \t]*/)[0])<=first.indent)break;if(!line.trim())break;to=next;at=next+1;}}
 const context=contextBefore(value,from),lines=value.slice(from,to).split('\n');
 const parent=first?context.stack.findLast(p=>p.indent<first.indent):null;
 const step=outdent?(first?Math.min(LIST_INDENT,first.indent-(parent?.indent??Math.max(0,first.indent-LIST_INDENT))):LIST_INDENT):LIST_INDENT;
 let oldOffset=from,newOffset=from;const mapped=[];
 const result=lines.map(line=>{
  const item=context.fence?null:listItem(line),oldSpace=line.match(/^[ \t]*/)[0];
  const amount=indentWidth(oldSpace),indent=outdent?Math.max(0,amount-step):amount+step;
  let text=' '.repeat(indent)+line.slice(oldSpace.length);
  if(item){
   const depth=Math.max(0,Math.ceil(indent/LIST_INDENT));
   const marker=/^\d/.test(item.marker)?item.marker:bulletForDepth(depth);
   text=' '.repeat(indent)+marker+' '+(item.task?'['+item.checked+'] ':'')+item.body;
   while(context.stack.length&&context.stack.at(-1).indent>=item.indent)context.stack.pop();context.stack.push(item);
  }
  mapped.push({old:oldOffset,next:newOffset,length:line.length,delta:text.length-line.length});oldOffset+=line.length+1;newOffset+=text.length+1;return text;
 });
 const text=result.join('\n');
 const map=position=>{const row=mapped.find(r=>position<=r.old+r.length);return row?row.next+Math.max(0,position-row.old+row.delta):position+text.length-(to-from);};
 return {start:from,end:to,text,selection:[map(start),map(end)]};
}
export function headingEdit(value,start,end,level){
 const from=value.lastIndexOf('\n',start-1)+1;
 const last=end>start&&value[end-1]==='\n'?end-1:end;
 const next=value.indexOf('\n',last),to=next<0?value.length:next;
 const lines=value.slice(from,to).split('\n'),prefix='#'.repeat(Math.max(1,Math.min(4,level)))+' ';
 const text=lines.map(line=>prefix+line.replace(/^#{1,6}\s+/, '')).join('\n');
 const map=position=>{let offset=position-from,mapped=from;for(const line of lines){const old=line.match(/^#{1,6}\s+/)?.[0].length||0;if(offset<=line.length)return mapped+prefix.length+Math.max(0,offset-old);offset-=line.length+1;mapped+=prefix.length+line.length-old+1;}return position+text.length-(to-from);};
 return {start:from,end:to,text,selection:[map(start),map(end)]};
}
