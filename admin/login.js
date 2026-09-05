import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const config=window.A4PRINT_CONFIG||{},SUPABASE_URL=config.supabaseUrl||'https://qgakliolffnwkymoqvzn.supabase.co',SUPABASE_PUBLISHABLE_KEY=config.supabasePublishableKey||'';
const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY),form=document.getElementById('form'),submit=document.getElementById('submit'),error=document.getElementById('error'),recoveryBox=document.getElementById('recoveryBox'),recoveryEmail=document.getElementById('recoveryEmail'),recoveryError=document.getElementById('recoveryError'),recoverySuccess=document.getElementById('recoverySuccess'),sendRecovery=document.getElementById('sendRecovery');
let authSettings=null;
const withTimeout=(promise,ms,message)=>Promise.race([Promise.resolve(promise),new Promise((_,reject)=>setTimeout(()=>reject(new Error(message||'Превышено время ожидания.')),ms))]);
function showError(message){error.textContent=message;error.style.display='block'}function resetRecoveryMessages(){recoveryError.style.display='none';recoverySuccess.style.display='none';recoveryError.textContent='';recoverySuccess.textContent=''}
function providerName(provider){if(provider==='google')return'Google';if(provider==='custom:yandex')return'Яндекс';if(provider==='custom:mailru')return'Mail.ru';return provider}
function safeReturnTo(){const raw=new URLSearchParams(location.search).get('returnTo');if(!raw)return null;try{const u=new URL(raw,location.origin);if(u.origin===location.origin&&(u.pathname.startsWith('/chat/')||u.pathname.startsWith('/mobile/')))return u.pathname+u.search+u.hash}catch{}return null}
async function loadAuthSettings(){if(authSettings)return authSettings;try{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);const r=await fetch(`${SUPABASE_URL}/auth/v1/settings`,{headers:{apikey:SUPABASE_PUBLISHABLE_KEY},signal:controller.signal});clearTimeout(timer);if(!r.ok)return null;authSettings=await r.json();return authSettings}catch{return null}}
function providerEnabled(settings,provider){const ext=settings?.external;if(!ext||typeof ext!=='object')return null;if(Object.prototype.hasOwnProperty.call(ext,provider))return Boolean(ext[provider]);if(provider.startsWith('custom:')){const key=provider.slice(7);if(Object.prototype.hasOwnProperty.call(ext,key))return Boolean(ext[key])}return null}
async function routeChatReturn(rt){
  const{data:{session},error:sErr}=await withTimeout(supabase.auth.getSession(),6000,'Не удалось получить сессию.');if(sErr)throw sErr;if(!session)throw new Error('Сессия не найдена.');
  const{data:u,error:uErr}=await withTimeout(supabase.from('users').select('id,is_active').eq('auth_user_id',session.user.id).maybeSingle(),7000,'Проверка профиля заняла слишком много времени.');if(uErr)throw uErr;
  if(u?.is_active===true){location.replace(rt);return true}
  if(u?.is_active===false){location.replace('./pending.html');return true}
  location.replace('./register.html?returnTo='+encodeURIComponent(rt));return true
}
async function routeByProfile(){const rt=safeReturnTo();if(rt)return routeChatReturn(rt);const{data,error:e}=await supabase.rpc('get_my_staff_profile');if(e)throw e;const st=data?.status;if(st==='ACTIVE'){const roles=new Set((data.roles||[]).map(r=>r.name));location.replace(roles.has('POS_OPERATOR')&&roles.size===1?'../pos/index.html':'./index.html');return}if(st==='PENDING'||st==='REJECTED'){location.replace('./pending.html');return}location.replace('./register.html')}
async function startOAuth(provider,button=null){
  error.style.display='none';if(button)button.disabled=true;
  try{
    if(!SUPABASE_PUBLISHABLE_KEY)throw new Error('Не задан Publishable Key Supabase.');
    const settings=await loadAuthSettings(),enabled=providerEnabled(settings,provider);
    if(enabled===false)throw new Error(`${providerName(provider)} пока не подключён в настройках входа A4PRINT HUB. Используйте вход по email или обратитесь к администратору.`);
    const q=new URLSearchParams({oauth:'1'}),rt=safeReturnTo();if(rt)q.set('returnTo',rt);
    const redirectTo=new URL(`./login.html?${q.toString()}`,location.href).href;
    const{error:e}=await supabase.auth.signInWithOAuth({provider,options:{redirectTo}});if(e)throw e;
  }catch(e){showError(e?.message||'Не удалось открыть авторизацию.');if(button)button.disabled=false;throw e}
}
document.getElementById('showRecovery').onclick=()=>{resetRecoveryMessages();recoveryEmail.value=document.getElementById('email').value.trim();recoveryBox.classList.add('open');recoveryEmail.focus()};document.getElementById('hideRecovery').onclick=()=>recoveryBox.classList.remove('open');sendRecovery.onclick=async()=>{resetRecoveryMessages();const email=recoveryEmail.value.trim();if(!email){recoveryError.textContent='Введите email.';recoveryError.style.display='block';return}sendRecovery.disabled=true;try{const redirectTo=new URL('./reset-password.html',location.href).href;const{error:e}=await supabase.auth.resetPasswordForEmail(email,{redirectTo});if(e)throw e;recoverySuccess.textContent='Ссылка отправлена. Откройте письмо и перейдите по ней.';recoverySuccess.style.display='block'}catch(e){recoveryError.textContent=e?.message||'Не удалось отправить письмо.';recoveryError.style.display='block'}finally{sendRecovery.disabled=false}};
for(const b of document.querySelectorAll('[data-provider]'))b.onclick=()=>startOAuth(b.dataset.provider,b).catch(()=>{});
form.addEventListener('submit',async event=>{event.preventDefault();error.style.display='none';submit.disabled=true;submit.textContent='Входим…';try{await supabase.auth.signOut({scope:'local'}).catch(()=>{});const{error:e}=await supabase.auth.signInWithPassword({email:document.getElementById('email').value.trim(),password:document.getElementById('password').value});if(e)throw e;submit.textContent='Проверяем доступ…';await routeByProfile()}catch(e){showError(e?.message||'Не удалось выполнить вход.')}finally{submit.disabled=false;submit.textContent='Войти'}});
(async()=>{
  const q=new URLSearchParams(location.search),autoProvider=q.get('startProvider');
  if(autoProvider){
    submit.disabled=true;submit.textContent=`Открываем ${providerName(autoProvider)}…`;
    try{await startOAuth(autoProvider)}catch{}finally{if(document.visibilityState==='visible'){submit.disabled=false;submit.textContent='Войти'}}
    return;
  }
  if(q.get('oauth')!=='1'){loadAuthSettings().catch(()=>{});return}
  try{const{data:{session},error:e}=await withTimeout(supabase.auth.getSession(),8000,'Не удалось завершить авторизацию.');if(e)throw e;if(session)await routeByProfile();else throw new Error('Google не вернул сессию. Повторите вход.')}
  catch(e){showError(e?.message||'Не удалось завершить вход.')}
})();
