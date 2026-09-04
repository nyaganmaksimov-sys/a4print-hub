import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL='https://qgakliolffnwkymoqvzn.supabase.co';
const SUPABASE_KEY='sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu';
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY);
const $=id=>document.getElementById(id);
let installPrompt=null;
let authSettings=null;

function showMessage(text,type='info'){
  const el=$('message');
  el.textContent=text;
  el.className=`message ${type}`;
  el.hidden=false;
}
function clearMessage(){const el=$('message');el.hidden=true;el.textContent='';el.className='message'}
function setLoading(on,text='Проверяем аккаунт…'){$('loading').hidden=!on;if(on)$('loading').querySelector('span').textContent=text}
function providerName(p){if(p==='google')return'Google';if(p==='custom:yandex')return'Яндекс';if(p==='custom:mailru')return'Mail.ru';return p}
async function loadAuthSettings(){
  if(authSettings)return authSettings;
  try{
    const r=await fetch(`${SUPABASE_URL}/auth/v1/settings`,{headers:{apikey:SUPABASE_KEY}});
    authSettings=r.ok?await r.json():null;
  }catch{authSettings=null}
  return authSettings;
}
function providerEnabled(settings,provider){
  const ext=settings?.external;
  if(!ext||typeof ext!=='object')return null;
  if(Object.prototype.hasOwnProperty.call(ext,provider))return Boolean(ext[provider]);
  if(provider.startsWith('custom:')){
    const key=provider.slice(7);
    if(Object.prototype.hasOwnProperty.call(ext,key))return Boolean(ext[key]);
  }
  return null;
}
function isStandalone(){return window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true}
function openChat(){location.replace('/admin/messages.html?app=1&v=pwa')}
async function routeByProfile(autoOpen=true){
  const {data,error}=await supabase.rpc('get_my_staff_profile');
  if(error)throw error;
  const st=data?.status;
  if(st==='ACTIVE'){
    $('openChatBtn').hidden=false;
    $('openChatBtn').onclick=openChat;
    $('sessionHint').hidden=false;
    $('sessionHint').textContent='✅ Вы уже вошли в A4PRINT HUB. Можно открыть чат или установить приложение.';
    if(autoOpen)openChat();
    return;
  }
  $('openChatBtn').hidden=true;
  if(st==='PENDING'){
    $('sessionHint').hidden=false;
    $('sessionHint').innerHTML='⏳ Заявка сотрудника отправлена и ожидает одобрения администратора.';
    return;
  }
  if(st==='REJECTED'){
    $('sessionHint').hidden=false;
    $('sessionHint').innerHTML='⚠️ Заявка сотрудника отклонена. Обратитесь к администратору HUB.';
    return;
  }
  $('sessionHint').hidden=false;
  $('sessionHint').innerHTML='👤 Аккаунт найден, но регистрация сотрудника не завершена. <a href="/admin/register.html?returnTo=%2Fchat%2F">Завершить регистрацию</a>';
}

async function refreshProviderButtons(){
  const settings=await loadAuthSettings();
  document.querySelectorAll('[data-provider]').forEach(btn=>{
    const p=btn.dataset.provider,enabled=providerEnabled(settings,p);
    if(enabled===false){btn.disabled=true;btn.title=`${providerName(p)} пока не подключён в A4PRINT HUB`;btn.querySelector('span:last-child').textContent=`${providerName(p)} · не подключён`}
  });
}

for(const btn of document.querySelectorAll('[data-provider]')){
  btn.addEventListener('click',async()=>{
    clearMessage();
    const provider=btn.dataset.provider;
    btn.disabled=true;
    try{
      const settings=await loadAuthSettings(),enabled=providerEnabled(settings,provider);
      if(enabled===false)throw new Error(`${providerName(provider)} пока не подключён. Используйте другой способ входа.`);
      const redirect=new URL('/admin/login.html',location.origin);
      redirect.searchParams.set('oauth','1');
      redirect.searchParams.set('returnTo','/chat/?auth=1');
      const {error}=await supabase.auth.signInWithOAuth({provider,options:{redirectTo:redirect.href}});
      if(error)throw error;
    }catch(e){showMessage(e?.message||'Не удалось открыть авторизацию.','error');btn.disabled=false}
  });
}

$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();clearMessage();
  const email=$('email').value.trim().toLowerCase(),password=$('password').value;
  if(!email||!password)return showMessage('Введите email и пароль.','error');
  $('loginBtn').disabled=true;setLoading(true,'Входим в A4PRINT Chat…');
  try{
    const {error}=await supabase.auth.signInWithPassword({email,password});
    if(error)throw error;
    await routeByProfile(true);
  }catch(err){showMessage(err?.message||'Не удалось выполнить вход.','error')}
  finally{$('loginBtn').disabled=false;setLoading(false)}
});

$('togglePassword').onclick=()=>{
  const input=$('password'),show=input.type==='password';
  input.type=show?'text':'password';
  $('togglePassword').textContent=show?'🙈':'👁';
};
$('forgotBtn').onclick=()=>{$('recoverBox').hidden=false;$('recoverEmail').value=$('email').value.trim();$('recoverEmail').focus()};
$('cancelRecovery').onclick=()=>{$('recoverBox').hidden=true};
$('sendRecovery').onclick=async()=>{
  clearMessage();const email=$('recoverEmail').value.trim().toLowerCase();
  if(!email)return showMessage('Введите email для восстановления.','error');
  $('sendRecovery').disabled=true;
  try{
    const redirectTo=new URL('/admin/reset-password.html',location.origin).href;
    const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo});
    if(error)throw error;
    showMessage('Ссылка для смены пароля отправлена на почту.','success');$('recoverBox').hidden=true;
  }catch(e){showMessage(e?.message||'Не удалось отправить ссылку.','error')}
  finally{$('sendRecovery').disabled=false}
};

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;if(!isStandalone())$('installBtn').hidden=false});
$('installBtn').onclick=async()=>{
  if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installBtn').hidden=true;return}
  const isiOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
  if(isiOS)$('iosInstall').hidden=false;
  else showMessage('Откройте меню браузера и выберите «Установить приложение» или «Создать ярлык».','info');
};
$('closeIosInstall').onclick=()=>{$('iosInstall').hidden=true};
window.addEventListener('appinstalled',()=>{$('installBtn').hidden=true;showMessage('A4PRINT HUB Chat установлен.','success')});

async function init(){
  if('serviceWorker' in navigator){navigator.serviceWorker.register('/a4print-chat-sw.js',{scope:'/'}).catch(e=>console.warn('PWA service worker',e))}
  const standalone=isStandalone();
  if(standalone)$('installBtn').hidden=true;
  else if(/iphone|ipad|ipod/i.test(navigator.userAgent))$('installBtn').hidden=false;
  await refreshProviderButtons();
  const {data:{session}}=await supabase.auth.getSession();
  if(session){
    setLoading(true);
    try{
      const justAuthenticated=new URLSearchParams(location.search).get('auth')==='1';
      await routeByProfile(standalone||justAuthenticated);
    }catch(e){showMessage(e?.message||'Не удалось проверить доступ.','error')}
    finally{setLoading(false)}
  }
}

init();
