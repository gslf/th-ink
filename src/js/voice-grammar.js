import {parseScreenless} from './screenless.js';
import {navigationGrammar} from './text-navigation.js';
import {normalize} from './core.js';
const pairs=[
 ['modalità comando','command mode'],['comandi','commands'],['dettatura','dictation'],['ferma lettura','stop reading'],['pausa lettura','pause reading'],['silenzio','be quiet'],['continua lettura','resume reading'],['rileggi','repeat reading'],['ripeti messaggio','repeat message'],
 ['nuova nota','new note'],['rinomina nota','rename note'],['elenca cestino','list trash'],['elenca note','list notes'],['elenca cartelle','list folders'],['sposta nota','move note'],['crea cartella','create folder'],['cerca','search'],['nota successiva','next note'],['nota precedente','previous note'],['prossima pagina','next page'],['pagina precedente','previous page'],
 ['cancella il paragrafo precedente','delete previous paragraph'],['cancella paragrafo','delete paragraph'],['cancella selezione','delete selection'],['seleziona tutto','select all'],['seleziona paragrafo','select paragraph'],['seleziona parola','select word'],['seleziona frase','select sentence'],['modifica selezione','edit selection'],['modifica paragrafo','edit paragraph'],['trova e sostituisci','find and replace'],
 ['paragrafo precedente','previous paragraph'],['paragrafo successivo','next paragraph'],['parola precedente','previous word'],['parola successiva','next word'],['inizio nota','start of note'],['fine nota','end of note'],['dove sono','where am i'],['leggi nota','read note'],['leggi paragrafo','read paragraph'],['leggi il paragrafo precedente','read previous paragraph'],['leggi selezione','read selection'],
 ['grassetto','bold'],['corsivo','italic'],['barrato','strikethrough'],['titolo','heading'],['elenco','bullet list'],['elenco numerato','numbered list'],['casella','checklist'],['spunta casella','toggle checkbox'],['citazione','quote'],['codice','code'],['blocco codice','code block'],['collegamento','link'],['tabella','table'],['rientra','indent'],['riduci rientro','outdent'],['rimuovi formattazione','clear formatting'],
 ['annulla','undo'],['ripeti','redo'],['copia','copy'],['taglia','cut'],['incolla','paste'],['duplica nota','duplicate note'],['duplica paragrafo','duplicate paragraph'],['sposta paragrafo sopra','move paragraph up'],['sposta paragrafo sotto','move paragraph down'],['preferita','pin note'],['cestina nota','trash note'],['ripristina nota','restore note'],['leggi cronologia','read history'],['selezione maiuscola','uppercase selection'],['selezione minuscola','lowercase selection'],['salva','save'],['aiuto','help'],['conferma','confirm'],['annulla comando','cancel'],['ferma ascolto','stop listening'],['lingua italiana','italian language'],['lingua inglese','english language'],['concentrazione','focus'],['inserisci data','insert date'],['a capo','new line'],['nuovo paragrafo','new paragraph']
];
export function grammar(lang,mode='commands') {
 const en=lang.startsWith('en'),index=en?1:0;
 const words=mode==='interrupt'?(en?['stop reading','pause reading','be quiet']:['ferma lettura','pausa lettura','silenzio']):mode==='dictation'?(en?['command mode','hey think']:['modalità comando','ehi think']):pairs.map(pair=>pair[index]);
 if(mode==='commands')for(const n of (en?['one','two','three','four','five','six','seven','eight','nine','ten']:['uno','due','tre','quattro','cinque','sei','sette','otto','nove','dieci'])){
  words.push(...(en?['choose ','open result ','go to paragraph ','select paragraph ','restore version ']:['scegli ','apri risultato ','vai al paragrafo ','seleziona paragrafo ','ripristina versione ']).map(prefix=>prefix+n));
 }
 return [...new Set([...words,...(mode==='commands'?navigationGrammar(en):[]),'[unk]'])];
}
export function distance(a,b){a=normalize(a);b=normalize(b);let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length]/Math.max(1,a.length,b.length);}
export const confidence=words=>words?.length?words.reduce((s,w)=>s+(w.conf||0),0)/words.length:null;
export function chooseTranscript(free,constrained,mode){
 const candidate=constrained.text?.trim(),original=free.text?.trim()||'';
 if(!candidate||candidate.includes('[unk]'))return {...free,source:'free'};
 const score=confidence(constrained.words);
 if(score!==null&&score<.75)return {...free,source:'free'};
 if(mode==='interrupt')return {...constrained,source:'grammar'};
 // Do not let grammar correction change an already understood count, scope or action.
 if(mode==='commands'){const freeCommand=parseScreenless(original),grammarCommand=parseScreenless(candidate);if(freeCommand&&JSON.stringify(freeCommand)!==JSON.stringify(grammarCommand))return {...free,source:'free'};}
 const difference=distance(original,candidate);
 const limit=candidate.split(/\s+/).length===1?.2:.4;
 // Constrained grammars can force a plausible command out of unrelated speech.
 // Require independent agreement from free decoding; never act on grammar alone.
 if(original&&difference<=limit)return {...constrained,source:'grammar'};
 return {...free,source:'free'};
}
