const config=window.A4PRINT_CONFIG||{};
const SUPABASE_URL=config.supabaseUrl||'https://qgakliolffnwkymoqvzn.supabase.co';
const SUPABASE_PUBLISHABLE_KEY=config.supabasePublishableKey||'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu';
const API_BASE=String(config.apiBaseUrl||'https://a4print-hub-api.onrender.com').replace(/\/$/,'');
const RETURN_KEY='a4print_auth_return_to';

const form=document.getElementById('form');
const submit=document.getElementById('submit');
const error=document.getElementById('error');
const recoveryBox=document.getElementById('recoveryBox');
const recoveryEmail=document.getElementById('recoveryEmail');
const recoveryError=document.getElementById('recoveryError');
const recoverySuccess=document.getElementById('recoverySuccess');
const sendRecovery=document.getElementById('sendRecovery');

function showError(message){error.textContent=message||'Не удалось выполнить вход.';error.style.display='block'}
function hideError(){error.textContent='';error.style.display='none'}
function resetRecoveryMessages(){recoveryError.style.display='none';recoverySuccess.style.display='none';recoveryError.textContent='';recoverySuccess.textContent=''}
function friendlyError(ex,fallback='Не удалось выполнить вход.'){
  const msg=String(ex?.message||ex||'').trim();
  if(!msg)return fallback;
  if(/invalid login credentials|invalid_credentials|неверный email или пароль/i.test(msg))return 'Неверный email или пароль.';
  if(/email not confirmed/i.test(msg))return 'Email ещё не подтверждён.';
  if(/provider.*not enabled|unsupported provider/i.test(msg))return 'Этот способ входа пока не подключён.';
  if(/oauth state not found|state.*expired/i.test(msg))return 'Сессия входа устарела. Нажмите кнопку входа ещё раз.';
  if(/failed to fetch|network|load failed|networkerror|abort|socket|host/i.test(msg))return 'Не удалось связаться с сервером входа. Повторите попытку через несколько секунд.';
  return msg;
}
function providerName(provider){if(provider==='google')return'Google';if(provider==='custom:yandex')return'Яндекс';if(provider==='custom:mailru')return'Mail.ru';return provider}
function validReturn(raw){
  if(!raw)return null;
  try{const u=new URL(raw,location.origin);if(u.origin===location.origin&&(u.pathname.startsWith('/chat/')||u.pathname.startsWith('/mobile/')||u.pathname.startsWith('/admin/')||u.pathname.startsWith('/pos/')))return u.pathname+u.search+u.hash}catch{}
  return null;
}
function safeReturnTo(){
  const q=new URLSearchParams(location.search).get('returnTo');
  if(validReturn(q))return validReturn(q);
  try{return validReturn(localStorage.getItem(RETURN_KEY))}catch{return null}
}
function rememberReturn(rt){try{if(rt)localStorage.setItem(RETURN_KEY,rt)}catch{}}
function clearReturn(){try{localStorage.removeItem(RETURN_KEY)}catch{}}

