const SUPABASE_URL='https://qgakliolffnwkymoqvzn.supabase.co';
const SUPABASE_KEY='sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu';
const SUPABASE_STORAGE_KEY='sb-qgakliolffnwkymoqvzn-auth-token';
const OAUTH_RETURN='https://a4print-hub.ru/mobile/';
const ACCESS_KEY='a4print_mobile_access';
const REFRESH_KEY='a4print_mobile_refresh';
const EXPIRES_KEY='a4print_mobile_expires';
const OAUTH_TARGET_KEY='a4print_oauth_return_target';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const statusName={NEW:'Новый',CONFIRMED:'Подтверждён',IN_PROGRESS:'В работе',READY:'Готов',COMPLETED:'Завершён',ON_HOLD:'Пауза',CANCELLED:'Отменён'};
let oauthFinishing=false;
let booting=false;

function setLoginError(message=''){
  const el=$('loginError');if(!el)return;el.textContent=message;el.classList.toggle('show',!!message);
}
function showLogin(message=''){$('loginView')?.classList.remove('hidden');$('appView')?.classList.add('hidden');setLoginError(message)}
function showApp(){$('loginView')?.classList.add('hidden');$('appView')?.classList.remove('hidden');setLoginError('')}
function setHomeNotice(message=''){const n=$('homeNotice');if(!n)return;n.textContent=message;n.classList.toggle('show',!!message)}
function statusClass(s){return s==='READY'?'ready':s==='NEW'?'new':['CONFIRMED','IN_PROGRESS'].includes(s)?'work':''}
function customerName(o){const c=o.customers||{};return c.full_name||c.company_name||'Клиент не указан'}
function friendlyError(ex,fallback='Не удалось выполнить операцию.'){
  const msg=String(ex?.message||ex||'').trim();if(!msg)return fallback;
  if(/invalid login credentials|invalid_credentials|неверный email/i.test(msg))return 'Неверный email или пароль.';
  if(/email not confirmed/i.test(msg))return 'Email ещё не подтверждён.';
  if(/provider.*not enabled|unsupported provider/i.test(msg))return 'Этот способ входа пока не подключён к A4PRINT HUB.';
  if(/failed to fetch|network|load failed|networkerror|abort|socket|host/i.test(msg))return 'Не удалось связаться с A4PRINT HUB. Проверьте интернет и повторите попытку.';
  if(/timeout|timed out|время ожидания|слишком долго/i.test(msg))return 'Соединение устанавливается слишком долго. Повторите попытку.';
  return msg;
}

function storedSession(){try{return JSON.parse(localStorage.getItem(SUPABASE_STORAGE_KEY)||'null')||{}}catch{return {}}}
function saveSession(session){
  if(!session?.access_token)return;
  const normalized={...storedSession(),...session};
  if(!normalized.expires_at&&normalized.expires_in)normalized.expires_at=Math.floor(Date.now()/1000)+Number(normalized.expires_in||0);
  localStorage.setItem(ACCESS_KEY,normalized.access_token);
  if(normalized.refresh_token)localStorage.setItem(REFRESH_KEY,normalized.refresh_token);
  if(normalized.expires_at)localStorage.setItem(EXPIRES_KEY,String(normalized.expires_at));
  localStorage.setItem(SUPABASE_STORAGE_KEY,JSON.stringify(normalized));
}
function clearSession(){[ACCESS_KEY,REFRESH_KEY,EXPIRES_KEY,SUPABASE_STORAGE_KEY].forEach(k=>localStorage.removeItem(k))}
function accessToken(){return localStorage.getItem(ACCESS_KEY)||storedSession()?.access_token||''}
function refreshToken(){return localStorage.getItem(REFRESH_KEY)||storedSession()?.refresh_token||''}

async function request(url,{method='GET',body,token,timeout=22000}={}){
  const headers={Accept:'application/json',apikey:SUPABASE_KEY,Authorization:`Bearer ${token||SUPABASE_KEY}`};
  if(body!==undefined)headers['Content-Type']='application/json';
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const r=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
    const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={message:text}}
    if(!r.ok){const e=new Error(data?.msg||data?.message||data?.error_description||data?.error||`HTTP ${r.status}`);e.status=r.status;e.code=data?.error;throw e}
    return data;
  }catch(e){if(e?.name==='AbortError'){const t=new Error('Время ожидания ответа истекло.');t.status=408;throw t}throw e}
  finally{clearTimeout(timer)}
}
function sb(path,opt={}){return request(SUPABASE_URL+path,opt)}

