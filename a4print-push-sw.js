self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?event.data.json():{}}catch{data={body:event.data?.text?.()||'Новое сообщение'}}
  const title=data.title||'A4PRINT HUB';
  const options={
    body:data.body||'Новое сообщение',
    icon:'/admin/assets/a4print-hub-logo.png',
    badge:'/admin/assets/a4print-hub-logo.png',
    tag:data.tag||('a4-chat-'+(data.room_id||'message')),
    renotify:true,
    vibrate:[180,80,180],
    data:{url:data.url||'/admin/messages.html?app=1',room_id:data.room_id||''},
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=new URL(event.notification.data?.url||'/admin/messages.html?app=1',self.location.origin).href;
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
