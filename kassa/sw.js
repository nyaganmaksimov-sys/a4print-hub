const CACHE='a4print-kassa-v7';
const CORE=[
  './','./index.html','./styles.css','./modules.css','./shift.css','./config.js','./db.js','./bootstrap.js','./app.js','./modules.js','./ui.js','./shift-operator.js','./manifest.webmanifest',
  '../admin/vendor/supabase.js','../admin/assets/a4print-hub-logo-white.svg'
];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE).catch(()=>{})).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('a4print-kassa-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  const critical=event.request.mode==='navigate'||/\.(?:js|css|html|webmanifest)$/i.test(url.pathname);
  if(critical){
    event.respondWith(fetch(new Request(event.request,{cache:'no-store'})).then(r=>{
      const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});return r;
    }).catch(async()=>await caches.match(event.request)||await caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});return r})));
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});
