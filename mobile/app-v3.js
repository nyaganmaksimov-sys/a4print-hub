import { Capacitor, CapacitorHttp } from 'https://cdn.jsdelivr.net/npm/@capacitor/core@7/+esm';
import { App as NativeApp } from 'https://cdn.jsdelivr.net/npm/@capacitor/app@7/+esm';
import { Browser as NativeBrowser } from 'https://cdn.jsdelivr.net/npm/@capacitor/browser@7/+esm';

const API_BASE='https://a4print-hub-api.onrender.com';
const SUPABASE_URL='https://qgakliolffnwkymoqvzn.supabase.co';
const SUPABASE_KEY='sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu';
const SUPABASE_STORAGE_KEY='sb-qgakliolffnwkymoqvzn-auth-token';
const OAUTH_RETURN='https://a4print-hub.ru/mobile/auth-callback.html';
const IS_NATIVE=Capacitor.isNativePlatform();
const ACCESS_KEY='a4print_mobile_access';
const REFRESH_KEY='a4print_mobile_refresh';
const EXPIRES_KEY='a4print_mobile_expires';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const statusName={NEW:'Новый',CONFIRMED:'Подтверждён',IN_PROGRESS:'В работе',READY:'Готов',COMPLETED:'Завершён',ON_HOLD:'Пауза',CANCELLED:'Отменён'};
let oauthFinishing=false;

function setLoginError(message=''){
  const el=$('loginError');
  if(!el)return;
  el.textContent=message;
  el.classList.toggle('show',!!message);
}
function showLogin(message=''){
  $('loginView')?.classList.remove('hidden');
  $('appView')?.classList.add('hidden');
  setLoginError(message);
}
function showApp(){
  $('loginView')?.classList.add('hidden');
  $('appView')?.classList.remove('hidden');
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
function friendlyError(ex,fallback='Не удалось выполнить операцию.'){
  const msg=String(ex?.message||ex||'').trim();
  if(!msg)return fallback;
  if(/invalid login credentials|invalid_credentials|неверный email/i.test(msg))return 'Неверный email или пароль.';
  if(/email not confirmed/i.test(msg))return 'Email ещё не подтверждён.';
  if(/provider.*not enabled|unsupported provider/i.test(msg))return 'Этот способ входа пока не подключён к A4PRINT HUB.';
  if(/failed to fetch|network|load failed|networkerror|abort|socket|host/i.test(msg))return 'Не удалось связаться с A4PRINT HUB. Повторите попытку через несколько секунд.';
  if(/timeout|timed out|время ожидания|слишком долго/i.test(msg))return 'Соединение устанавливается слишком долго. Повторите попытку.';
  return msg;
}

function storedSession(){
  try{return JSON.parse(localStorage.getItem(SUPABASE_STORAGE_KEY)||'null')||{}}
  catch{return {}}
}
function saveSession(session){
  if(!session?.access_token)return;
  const normalized={...storedSession(),...session};
  if(!normalized.expires_at&&normalized.expires_in)normalized.expires_at=Math.floor(Date.now()/1000)+Number(normalized.expires_in||0);
  localStorage.setItem(ACCESS_KEY,normalized.access_token);
  if(normalized.refresh_token)localStorage.setItem(REFRESH_KEY,normalized.refresh_token);
  if(normalized.expires_at)localStorage.setItem(EXPIRES_KEY,String(normalized.expires_at));
  localStorage.setItem(SUPABASE_STORAGE_KEY,JSON.stringify(normalized));
}
function clearSession(){
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EXPIRES_KEY);
  localStorage.removeItem(SUPABASE_STORAGE_KEY);
}
function accessToken(){return localStorage.getItem(ACCESS_KEY)||storedSession()?.access_token||''}

