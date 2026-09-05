const config=window.A4PRINT_CONFIG||{};
const SUPABASE_URL=config.supabaseUrl||'https://qgakliolffnwkymoqvzn.supabase.co';
const SUPABASE_PUBLISHABLE_KEY=config.supabasePublishableKey||'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu';
const STORAGE_KEY='sb-qgakliolffnwkymoqvzn-auth-token';
const ACCESS_KEY='a4print_mobile_access';
const REFRESH_KEY='a4print_mobile_refresh';
const EXPIRES_KEY='a4print_mobile_expires';
const RETURN_KEY='a4print_auth_return_to';

const form=document.getElementById('form');
const submit=document.getElementById('submit');
const error=document.getElementById('error');
const recoveryBox=document.getElementById('recoveryBox');
const recoveryEmail=document.getElementById('recoveryEmail');
const recoveryError=document.getElementById('recoveryError');
const recoverySuccess=document.getElementById('recoverySuccess');
const sendRecovery=document.getElementById('sendRecovery');

function showError(message){
  error.textContent=message||'Не удалось выполнить вход.';
  error.style.display='block';
}
function hideError(){error.textContent='';error.style.display='none'}
function resetRecoveryMessages(){
  recoveryError.style.display='none';recoverySuccess.style.display='none';
  recoveryError.textContent='';recoverySuccess.textContent='';
}
function friendlyError(ex,fallback='Не удалось выполнить вход.'){
  const msg=String(ex?.message||ex||'').trim();
  if(!msg)return fallback;
  if(/invalid login credentials|invalid_credentials/i.test(msg))return 'Неверный email или пароль.';
  if(/email not confirmed/i.test(msg))return 'Email ещё не подтверждён.';
  if(/provider.*not enabled|unsupported provider/i.test(msg))return 'Этот способ входа пока не подключён.';
  if(/failed to fetch|network|load failed|networkerror|abort|socket|host/i.test(msg))return 'Не удалось связаться с сервером входа. Проверьте интернет и повторите попытку.';
  if(/timeout|timed out|время ожидания/i.test(msg))return 'Сервер входа отвечает слишком долго. Повторите попытку.';
  return msg;
}
function providerName(provider){
  if(provider==='google')return'Google';
  if(provider==='custom:yandex')return'Яндекс';
  if(provider==='custom:mailru')return'Mail.ru';
  return provider;
}
function validReturn(raw){
  if(!raw)return null;
  try{
    const u=new URL(raw,location.origin);
    if(u.origin===location.origin&&(u.pathname.startsWith('/chat/')||u.pathname.startsWith('/mobile/')||u.pathname.startsWith('/admin/')||u.pathname.startsWith('/pos/')))
      return u.pathname+u.search+u.hash;
  }catch{}
  return null;
}
function safeReturnTo(){
  const q=new URLSearchParams(location.search).get('returnTo');
  if(validReturn(q))return validReturn(q);
  try{return validReturn(localStorage.getItem(RETURN_KEY))}catch{return null}
}
function rememberReturn(rt){try{if(rt)localStorage.setItem(RETURN_KEY,rt)}catch{}}
function clearReturn(){try{localStorage.removeItem(RETURN_KEY)}catch{}}

