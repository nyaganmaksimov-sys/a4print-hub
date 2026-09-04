const CACHE='a4print-hub-chat-v1';
const STATIC=['/chat/','/chat/index.html','/chat/styles.css','/chat/app.js','/chat/manifest.webmanifest','/chat/icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).catch(()=>{}).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('a4print-hub-chat-')&&k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim()})()));
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const url=new URL(req.url);if(url.origin!==self.location.origin)return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).catch(async()=>await caches.match('/chat/index.html')||Response.error()));return;
  }
  if(url.pathname.startsWith('/chat/')){
    event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});return r}).catch(()=>cached)));
  }
});
self.addEventListener('push',event=>{
  let data={title:'A4PRINT HUB',body:'Новое сообщение',url:'/admin/messages.html?app=1'};
  try{if(event.data)data={...data,...event.data.json()}}catch{try{data.body=event.data.text()}catch{}}
  event.waitUntil(self.registration.showNotification(data.title||'A4PRINT HUB',{body:data.body||'Новое сообщение',icon:'/chat/icon.svg',badge:'/chat/icon.svg',tag:data.tag||'a4-chat',renotify:true,data:{url:data.url||'/admin/messages.html?app=1'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const target=event.notification.data?.url||'/admin/messages.html?app=1';
  event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of windows){try{const u=new URL(client.url);if(u.origin===self.location.origin){await client.focus();if('navigate'in client)await client.navigate(target);return}}catch{}}if(self.clients.openWindow)await self.clients.openWindow(target)})());
});