function parseNativeData(raw){
  if(raw==null)return {};
  if(typeof raw==='object')return raw;
  try{return JSON.parse(raw)}catch{return {message:String(raw)}}
}
async function http(url,{method='GET',body,headers={},timeout=30000}={}){
  if(IS_NATIVE&&CapacitorHttp?.request){
    const response=await CapacitorHttp.request({url,method,headers,data:body,connectTimeout:Math.min(timeout,15000),readTimeout:timeout});
    const data=parseNativeData(response.data);
    if(response.status<200||response.status>=300){
      const e=new Error(data?.msg||data?.message||data?.error_description||data?.error||`HTTP ${response.status}`);
      e.status=response.status;e.code=data?.error;throw e;
    }
    return data;
  }
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
    const text=await response.text();let data={};
    try{data=text?JSON.parse(text):{}}catch{data={message:text}}
    if(!response.ok){const e=new Error(data?.msg||data?.message||data?.error_description||data?.error||`HTTP ${response.status}`);e.status=response.status;e.code=data?.error;throw e}
    return data;
  }finally{clearTimeout(timer)}
}
async function supabase(path,{method='GET',body,token,timeout=25000}={}){
  const headers={Accept:'application/json',apikey:SUPABASE_KEY,Authorization:`Bearer ${token||SUPABASE_KEY}`};
  if(body!==undefined)headers['Content-Type']='application/json';
  return http(SUPABASE_URL+path,{method,body,headers,timeout});
}
async function api(path,{method='GET',body,token,timeout=35000}={}){
  const headers={Accept:'application/json'};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(token)headers.Authorization=`Bearer ${token}`;
  return http(API_BASE+path,{method,body,headers,timeout});
}

