self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=(event.notification.data&&event.notification.data.url)||'./messages.html';
  event.waitUntil((async()=>{
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clients){
      try{
        const u=new URL(client.url);
        if(u.origin===self.location.origin){await client.focus();if('navigate'in client)await client.navigate(target);return;}
      }catch{}
    }
    if(self.clients.openWindow)await self.clients.openWindow(target);
  })());
});
