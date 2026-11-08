import {t} from './i18n.js';
import {resolveNavigation,textPosition} from './text-navigation.js';
import {normalize, paragraphRange, previousParagraphRange} from './core.js';
import {SpokenDialog, interpret, parseScreenless, findTextRanges, numberedParagraph, unitRange, confirmationSnapshot, confirmationValid} from './screenless.js';

// UI-independent orchestration; the adapter is the same editor used by keyboard.
export class SpokenEditor {
  constructor(adapter){this.a=adapter;this.dialog=new SpokenDialog();this.pending=null;this.choices=null;this.lastMessage='';this.pipeline=Promise.resolve();}
  en(){return this.a.language().startsWith('en');}
  async say(it,en=it){const message=this.en()?en:it;this.lastMessage=message;return this.a.say(message);}
  snapshot(action){const s=this.a.snapshot();return s?.note?confirmationSnapshot(s.note,s.selection,action):null;}
  valid(s){const current=this.a.snapshot();return confirmationValid(s,current?.note,current?.selection||[]);}
  cancel(){this.a.setArgumentMode?.(false);this.dialog.cancel();this.pending=null;this.choices=null;}
  receive(text){
    // Interrupts bypass the serial action queue, so a long read is never a lock.
    const command=parseScreenless(text);
    if(command&&['stopReading','pauseReading'].includes(command.id)){this.a.interrupt(command.id);return Promise.resolve();}
    this.pipeline=this.pipeline.catch(()=>{}).then(()=>this.handle(text)).catch(error=>this.say('Operazione non eseguita. '+error.message,'Action not completed. '+t(error.message,{},'en')));return this.pipeline;
  }
  async handle(text){
    if(this.dialog.pending){
      const reply=this.dialog.answer(text);if(!this.dialog.pending)this.a.setArgumentMode?.(false);if(reply.cancelled)return this.say('Richiesta annullata.','Request cancelled.');
      if(reply.prompt)return this.say(...reply.prompt);
      if(reply.context&&!this.valid(reply.context))return this.say('La nota o la selezione è cambiata. Ripeti il comando.','The note or selection changed. Repeat the command.');
      return this.run({id:reply.id,...reply.args});
    }
    const intent=interpret(text,this.a.mode());
    if(intent.text!==undefined){
      if(this.pending)return this.say('Prima conferma o annulla la modifica in sospeso.','First confirm or cancel the pending change.');
      await this.a.insert(intent.text,intent.punctuation);return;
    }
    this.a.setMode(intent.mode);
    if(!intent.command)return this.say('Comando non riconosciuto. Di’ aiuto.','Command not recognized. Say help.');
    return this.run(intent.command);
  }
  async ask(id,fields){this.a.setArgumentMode?.(true);const context=this.snapshot({id});const prompt=this.dialog.start(id,fields,context);return this.say(...prompt);}
  async confirm(action,description){
    this.pending=this.snapshot(action);if(!this.pending)return this.say('Apri prima una nota.','Open a note first.');
    return this.say(`${description[0]} Di’ conferma oppure annulla comando.`,`${description[1]} Say confirm or cancel.`);
  }
  async list(type,items,action,context=null){this.choices={type,items,action,context,page:0};return this.readChoices();}
  async readChoices(){const list=this.choices;if(!list?.items.length)return this.say('Nessun risultato.','No results.');
    const start=list.page*5;const content=list.items.slice(start,start+5).map((item,i)=>`${i+1}. ${item.label}`).join('. ');
    return this.say(`${content}. Pagina ${list.page+1} di ${Math.ceil(list.items.length/5)}. Di’ scegli e il numero, oppure prossima pagina.`,`${content}. Page ${list.page+1} of ${Math.ceil(list.items.length/5)}. Say choose and the number, or next page.`);
  }
  async run(c){
    const a=this.a,s=a.snapshot(),note=s?.note,selection=s?.selection||[0,0],body=note?.body||'';
    if(c.id==='cancel'){this.cancel();return this.say('Comando annullato.','Command cancelled.');}
    if(c.id==='confirm'){
      const pending=this.pending;this.pending=null;
      if(!this.valid(pending))return this.say('Conferma assente, scaduta o nota modificata. Ripeti il comando.','No valid confirmation, it expired, or the note changed. Repeat the command.');
      return this.commit(pending.action);
    }
    if(this.pending)return this.say('C’è una modifica in sospeso. Di’ conferma o annulla comando.','There is a pending edit. Say confirm or cancel.');
    if(['moveUnits','extendUnits','extendEdge','moveEdge','gotoUnit','selectUnit','readUnit','editUnit','deleteUnit','collapseSelection'].includes(c.id)){
      if(!note)return this.say('Apri prima una nota.','Open a note first.');
      const result=resolveNavigation(body,selection,c,a.language());
      if(result.error)return this.say(result.error==='empty'?'Il testo è vuoto.':'Non ci sono abbastanza elementi in questa direzione. La selezione non è cambiata.',result.error==='empty'?'The text is empty.':'Not enough items in this direction. The selection is unchanged.');
      a.select(result.range);
      const selected=body.slice(...result.range);
      if(c.id==='readUnit')return a.read(selected);
      if(c.id==='editUnit')return this.ask('editSelection',[{name:'value',prompt:['Detta il testo che sostituirà: '+selected,'Dictate the text to replace: '+selected]}]);
      if(c.id==='deleteUnit')return this.confirm({id:'deleteSelection'},['Cancellare: '+selected+'?','Delete: '+selected+'?']);
      if(result.range[0]!==result.range[1])return this.say('Selezionato: '+selected,'Selected: '+selected);
      const pos=textPosition(body,result.range[0],a.language());
      return this.say(`${result.boundary?'Limite della nota. ':''}Paragrafo ${pos.paragraph}, frase ${pos.sentence}.`,`${result.boundary?'Note boundary. ':''}Paragraph ${pos.paragraph}, sentence ${pos.sentence}.`);
    }
    const fields={
      rename:[{name:'value',prompt:['Quale titolo vuoi usare?','What title would you like?']}],
      folder:[{name:'value',prompt:['Come si chiama la nuova cartella?','What is the new folder called?']}],
      new:[{name:'value',prompt:['Come si chiama la nuova nota?','What is the new note called?']}],
      search:[{name:'value',prompt:['Quale testo devo cercare?','What text should I search for?']}],
      editSelection:[{name:'value',prompt:['Detta il testo che sostituirà la selezione.','Dictate the text to replace the selection.']}],
      editParagraph:[{name:'value',prompt:['Detta il nuovo paragrafo.','Dictate the new paragraph.']}],
    };
    if(fields[c.id]&&!c.value)return this.ask(c.id,fields[c.id]);
    if(c.id==='replace'&&!c.from)return this.ask('replace',[{name:'from',prompt:['Quale testo vuoi sostituire?','What text should I replace?']},{name:'to',prompt:['Con quale testo?','What should replace it?']}]);
    if(c.id==='link'&&!c.url)return this.ask('link',[{name:'url',prompt:['Detta l’indirizzo. Puoi dire punto e barra.','Dictate the address. You can say dot and slash.']}]);
    switch(c.id){
      case 'confirm':case 'cancel':return;
      case 'commands':a.setMode('commands');return this.say('Modalità comandi.','Command mode.');
      case 'dictation':a.setMode('dictation');this.dialog.cancel();return this.say('Dettatura. Di’ modalità comando per modificare.','Dictation. Say command mode to edit.');
      case 'stop':await this.say('Ascolto terminato.','Listening stopped.');a.stop();return;
      case 'help':return this.say('Dì dettatura per scrivere. Puoi dire: dove sono, seleziona l’ultima frase del paragrafo, spostati tre frasi avanti, estendi selezione due parole avanti, fine frase, modifica selezione, trova e sostituisci, grassetto, collegamento, leggi nota. Durante la lettura dì pausa lettura o ferma lettura. Conferma autorizza una modifica; annulla comando la cancella.','Say dictation to write. You can say: where am I, select the last sentence in the paragraph, move three sentences forward, extend selection two words forward, end of sentence, edit selection, find and replace, bold, link, read note. While reading say pause reading or stop reading. Confirm approves an edit; cancel discards it.');
      case 'repeatFeedback':return a.say(this.lastMessage);
      case 'stopReading':case 'pauseReading':return a.interrupt(c.id);
      case 'resumeReading':return a.resume();case 'repeatReading':return a.repeat();
      case 'italian':case 'english':return a.setLanguage(c.id==='italian'?'it-IT':'en-US');
      case 'listTrash':return this.list('notes',a.notes().filter(n=>n.deleted).map(n=>({id:n.id,label:n.title||'Senza titolo'})),'open');
      case 'listNotes':return this.list('notes',a.notes().filter(n=>!n.deleted).map(n=>({id:n.id,label:n.title||'Senza titolo'})),'open');
      case 'search':return this.list('notes',await a.search(c.value),'open');
      case 'listFolders':return this.list('folders',a.folders(),'selectFolder');
      case 'move':{
        const folders=a.folders();if(!c.value)return this.list('folders',folders,'move',this.snapshot(c));
        const matches=folders.filter(f=>normalize(f.label)===normalize(c.value)||normalize(f.name)===normalize(c.value));
        if(matches.length===1){await a.move(matches[0].id);return this.say('Nota spostata.','Note moved.');}
        return this.list('folders',matches,'move',this.snapshot(c));
      }
      case 'open':{const matches=a.notes().filter(n=>!n.deleted&&normalize(n.title)===normalize(c.value));if(matches.length!==1)return this.list('notes',matches.map(n=>({id:n.id,label:n.title})),'open');await a.open(matches[0].id);return this.say('Aperta '+matches[0].title,'Opened '+matches[0].title);}
      case 'nextNote':case 'previousNote':{const notes=a.notes().filter(n=>!n.deleted),at=notes.findIndex(n=>n.id===note?.id),target=notes[at+(c.id==='nextNote'?1:-1)];if(!target)return this.say('Non ci sono altre note in questa direzione.','No more notes in this direction.');await a.open(target.id);return this.say('Aperta '+target.title,'Opened '+target.title);}
      case 'nextResults':case 'previousResults':if(this.choices)this.choices.page=Math.max(0,Math.min(Math.ceil(this.choices.items.length/5)-1,this.choices.page+(c.id==='nextResults'?1:-1)));return this.readChoices();
      case 'openResult':{
        const choices=this.choices,item=choices?.items[choices.page*5+Number(c.value)-1];
        if(!item)return this.say('Numero non disponibile nella pagina corrente.','Number not available on this page.');
        if(choices.context&&!this.valid(choices.context)){this.choices=null;return this.say('La nota è cambiata. Ripeti la ricerca.','The note changed. Repeat the search.');}
        if(choices.action==='open'){await a.open(item.id);return this.say('Aperta '+item.label,'Opened '+item.label);}
        if(choices.action==='move'){await a.move(item.id);return this.say('Nota spostata.','Note moved.');}
        if(choices.action==='selectFolder'){await a.selectFolder(item.id);return this.say('Cartella '+item.label,'Folder '+item.label);}
        if(choices.action==='select'){a.select(item.range);return this.say('Selezionato: '+body.slice(...item.range),'Selected: '+body.slice(...item.range));}
        if(choices.action==='restoreVersion')return this.confirm({id:'restoreVersion',version:item.version},['Ripristinare '+item.label+'?','Restore '+item.label+'?']);
        return;
      }
      case 'selectText':case 'cursorText':{
        const ranges=findTextRanges(body,c.value);if(!ranges.length)return this.say('Testo non trovato.','Text not found.');
        if(ranges.length>1)return this.list('matches',ranges.map((range,i)=>({range:c.id==='cursorText'?[c.after?range[1]:range[0],c.after?range[1]:range[0]]:range,label:`${i+1}: ${body.slice(Math.max(0,range[0]-25),Math.min(body.length,range[1]+25))}`})),'select',this.snapshot(c));
        const r=ranges[0];a.select(c.id==='cursorText'?[c.after?r[1]:r[0],c.after?r[1]:r[0]]:r);return this.say(c.id==='cursorText'?'Cursore spostato.':'Selezionato: '+body.slice(...r),c.id==='cursorText'?'Cursor moved.':'Selected: '+body.slice(...r));
      }
      case 'gotoParagraph':case 'selectParagraphNumber':{const r=numberedParagraph(body,Number(c.value));if(!r)return this.say('Paragrafo non trovato.','Paragraph not found.');a.select(c.id==='gotoParagraph'?[r[0],r[0]]:r);return this.say(`Paragrafo ${c.value}: ${body.slice(...r)}`,`Paragraph ${c.value}: ${body.slice(...r)}`);}
      case 'selectWord':case 'selectSentence':{const r=unitRange(body,selection[0],c.id==='selectWord'?'word':'sentence');a.select(r);return this.say('Selezionato: '+body.slice(...r),'Selected: '+body.slice(...r));}
      case 'nextWord':case 'previousWord':{const r=unitRange(body,c.id==='nextWord'?unitRange(body,selection[1])[1]+1:Math.max(0,selection[0]-2));a.select([r[0],r[0]]);return this.say(body.slice(...r));}
      case 'selectLastSentence':case 'readLastSentence':{const range=unitRange(body,Math.max(0,selection[0]-1),'sentence');if(c.id==='selectLastSentence')a.select(range);return this.say(body.slice(...range));}
      case 'where':{const pos=textPosition(body,selection[0],a.language()),number=pos.paragraph;return this.say(`Nota ${note?.title||'senza titolo'}, paragrafo ${number}, frase ${pos.sentence}, ${selection[1]-selection[0]} caratteri selezionati. Modalità ${a.mode()==='commands'?'comandi':'dettatura'}.`,`Note ${note?.title||'untitled'}, paragraph ${number}, sentence ${pos.sentence}, ${selection[1]-selection[0]} selected characters. ${a.mode()} mode.`);}
      case 'read':return a.read(`${note?.title||''}. ${body}`);
      case 'readSelection':return a.read(body.slice(...selection)|| (this.en()?'Nothing selected.':'Nessun testo selezionato.'));
      case 'readParagraph':case 'readPrevious':{const range=(c.id==='readPrevious'?previousParagraphRange:paragraphRange)(body,selection[0]);return a.read(body.slice(...range));}
      case 'listHistory':return this.list('history',(await a.history()).map((version,i)=>({version,label:`${i+1}: ${new Date(version.at).toLocaleString(this.en()?'en-US':'it-IT')}`})),'restoreVersion',this.snapshot(c));
      case 'restoreVersion':{const version=(await a.history())[Number(c.value)-1];if(!version)return this.say('Versione non trovata.','Version not found.');return this.confirm({id:c.id,version},['Ripristinare la versione scelta?','Restore the selected version?']);}
      case 'restoreNote':if(note?.deleted){await a.execute('trash');return this.say('Nota ripristinata.','Note restored.');}return this.say('La nota non è nel cestino.','The note is not in the trash.');
      case 'editSelection':if(selection[0]===selection[1])return this.say('Seleziona prima il testo da modificare.','Select the text to edit first.');return this.confirm(c,[`Sostituire la selezione con: ${c.value}?`,`Replace the selection with: ${c.value}?`]);
      case 'editParagraph':return this.confirm(c,[`Sostituire il paragrafo con: ${c.value}?`,`Replace the paragraph with: ${c.value}?`]);
      case 'replace':{
        const ranges=findTextRanges(body,c.from);if(!ranges.length)return this.say('Testo non trovato.','Text not found.');return this.confirm({...c,ranges},[`Sostituire ${ranges.length} occorrenze di ${c.from} con ${c.to}?`,`Replace ${ranges.length} occurrences of ${c.from} with ${c.to}?`]);
      }
      case 'deletePrevious':case 'deleteParagraph':case 'deleteSelection':case 'cut':case 'trash':case 'clearFormat':
        return this.confirm(c,[`Confermi: ${descriptions[c.id][0]}?`,`Confirm: ${descriptions[c.id][1]}?`]);
      case 'link':{
        let url=normalize(c.url).replace(/\b(?:punto|dot)\b/g,'.').replace(/\b(?:barra|slash)\b/g,'/').replace(/\b(?:trattino|dash)\b/g,'-').replace(/\s/g,'');
        if(!/^https?:\/\//.test(url))url='https://'+url;
        try{const parsed=new URL(url);if(!/^https?:$/.test(parsed.protocol)||!parsed.hostname.includes('.'))throw Error();}catch{return this.say('Indirizzo non valido. Ripeti il comando collegamento.','Invalid address. Repeat the link command.');}
        return this.confirm({id:'insertLink',url},[`Inserire il collegamento ${url}?`,`Insert the link ${url}?`]);
      }
      case 'new':await a.create(c.value);return this.say('Creata '+c.value,'Created '+c.value);
      case 'folder':await a.folder(c.value);return this.say('Cartella creata.','Folder created.');
      case 'uppercase':case 'lowercase':{const value=body.slice(...selection);a.edit(c.id==='uppercase'?value.toLocaleUpperCase():value.toLocaleLowerCase());return this.say('Selezione modificata.','Selection updated.');}
      case 'focus':a.focus();return this.say('Modalità concentrazione attivata.','Focus mode enabled.');
    }
    await a.execute(c.id,c);
    if(['selectParagraph','selectAll','previous','next','start','end'].includes(c.id)){const now=a.snapshot();const range=now.selection[0]===now.selection[1]?paragraphRange(now.note.body,now.selection[0]):now.selection;return this.say(now.note.body.slice(...range)|| (this.en()?'Empty.':'Vuoto.'));}
    const message=descriptions[c.id]||['Comando eseguito.','Command completed.'];return this.say(...message);
  }
  async commit(c){
    const a=this.a,{note,selection}=a.snapshot();
    if(c.id==='editSelection')a.edit(c.value);
    else if(c.id==='editParagraph')a.edit(c.value,...paragraphRange(note.body,selection[0]));
    else if(c.id==='replace'){let body=note.body;for(const [start,end] of c.ranges.slice().reverse())body=body.slice(0,start)+c.to+body.slice(end);a.edit(body,0,note.body.length);}
    else if(c.id==='insertLink')a.edit(`[${note.body.slice(...selection)||c.url}](${c.url})`);
    else if(c.id==='restoreVersion')await a.restore(c.version);
    else await a.execute(c.id,c);
    return this.say('Modifica applicata. Puoi dire annulla.','Edit applied. You can say undo.');
  }
}
const descriptions={
 deletePrevious:['cancellare il paragrafo precedente','delete previous paragraph'],deleteParagraph:['cancellare il paragrafo','delete paragraph'],deleteSelection:['cancellare la selezione','delete selection'],cut:['tagliare la selezione','cut selection'],trash:['spostare la nota nel cestino','move note to trash'],clearFormat:['rimuovere la formattazione','clear formatting'],
 bold:['Grassetto applicato.','Bold applied.'],italic:['Corsivo applicato.','Italic applied.'],undo:['Modifica annullata.','Edit undone.'],redo:['Modifica ripetuta.','Edit redone.'],save:['Nota salvata.','Note saved.'],copy:['Selezione copiata negli appunti locali.','Selection copied to local clipboard.'],paste:['Testo incollato.','Text pasted.'],rename:['Nota rinominata.','Note renamed.'],pin:['Preferita aggiornata.','Favorite updated.']
};
export function spokenMarkdown(text,lang='it-IT') {
  return text.replace(/^- \[x\] /gim,lang==='it-IT'?'Completato: ':'Completed: ').replace(/^- \[ \] /gm,lang==='it-IT'?'Da fare: ':'To do: ').replace(/^#{1,6}\s+/gm,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/[*`~]/g,'').replace(/^>\s?/gm,'');
}