async function refreshSession(){
  const refresh=localStorage.getItem(REFRESH_KEY)||storedSession()?.refresh_token||'';
  if(!refresh)return false;
  try{
    const data=await supabase('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:refresh},timeout:20000});
    if(!data?.access_token)return false;
    saveSession(data);
    return true;
  }catch{return false}
}
async function directBootstrap(){
  const token=accessToken();if(!token)return null;
  const user=await supabase('/auth/v1/user',{token,timeout:18000});
  saveSession({...storedSession(),user});
  const [profileRows,orders]=await Promise.all([
    supabase(`/rest/v1/users?select=id,auth_user_id,full_name,email,phone,is_active,created_at&auth_user_id=eq.${encodeURIComponent(user.id)}&limit=1`,{token,timeout:22000}),
    supabase('/rest/v1/orders?select=id,order_number,status,total,model_name,source,business_unit,created_at,customers(full_name,company_name)&order=created_at.desc&limit=100',{token,timeout:22000})
  ]);
  const profile=Array.isArray(profileRows)?profileRows[0]:null;
  if(!profile){const e=new Error('Профиль сотрудника не найден.');e.status=403;throw e}
  if(profile.is_active===false){const e=new Error('Учётная запись сотрудника отключена.');e.status=403;throw e}
  return {success:true,profile,orders:Array.isArray(orders)?orders:[]};
}
async function bootstrap(){
  const token=accessToken();if(!token)return null;
  try{return await directBootstrap()}
  catch(ex){
    if(ex.status===401&&await refreshSession())return directBootstrap();
    try{return await api('/api/v1/mobile/bootstrap',{token:accessToken(),timeout:25000})}
    catch{throw ex}
  }
}

function renderHome(data){
  const profile=data?.profile||{};
  const rows=data?.orders||[];
  $('hello').textContent=profile.full_name?`Привет, ${profile.full_name.split(/\s+/)[0]}`:'Главная';
  $('newOrders').textContent=rows.filter(x=>x.status==='NEW').length;
  $('workOrders').textContent=rows.filter(x=>['CONFIRMED','IN_PROGRESS'].includes(x.status)).length;
  $('readyOrders').textContent=rows.filter(x=>x.status==='READY').length;
  $('recentOrders').innerHTML=rows.slice(0,8).map(o=>`<a class="order" href="/admin/order.html?id=${encodeURIComponent(o.id)}&mobile=1"><span><b>№${esc(o.order_number||String(o.id).slice(0,8))} · ${esc(customerName(o))}</b><small>${esc(o.model_name||o.source||(o.business_unit==='3D_ARTPRINT'?'3D-заказ':'Печать / услуга'))}</small><em class="status ${statusClass(o.status)}">${esc(statusName[o.status]||o.status||'—')}</em></span><strong>${Number(o.total||0).toLocaleString('ru-RU')} ₽</strong></a>`).join('')||'<div class="empty">Заказов пока нет</div>';
}
async function enterApp(){
  if(!accessToken()){showLogin();return false}
  setHomeNotice('');
  try{
    const data=await bootstrap();
    if(!data){showLogin();return false}
    showApp();renderHome(data);return true;
  }catch(ex){
    if(ex.status===401){clearSession();showLogin('Сессия завершена. Войдите снова.');return false}
    if(ex.status===403){showLogin(friendlyError(ex,'Доступ сотрудника не разрешён.'));return false}
    showLogin(friendlyError(ex,'Не удалось загрузить рабочие данные.'));return false;
  }
}

function paramsFromUrl(rawUrl){
  try{
    const u=new URL(rawUrl);const out=new URLSearchParams(u.search);const hash=new URLSearchParams(String(u.hash||'').replace(/^#/,''));
    hash.forEach((value,key)=>out.set(key,value));return out;
  }catch{return new URLSearchParams()}
}
async function finishOAuth(rawUrl){
  if(oauthFinishing||!rawUrl)return false;
  const params=paramsFromUrl(rawUrl);
  const oauthError=params.get('error_description')||params.get('error');
  const access=params.get('access_token');
  const refresh=params.get('refresh_token');
  const expiresAt=params.get('expires_at');
  const expiresIn=params.get('expires_in');
  if(!oauthError&&!access)return false;
  oauthFinishing=true;
  try{
    if(oauthError)throw new Error(decodeURIComponent(String(oauthError).replace(/\+/g,' ')));
    const user=await supabase('/auth/v1/user',{token:access,timeout:18000});
    saveSession({access_token:access,refresh_token:refresh,expires_at:Number(expiresAt)||undefined,expires_in:Number(expiresIn)||undefined,token_type:'bearer',user});
    try{if(IS_NATIVE)await NativeBrowser.close()}catch{}
    if(location.pathname.includes('/mobile/'))history.replaceState({},'', '/mobile/');
    await enterApp();return true;
  }catch(ex){
    try{if(IS_NATIVE)await NativeBrowser.close()}catch{}
    showLogin(friendlyError(ex,'Не удалось завершить вход.'));return true;
  }finally{oauthFinishing=false}
}
async function initOAuthBridge(){
  await finishOAuth(location.href);
  if(!IS_NATIVE)return;
  try{
    await NativeApp.addListener('appUrlOpen',event=>{if(/^a4printhub:\/\//i.test(event?.url||''))finishOAuth(event.url).catch(ex=>showLogin(friendlyError(ex)))});
    const launch=await NativeApp.getLaunchUrl();
    if(/^a4printhub:\/\//i.test(launch?.url||''))await finishOAuth(launch.url);
  }catch(ex){console.warn('Native OAuth bridge unavailable',ex)}
}

$('loginForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const btn=$('loginButton');setLoginError('');btn.disabled=true;btn.textContent='Входим…';
  try{
    const email=$('email').value.trim().toLowerCase();const password=$('password').value;
    const data=await supabase('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},timeout:22000});
    if(!data?.access_token)throw new Error('Сервер не вернул сессию.');
    saveSession(data);btn.textContent='Открываем A4PRINT HUB…';await enterApp();
  }catch(ex){showLogin(friendlyError(ex,'Не удалось войти.'))}
  finally{btn.disabled=false;btn.textContent='Войти'}
});

for(const b of document.querySelectorAll('[data-provider]')){
  b.addEventListener('click',async()=>{
    setLoginError('');b.disabled=true;
    try{
      const provider=encodeURIComponent(b.dataset.provider||'');
      const url=`${SUPABASE_URL}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(OAUTH_RETURN)}`;
      if(IS_NATIVE)await NativeBrowser.open({url,toolbarColor:'#0f172a'});else location.href=url;
    }catch(ex){showLogin(friendlyError(ex,'Не удалось открыть авторизацию.'));b.disabled=false}
  });
}

$('logout').onclick=()=>{clearSession();showLogin()};
initOAuthBridge().catch(ex=>console.warn('OAuth init failed',ex));
enterApp().catch(ex=>showLogin(friendlyError(ex,'Не удалось открыть приложение.')));
