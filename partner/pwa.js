(()=>{
  const VAPID_PUBLIC_KEY='BDDnFkVMOVTJ0B2C3WLFedvsZgXBmV5y4LSC_0b-IXnr_XD2UJ1E7qjlraV8Jgk65VCACQLGHN8yURN7OktBmtc';
  const addHead=()=>{
    if(!document.querySelector('link[rel="manifest"]')){const l=document.createElement('link');l.rel='manifest';l.href='./manifest.webmanifest';document.head.appendChild(l)}
    if(!document.querySelector('meta[name="theme-color"]')){const m=document.createElement('meta');m.name='theme-color';m.content='#2563eb';document.head.appendChild(m)}
    if(!document.querySelector('link[rel="apple-touch-icon"]')){const a=document.createElement('link');a.rel='apple-touch-icon';a.href='./pwa-icon.svg';document.head.appendChild(a)}
  };
  const b64ToUint8=s=>{const pad='='.repeat((4-s.length%4)%4),raw=atob((s+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))};
  addHead();
  let swReady=null;
  if('serviceWorker'in navigator){window.addEventListener('load',()=>{swReady=navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(()=>navigator.serviceWorker.ready).catch(e=>{console.warn(e);return null})})}
  let deferredPrompt=null;
  const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  const ensureInstallButton=()=>{
    if(standalone()||document.getElementById('pwaInstall'))return;
    const b=document.createElement('button');b.id='pwaInstall';b.type='button';b.textContent='Установить приложение';b.setAttribute('aria-label','Установить Partner CRM');
    Object.assign(b.style,{position:'fixed',right:'18px',bottom:'18px',zIndex:'9999',border:'0',borderRadius:'14px',padding:'12px 16px',background:'linear-gradient(135deg,#2563eb,#7c3aed)',color:'#fff',fontWeight:'850',boxShadow:'0 14px 36px rgba(37,99,235,.28)',cursor:'pointer',display:'none'});
    b.onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;b.remove()}else{alert('Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».')}};
    document.body.appendChild(b);
  };
  const ensureNotifyButton=()=>{
    if(!('Notification'in window)||!('PushManager'in window)||Notification.permission==='denied'||document.getElementById('pushEnable'))return;
    const b=document.createElement('button');b.id='pushEnable';b.type='button';b.textContent='🔔 Включить уведомления';
    Object.assign(b.style,{position:'fixed',right:'18px',bottom:standalone()?'18px':'72px',zIndex:'9998',border:'1px solid #cbd5e1',borderRadius:'14px',padding:'11px 14px',background:'#fff',color:'#0f172a',fontWeight:'800',boxShadow:'0 12px 32px rgba(15,23,42,.16)',cursor:'pointer'});
    b.onclick=async()=>{b.disabled=true;b.textContent='Подключаем уведомления…';try{const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();if(permission!=='granted'){b.textContent='Уведомления запрещены';return}await syncPush(true);b.remove()}catch(e){console.warn(e);b.disabled=false;b.textContent='🔔 Включить уведомления'}};
    document.body.appendChild(b);
  };
  async function syncPush(showSuccess=false){
    if(Notification.permission!=='granted'||!window.A4PRINT_PARTNER_CONFIG)return false;
    const reg=await(swReady||navigator.serviceWorker.ready);if(!reg)return false;
    const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const cfg=window.A4PRINT_PARTNER_CONFIG,client=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
    const{data:{session}}=await client.auth.getSession();if(!session)return false;
    const{data:pu,error:puErr}=await client.from('partner_users').select('partner_id').eq('auth_user_id',session.user.id).eq('is_active',true).maybeSingle();if(puErr||!pu)return false;
    let sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToUint8(VAPID_PUBLIC_KEY)});
    const j=sub.toJSON();
    const row={partner_id:pu.partner_id,auth_user_id:session.user.id,endpoint:j.endpoint,p256dh:j.keys?.p256dh,auth:j.keys?.auth,user_agent:navigator.userAgent,enabled:true,updated_at:new Date().toISOString()};
    const{error}=await client.from('partner_push_subscriptions').upsert(row,{onConflict:'endpoint'});if(error)throw error;
    localStorage.setItem('a4print-push-ready','1');
    if(showSuccess&&reg.showNotification)await reg.showNotification('Уведомления включены',{body:'Теперь Partner CRM сможет сообщать о новых сообщениях, даже когда приложение закрыто.',tag:'push-enabled',icon:'./pwa-icon.svg'});
    return true;
  }
  window.A4PRINT_syncPush=syncPush;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;ensureInstallButton();const b=document.getElementById('pwaInstall');if(b)b.style.display='block'});
  window.addEventListener('appinstalled',()=>{deferredPrompt=null;document.getElementById('pwaInstall')?.remove();const n=document.getElementById('pushEnable');if(n)n.style.bottom='18px'});
  window.addEventListener('DOMContentLoaded',()=>{
    ensureInstallButton();
    setTimeout(()=>{const b=document.getElementById('pwaInstall');if(b&&!standalone())b.style.display='block'},1800);
    setTimeout(async()=>{if('Notification'in window&&Notification.permission==='granted'){try{await syncPush()}catch(e){console.warn(e)}}else ensureNotifyButton()},2200);
  });
})();