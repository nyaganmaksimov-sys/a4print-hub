import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL='https://qgakliolffnwkymoqvzn.supabase.co';
const SUPABASE_KEY='sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu';
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY);
const $=id=>document.getElementById(id);
let installPrompt=null;
let authSettings=null;

const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function withTimeout(promise,ms,message){
  let timer;
  try{
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message||'Превышено время ожидания.')),ms)})
    ]);
  }finally{clearTimeout(timer)}
}

function showMessage(text,type='info'){
  const el=$('message');
  el.textContent=text;
  el.className=`message ${type}`;
  el.hidden=false;
}
function clearMessage(){const el=$('message');el.hidden=true;el.textContent='';el.className='message'}
function setLoading(on,text='Проверяем аккаунт…'){
  const el=$('loading');
  if(!el)return;
  el.hidden=!on;
  if(on){const span=el.querySelector('span');if(span)span.textContent=text}
}
function providerName(p){if(p==='google')return'Google';if(p==='custom:yandex')return'Яндекс';if(p==='custom:mailru')return'Mail.ru';return p}
function isStandalone(){return window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true}
function openChat(){location.replace('/admin/messages.html?app=1&v=pwa2')}
function revealOpenChat(hint='✅ Аккаунт сотрудника активен. Можно открыть чат или установить приложение.'){
  const btn=$('openChatBtn');
  btn.hidden=false;
  btn.onclick=openChat;
  const hintEl=$('sessionHint');
  hintEl.hidden=false;
  hintEl.textContent=hint;
}

async function loadAuthSettings(){
  if(authSettings)return authSettings;
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),4500);
    const r=await fetch(`${SUPABASE_URL}/auth/v1/settings`,{headers:{apikey:SUPABASE_KEY},signal:controller.signal});
    clearTimeout(timer);
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

async function getSession(){
  const result=await withTimeout(supabase.auth.getSession(),6000,'Не удалось быстро получить сессию.');
  if(result?.error)throw result.error;
  return result?.data?.session||null;
}

async function getStaffState(){
  const session=await getSession();
  if(!session)return{status:'SIGNED_OUT',session:null,user:null};
  const query=supabase.from('users')
    .select('id,full_name,email,is_active')
    .eq('auth_user_id',session.user.id)
    .maybeSingle();
  const {data:user,error}=await withTimeout(query,7000,'Проверка профиля заняла слишком много времени.');
  if(error)throw error;
  if(user?.is_active===true)return{status:'ACTIVE',session,user};
  if(user?.is_active===false)return{status:'DISABLED',session,user};
  return{status:'UNREGISTERED',session,user:null};
}

async function routeByProfile(autoOpen=true){
  const state=await getStaffState();
  const hint=$('sessionHint');
  if(state.status==='ACTIVE'){
    revealOpenChat(`✅ ${state.user?.full_name||state.user?.email||'Сотрудник'} — вход выполнен. Можно открыть чат или установить приложение.`);
    if(autoOpen){await delay(80);openChat()}
    return state;
  }
  $('openChatBtn').hidden=true;
  if(state.status==='DISABLED'){
    hint.hidden=false;
    hint.textContent='⛔ Учётная запись сотрудника отключена. Обратитесь к администратору HUB.';
    return state;
  }
  if(state.status==='UNREGISTERED'){
    hint.hidden=false;
    hint.innerHTML='👤 Аккаунт найден, но профиль сотрудника ещё не активирован. <a href="/admin/register.html?returnTo=%2Fchat%2F">Перейти к регистрации</a>';
    return state;
  }
  hint.hidden=true;
  return state;
}

async function refreshProviderButtons(){
  const settings=await loadAuthSettings();
  document.querySelectorAll('[data-provider]').forEach(btn=>{
    const p=btn.dataset.provider,enabled=providerEnabled(settings,p);
    if(enabled===false){
      btn.disabled=true;
      btn.title=`${providerName(p)} пока не подключён в A4PRINT HUB`;
      const label=btn.querySelector('span:last-child');
      if(label)label.textContent=`${providerName(p)} · не подключён`;
    }else{
      btn.disabled=false;
    }
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
    }catch(e){
      showMessage(e?.message||'Не удалось открыть авторизацию.','error');
      btn.disabled=false;
    }
  });
}

$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();clearMessage();
  const email=$('email').value.trim().toLowerCase(),password=$('password').value;
  if(!email||!password)return showMessage('Введите email и пароль.','error');
  $('loginBtn').disabled=true;setLoading(true,'Входим в A4PRINT Chat…');
  try{
    const {error}=await withTimeout(supabase.auth.signInWithPassword({email,password}),10000,'Сервер входа не ответил вовремя.');
    if(error)throw error;
    await routeByProfile(true);
  }catch(err){
    showMessage(err?.message||'Не удалось выполнить вход.','error');
    try{const session=await getSession();if(session)revealOpenChat('⚠️ Вход выполнен, но проверка профиля задержалась. Попробуйте открыть чат напрямую.')}catch{}
  }finally{$('loginBtn').disabled=false;setLoading(false)}
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
    const {error}=await withTimeout(supabase.auth.resetPasswordForEmail(email,{redirectTo}),10000,'Сервер восстановления не ответил вовремя.');
    if(error)throw error;
    showMessage('Ссылка для смены пароля отправлена на почту.','success');$('recoverBox').hidden=true;
  }catch(e){showMessage(e?.message||'Не удалось отправить ссылку.','error')}
  finally{$('sendRecovery').disabled=false}
};

window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();installPrompt=e;
  if(!isStandalone())$('installBtn').hidden=false;
});
$('installBtn').onclick=async()=>{
  if(installPrompt){
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt=null;
    return;
  }
  const isiOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
  if(isiOS)$('iosInstall').hidden=false;
  else showMessage('В Chrome нажмите значок установки справа в адресной строке или меню ⋮ → «Установить A4PRINT HUB Chat».','info');
};
$('closeIosInstall').onclick=()=>{$('iosInstall').hidden=true};
window.addEventListener('appinstalled',()=>{showMessage('A4PRINT HUB Chat установлен.','success')});

async function init(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/a4print-chat-sw.js?v=2',{scope:'/'}).then(r=>r.update()).catch(e=>console.warn('PWA service worker',e));
  }
  const standalone=isStandalone();
  $('installBtn').hidden=standalone;
  refreshProviderButtons().catch(()=>{});

  let session=null;
  try{session=await getSession()}catch(e){
    showMessage('Не удалось быстро проверить сохранённый вход. Можно войти заново ниже.','error');
    setLoading(false);
    return;
  }
  if(!session){setLoading(false);return}

  setLoading(true);
  try{
    const justAuthenticated=new URLSearchParams(location.search).get('auth')==='1';
    await routeByProfile(standalone||justAuthenticated);
  }catch(e){
    console.warn('A4 Chat profile check failed',e);
    revealOpenChat('⚠️ Сессия найдена. Проверка профиля задержалась — можно открыть рабочий чат напрямую.');
    showMessage(e?.message||'Не удалось проверить профиль сотрудника.','error');
  }finally{setLoading(false)}
}

init().catch(e=>{
  console.error(e);
  setLoading(false);
  showMessage('Не удалось запустить A4PRINT Chat. Обновите страницу или откройте рабочий чат.','error');
  revealOpenChat('⚠️ Доступен прямой вход в рабочий чат.');
});
