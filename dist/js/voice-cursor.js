import {t} from './i18n.js';
import {textPosition} from './text-navigation.js';
// A visible, non-blinking selection independent of keyboard focus. The mirror
// uses text nodes only, so Markdown/HTML are never interpreted here.
export class VoiceCursor {
 constructor(editor,container,scroller,label,language=()=>'it-IT'){
  Object.assign(this,{editor,container,scroller,label,language,enabled:false,frame:0,follow:false,lastKey:null});
  this.mirror=document.createElement('div');this.mirror.className='voice-cursor-mirror';this.mirror.setAttribute('aria-hidden','true');this.mirror.hidden=true;container.append(this.mirror);
  this.onSelection=()=>this.update(false);editor.addEventListener('select',this.onSelection);document.addEventListener('selectionchange',this.onSelection);
  this.observer=new ResizeObserver(()=>this.update(true));this.observer.observe(editor);this.observer.observe(scroller);
 }
 setEnabled(enabled){this.enabled=enabled;this.mirror.hidden=!enabled;this.update(true);}
 update(follow=false){if(!this.enabled)return;this.follow ||= follow;if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.render();});}
 render(){
  if(!this.enabled||this.editor.hidden||!this.editor.clientWidth)return;
  const {editor,mirror}=this,start=editor.selectionStart,end=editor.selectionEnd,backward=editor.selectionDirection==='backward',head=backward?start:end;
  const key=[editor.value,start,end,head,editor.clientWidth,getComputedStyle(editor).font,this.language()].join('\u0000');
  if(key!==this.lastKey){
   this.lastKey=key;const css=getComputedStyle(editor);
   for(const p of ['font','lineHeight','letterSpacing','wordSpacing','textIndent','textTransform','tabSize','padding','direction'])mirror.style[p]=css[p];
   mirror.style.width=editor.clientWidth+'px';
   const caret=document.createElement('span');caret.className='voice-caret';caret.textContent='\u200b';
   const mark=document.createElement('mark');mark.className='voice-selection';mark.textContent=editor.value.slice(start,end);
   mirror.replaceChildren(document.createTextNode(editor.value.slice(0,start)),...(backward?[caret,mark]:[mark,caret]),document.createTextNode(editor.value.slice(end)+'\u200b'));
   this.caret=caret;const p=textPosition(editor.value,head,this.language());if(this.label)this.label.textContent=p.paragraph?t('¶ {paragraph} · Frase {sentence}{selection}',{paragraph:p.paragraph,sentence:p.sentence,selection:end>start?t(' · Selezione'):''}):t('Nota vuota');
  }
  if(this.follow&&this.caret){const r=this.caret.getBoundingClientRect(),box=this.scroller.getBoundingClientRect();if(r.top<box.top+24)this.scroller.scrollTop+=r.top-box.top-24;else if(r.bottom>box.bottom-24)this.scroller.scrollTop+=r.bottom-box.bottom+24;}
  this.follow=false;
 }
 dispose(){cancelAnimationFrame(this.frame);this.observer.disconnect();this.editor.removeEventListener('select',this.onSelection);document.removeEventListener('selectionchange',this.onSelection);this.mirror.remove();}
}
