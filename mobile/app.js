import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { Capacitor } from 'https://cdn.jsdelivr.net/npm/@capacitor/core@7/+esm';
import { App as NativeApp } from 'https://cdn.jsdelivr.net/npm/@capacitor/app@7/+esm';
import { Browser as NativeBrowser } from 'https://cdn.jsdelivr.net/npm/@capacitor/browser@7/+esm';

const SUPABASE_URL='https://qgakliolffnwkymoqvzn.supabase.co';
const SUPABASE_KEY='sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu';
const OAUTH_RETURN='https://a4print-hub.ru/mobile/auth-callback.html';
const IS_NATIVE=Capacitor.isNativePlatform();
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const statusName={NEW:'Новый',CONFIRMED:'Подтверждён',IN_PROGRESS:'В работе',READY:'Готов',COMPLETED:'Завершён',ON_HOLD:'Пауза',CANCELLED:'Отменён'};
const providerTitles={google:'Google','custom:yandex':'Яндекс','custom:mailru':'Mail.ru'};
let authSettings=null;
let oauthFinishing=false;

const withTimeout=(promise,ms,message)=>Promise.race([
  Promise.resolve(promise),
  new Promise((_,reject)=>setTimeout(()=>reject(new Error(message||'Превышено время ожидания.')),ms))
]);

function friendlyError(ex,fallback='Не удалось выполнить операцию.'){
  const msg=String(ex?.message||ex||'').trim();
  if(!msg)return fallback;
  if(/failed to fetch|network|load failed|networkerror/i.test(msg))return 'Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз.';
  if(/invalid login credentials/i.test(msg))return 'Неверный email или пароль.';
  if(/email not confirmed/i.test(msg))return 'Email ещё не подтверждён.';
  if(/timeout|время ожидания/i.test(msg))return 'Сервер отвечает слишком долго. Попробуйте ещё раз.';
  return msg;
}

function setLoginError(message=''){
  const e=$('loginError');
  e.textContent=message;
  e.classList.toggle('show',!!message);
}
function showLogin(message=''){
  $('loginView').classList.remove('hidden');
  $('appView').classList.add('hidden');
  setLoginError(message);
}
function showApp(){
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  setLoginError('');
}
function setHomeNotice(message=''){
  const n=$('homeNotice');
  if(!n)return;
  n.textContent=message;
  n.classList.toggle('show',!!message);
}
function statusClass(s){return s==='READY'?'ready':s==='NEW'?'new':['CONFIRMED','IN_PROGRESS'].includes(s)?'work':''}
function customerName(o){const c=o.customers||{};return c.full_name||c.company_name||'Клиент не указан'}

