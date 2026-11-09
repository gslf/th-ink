export const themeChoices=['auto','light','dark'];
export const resolveTheme=(preference,dark)=>preference==='dark'||preference==='auto'&&dark?'dark':'light';
export class ThemeController extends EventTarget {
 constructor({media=matchMedia('(prefers-color-scheme: dark)'),apply,save=async()=>{}}){super();this.media=media;this.apply=apply;this.save=save;this.preference='auto';this.pending=Promise.resolve();this.onSystem=()=>this.render();media.addEventListener('change',this.onSystem);}
 render(){this.effective=resolveTheme(this.preference,this.media.matches);this.apply(this.effective,this.preference);this.dispatchEvent(new Event('change'));}
 set(value,{persist=true}={}){if(!themeChoices.includes(value))throw Error('Tema non valido');this.preference=value;this.render();if(persist)this.pending=this.pending.catch(()=>{}).then(()=>this.save(value));return this.pending;}
 dispose(){this.media.removeEventListener('change',this.onSystem);}
}
