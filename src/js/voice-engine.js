import {MODELS, RUNTIME} from './voice-config.js';
export const VOICE_CACHE = 'th-ink-voice-v1';
const base = new URL('../', import.meta.url);
export const assetURL = asset => {const url=new URL(asset.url,base);if(asset.url.includes('/models/')||asset.url===RUNTIME.url)url.searchParams.set('sha256',asset.sha256);return url.href;};
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');

// Only same-origin, hash-checked assets. This never sends audio or text over HTTP.
export async function cacheAsset(asset, progress = () => {}, signal) {
  const url = assetURL(asset);
  if (new URL(url).origin !== location.origin) throw Error('Il modello deve essere sullo stesso dispositivo/server dell’app.');
  const cache = await caches.open(VOICE_CACHE);
  const cached=await cache.match(url);if(cached?.headers.get('X-think-sha256')===asset.sha256)return;
  const downloadURL=new URL(url);downloadURL.searchParams.set('assetHash',asset.sha256);
  const response = await fetch(downloadURL, {signal, credentials: 'same-origin'});
  if (!response.ok) throw Error(`Modello locale mancante (${response.status}). Esegui npm run setup:voice.`);
  const reader = response.body.getReader(), chunks = [];
  let received = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    received += value.length;
    if (received > asset.bytes) { await reader.cancel(); throw Error('Dimensione del modello non valida.'); }
    chunks.push(value); progress(received / asset.bytes);
  }
  const bytes = new Uint8Array(received); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  if (received !== asset.bytes || await digest(bytes) !== asset.sha256) throw Error('Integrità del modello non valida: copia non salvata.');
  await cache.put(url, new Response(bytes, {headers: {'Content-Type': asset.type || 'application/gzip','X-think-sha256':asset.sha256}}));
}

export class VoskEngine {
  constructor() {this.model = null; this.lang = null; this.generation = 0;}
  async availability(lang) {
    if (!MODELS[lang] || !globalThis.WebAssembly || !globalThis.Worker || !globalThis.caches) return 'unsupported';
    if (this.lang === lang && this.model?.ready) return 'available';
    const cache = await caches.open(VOICE_CACHE);
    const assets=[MODELS[lang],RUNTIME];
    const copies=await Promise.all(assets.map(asset=>cache.match(assetURL(asset))));
    return copies.every((copy,i)=>copy?.headers.get('X-think-sha256')===assets[i].sha256)?'available':'downloadable';
  }
  async install(lang, progress, signal) {
    if (!MODELS[lang]) throw Error('Lingua non supportata.');
    await cacheAsset(RUNTIME, n => progress?.({stage:'runtime', progress:n}), signal);
    await cacheAsset(MODELS[lang], n => progress?.({stage:'model', progress:n}), signal);
  }
  async load(lang, progress, signal) {
    if (this.lang === lang && this.model?.ready) return this.model;
    this.dispose(); const generation = this.generation;
    await this.install(lang, progress, signal);
    if (signal?.aborted || generation !== this.generation) throw new DOMException('Caricamento annullato', 'AbortError');
    await import(assetURL(RUNTIME));
    progress?.({stage:'loading'});
    const model = new globalThis.Vosk.Model(assetURL(MODELS[lang]), -2);
    this.model = model;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(Error('Caricamento del modello scaduto. Riprova.')), 120000);
      const abort = () => finish(new DOMException('Caricamento annullato', 'AbortError'));
      const finish = error => {clearTimeout(timeout); signal?.removeEventListener('abort', abort); if(error) reject(error); else resolve();};
      signal?.addEventListener('abort', abort, {once:true});
      model.on('load', msg => finish(msg.result ? null : Error('Impossibile caricare il modello locale.')));
      model.on('error', msg => finish(Error(msg.error || JSON.stringify(msg))));
      model.worker.addEventListener('error', e => finish(Error(e.message || 'Worker vocale interrotto.')), {once:true});
    }).catch(error => {this.dispose(); throw error;});
    if (generation !== this.generation || signal?.aborted) {this.dispose(); throw new DOMException('Caricamento annullato', 'AbortError');}
    this.lang = lang; return model;
  }
  createRecognizer(onPartial = () => {}, grammar) {
    if (!this.model?.ready) throw Error('Modello non pronto.');
    const recognizer = new this.model.KaldiRecognizer(16000, grammar ? JSON.stringify(grammar) : undefined);
    recognizer.setWords(true);
    let pending = null, disposed = false;
    const respond = message => {
      if (!pending || disposed) return;
      const p = pending; pending = null; clearTimeout(p.timeout);
      if (message.event === 'error') p.reject(Error(message.error));
      else {if (message.event === 'partialresult') onPartial(message.result.partial || ''); p.resolve(message);}
    };
    for (const event of ['partialresult','result','error']) recognizer.on(event, respond);
    const request = fn => new Promise((resolve,reject) => {
      if (disposed) return reject(new DOMException('Sessione terminata','AbortError'));
      if (pending) return reject(Error('Richiesta ASR concorrente.'));
      pending={resolve,reject,timeout:setTimeout(()=>{const p=pending;pending=null;p?.reject(Error('Il motore vocale non risponde.'));},10000)};
      try {fn();} catch(e) {const p=pending;pending=null;clearTimeout(p.timeout);reject(e);}
    });
    return {
      feed: samples => request(()=>recognizer.acceptWaveformFloat(samples,16000)),
      finish: () => request(()=>recognizer.retrieveFinalResult()),
      dispose: () => {disposed=true;if(pending){clearTimeout(pending.timeout);pending.reject(new DOMException('Sessione terminata','AbortError'));pending=null;}recognizer.remove();},
    };
  }
  dispose() {this.generation++;this.model?.worker?.terminate();this.model=null;this.lang=null;}
}