async function request(path,{method='GET',body,token,timeout=18000}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  const headers={Accept:'application/json',apikey:SUPABASE_PUBLISHABLE_KEY};
  if(token)headers.Authorization=`Bearer ${token}`;
  if(body!==undefined)headers['Content-Type']='application/json';
  try{
    const r=await fetch(SUPABASE_URL+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
    const text=await r.text();
    let data={};
    try{data=text?JSON.parse(text):{}}catch{data={message:text}}
    if(!r.ok){
      const e=new Error(data?.msg||data?.message||data?.error_description||data?.error||`HTTP ${r.status}`);
      e.status=r.status;e.code=data?.error;
      throw e;
    }
    return data;
  }catch(e){
    if(e?.name==='AbortError')throw new Error('Время ожидания ответа истекло.');
    throw e;
  }finally{clearTimeout(timer)}
}

function storedSession(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')||{}}catch{return {}}}
function saveSession(session){
  if(!session?.access_token)return;
  const normalized={...storedSession(),...session};
  if(!normalized.expires_at&&normalized.expires_in)normalized.expires_at=Math.floor(Date.now()/1000)+Number(normalized.expires_in||0);
  try{
    localStorage.setItem(STORAGE_KEY,JSON.stringify(normalized));
    localStorage.setItem(ACCESS_KEY,normalized.access_token);
    if(normalized.refresh_token)localStorage.setItem(REFRESH_KEY,normalized.refresh_token);
    if(normalized.expires_at)localStorage.setItem(EXPIRES_KEY,String(normalized.expires_at));
  }catch{}
}
function clearLocalSession(){
  try{[STORAGE_KEY,ACCESS_KEY,REFRESH_KEY,EXPIRES_KEY].forEach(k=>localStorage.removeItem(k))}catch{}
}

async function routeByProfile(token){
  const rt=safeReturnTo();
  const data=await request('/rest/v1/rpc/get_my_staff_profile',{method:'POST',body:{},token,timeout:12000});
  const st=data?.status;
  if(st==='ACTIVE'){
    clearReturn();
    if(rt){location.replace(rt);return}
    const roles=new Set((data.roles||[]).map(r=>r.name));
    location.replace(roles.has('POS_OPERATOR')&&roles.size===1?'../pos/index.html':'./index.html');
    return;
  }
  if(st==='PENDING'||st==='REJECTED'){
    clearReturn();location.replace('./pending.html');return;
  }
  location.replace('./register.html'+(rt?'?returnTo='+encodeURIComponent(rt):''));
}

function oauthUrl(provider){
  const q=new URLSearchParams({oauth:'1'});
  const rt=safeReturnTo();
  if(rt){q.set('returnTo',rt);rememberReturn(rt)}
  const redirectTo=new URL(`./login.html?${q.toString()}`,location.href).href;
  const u=new URL('/auth/v1/authorize',SUPABASE_URL);
  u.searchParams.set('provider',provider);
  u.searchParams.set('redirect_to',redirectTo);
  return u.href;
}
function startOAuth(provider,button=null){
  hideError();
  if(!SUPABASE_PUBLISHABLE_KEY){showError('Не задан Publishable Key Supabase.');return}
  if(button){button.disabled=true;button.textContent=`Открываем ${providerName(provider)}…`}
  location.assign(oauthUrl(provider));
}

function oauthParams(){
  const out=new URLSearchParams(location.search);
  const hash=new URLSearchParams(String(location.hash||'').replace(/^#/,''));
  hash.forEach((v,k)=>out.set(k,v));
  return out;
}
async function finishOAuth(){
  const p=oauthParams();
  if(p.get('oauth')!=='1'&&!p.get('access_token')&&!p.get('error'))return false;
  const oauthError=p.get('error_description')||p.get('error');
  if(oauthError){showError(decodeURIComponent(String(oauthError).replace(/\+/g,' ')));return true}
  const access=p.get('access_token');
  if(!access){
    // Пока провайдер не вернул callback, не показываем ложную ошибку.
    // Если URL уже callback без токена, сообщаем понятную причину.
    if(p.get('oauth')==='1'&&document.referrer.includes('accounts.google.'))showError('Google не вернул сессию. Повторите вход.');
    return p.get('oauth')==='1';
  }
  try{
    const user=await request('/auth/v1/user',{token:access,timeout:12000});
    saveSession({
      access_token:access,
      refresh_token:p.get('refresh_token')||'',
      expires_at:Number(p.get('expires_at'))||undefined,
      expires_in:Number(p.get('expires_in'))||undefined,
      token_type:p.get('token_type')||'bearer',
      user
    });
    const clean=new URL(location.href);
    clean.hash='';clean.searchParams.delete('oauth');
    history.replaceState({},'',clean.pathname+clean.search);
    await routeByProfile(access);
  }catch(e){showError(friendlyError(e,'Не удалось завершить вход через Google.'))}
  return true;
}

document.getElementById('showRecovery').onclick=()=>{
  resetRecoveryMessages();
  recoveryEmail.value=document.getElementById('email').value.trim();
  recoveryBox.classList.add('open');
  recoveryEmail.focus();
};
document.getElementById('hideRecovery').onclick=()=>recoveryBox.classList.remove('open');
sendRecovery.onclick=async()=>{
  resetRecoveryMessages();
  const emailValue=recoveryEmail.value.trim();
  if(!emailValue){recoveryError.textContent='Введите email.';recoveryError.style.display='block';return}
  sendRecovery.disabled=true;
  try{
    const redirectTo=new URL('./reset-password.html',location.href).href;
    await request('/auth/v1/recover?redirect_to='+encodeURIComponent(redirectTo),{method:'POST',body:{email:emailValue},timeout:18000});
    recoverySuccess.textContent='Ссылка отправлена. Откройте письмо и перейдите по ней.';
    recoverySuccess.style.display='block';
  }catch(e){
    recoveryError.textContent=friendlyError(e,'Не удалось отправить письмо.');
    recoveryError.style.display='block';
  }finally{sendRecovery.disabled=false}
};

for(const b of document.querySelectorAll('[data-provider]')){
  b.onclick=()=>startOAuth(String(b.dataset.provider||'').trim(),b);
}

form.addEventListener('submit',async event=>{
  event.preventDefault();
  hideError();
  submit.disabled=true;submit.textContent='Входим…';
  try{
    clearLocalSession();
    const emailValue=document.getElementById('email').value.trim().toLowerCase();
    const password=document.getElementById('password').value;
    const session=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:emailValue,password},timeout:20000});
    if(!session?.access_token)throw new Error('Сервер не вернул сессию.');
    saveSession(session);
    submit.textContent='Проверяем доступ…';
    await routeByProfile(session.access_token);
  }catch(e){showError(friendlyError(e,'Не удалось выполнить вход.'))}
  finally{submit.disabled=false;submit.textContent='Войти'}
});

(async()=>{
  try{window.A4AuthUI?.apply?.('login').catch(()=>{})}catch{}
  const q=new URLSearchParams(location.search);
  const rt=validReturn(q.get('returnTo'));if(rt)rememberReturn(rt);
  const autoProvider=q.get('startProvider');
  if(autoProvider){startOAuth(autoProvider);return}
  await finishOAuth();
})().catch(e=>showError(friendlyError(e,'Не удалось открыть страницу входа.')));
