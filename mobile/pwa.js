const SUPABASE_URL='https://qgakliolffnwkymoqvzn.supabase.co';
const SUPABASE_KEY='sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu';
const SUPABASE_STORAGE_KEY='sb-qgakliolffnwkymoqvzn-auth-token';
const ACCESS_KEY='a4print_mobile_access';
const VAPID_PUBLIC='BBpMmH5lmF-yZc2BrS2DyJjyzLobGlIm7a8BXiMoOQi4R6au34K_WBkk34_5YO3OZx4rv5XoAzGlkJAz5A4Mojw';
const PUSH_SYNC_KEY='a4_pwa_push_last_sync_v1';
let deferredInstall=null;
let swRegistration=null;

const q=(s,root=document)=>root.querySelector(s);
const qa=(s,root=document)=>[...root.querySelectorAll(s)];
const standalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
const pushSupported=()=>('serviceWorker'in navigator)&&('PushManager'in window)&&('Notification'in window);

function b64url(value){
  const pad='='.repeat((4-value.length%4)%4);
  const raw=atob((value+pad).replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}

function session(){
  try{return JSON.parse(localStorage.getItem(SUPABASE_STORAGE_KEY)||'null')||{}}
  catch{return {}}
}
function accessToken(){return localStorage.getItem(ACCESS_KEY)||session()?.access_token||''}

async function registration(){
  if(swRegistration)return swRegistration;
  swRegistration=await navigator.serviceWorker.register('/a4print-hub-sw.js',{scope:'/'});
  try{await swRegistration.update()}catch{}
  return swRegistration;
}

async function saveSubscription(sub){
  const token=accessToken();
  if(!token)throw new Error('Сначала войдите в A4PRINT HUB.');
  const j=sub.toJSON();
  const row={
    endpoint:sub.endpoint,
    p256dh:j.keys?.p256dh||'',
    auth:j.keys?.auth||'',
    user_agent:navigator.userAgent||'',
    platform:navigator.platform||'',
    is_active:true,
    updated_at:new Date().toISOString()
  };
  const r=await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?on_conflict=endpoint`,{
    method:'POST',
    headers:{
      apikey:SUPABASE_KEY,
      Authorization:`Bearer ${token}`,
      'Content-Type':'application/json',
      Prefer:'resolution=merge-duplicates,return=minimal'
    },
    body:JSON.stringify(row)
  });
  if(!r.ok){
    const text=await r.text().catch(()=>null);
    throw new Error(text||`Не удалось сохранить Push (${r.status})`);
  }
  localStorage.setItem(PUSH_SYNC_KEY,String(Date.now()));
}

function pushState(){
  if(!pushSupported())return {kind:'unsupported',text:'Push не поддерживается на этом устройстве'};
  if(Notification.permission==='denied')return {kind:'denied',text:'Push заблокирован в настройках браузера'};
  if(Notification.permission==='granted')return {kind:'enabled',text:'Push-уведомления включены'};
  return {kind:'default',text:'Push-уведомления нужно включить'};
}

function updatePushUi(){
  const state=pushState();
  qa('[data-push-status]').forEach(el=>{
    el.textContent=state.text;
    el.dataset.state=state.kind;
  });
  qa('[data-push-enable]').forEach(btn=>{
    btn.disabled=state.kind==='unsupported'||state.kind==='enabled';
    btn.textContent=state.kind==='enabled'?'✓ Push включён':state.kind==='denied'?'Открыть настройки уведомлений':'Включить Push';
  });
  qa('[data-push-required]').forEach(el=>{
    el.classList.toggle('show',state.kind!=='enabled');
    const txt=q('[data-push-required-text]',el);
    if(txt)txt.textContent=state.kind==='denied'
      ?'Уведомления запрещены. Разрешите их для a4print-hub.ru в настройках браузера.'
      :'Включите Push, чтобы сообщения приходили, когда A4PRINT HUB свёрнут или закрыт.';
  });
}

async function ensurePush(requestPermission=false){
  if(!pushSupported())throw new Error('Push-уведомления не поддерживаются этим браузером.');
  if(Notification.permission==='denied'){
    updatePushUi();
    throw new Error('Уведомления запрещены. Откройте настройки сайта a4print-hub.ru и разрешите уведомления.');
  }
  if(Notification.permission==='default'){
    if(!requestPermission){updatePushUi();return false}
    const permission=await Notification.requestPermission();
    if(permission!=='granted'){updatePushUi();return false}
  }
  const reg=await registration();
  let sub=await reg.pushManager.getSubscription();
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64url(VAPID_PUBLIC)});
  await saveSubscription(sub);
  updatePushUi();
  return true;
}

async function quietRestorePush(){
  if(!pushSupported()||Notification.permission!=='granted'||!accessToken())return;
  let last=0;try{last=Number(localStorage.getItem(PUSH_SYNC_KEY)||0)}catch{}
  if(Date.now()-last<6*60*60*1000)return;
  try{await ensurePush(false)}catch(e){console.warn('A4PRINT HUB push restore failed',e)}
}

async function testPush(){
  if(Notification.permission!=='granted')await ensurePush(true);
  const reg=await registration();
  await reg.showNotification('A4PRINT HUB',{body:'Push-уведомления работают. Сообщения будут приходить и при свёрнутом приложении.',icon:'/admin/assets/a4print-hub-logo.png',badge:'/admin/assets/a4print-hub-logo.png',tag:'a4-push-test',data:{url:'/mobile/'}});
}

function bindPushUi(){
  qa('[data-push-enable]').forEach(btn=>btn.addEventListener('click',async()=>{
    if(Notification.permission==='denied'){
      alert('Разрешите уведомления для a4print-hub.ru: Настройки браузера → Настройки сайтов → Уведомления.');
      return;
    }
    btn.disabled=true;
    try{await ensurePush(true)}catch(e){alert(e?.message||'Не удалось включить Push.')}finally{updatePushUi()}
  }));
  qa('[data-push-test]').forEach(btn=>btn.addEventListener('click',async()=>{
    btn.disabled=true;
    try{await testPush()}catch(e){alert(e?.message||'Не удалось показать тестовое уведомление.')}finally{btn.disabled=false;updatePushUi()}
  }));
  updatePushUi();
}

function updateInstallUi(){
  const installed=standalone();
  qa('[data-install-app]').forEach(btn=>{
    btn.hidden=installed;
    btn.disabled=!deferredInstall&&/iphone|ipad|ipod/i.test(navigator.userAgent||'');
    btn.textContent=installed?'Приложение установлено':'Установить A4PRINT HUB';
  });
  qa('[data-install-state]').forEach(el=>el.textContent=installed?'Установлено на устройство':'Можно установить на главный экран без APK');
}

function bindInstallUi(){
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();
    deferredInstall=e;
    updateInstallUi();
  });
  window.addEventListener('appinstalled',()=>{deferredInstall=null;updateInstallUi()});
  qa('[data-install-app]').forEach(btn=>btn.addEventListener('click',async()=>{
    if(standalone())return;
    if(deferredInstall){
      deferredInstall.prompt();
      await deferredInstall.userChoice.catch(()=>null);
      deferredInstall=null;
      updateInstallUi();
      return;
    }
    alert('Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».');
  }));
  updateInstallUi();
}

function watchLogin(){
  const app=q('#appView');
  if(!app)return;
  const run=()=>{if(!app.classList.contains('hidden'))quietRestorePush()};
  new MutationObserver(run).observe(app,{attributes:true,attributeFilter:['class']});
  run();
}

async function init(){
  bindInstallUi();
  bindPushUi();
  watchLogin();
  try{await registration()}catch(e){console.warn('Service worker registration failed',e)}
  quietRestorePush();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
