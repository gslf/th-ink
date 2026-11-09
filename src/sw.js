const CACHE='th-ink-shell-version';
const ASSETS=[];
const INTEGRITY={};
// Reject partial deployments before replacing the last complete offline version.
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload',integrity:INTEGRITY[url]}))).then(()=>{if(['localhost','127.0.0.1'].includes(self.location.hostname))return self.skipWaiting();})));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('th-ink-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(e.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname.includes('/api/'))return;
 if(url.pathname.includes('/models/')||url.pathname.includes('/vendor/')){e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request)));return;}
 if(['localhost','127.0.0.1'].includes(url.hostname)){e.respondWith(fetch(e.request,{cache:'no-store'}).catch(async()=>await caches.match(e.request)||(e.request.mode==='navigate'?await caches.match('./index.html'):Response.error())));return;}
 e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).catch(()=>{if(e.request.mode==='navigate')return caches.match('./index.html');return Response.error();})));
});

// API responses never enter the shell cache. A push wakes the worker even when
// no application window exists; delivery time still depends on the OS/network.
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{let data={};try{data=event.data?.json()||{};}catch{}
  const base=new URL('./',self.location.href);let url;try{url=new URL(data.url||'./',base);if(url.origin!==base.origin||url.pathname!==base.pathname)url=base;}catch{url=base;}
  await self.registration.showNotification(String(data.title||'th.ink').slice(0,200),{body:String(data.body||'Reminder').slice(0,400),icon:new URL('assets/icon-192.png',base).href,badge:new URL('assets/icon-192.png',base).href,tag:String(data.tag||'think-reminder').slice(0,160),renotify:true,data:{url:url.href}});
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{const base=new URL('./',self.location.href);let url=new URL(event.notification.data?.url||base.href);if(url.origin!==base.origin||url.pathname!==base.pathname)url=base;
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});const client=clients.find(c=>{const u=new URL(c.url);return u.origin===base.origin&&u.pathname===base.pathname;});
  if(client){await client.focus();if(url.searchParams.has('note'))client.postMessage({type:'reminder-open',note:url.searchParams.get('note'),reminder:url.searchParams.get('reminder')});}else await self.clients.openWindow(url.href);
 })());
});
