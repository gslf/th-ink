import {StateField} from '@codemirror/state';
import {Decoration,EditorView} from '@codemirror/view';
import {codeTokens} from '../js/code-highlight.js';
const codeLine=Decoration.line({class:'cm-code-line'}),fenceLine=Decoration.line({class:'cm-code-line cm-code-fence'});
function decorate(state){
 const doc=state.doc,ranges=[];let fence=null,info='',start=0;
 const highlight=end=>{if(end<=start)return;const text=doc.sliceString(start,end);for(const token of codeTokens(text,info))ranges.push(Decoration.mark({class:token.class}).range(start+token.from,start+token.to));};
 for(let i=1;i<=doc.lines;i++){
  const line=doc.line(i),match=line.text.match(/^ {0,3}(`{3,}|~{3,})([^`]*)$/);
  if(fence){
   const closing=match&&match[1][0]===fence[0]&&match[1].length>=fence.length&&!match[2].trim();
   ranges.push((closing?fenceLine:codeLine).range(line.from));
   if(closing){highlight(Math.max(start,line.from-1));fence=null;}
  }else if(match){fence=match[1];info=match[2];start=line.to+1;ranges.push(fenceLine.range(line.from));}
 }
 if(fence)highlight(doc.length);
 return Decoration.set(ranges,true);
}
export const codeBlocks=StateField.define({create:decorate,update:(value,tr)=>tr.docChanged?decorate(tr.state):value,provide:field=>EditorView.decorations.from(field)});