function paramsFromUrl(rawUrl){
  try{
    const u=new URL(rawUrl);
    const out=new URLSearchParams(u.search);
    const hash=new URLSearchParams(String(u.hash||'').replace(/^#/,''));
    hash.forEach((value,key)=>out.set(key,value));
    return out;
  }catch{return new URLSearchParams()}
}

async function finishOAuth(rawUrl){
  if(oauthFinishing||!rawUrl)return false;
  const params=paramsFromUrl(rawUrl);
  const oauthError=params.get('error_description')||params.get('error');
  const accessToken=params.get('access_token');
  const refreshToken=params.get('refresh_token');
  const code=params.get('code');
  if(!oauthError&&!accessToken&&!code)return false;

  oauthFinishing=true;
  try{
    if(oauthError)throw new Error(decodeURIComponent(oauthError.replace(/\+/g,' ')));
    if(accessToken&&refreshToken){
      const {error}=await supabase.auth.setSession({access_token:accessToken,refresh_token:refreshToken});
      if(error)throw error;
    }else if(code){
      const {error}=await supabase.auth.exchangeCodeForSession(code);
      if(error)throw error;
    }else{
      throw new Error('Сервер авторизации не вернул сессию. Попробуйте ещё раз.');
    }
    try{if(IS_NATIVE)await NativeBrowser.close()}catch{}
    if(location.pathname.includes('/mobile/'))history.replaceState({},'', '/mobile/');
    await enterApp();
    return true;
  }catch(ex){
    try{if(IS_NATIVE)await NativeBrowser.close()}catch{}
    showLogin(friendlyError(ex,'Не удалось завершить вход.'));
    return true;
  }finally{oauthFinishing=false}
}

async function initOAuthBridge(){
  if(!IS_NATIVE){
    await finishOAuth(location.href);
    return;
  }
  try{
    await NativeApp.addListener('appUrlOpen',event=>{
      if(/^a4printhub:\/\//i.test(event?.url||''))finishOAuth(event.url).catch(ex=>showLogin(friendlyError(ex)));
    });
    const launch=await NativeApp.getLaunchUrl();
    if(/^a4printhub:\/\//i.test(launch?.url||''))await finishOAuth(launch.url);
  }catch(ex){console.warn('Native OAuth bridge unavailable',ex)}
}

async function loadAuthSettings(){
  if(authSettings)return authSettings;
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    const r=await fetch(`${SUPABASE_URL}/auth/v1/settings`,{headers:{apikey:SUPABASE_KEY},signal:controller.signal});
    clearTimeout(timer);
    if(!r.ok)return null;
    authSettings=await r.json();
    return authSettings;
  }catch{return null}
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
async function refreshProviderButtons(){
  const settings=await loadAuthSettings();
  for(const b of document.querySelectorAll('[data-provider]')){
    const enabled=providerEnabled(settings,b.dataset.provider);
    if(enabled===false){
      b.classList.add('provider-disabled');
      b.title=`${providerTitles[b.dataset.provider]||b.dataset.provider} пока не подключён`;
    }
  }
}

async function getStaffProfile(){
  const {data,error}=await withTimeout(supabase.rpc('get_my_staff_profile'),8000,'Проверка профиля заняла слишком много времени.');
  if(error)throw error;
  return data||{};
}

async function loadHome(profile){
  setHomeNotice('');
  $('hello').textContent=profile?.full_name?`Привет, ${profile.full_name.split(/\s+/)[0]}`:'Главная';
  const {data,error}=await withTimeout(
    supabase.from('orders')
      .select('id,order_number,status,total,model_name,source,business_unit,created_at,customers(full_name,company_name)')
      .order('created_at',{ascending:false})
      .limit(100),
    10000,
    'Заказы загружаются слишком долго.'
  );
  if(error)throw error;
  const rows=data||[];
  $('newOrders').textContent=rows.filter(x=>x.status==='NEW').length;
  $('workOrders').textContent=rows.filter(x=>['CONFIRMED','IN_PROGRESS'].includes(x.status)).length;
  $('readyOrders').textContent=rows.filter(x=>x.status==='READY').length;
  $('recentOrders').innerHTML=rows.slice(0,8).map(o=>`<a class="order" href="/admin/order.html?id=${encodeURIComponent(o.id)}&mobile=1"><span><b>№${esc(o.order_number||String(o.id).slice(0,8))} · ${esc(customerName(o))}</b><small>${esc(o.model_name||o.source||(o.business_unit==='3D_ARTPRINT'?'3D-заказ':'Печать / услуга'))}</small><em class="status ${statusClass(o.status)}">${esc(statusName[o.status]||o.status||'—')}</em></span><strong>${Number(o.total||0).toLocaleString('ru-RU')} ₽</strong></a>`).join('')||'<div class="empty">Заказов пока нет</div>';
}

async function enterApp(){
  const {data:{session},error:sessionError}=await withTimeout(supabase.auth.getSession(),7000,'Не удалось получить сессию.');
  if(sessionError)throw sessionError;
  if(!session){showLogin();return false}

  const staff=await getStaffProfile();
  if(staff.status!=='ACTIVE'||!staff.user){
    if(staff.status==='PENDING'||staff.status==='REJECTED'){
      showLogin('Доступ сотрудника ещё не одобрен.');
      return false;
    }
    if(staff.status==='DISABLED'){
      showLogin('Учётная запись сотрудника отключена.');
      return false;
    }
    showLogin('Профиль сотрудника не найден.');
    return false;
  }

  showApp();
  try{await loadHome(staff.user)}
  catch(ex){
    console.error('Mobile home load failed',ex);
    $('recentOrders').innerHTML='<div class="empty">Не удалось загрузить заказы</div>';
    setHomeNotice(friendlyError(ex,'Вход выполнен, но рабочие данные пока не загрузились.'));
  }
  return true;
}

$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=$('loginButton');
  setLoginError('');
  btn.disabled=true;
  btn.textContent='Входим…';
  try{
    const {error}=await withTimeout(
      supabase.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value}),
      10000,
      'Сервер входа отвечает слишком долго.'
    );
    if(error)throw error;
    btn.textContent='Проверяем доступ…';
    await enterApp();
  }catch(ex){showLogin(friendlyError(ex,'Не удалось войти. Проверьте email и пароль.'))}
  finally{btn.disabled=false;btn.textContent='Войти'}
});

for(const b of document.querySelectorAll('[data-provider]')){
  b.addEventListener('click',async()=>{
    setLoginError('');
    b.disabled=true;
    const provider=b.dataset.provider;
    try{
      const settings=await loadAuthSettings();
      if(providerEnabled(settings,provider)===false)throw new Error(`${providerTitles[provider]||provider} пока не подключён в A4PRINT HUB.`);
      const {data,error}=await supabase.auth.signInWithOAuth({
        provider,
        options:{redirectTo:OAUTH_RETURN,skipBrowserRedirect:IS_NATIVE}
      });
      if(error)throw error;
      if(IS_NATIVE){
        if(!data?.url)throw new Error('Не удалось получить адрес авторизации.');
        await NativeBrowser.open({url:data.url,toolbarColor:'#0f172a'});
      }
    }catch(ex){
      showLogin(friendlyError(ex,'Не удалось открыть авторизацию.'));
    }finally{b.disabled=false}
  });
}

$('logout').onclick=async()=>{
  try{await supabase.auth.signOut({scope:'local'})}catch{}
  showLogin();
};

refreshProviderButtons().catch(()=>{});
initOAuthBridge().catch(ex=>console.warn('OAuth bridge init failed',ex));
enterApp().catch(ex=>showLogin(friendlyError(ex,'Не удалось открыть приложение.')));
