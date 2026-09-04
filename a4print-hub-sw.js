const VERSION='a4print-hub-sw-3';

self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(n=>/a4print|chat|hub/i.test(n)).map(n=>caches.delete(n)));
  await self.clients.claim();
})()));

// HUB работает online-first без собственного кеша рабочих страниц.
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith(fetch(event.request,{cache:'no-store'}).catch(()=>new Response('Сеть недоступна',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));
});

function chatTarget(data={}){
  let target=data.url||'/admin/messages.html?app=1';
  try{
    const u=new URL(target,self.location.origin);
    if(data.room_id){
      u.pathname='/admin/messages.html';
      u.searchParams.set('room',data.room_id);
      if(data.message_id)u.searchParams.set('message',data.message_id);
      u.searchParams.set('app','1');
      u.searchParams.set('v','push3');
    }
    return u.pathname+u.search;
  }catch{return target}
}

self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?event.data.json():{}}catch{data={body:event.data?.text?.()||'Новое сообщение'}}
  const title=data.title||'A4PRINT HUB';
  const target=chatTarget(data);
  const options={
    body:data.body||'Новое сообщение',
    icon:'/admin/assets/a4print-hub-logo.png',
    badge:'/admin/assets/a4print-hub-logo.png',
    tag:data.tag||('a4-chat-'+(data.message_id||data.room_id||'message')),
    renotify:true,
    vibrate:[160,70,160],
    data:{url:target,room_id:data.room_id||'',message_id:data.message_id||''}
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const data=event.notification.data||{};
  const url=new URL(chatTarget(data),self.location.origin).href;
  event.waitUntil((async()=>{
    const list=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of list){
      if(new URL(client.url).origin===self.location.origin){
        try{await client.navigate(url)}catch{}
        return client.focus();
      }
    }
    return clients.openWindow(url);
  })());
});

self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});
