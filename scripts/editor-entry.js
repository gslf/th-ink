import {EditorState,Compartment,EditorSelection} from '@codemirror/state';
import {EditorView,keymap,drawSelection} from '@codemirror/view';
import {defaultKeymap} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {syntaxHighlighting,HighlightStyle} from '@codemirror/language';
import {tags} from '@lezer/highlight';

// Keep the app's plain-Markdown storage/selection interface. All editing and
// geometry are handled by one view, with no textarea mirror or height collapse.
export function createMarkdownEditor(host,scroller,{newline}={}){
 const editable=new Compartment();let external=false,readOnly=false,frame=0,inputScroll=null,restoreFrame=0;
 const ensureVisible=()=>{
  cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   if(host.hidden||!host.clientWidth)return;
   const box=scroller.getBoundingClientRect(),caret=view.coordsAtPos(view.state.selection.main.head);
   if(!caret)return;
   const top=box.top+12,bottom=box.bottom-12;
   if(caret.top<top)scroller.scrollTop+=caret.top-top;
   else if(caret.bottom>bottom)scroller.scrollTop+=caret.bottom-bottom;
  });
 };
 const style=HighlightStyle.define([
  ...[tags.heading1,tags.heading2,tags.heading3,tags.heading4,tags.heading5,tags.heading6].map((tag,i)=>({tag,fontWeight:'650',fontSize:[1.55,1.35,1.18,1.06,1,1][i]+'em',lineHeight:'1.5'})),
  {tag:tags.strong,fontWeight:'700'},{tag:tags.emphasis,fontStyle:'italic'},
  {tag:tags.strikethrough,textDecoration:'line-through'},
  {tag:tags.monospace,fontFamily:'var(--mono,monospace)',fontSize:'.88em',backgroundColor:'var(--list)'},
  {tag:tags.link,color:'var(--link)',textDecoration:'underline',textUnderlineOffset:'3px'},
  {tag:tags.url,color:'var(--link)'},{tag:tags.quote,color:'var(--muted)'},
  {tag:tags.processingInstruction,color:'var(--muted)'}
 ]);
 const view=new EditorView({parent:host,state:EditorState.create({extensions:[
  markdown({addKeymap:false,extensions:[{remove:['SetextHeading']}]}),syntaxHighlighting(style),EditorView.lineWrapping,
  drawSelection({cursorBlinkRate:0,drawRangeCursor:true}),editable.of([EditorState.readOnly.of(false),EditorView.editable.of(true)]),
  EditorView.contentAttributes.of(()=>({'aria-label':host.getAttribute('aria-label')||'Markdown',lang:host.lang||document.documentElement.lang,spellcheck:'true'})),
  // App undo and formatting shortcuts must reach the shared history handler.
  keymap.of([{key:'Enter',run:()=>{newline();return true;}},...defaultKeymap.filter(k=>!/(?:Mod-[biyz]|Tab|Enter)/i.test(k.key||''))]),
  EditorView.scrollHandler.of(()=>{ensureVisible();return true;}),
  EditorView.theme({'&':{background:'transparent',color:'inherit'},'&.cm-focused':{outline:'none'},'.cm-scroller':{font:'inherit',lineHeight:'inherit',overflow:'visible'},'.cm-content':{padding:'0',minHeight:'270px',caretColor:'var(--ink)'},'.cm-line':{padding:'0'},'.cm-cursor':{borderLeftColor:'var(--ink)'},'.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{background:'color-mix(in srgb,var(--yellow) 38%,transparent)'}})
 ]}),dispatchTransactions(transactions){
  const changed=transactions.some(tr=>tr.docChanged),user=changed&&!external;
  const stableScroll=inputScroll??scroller.scrollTop;inputScroll=null;
  if(user)host.dispatchEvent(new Event('beforeinput'));
  view.update(transactions);
  if(user){
   host.dispatchEvent(new Event('input'));
   // Contenteditable may scroll its selection during native input. Restore the
   // pre-input viewport, then reveal only a caret that actually left the view.
   cancelAnimationFrame(restoreFrame);restoreFrame=requestAnimationFrame(()=>{scroller.scrollTop=stableScroll;ensureVisible();});
  }
  if(transactions.some(tr=>tr.selection))host.dispatchEvent(new Event('select'));
 }});
 host.addEventListener('beforeinput',event=>{
  if(event.isTrusted)inputScroll=scroller.scrollTop;
  // Virtual keyboards can send beforeinput without a physical Enter key.
  if(!event.isComposing&&['insertParagraph','insertLineBreak'].includes(event.inputType)){
   event.preventDefault();event.stopPropagation();inputScroll=null;newline();
  }
 },true);
 for(const event of ['wheel','touchstart','pointerdown'])scroller.addEventListener(event,()=>{cancelAnimationFrame(restoreFrame);inputScroll=null;},{passive:true});
 const dispatch=spec=>{external=true;try{view.dispatch(spec);}finally{external=false;}};
 const clamp=n=>Math.max(0,Math.min(Number(n)||0,view.state.doc.length));
 Object.defineProperties(host,{
  value:{get:()=>view.state.doc.toString(),set:value=>{value=String(value);const previous=host.value;if(value===previous)return;let from=0,to=previous.length,until=value.length;while(from<to&&from<until&&previous[from]===value[from])from++;while(to>from&&until>from&&previous[to-1]===value[until-1]){to--;until--;}const head=Math.min(view.state.selection.main.head,value.length);dispatch({changes:{from,to,insert:value.slice(from,until)},selection:{anchor:head}});}},
  selectionStart:{get:()=>view.state.selection.main.from},selectionEnd:{get:()=>view.state.selection.main.to},
  selectionDirection:{get:()=>view.state.selection.main.anchor>view.state.selection.main.head?'backward':'forward'},
  readOnly:{get:()=>readOnly,set:value=>{readOnly=!!value;dispatch({effects:editable.reconfigure([EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly)])});}},
  markdownView:{value:view}
 });
 host.setSelectionRange=(start,end=start,direction='forward')=>{start=clamp(start);end=clamp(end);dispatch({selection:EditorSelection.single(direction==='backward'?end:start,direction==='backward'?start:end)});};
 host.select=()=>host.setSelectionRange(0,view.state.doc.length);
 host.focus=()=>view.focus();
 host.replaceMarkdown=(text,start,end,selection)=>{
  const head=start+text.length;dispatch({changes:{from:start,to:end,insert:text},selection:selection?{anchor:selection[0],head:selection[1]}:{anchor:head}});ensureVisible();
 };
 host.ensureCaretVisible=ensureVisible;
 host.refreshEditor=()=>view.requestMeasure();
 new ResizeObserver(()=>{if(view.hasFocus||document.querySelector('#app').classList.contains('voice-mode'))ensureVisible();}).observe(scroller);
 return host;
}
