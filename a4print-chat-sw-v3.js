const CACHE='a4print-hub-chat-v3';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const k of await caches.keys()){if(k.startsWith('a4print-hub-chat-')&&k!==CACHE)await caches.delete(k)}await self.clients.claim()})()));
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;const url=new URL(req.url);if(url.origin!==self.location.origin)return;
  if(req.mode==='navigate'||url.pathname.startsWith('/chat/')){
    event.respondWith((async()=>{try{const fresh=await fetch(req,{cache:'no-store'});const c=await caches.open(CACHE);c.put(req,fresh.clone()).catch(()=>{});return fresh}catch{const cached=await caches.match(req);if(cached)return cached;if(req.mode==='navigate')return caches.match('/chat/start.html');throw new Error('offline')}})());
  }
});
self.addEventListener('push',event=>{let d={title:'A4PRINT HUB',body:'Новое сообщение',url:'/admin/messages.html?app=1'};try{if(event.data)d={...d,...event.data.json()}}catch{}event.waitUntil(self.registration.showNotification(d.title||'A4PRINT HUB',{body:d.body||'Новое сообщение',icon:'/chat/icon.svg',badge:'/chat/icon.svg',tag:d.tag||'a4-chat',renotify:true,data:{url:d.url||'/admin/messages.html?app=1'}}))});
self.addEventListener('notificationclick',event=>{event.notification.close();const target=event.notification.data?.url||'/admin/messages.html?app=1';event.waitUntil((async()=>{for(const c of await self.clients.matchAll({type:'window',includeUncontrolled:true})){try{if(new URL(c.url).origin===self.location.origin){await c.focus();if('navigate'in c)await c.navigate(target);return}}catch{}}if(self.clients.openWindow)await self.clients.openWindow(target)})())});