async function refreshSession(){
  const refresh=refreshToken();if(!refresh)return false;
  try{const data=await sb('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:refresh},timeout:18000});if(!data?.access_token)return false;saveSession(data);return true}catch{return false}
}
async function ensureValidSession(){
  const s=storedSession();
  const exp=Number(s.expires_at||localStorage.getItem(EXPIRES_KEY)||0);
  if(exp&&exp-Math.floor(Date.now()/1000)<90)return refreshSession();
  return !!accessToken();
}
async function directBootstrap(){
  if(!await ensureValidSession())return null;
  const token=accessToken();
  const user=await sb('/auth/v1/user',{token,timeout:16000});
  saveSession({...storedSession(),user});
  const [profileRows,orders]=await Promise.all([
    sb(`/rest/v1/users?select=id,auth_user_id,full_name,email,phone,is_active,created_at&auth_user_id=eq.${encodeURIComponent(user.id)}&limit=1`,{token,timeout:18000}),
    sb('/rest/v1/orders?select=id,order_number,status,total,model_name,source,business_unit,created_at,customers(full_name,company_name)&order=created_at.desc&limit=100',{token,timeout:18000})
  ]);
  const profile=Array.isArray(profileRows)?profileRows[0]:null;
  if(!profile){const e=new Error('Профиль сотрудника не найден.');e.status=403;throw e}
  if(profile.is_active===false){const e=new Error('Учётная запись сотрудника отключена.');e.status=403;throw e}
  return {success:true,profile,orders:Array.isArray(orders)?orders:[]};
}
async function bootstrap(){
  try{return await directBootstrap()}
  catch(ex){if(ex.status===401&&await refreshSession())return directBootstrap();throw ex}
}

function safeReturnTarget(value){
  if(!value)return '';
  try{const u=new URL(value,location.origin);if(u.origin!==location.origin)return '';if(!u.pathname.startsWith('/admin/')&&!u.pathname.startsWith('/mobile/'))return '';return u.pathname+u.search+u.hash}catch{return ''}
}
function requestedReturn(){return safeReturnTarget(new URLSearchParams(location.search).get('return')||sessionStorage.getItem(OAUTH_TARGET_KEY)||'')}
function maybeContinue(){
  const target=requestedReturn();
  if(target&&target!=='/mobile/'&&!target.startsWith('/mobile/?')){sessionStorage.removeItem(OAUTH_TARGET_KEY);location.replace(target);return true}
  return false;
}

function renderHome(data){
  const profile=data?.profile||{};const rows=data?.orders||[];
  $('hello').textContent=profile.full_name?`Привет, ${profile.full_name.split(/\s+/)[0]}`:'Главная';
  $('newOrders').textContent=rows.filter(x=>x.status==='NEW').length;
  $('workOrders').textContent=rows.filter(x=>['CONFIRMED','IN_PROGRESS'].includes(x.status)).length;
  $('readyOrders').textContent=rows.filter(x=>x.status==='READY').length;
  $('recentOrders').innerHTML=rows.slice(0,8).map(o=>`<a class="order" href="/admin/order.html?id=${encodeURIComponent(o.id)}&mobile=1"><span><b>№${esc(o.order_number||String(o.id).slice(0,8))} · ${esc(customerName(o))}</b><small>${esc(o.model_name||o.source||(o.business_unit==='3D_ARTPRINT'?'3D-заказ':'Печать / услуга'))}</small><em class="status ${statusClass(o.status)}">${esc(statusName[o.status]||o.status||'—')}</em></span><strong>${Number(o.total||0).toLocaleString('ru-RU')} ₽</strong></a>`).join('')||'<div class="empty">Заказов пока нет</div>';
}
async function enterApp(){
  if(booting)return false;booting=true;
  try{
    if(!accessToken()){showLogin();return false}
    setHomeNotice('');
    const data=await bootstrap();if(!data){showLogin();return false}
    showApp();renderHome(data);if(maybeContinue())return true;return true;
  }catch(ex){
    if(ex.status===401){clearSession();showLogin('Сессия завершена. Войдите снова.');return false}
    if(ex.status===403){showLogin(friendlyError(ex,'Доступ сотрудника не разрешён.'));return false}
    showLogin(friendlyError(ex,'Не удалось загрузить рабочие данные.'));return false;
  }finally{booting=false}
}

function oauthParams(){
  const out=new URLSearchParams(location.search);const hash=new URLSearchParams(String(location.hash||'').replace(/^#/,''));hash.forEach((v,k)=>out.set(k,v));return out;
}
async function finishOAuth(){
  if(oauthFinishing)return false;const p=oauthParams();const oauthError=p.get('error_description')||p.get('error');const access=p.get('access_token');
  if(!oauthError&&!access)return false;oauthFinishing=true;
  try{
    if(oauthError)throw new Error(decodeURIComponent(String(oauthError).replace(/\+/g,' ')));
    const user=await sb('/auth/v1/user',{token:access,timeout:16000});
    saveSession({access_token:access,refresh_token:p.get('refresh_token')||'',expires_at:Number(p.get('expires_at'))||undefined,expires_in:Number(p.get('expires_in'))||undefined,token_type:'bearer',user});
    history.replaceState({},'', '/mobile/');
    await enterApp();return true;
  }catch(ex){showLogin(friendlyError(ex,'Не удалось завершить вход.'));return true}
  finally{oauthFinishing=false}
}

$('loginForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const btn=$('loginButton');setLoginError('');btn.disabled=true;btn.textContent='Входим…';
  try{
    const email=$('email').value.trim().toLowerCase();const password=$('password').value;
    const data=await sb('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},timeout:20000});
    if(!data?.access_token)throw new Error('Сервер не вернул сессию.');
    saveSession(data);btn.textContent='Открываем A4PRINT HUB…';await enterApp();
  }catch(ex){showLogin(friendlyError(ex,'Не удалось войти.'))}
  finally{btn.disabled=false;btn.textContent='Войти'}
});

for(const b of document.querySelectorAll('[data-provider]')){
  b.addEventListener('click',()=>{
    setLoginError('');
    const target=safeReturnTarget(new URLSearchParams(location.search).get('return')||'');if(target)sessionStorage.setItem(OAUTH_TARGET_KEY,target);
    const provider=encodeURIComponent(b.dataset.provider||'');
    location.assign(`${SUPABASE_URL}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(OAUTH_RETURN)}`);
  });
}

$('logout').onclick=()=>{clearSession();sessionStorage.removeItem(OAUTH_TARGET_KEY);showLogin()};

(async()=>{
  const handled=await finishOAuth();if(!handled)await enterApp();
})().catch(ex=>showLogin(friendlyError(ex,'Не удалось открыть приложение.')));
