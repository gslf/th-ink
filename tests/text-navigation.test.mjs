import test from 'node:test';import assert from 'node:assert/strict';
import {parseNavigation,resolveNavigation,textUnits,textPosition,navigationGrammar} from '../src/js/text-navigation.js';
import {parseScreenless} from '../src/js/screenless.js';
import {grammar,chooseTranscript} from '../src/js/voice-grammar.js';
const body='Prima frase. Seconda frase! Terza frase?\n\nAltro paragrafo. Ultima frase.';
const run=(command,at=0,text=body)=>resolveNavigation(text,Array.isArray(at)?at:[at,at],parseScreenless(command),'it');
test('last sentence of paragraph differs from last sentence of note, IT/EN',()=>{
 for(const c of ['seleziona l’ultima frase del paragrafo','select the last sentence in the paragraph'])assert.equal(body.slice(...run(c).range),'Terza frase?');
 assert.equal(body.slice(...run('seleziona la prima frase della nota',60).range),'Prima frase.');
 assert.equal(body.slice(...run('select the last sentence in the note').range),'Ultima frase.');
});
test('numbered movements and next/previous paragraph do not stop in the current unit',()=>{
 assert.deepEqual(run('spostati tre frasi in avanti').range,[42,42]);
 assert.deepEqual(run('spostati al paragrafo successivo',5).range,[42,42]);
 assert.deepEqual(run('move to the previous paragraph',48).range,[0,0]);
 assert.deepEqual(run('spostati due frasi indietro',45).range,[13,13]);
});
test('multiple selection in both directions, extension, and collapse',()=>{
 assert.equal(body.slice(...run('seleziona due frasi successive').range),'Seconda frase! Terza frase?');
 assert.equal(body.slice(...run('select the previous two sentences',42).range),'Seconda frase! Terza frase?');
 assert.deepEqual(run('estendi selezione due parole avanti').range,[0,13]);
 assert.deepEqual(run('cursor at the start of selection',[13,26]).range,[13,13]);
 assert.deepEqual(run('deseleziona',[13,26]).range,[26,26]);
});
test('explicit boundaries, numbered sentence within paragraph, no partial out-of-range selection',()=>{
 assert.deepEqual(run('fine frase',4).range,[12,12]);
 assert.deepEqual(run('inizio paragrafo',48).range,[42,42]);
 assert.equal(body.slice(...run('seleziona frase due',43).range),'Ultima frase.');
 assert.deepEqual(run('vai alla frase due',43).range,[59,59]);
 assert.equal(run('select the previous two sentences',0).error,'boundary');
 assert.deepEqual(run('move ten sentences forward').range,[body.length,body.length]);
 assert.equal(run('move ten sentences forward').boundary,true);
 assert.equal(run('seleziona frase',0,'').error,'empty');
 assert.equal(parseNavigation('spostati 1000 frasi avanti'),null);
 assert.equal(parseNavigation('seleziona qualsiasi cosa che vuoi'),null);
});
test('Unicode segmentation, newlines without punctuation, empty separators, and position',()=>{
 const text='Caffè ☕️. «È pronto!»\n\n\n  Next line without punctuation\nAnd another.';
 const ranges=textUnits(text,'sentence','it');assert.ok(ranges.length>=3);
 assert.equal(text.slice(...ranges[0]),'Caffè ☕️.');assert.ok(ranges.some(r=>text.slice(...r).includes('Next line')));
 assert.deepEqual(textPosition(text,text.indexOf('Next'),'en'),{paragraph:2,sentence:1});
 const graphemes=textUnits('a👨‍👩‍👧‍👦e\u0301','character');assert.equal(graphemes.length,3);assert.equal(graphemes[1][1],12);
 const words=textUnits("L’idea è bella.",'word','it');assert.equal("L’idea è bella.".slice(...words[0]),'L’idea');
});
test('every navigation grammar phrase is accepted by the parser',()=>{
 for(const en of [false,true])for(const phrase of navigationGrammar(en))assert.ok(parseNavigation(phrase),phrase);
 assert.ok(grammar('it-IT').includes('spostati tre frasi avanti'));
 assert.ok(grammar('en-US').includes('select the last sentence in the paragraph'));
});
test('multiple last sentences and selection from here to a boundary',()=>{
 assert.equal(body.slice(...run('seleziona le ultime due frasi del paragrafo').range),'Seconda frase! Terza frase?');
 assert.deepEqual(run('avanti tre frasi').range,[42,42]);
 assert.deepEqual(run('seleziona da qui alla fine del paragrafo',13).range,[13,40]);
 assert.deepEqual(run('select from here to the start of the sentence',20).range,[13,20]);
});
test('singular movement, selection synonyms, and accents without splitting graphemes',()=>{
 assert.deepEqual(run('spostati una frase avanti').range,[13,13]);
 assert.deepEqual(run('move one sentence forward').range,[13,13]);
 assert.equal(body.slice(...run('highlight the last sentence in the paragraph').range),'Terza frase?');
 assert.equal(body.slice(...run('evidenzia ultima frase del paragrafo').range),'Terza frase?');
 const emoji='a👨‍👩‍👧‍👦e\u0301';assert.deepEqual(run('spostati un carattere avanti',1,emoji).range,[12,12]);
});

test('ASR grammar does not rewrite the count or scope of an already valid command',()=>{
 for(const [free,controlled] of [['spostati due frasi avanti','spostati tre frasi avanti'],['seleziona ultima frase della nota','seleziona ultima frase del paragrafo']]){
  const result=chooseTranscript({text:free,words:[]},{text:controlled,words:[{conf:1}]},'commands');assert.equal(result.text,free);assert.equal(result.source,'free');
 }
});
