const CACHE='a4print-kassa-v38';
const CORE=[
  './','./index.html','./styles.css','./modules.css','./shift.css','./shift-layout-fix.css','./shift-profile.css','./shift-compact.css','./sale-finish.css','./config.js','./db.js','./bootstrap.js','./network-safety.js','./shift-session-gate.js','./sync-throttle.js','./app.js','./modules.js','./ui.js','./catalog-quick-add.js','./shift-operator.js','./shift-state-sync.js','./shift-profile.js','./shift-profile-compact.js','./cash-operations.js','./sale-submit-guard.js','./sale-finish.js','./queue-recovery.js','./return-finish.js','./history-hub.js','./held-receipts.js','./report-source-summary.js','./settings-help.js','./sale-view-fix.js','./startup-shift.js','./runtime-stability.js','./jarvis-workday.js',
  '../admin/vendor/supabase.js','../admin/voice-engine.js','../admin/jarvis-assistant.js','../admin/jarvis-wake.js','../admin/guard.js','../admin/assets/a4print-hub-logo-white.svg'
];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE).catch(()=>{})).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('a4print-kassa-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  const critical=event.request.mode==='navigate'||/\.(?:js|css|html|webmanifest)$/i.test(url.pathname);
  if(critical){
    event.respondWith(fetch(new Request(event.request,{cache:'no-store'})).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});return r}).catch(async()=>await caches.match(event.request)||await caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});return r})));
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});
