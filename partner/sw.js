const CACHE='a4print-partner-v2';
const SHELL=['./','./crm.html','./login.html','./crm.css','./config.js','./pwa-icon.svg','./offline.html'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==location.origin)return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));return res}).catch(async()=>await caches.match(req)||await caches.match('./offline.html')));
    return;
  }
  event.respondWith(caches.match(req).then(cached=>{
    const fresh=fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return res}).catch(()=>cached);
    return cached||fresh;
  }));
});
self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?event.data.json():{}}catch{data={body:event.data?.text()||'Новое событие в Partner CRM'}}
  const title=data.title||'Partner CRM';
  const options={body:data.body||'У вас новое уведомление',tag:data.tag||'a4print-partner',renotify:true,icon:'./pwa-icon.svg',badge:'./pwa-icon.svg',data:{url:data.url||'./crm-messages.html',conversation_id:data.conversation_id||null}};
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'./crm-messages.html',self.registration.scope).href;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async list=>{
    for(const client of list){if('navigate'in client)await client.navigate(target);if('focus'in client)return client.focus()}
    return clients.openWindow(target);
  }));
});