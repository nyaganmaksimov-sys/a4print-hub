(function(){
  if(window.__A4_PUSH_CLIENT__)return;
  window.__A4_PUSH_CLIENT__=true;

  const VAPID_PUBLIC='BBpMmH5lmF-yZc2BrS2DyJjyzLobGlIm7a8BXiMoOQi4R6au34K_WBkk34_5YO3OZx4rv5XoAzGlkJAz5A4Mojw';
  let supabase=null,reg=null,button=null;
  const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent||'');
  const standalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;

  function b64(s){const pad='='.repeat((4-s.length%4)%4),base=(s+pad).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(base),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
  function supported(){return 'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window}
  function label(text,bad=false){if(!button)return;button.textContent=text;button.style.color=bad?'#b91c1c':'';button.title=text}

  async function save(sub){
    if(!supabase)return;
    const j=sub.toJSON(),keys=j.keys||{};
    const row={endpoint:sub.endpoint,p256dh:keys.p256dh,auth:keys.auth,user_agent:navigator.userAgent||'',platform:navigator.platform||'',is_active:true,updated_at:new Date().toISOString()};
    const{error}=await supabase.from('push_subscriptions').upsert(row,{onConflict:'endpoint'});if(error)throw error;
  }

  async function ensureRegistration(){
    if(reg)return reg;
    reg=await navigator.serviceWorker.register('/a4print-push-sw.js?v=20260904-1',{scope:'/'});
    await navigator.serviceWorker.ready;
    return reg;
  }

  async function ensureSubscribed(requestPermission=false){
    if(!supported()){label('Push недоступен',true);return false}
    if(isIOS&&!standalone()){
      label('📲 Push после установки');
      if(requestPermission)alert('На iPhone push-уведомления работают для A4 Chat, добавленного на экран Домой. Сначала установите A4 Chat через меню «Поделиться» → «На экран Домой», затем откройте его и включите Push.');
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
    await save(sub);label('✅ Push включён');return true;
  }

  async function initSupabase(){
    try{const mod=await import('./guard.js');supabase=mod.supabase}catch(e){console.warn('A4 push auth init failed',e)}
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
    button.onclick=async e=>{e.stopPropagation();button.disabled=true;try{await ensureSubscribed(true)}catch(err){console.error(err);label('Ошибка Push',true);alert(err?.message||'Не удалось включить Push-уведомления.')}finally{button.disabled=false}};
    host.prepend(button);return true;
  }

  async function init(){
    await initSupabase();
    let tries=0;const t=setInterval(()=>{if(installButton()||++tries>80)clearInterval(t)},100);
    if(supported()){
      try{await ensureSubscribed(false)}catch(e){console.warn('A4 push restore failed',e)}
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();