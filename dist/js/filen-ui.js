import {t, getLocale} from './i18n.js';
export function filenSettings({modal,sync,session,connect,disconnect,remembered}){
 const el=modal('Filen'),make=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 el.classList.add('filen-panel');
 const status=make('p',t(sync.message));status.setAttribute('role','status');el.append(status);
 const update=()=>{if(!el.isConnected)return;status.textContent=sync.status==='ready'&&sync.lastSync?`${t(sync.message)} · ${new Date(sync.lastSync).toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit'})}`:t(sync.message);};sync.addEventListener('change',update);const dialog=el.closest('dialog');dialog?.addEventListener('close',()=>sync.removeEventListener('change',update),{once:true});update();
 if(sync.provider){
  el.append(make('p',sync.provider.sdk.config.email||t('Account collegato')));
  el.append(make('p',t('Cartella Filen: th.ink / revisioni-v1. Note e cartelle si aggiornano mentre l’app è aperta. Le modifiche offline partiranno al ritorno della connessione.')));
  const actions=make('div','');actions.className='filen-actions';
  const run=make('button',t('Sincronizza ora'));run.className='primary';run.onclick=async()=>{run.disabled=true;try{await sync.sync();}catch{}finally{run.disabled=false;}};
  const forget=make('button',t('Scollega'));forget.onclick=async()=>{forget.disabled=true;run.disabled=true;try{await disconnect();filenSettings({modal,sync,session,connect,disconnect,remembered:()=>false});}catch{status.textContent=t('Impossibile scollegare. Riprova.');forget.disabled=false;run.disabled=false;}};
  const remember=make('label',''),check=document.createElement('input');check.type='checkbox';check.checked=remembered();remember.append(check,make('span',t('Ricorda accesso su questo dispositivo')));
  check.onchange=async()=>{check.disabled=true;try{if(check.checked)await session.save(sync.provider.sdk.config);else await session.clear();}catch{check.checked=!check.checked;status.textContent=t('Non è stato possibile aggiornare l’accesso memorizzato.');}finally{check.disabled=false;}};
  if(sync.status==='expired'){run.disabled=true;status.textContent=t('La sessione non è più valida. Scollega e accedi di nuovo.');}
  actions.append(run,forget);el.append(remember,actions);return;
 }
 const form=document.createElement('form');form.className='filen-form';
 const add=(name,label,type,autocomplete,required=false)=>{const l=make('label',label),input=document.createElement('input');input.name=name;input.type=type;input.autocomplete=autocomplete;input.required=required;l.append(input);form.append(l);return input;};
 const email=add('email',t('Email Filen'),'email','username',true),password=add('password','Password','password','current-password',true),twoFactor=add('twoFactor',t('Codice 2FA, se attivo'),'text','one-time-code');
 twoFactor.inputMode='text';
 const label=make('label',''),check=document.createElement('input');check.type='checkbox';check.checked=true;label.className='remember-access';label.append(check,make('span',t('Ricorda accesso su questo dispositivo')));form.append(label);
 const info=make('p',t('La sessione viene cifrata nel browser. La password non viene salvata. Il collegamento autorizza th.ink a sincronizzare questo archivio con il tuo account Filen.'));info.className='filen-detail';form.append(info);
 const submit=make('button',t('Collega e sincronizza'));submit.type='submit';submit.className='primary';form.append(submit);
 form.onsubmit=async event=>{
  event.preventDefault();submit.disabled=true;status.textContent=t('Collegamento…');
  const credentials={email:email.value.trim(),password:password.value,twoFactorCode:twoFactor.value.trim()||undefined};password.value='';twoFactor.value='';
  try{await connect(credentials,check.checked);filenSettings({modal,sync,session,connect,disconnect,remembered});}
  catch(error){status.textContent=authMessage(error);submit.disabled=false;password.focus();}
  finally{credentials.password='';credentials.twoFactorCode='';}
 };
 el.append(form);
}
export function authMessage(error){
 if(['enter_2fa','wrong_2fa'].includes(error.code))return t('Inserisci password e codice 2FA aggiornato.');
 if(error.code==='email_or_password_wrong')return t('Email o password non corrette.');
 return t('Collegamento non riuscito. Verifica connessione e credenziali, poi riprova.');
}
