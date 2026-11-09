// Permission prompts may remain unanswered. Cancellation must release any
// stream the browser grants later, rather than leave a hidden microphone open.
export function requestMicrophone(getStream,{signal,timeoutMs=30000}={}){
 return new Promise((resolve,reject)=>{
  let settled=false,timer;
  const finish=(error,stream)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(stream);};
  const abort=()=>finish(new DOMException('Caricamento annullato','AbortError'));
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>finish(Error('Il browser non ha risposto alla richiesta del microfono. Controlla i permessi del sito e dell’app. Se usi un’anteprima integrata, prova lo stesso indirizzo nel browser di sistema.')),timeoutMs);
  try{
   Promise.resolve(getStream({video:false,audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}})).then(stream=>{
    if(settled){stream.getTracks().forEach(track=>track.stop());return;}
    finish(null,stream);
   },error=>{
    const messages={NotAllowedError:'Accesso al microfono negato. Consenti il microfono nei permessi del sito e nelle impostazioni dell’app o del sistema.',NotFoundError:'Nessun microfono disponibile. Collega un microfono e riprova.',NotReadableError:'Il microfono non è accessibile. Controlla se è occupato da un’altra app e riprova.'};
    finish(messages[error.name]?new Error(messages[error.name]):error);
   });
  }catch(error){finish(error);}
 });
}