(async()=>{
  const createClient=window.supabase?.createClient;
  if(!createClient)throw new Error('Локальный модуль авторизации не загрузился. Обновите страницу.');
  const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
    global:{fetch:window.A4SupabaseFetch||fetch},
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  window.__A4_AUTH_CLIENT__=supabase;

  async function routeByProfile(){
    const {data:{session},error:sessionError}=await supabase.auth.getSession();
    if(sessionError)throw sessionError;
    if(!session?.access_token)throw new Error('Сессия входа не создана.');
    const {data,error:profileError}=await supabase.rpc('get_my_staff_profile');
    if(profileError)throw profileError;
    const rt=safeReturnTo();
    const st=data?.status;
    if(st==='ACTIVE'){
      clearReturn();
      if(rt){location.replace(rt);return}
      const roles=new Set((data.roles||[]).map(r=>r.name));
      location.replace(roles.has('POS_OPERATOR')&&roles.size===1?'../pos/index.html':'./index.html');
      return;
    }
    clearReturn();
    if(st==='PENDING'||st==='REJECTED'||st==='DISABLED'){location.replace('./pending.html');return}
    location.replace('./register.html'+(rt?'?returnTo='+encodeURIComponent(rt):''));
  }

  async function startOAuth(provider,button=null){
    hideError();
    const rt=safeReturnTo();if(rt)rememberReturn(rt);
    if(button){button.disabled=true;button.textContent=`Открываем ${providerName(provider)}…`}
    try{
      const redirectTo=new URL('./login.html?oauth=1',location.href).href;
      const {error}=await supabase.auth.signInWithOAuth({provider,options:{redirectTo}});
      if(error)throw error;
    }catch(e){
      if(button){button.disabled=false;button.textContent=provider==='google'?'🔵 Войти через Google':provider==='custom:yandex'?'🟡 Войти через Яндекс':'🔷 Войти через Mail.ru'}
      showError(friendlyError(e,'Не удалось открыть вход через провайдера.'));
    }
  }

  async function signInPassword(email,password){
    let backendError=null;
    if(API_BASE){
      try{
        const response=await fetch(`${API_BASE}/api/v1/mobile/auth/password`,{
          method:'POST',
          headers:{'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({email,password}),
          cache:'no-store',
          credentials:'omit'
        });
        const payload=await response.json().catch(()=>({}));
        if(!response.ok||!payload?.success||!payload?.session?.access_token||!payload?.session?.refresh_token){
          const err=new Error(payload?.message||payload?.error||`Сервер входа вернул ${response.status}`);
          err.status=response.status;
          if(response.status>=400&&response.status<500&&response.status!==408&&response.status!==429)throw err;
          backendError=err;
        }else{
          const {data,error}=await supabase.auth.setSession({
            access_token:payload.session.access_token,
            refresh_token:payload.session.refresh_token
          });
          if(error)throw error;
          if(!data?.session)throw new Error('Сервер не вернул сессию.');
          return data.session;
        }
      }catch(e){
        if(e?.status>=400&&e?.status<500&&e?.status!==408&&e?.status!==429)throw e;
        backendError=e;
      }
    }

    try{
      const {data,error}=await supabase.auth.signInWithPassword({email,password});
      if(error)throw error;
      if(!data?.session)throw new Error('Сервер не вернул сессию.');
      return data.session;
    }catch(directError){
      if(backendError&&/invalid login credentials|неверный email или пароль/i.test(String(backendError?.message||'')))throw backendError;
      throw directError||backendError||new Error('Не удалось выполнить вход.');
    }
  }

  document.getElementById('showRecovery').onclick=()=>{resetRecoveryMessages();recoveryEmail.value=document.getElementById('email').value.trim();recoveryBox.classList.add('open');recoveryEmail.focus()};
  document.getElementById('hideRecovery').onclick=()=>recoveryBox.classList.remove('open');
  sendRecovery.onclick=async()=>{
    resetRecoveryMessages();const emailValue=recoveryEmail.value.trim();
    if(!emailValue){recoveryError.textContent='Введите email.';recoveryError.style.display='block';return}
    sendRecovery.disabled=true;
    try{
      const redirectTo=new URL('./reset-password.html',location.href).href;
      const {error}=await supabase.auth.resetPasswordForEmail(emailValue,{redirectTo});
      if(error)throw error;
      recoverySuccess.textContent='Ссылка отправлена. Откройте письмо и перейдите по ней.';recoverySuccess.style.display='block';
    }catch(e){recoveryError.textContent=friendlyError(e,'Не удалось отправить письмо.');recoveryError.style.display='block'}
    finally{sendRecovery.disabled=false}
  };

  for(const b of document.querySelectorAll('[data-provider]'))b.onclick=()=>startOAuth(String(b.dataset.provider||'').trim(),b);

  form.addEventListener('submit',async event=>{
    event.preventDefault();hideError();submit.disabled=true;submit.textContent='Входим…';
    try{
      const emailValue=document.getElementById('email').value.trim().toLowerCase();
      const password=document.getElementById('password').value;
      await signInPassword(emailValue,password);
      submit.textContent='Проверяем доступ…';
      await routeByProfile();
    }catch(e){showError(friendlyError(e,'Не удалось выполнить вход.'))}
    finally{submit.disabled=false;submit.textContent='Войти'}
  });

  try{window.A4AuthUI?.apply?.('login').catch(()=>{})}catch{}
  const q=new URLSearchParams(location.search);
  const rt=validReturn(q.get('returnTo'));if(rt)rememberReturn(rt);
  const autoProvider=q.get('startProvider');if(autoProvider){startOAuth(autoProvider);return}

  const {data:{session},error:sessionError}=await supabase.auth.getSession();
  if(sessionError)showError(friendlyError(sessionError));
  if(session){
    try{await routeByProfile()}catch(e){showError(friendlyError(e,'Вход выполнен, но не удалось проверить доступ.'))}
  }else if(q.get('oauth')==='1'){
    const hash=new URLSearchParams(String(location.hash||'').replace(/^#/,''));
    const oauthError=hash.get('error_description')||hash.get('error')||q.get('error_description')||q.get('error');
    if(oauthError)showError(friendlyError(decodeURIComponent(String(oauthError).replace(/\+/g,' '))));
  }
})().catch(e=>showError(friendlyError(e,'Не удалось открыть страницу входа.')));