import {parseNavigation,textUnits,unitIndex} from './text-navigation.js';
import {normalize, parseCommand, voiceIntent, paragraphRange} from './core.js';
const numbers={zero:0,uno:1,una:1,un:1,one:1,due:2,two:2,tre:3,three:3,quattro:4,four:4,cinque:5,five:5,sei:6,six:6,sette:7,seven:7,otto:8,eight:8,nove:9,nine:9,dieci:10,ten:10};
export const spokenNumber = value => /^\d+$/.test(value.trim()) ? Number(value) : numbers[normalize(value.trim())];
export function parseScreenless(input, mode='commands') {
  const raw=input.trim().replace(/[.!?]+$/,'').replace(/^(?:per favore|please)\s+/i,'');
  const value=normalize(raw);
  const legacy=parseCommand(raw);if(['deleteParagraph','deletePrevious','readParagraph','readPrevious'].includes(legacy?.id))return legacy;
  const navigation=parseNavigation(raw);if(navigation)return navigation;
  const direct={
    'elenca cestino':'listTrash','list trash':'listTrash','elenca note':'listNotes','list notes':'listNotes','elenca cartelle':'listFolders','list folders':'listFolders',
    'nota successiva':'nextNote','next note':'nextNote','nota precedente':'previousNote','previous note':'previousNote',
    'prossima pagina':'nextResults','next page':'nextResults','pagina precedente':'previousResults','previous page':'previousResults',
    'continua lettura':'resumeReading','resume reading':'resumeReading','pausa lettura':'pauseReading','pause reading':'pauseReading',
    'rileggi':'repeatReading','repeat reading':'repeatReading','ripeti messaggio':'repeatFeedback','repeat message':'repeatFeedback',
    'rinomina nota':'rename','rename note':'rename','nuova cartella':'folder','crea cartella':'folder','create folder':'folder',
    'sposta nota':'move','move note':'move','cerca':'search','search':'search','trova e sostituisci':'replace','find and replace':'replace',
    'modifica selezione':'editSelection','edit selection':'editSelection','modifica paragrafo':'editParagraph','edit paragraph':'editParagraph',
    'leggi ultima frase':'readLastSentence','read last sentence':'readLastSentence','seleziona ultima frase':'selectLastSentence','select last sentence':'selectLastSentence',
    'parola precedente':'previousWord','previous word':'previousWord','parola successiva':'nextWord','next word':'nextWord',
    'seleziona parola':'selectWord','select word':'selectWord','seleziona frase':'selectSentence','select sentence':'selectSentence',
    'lingua italiana':'italian','italian language':'italian','lingua inglese':'english','english language':'english',
    'leggi cronologia':'listHistory','read history':'listHistory','cronologia':'listHistory','history':'listHistory',
    'selezione maiuscola':'uppercase','uppercase selection':'uppercase','selezione minuscola':'lowercase','lowercase selection':'lowercase',
    'annulla comando':'cancel','annulla richiesta':'cancel','cancel':'cancel','ripristina nota':'restoreNote','restore note':'restoreNote',
  };
  if(direct[value])return {id:direct[value]};
  for(const [id,pattern] of [
    ['openResult',/^(?:apri risultato|open result|scegli|choose) (.+)$/i],
    ['gotoParagraph',/^(?:vai al paragrafo|go to paragraph|paragrafo|paragraph) (.+)$/i],
    ['selectParagraphNumber',/^(?:seleziona paragrafo|select paragraph) (.+)$/i],
    ['restoreVersion',/^(?:ripristina versione|restore version) (.+)$/i],
  ]){const m=raw.match(pattern);if(m){const n=spokenNumber(m[1]);if(Number.isInteger(n)&&n>0)return {id,value:String(n)};}}
  const named=raw.match(/^(?:nuova nota|new note) (?:chiamata |called )?(.+)$/i);if(named)return {id:'new',value:named[1]};
  const cursor=raw.match(/^(?:cursore|cursor) (prima di|dopo|before|after) (.+)$/i);if(cursor)return {id:'cursorText',after:['dopo','after'].includes(normalize(cursor[1])),value:cursor[2]};
  return parseCommand(raw);
}
export function interpret(input, mode) {
  // These wake phrases are in both model vocabularies; never fuzzy-match an edit.
  const wake=input.match(/^(?:ehi\s+(?:think|tink)|hey\s+think|modalit[aà]\s+comand[oi]|command\s+mode)[,.:!]?\s*(.*)$/i);
  if(wake)return {mode:'commands',command:wake[1]?parseScreenless(wake[1]):{id:'commands'}};
  if(mode==='commands')return {mode,command:parseScreenless(input)};
  const literal=input.match(/^(?:letterale|literal)\s+(.+)$/i);if(literal)return {mode,text:literal[1]};
  const punctuation={'punto':'.','period':'.','virgola':',','comma':',','punto interrogativo':'?','question mark':'?','punto esclamativo':'!','exclamation mark':'!','due punti':':','colon':':','punto e virgola':';','semicolon':';','a capo':'\n','new line':'\n','nuovo paragrafo':'\n\n','new paragraph':'\n\n'};
  const p=punctuation[normalize(input.trim())];return p===undefined?{mode,text:input}:{mode,text:p,punctuation:true};
}
export function interruption(input) {
  const text=normalize(input.trim()).replace(/[.!?]+$/,'').replace(/^(?:ehi think|hey think|modalita comando|command mode)\s*/,'');
  if(['ferma lettura','stop reading','silenzio','be quiet'].includes(text))return 'stopReading';
  if(['pausa lettura','pause reading'].includes(text))return 'pauseReading';
  return null;
}
// Map normalized matches back to original UTF-16 offsets, including composed
// accents and surrogate pairs. Don't use normalized indices directly in textarea.
export function findTextRanges(text, query) {
  const starts=[],ends=[];let folded='',offset=0;
  for(const point of text){const normalized=normalize(point);for(const c of normalized){folded+=c;for(let j=0;j<c.length;j++){starts.push(offset);ends.push(offset+point.length);}}offset+=point.length;}
  const needle=normalize(query);if(!needle)return [];
  const result=[];let at=0;
  while((at=folded.indexOf(needle,at))!==-1){let end=ends[at+needle.length-1];while(end<text.length&&/\p{M}/u.test(text[end]))end++;result.push([starts[at],end]);at+=needle.length;}
  return result;
}
export function numberedParagraph(text, number) {
  const matches=[...text.matchAll(/(?:^|\n\n)([\s\S]*?)(?=\n\n|$)/g)];
  const m=matches[number-1];if(!m)return null;const start=m.index+(m[0].startsWith('\n\n')?2:0);return [start,start+m[1].length];
}
export function unitRange(text, cursor, unit='word') {
  if(unit==='paragraph')return paragraphRange(text,cursor);
  const ranges=textUnits(text,unit);return ranges[unitIndex(ranges,cursor)]||[0,0];
}
export function confirmationSnapshot(note, selection, action, now=Date.now()) {
  return {noteId:note.id,title:note.title,body:note.body,updated:note.updated,selection:[...selection],action,expires:now+30000};
}
export function confirmationValid(pending,note,selection,now=Date.now()) {
  return !!pending&&now<=pending.expires&&note?.id===pending.noteId&&note.title===pending.title&&note.body===pending.body&&note.updated===pending.updated&&selection[0]===pending.selection[0]&&selection[1]===pending.selection[1];
}

// A transaction-like spoken form: collect arguments, read a preview, then commit.
// No final action is taken during partial recognition or while asking a question.
export class SpokenDialog {
  constructor(){this.pending=null;}
  start(id, fields, context){this.pending={id,fields,values:{},index:0,context};return fields[0]?.prompt;}
  answer(input){const p=this.pending;if(!p)return null;const n=normalize(input.trim());if(['annulla comando','cancel'].includes(n)){this.pending=null;return {cancelled:true};}
    const field=p.fields[p.index];p.values[field.name]=input.trim();p.index++;
    if(p.index<p.fields.length)return {prompt:p.fields[p.index].prompt};
    this.pending=null;return {id:p.id,args:p.values,context:p.context};
  }
  cancel(){this.pending=null;}
}

// Dictation remains visible even when acoustic confidence is low. Commands and
// spoken form arguments still require a clearer result before they can act.
export function needsRecognitionRepeat({text,confidence},mode,argumentMode=false){
  return confidence!=null&&confidence<.45&&(mode==='commands'||argumentMode||!!interpret(text,mode).command);
}
