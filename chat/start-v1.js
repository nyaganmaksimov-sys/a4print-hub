(function(){
  const SUPABASE_URL='https://qgakliolffnwkymoqvzn.supabase.co';
  const SUPABASE_KEY='sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu';
  const $=id=>document.getElementById(id);
  let installPrompt=null, authSettings=null;

  function setStatus(text,type=''){
    const el=$('sessionStatus'); if(!el)return;
    el.textContent=text; el.className='start-status'+(type?' '+type:'');
  }
  function showMessage(text,type='info'){
    const el=$('message'); if(!el)return;
    el.textContent=text; el.className=`message ${type}`; el.hidden=false;
  }
  function clearMessage(){const el=$('message');if(el){el.hidden=true;el.textContent='';el.className='message'}}
  function providerName(p){if(p==='google')return'Google';if(p==='custom:yandex')return'Яндекс';if(p==='custom:mailru')return'Mail.ru';return p}
  function isStandalone(){return window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true}
  function openChat(){location.href='/admin/messages.html?app=1&v=pwa4'}
  function timeout(p,ms){return Promise.race([Promise.resolve(p),new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),ms))])}

  if(!$('openChatBtn'))return;
  $('openChatBtn').onclick=openChat;

  if(!window.supabase?.createClient){
    setStatus('Не удалось загрузить модуль входа. Рабочий чат можно открыть напрямую.','warn');
    $('installBtn').onclick=()=>showMessage('В меню браузера выберите «Установить приложение» или «Создать ярлык».','info');
    return;
  }

  const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);

  async function loadAuthSettings(){
    if(authSettings)return authSettings;
    try{
      const c=new AbortController(),t=setTimeout(()=>c.abort(),4500);
      const r=await fetch(`${SUPABASE_URL}/auth/v1/settings`,{headers:{apikey:SUPABASE_KEY},signal:c.signal});
      clearTimeout(t); authSettings=r.ok?await r.json():null;
    }catch{authSettings=null}
    return authSettings;
  }
  function providerEnabled(settings,p){
    const ext=settings?.external;if(!ext||typeof ext!=='object')return null;
    if(Object.prototype.hasOwnProperty.call(ext,p))return !!ext[p];
    if(p.startsWith('custom:')){const k=p.slice(7);if(Object.prototype.hasOwnProperty.call(ext,k))return !!ext[k]}
    return null;
  }
  async function refreshProviders(){
    const settings=await loadAuthSettings();
    document.querySelectorAll('[data-provider]').forEach(btn=>{
      const p=btn.dataset.provider,en=providerEnabled(settings,p);
      if(en===false){btn.disabled=true;btn.title=`${providerName(p)} пока не подключён`;const s=btn.querySelector('span:last-child');if(s)s.textContent=`${providerName(p)} · не подключён`}
    });
  }
  async function checkSession(){
    try{
      const {data,error}=await timeout(sb.auth.getSession(),5000); if(error)throw error;
      const session=data?.session;
      if(!session){setStatus('Войдите в аккаунт сотрудника или установите приложение.');return null}
      setStatus(`✅ Вход выполнен: ${session.user?.email||'сотрудник'}. Чат можно открыть сразу.`,'ok');
      if(isStandalone()||new URLSearchParams(location.search).get('installed')==='1')setTimeout(openChat,120);
      // Профиль проверяем только фоном: он никогда не блокирует экран.
      timeout(sb.from('users').select('full_name,is_active').eq('auth_user_id',session.user.id).maybeSingle(),6000)
        .then(({data:user,error})=>{
          if(error)return;
          if(user?.is_active===false)setStatus('⛔ Учётная запись сотрудника отключена. Обратитесь к администратору HUB.','error');
          else if(user?.is_active===true&&user.full_name)setStatus(`✅ ${user.full_name} — вход выполнен. Чат готов к работе.`,'ok');
        }).catch(()=>{});
      return session;
    }catch{
      setStatus('⚠️ Проверка сохранённого входа задержалась. Чат всё равно можно открыть напрямую.','warn');
      return null;
    }
  }

  document.querySelectorAll('[data-provider]').forEach(btn=>btn.addEventListener('click',async()=>{
    clearMessage(); const provider=btn.dataset.provider; btn.disabled=true;
    try{
      const settings=await loadAuthSettings(),en=providerEnabled(settings,provider);
      if(en===false)throw new Error(`${providerName(provider)} пока не подключён. Используйте другой способ входа.`);
      const redirect=new URL('/admin/login.html',location.origin);
      redirect.searchParams.set('oauth','1');redirect.searchParams.set('returnTo','/chat/start.html?auth=1');
      const {error}=await sb.auth.signInWithOAuth({provider,options:{redirectTo:redirect.href}});if(error)throw error;
    }catch(e){showMessage(e?.message||'Не удалось открыть авторизацию.','error');btn.disabled=false}
  }));

  $('loginForm').addEventListener('submit',async e=>{
    e.preventDefault();clearMessage();const email=$('email').value.trim().toLowerCase(),password=$('password').value;
    if(!email||!password)return showMessage('Введите email и пароль.','error');
    $('loginBtn').disabled=true;$('loginBtn').textContent='Входим…';
    try{
      const {error}=await timeout(sb.auth.signInWithPassword({email,password}),10000);if(error)throw error;
      setStatus('✅ Вход выполнен. Открываем чат…','ok');setTimeout(openChat,120);
    }catch(e){showMessage(e?.message==='timeout'?'Сервер входа не ответил вовремя. Попробуйте ещё раз.':(e?.message||'Не удалось выполнить вход.'),'error')}
    finally{$('loginBtn').disabled=false;$('loginBtn').textContent='Войти в A4PRINT Chat'}
  });

  $('togglePassword').onclick=()=>{const i=$('password'),show=i.type==='password';i.type=show?'text':'password';$('togglePassword').textContent=show?'🙈':'👁'};
  $('forgotBtn').onclick=()=>{$('recoverBox').hidden=false;$('recoverEmail').value=$('email').value.trim();$('recoverEmail').focus()};
  $('cancelRecovery').onclick=()=>{$('recoverBox').hidden=true};
  $('sendRecovery').onclick=async()=>{
    clearMessage();const email=$('recoverEmail').value.trim().toLowerCase();if(!email)return showMessage('Введите email.','error');
    $('sendRecovery').disabled=true;
    try{const {error}=await timeout(sb.auth.resetPasswordForEmail(email,{redirectTo:new URL('/admin/reset-password.html',location.origin).href}),10000);if(error)throw error;showMessage('Ссылка для смены пароля отправлена на почту.','success');$('recoverBox').hidden=true}
    catch(e){showMessage(e?.message||'Не удалось отправить ссылку.','error')}finally{$('sendRecovery').disabled=false}
  };

  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e});
  $('installBtn').onclick=async()=>{
    if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;return}
    if(/iphone|ipad|ipod/i.test(navigator.userAgent)){$('iosInstall').hidden=false;return}
    showMessage('В браузере нажмите значок установки справа в адресной строке или меню ⋮ → «Установить A4PRINT HUB Chat».','info');
  };
  $('closeIosInstall').onclick=()=>{$('iosInstall').hidden=true};
  window.addEventListener('appinstalled',()=>showMessage('A4PRINT HUB Chat установлен.','success'));

  if('serviceWorker' in navigator)navigator.serviceWorker.register('/a4print-chat-sw-v3.js',{scope:'/'}).then(r=>r.update()).catch(()=>{});
  refreshProviders().catch(()=>{});
  checkSession();
})();