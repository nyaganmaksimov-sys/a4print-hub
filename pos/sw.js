const CACHE='a4print-pos-v6';
const CORE=['./','./index.html','./styles-v2.css','./logo-fix.css','./manual-shift.js','./runtime-guard.js','./app-v2.js','./manifest.webmanifest','./login.html','./login.js','../admin/config.js','../admin/assets/a4print-hub-logo-white.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE).catch(()=>{})).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('a4print-pos-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const u=new URL(event.request.url);
  if(u.origin!==self.location.origin)return;
  const fresh=new Request(event.request,{cache:'no-store'});
  event.respondWith(fetch(fresh).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});return r}).catch(()=>caches.match(event.request).then(r=>r||caches.match('./index.html'))));
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});
