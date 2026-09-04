(function(){
  if(window.__A4_PUSH_CLIENT__)return;
  window.__A4_PUSH_CLIENT__=true;

  const VAPID_PUBLIC='BBpMmH5lmF-yZc2BrS2DyJjyzLobGlIm7a8BXiMoOQi4R6au34K_WBkk34_5YO3OZx4rv5XoAzGlkJAz5A4Mojw';
  const SYNC_KEY='a4_push_last_sync_v2';
  let supabase=null,reg=null,button=null;
  const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent||'');
  const standalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;

  function b64(s){const pad='='.repeat((4-s.length%4)%4),base=(s+pad).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(base),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
  function supported(){return 'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window}
  function label(text,bad=false){if(!button)return;button.textContent=text;button.style.color=bad?'#b91c1c':'';button.title=text}

  async function initSupabase(){
    if(supabase)return supabase;
    const mod=await import('./guard.js');
    supabase=mod.supabase;
    return supabase;
  }

  async function save(sub){
    const sb=await initSupabase();
    const j=sub.toJSON(),keys=j.keys||{};
    const row={endpoint:sub.endpoint,p256dh:keys.p256dh,auth:keys.auth,user_agent:navigator.userAgent||'',platform:navigator.platform||'',is_active:true,updated_at:new Date().toISOString()};
    const{error}=await sb.from('push_subscriptions').upsert(row,{onConflict:'endpoint'});if(error)throw error;
    try{localStorage.setItem(SYNC_KEY,String(Date.now()))}catch{}
  }

  async function ensureRegistration(){
    if(reg)return reg;
    reg=await navigator.serviceWorker.register('/a4print-hub-sw.js',{scope:'/'});
    try{await reg.update()}catch{}
    return reg;
  }

  async function ensureSubscribed(requestPermission=false,forceSave=false){
    if(!supported()){label('Push недоступен',true);return false}
    if(isIOS&&!standalone()){
      label('📲 Push после установки');
      if(requestPermission)alert('На iPhone push-уведомления работают для A4 Chat, добавленного на экран Домой. Сначала добавьте A4 Chat на экран, затем откройте его и включите Push.');
      return false;
    }
    if(Notification.permission==='denied'){label('🔕 Push запрещён',true);if(requestPermission)alert('Push-уведомления запрещены для a4print-hub.ru в настройках браузера.');return false}
    if(Notification.permission==='default'){
      if(!requestPermission){label('📲 Включить Push');return false}
      const p=await Notification.requestPermission();if(p!=='granted'){label('🔕 Push выключен',true);return false}
    }
    const r=await ensureRegistration();
    let sub=await r.pushManager.getSubscription();
    if(!sub)sub=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(VAPID_PUBLIC)});
    if(forceSave||requestPermission)await save(sub);
    label('✅ Push включён');return true;
  }

  function installButton(){
    if(button)return true;
    const panel=document.getElementById('hubChatNotifyPanel');if(!panel)return false;
    const candidates=[...panel.querySelectorAll('button')];
    const test=candidates.find(x=>/тест/i.test(x.textContent||''));
    const sound=candidates.find(x=>/звук/i.test(x.textContent||''));
    const host=test?.parentElement||sound?.parentElement||panel.firstElementChild;
    if(!host)return false;
    button=document.createElement('button');button.type='button';button.id='a4PushEnable';button.textContent='📲 Включить Push';
    button.style.cssText='border:1px solid #dbe2ea;background:#f8fafc;border-radius:9px;padding:7px 9px;cursor:pointer;font:inherit;font-size:12px;font-weight:800;white-space:nowrap';
    button.onclick=async e=>{e.stopPropagation();button.disabled=true;try{await ensureSubscribed(true,true)}catch(err){console.error(err);label('Ошибка Push',true);alert(err?.message||'Не удалось включить Push-уведомления.')}finally{button.disabled=false}};
    host.prepend(button);
    if(Notification.permission==='granted')label('✅ Push включён');
    return true;
  }

  function watchUi(){
    if(installButton())return;
    const obs=new MutationObserver(()=>{if(installButton())obs.disconnect()});
    obs.observe(document.documentElement,{childList:true,subtree:true});
    setTimeout(()=>obs.disconnect(),10000);
  }

  async function quietRestore(){
    if(!supported()||Notification.permission!=='granted')return;
    try{
      const r=await ensureRegistration();
      const sub=await r.pushManager.getSubscription();
      let last=0;try{last=Number(localStorage.getItem(SYNC_KEY)||0)}catch{}
      if(Date.now()-last<86400000)return;
      if(sub)await save(sub);
    }catch(e){console.warn('A4 push background sync failed',e)}
  }

  function init(){
    watchUi();
    const run=()=>quietRestore();
    if('requestIdleCallback'in window)requestIdleCallback(run,{timeout:5000});else setTimeout(run,2500);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
