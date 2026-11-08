// Public, non-sensitive diagnostics shared by the account UI and its tests.
export function pushStatusText(result,language='en'){
 const status=result?.status||result?.state;
 const messages={
  accepted:['Il servizio push ha accettato la notifica. La visualizzazione sul dispositivo non è confermata.','The push service accepted the notification. Display on the device is not confirmed.'],
  queued:['Test in coda: un altro invio è in corso. Il cron lo elaborerà.','Test queued: another delivery is running. The scheduler will process it.'],
  retrying:['Invio non riuscito: il server riproverà.','Delivery failed: the server will retry.'],
  expired:['Sottoscrizione scaduta. Attiva nuovamente questo dispositivo.','Subscription expired. Enable this device again.'],
  authorization:['Il servizio push rifiuta le chiavi. Riattiva il dispositivo e conserva le chiavi VAPID originali sul server.','The push service rejected the keys. Re-enable this device and keep the original VAPID keys on the server.'],
  payload:['Il servizio push rifiuta la dimensione del messaggio.','The push service rejected the message size.'],
  'rate-limit':['Il servizio push sta limitando gli invii. Il server riproverà.','The push service is rate limiting deliveries. The server will retry.'],
  provider:['Errore temporaneo del servizio push.','Temporary push service failure.'],
  transport:['Il backend non riesce a contattare il servizio push.','The backend could not reach the push service.'],
  encryption:['Errore nella preparazione crittografica della notifica. Verifica il backend e riattiva il dispositivo.','Notification encryption failed. Check the backend and re-enable this device.'],
  configuration:['Configurazione push o dipendenze PHP non disponibili.','Push configuration or PHP dependencies are unavailable.'],
  rejected:['Il servizio push ha rifiutato la richiesta.','The push service rejected the request.']
 };
 const detail=result?.status==='retrying'?result.pushStatus?.state:status;
 const text=(messages[detail]||messages[status]||["Esito dell’invio non disponibile.",'Delivery outcome unavailable.'])[language==='it'?0:1];
 const http=result?.pushStatus?.http??result?.http;return text+(Number.isInteger(http)?` (HTTP ${http})`:'');
}
export function samePushKey(subscription,key){const current=subscription?.options?.applicationServerKey;if(!current)return true;const bytes=new Uint8Array(current);return bytes.length===key.length&&bytes.every((b,i)=>b===key[i]);}

export function deliveryStatusText(batch,language='en'){
 if(!batch)return '';
 const count=key=>Number.isSafeInteger(batch[key])&&batch[key]>=0?batch[key]:0;
 const status=language==='it'
  ?`Ultimo giro di invii: ${count('sent')} accettati, ${count('retrying')} tentativi non riusciti, ${count('expired')} sottoscrizioni scadute rimosse.`
  :`Last delivery run: ${count('sent')} accepted, ${count('retrying')} unsuccessful attempts, ${count('expired')} expired subscriptions removed.`;
 const details=Object.entries(batch.outcomes||{}).filter(([state,n])=>!['accepted','expired'].includes(state)&&Number.isSafeInteger(n)&&n>0).map(([state,n])=>`${n} × ${pushStatusText({state},language)}`);
 return [status,...details].join(' ');
}
