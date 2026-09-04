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

  const ua=navigator.userAgent||'';
  const isIOS=/iphone|ipad|ipod/i.test(ua);
  const isAndroid=/android/i.test(ua);
  const isSamsung=/SamsungBrowser/i.test(ua);
  const isOpera=/OPR\//i.test(ua)||/Opera/i.test(ua);
  const isYandex=/YaBrowser/i.test(ua);
  const isMobile=isIOS||isAndroid||/Mobile/i.test(ua);

  function setInstallButtonLabel(){
    const btn=$('installBtn'); if(!btn)return;
    btn.textContent=isMobile?'➕ Добавить на экран':'⬇ Установить на компьютер';
  }

  function step(num,title,text){
    return `<li class="install-step"><span class="install-step-num">${num}</span><div><b>${title}</b><span>${text}</span></div></li>`;
  }

  function showInstallHelp(){
    const sheet=$('installSheet'),device=$('installDevice'),steps=$('installSteps'),note=$('installNote');
    if(!sheet||!steps)return;
    let html='';
    if(isIOS){
      device.textContent='iPhone / iPad';
      html+=step(1,'Откройте меню «Поделиться»','Нажмите значок □↑ внизу или вверху браузера.');
      html+=step(2,'Выберите «На экран Домой»','Если пункта не видно — прокрутите список действий ниже.');
      html+=step(3,'Нажмите «Добавить»','На главном экране появится отдельная иконка A4 Chat.');
      note.innerHTML='На iPhone установка выполняется через меню <b>«Поделиться»</b>. Это стандартный способ добавления веб-приложения.';
    }else if(isAndroid&&isSamsung){
      device.textContent='Android · Samsung Internet';
      html+=step(1,'Откройте меню браузера','Нажмите кнопку ≡ внизу браузера.');
      html+=step(2,'Выберите «Добавить страницу в»','Затем выберите <b>«Главный экран»</b>.');
      html+=step(3,'Подтвердите добавление','На экране телефона появится иконка A4 Chat.');
      note.innerHTML='Если появится пункт <b>«Установить приложение»</b>, можно выбрать его — результат будет тот же.';
    }else if(isAndroid&&isYandex){
      device.textContent='Android · Яндекс Браузер';
      html+=step(1,'Откройте меню браузера','Нажмите кнопку меню ⋮ или ≡.');
      html+=step(2,'Найдите «Добавить на главный экран»','Название может быть «Создать ярлык» или «Установить приложение».');
      html+=step(3,'Подтвердите','Иконка A4 Chat появится на экране телефона.');
      note.innerHTML='Если автоматическое окно установки не появилось, используйте пункт меню <b>«Добавить на главный экран»</b>.';
    }else if(isAndroid&&isOpera){
      device.textContent='Android · Opera';
      html+=step(1,'Откройте меню Opera','Нажмите ⋮ или значок профиля/меню.');
      html+=step(2,'Выберите «Добавить на главный экран»','Иногда пункт называется <b>«Установить приложение»</b>.');
      html+=step(3,'Подтвердите','A4 Chat появится среди приложений/на главном экране.');
      note.innerHTML='После добавления A4 Chat будет запускаться отдельным окном, почти как обычное приложение.';
    }else if(isAndroid){
      device.textContent='Android · Chrome / Chromium';
      html+=step(1,'Откройте меню браузера','Нажмите ⋮ справа вверху.');
      html+=step(2,'Выберите «Добавить на главный экран»','Или пункт <b>«Установить приложение»</b>, если он есть.');
      html+=step(3,'Нажмите «Установить» / «Добавить»','После этого появится иконка A4 Chat.');
      note.innerHTML='Если браузер предлагает <b>«Установить A4PRINT HUB Chat»</b>, выбирайте этот вариант.';
    }else{
      device.textContent='Компьютер';
      html+=step(1,'Откройте меню браузера','Нажмите ⋮ справа вверху или значок установки в адресной строке.');
      html+=step(2,'Выберите «Установить приложение»','В Chrome/Edge пункт может называться «Установить A4PRINT HUB Chat».');
      html+=step(3,'Подтвердите установку','A4 Chat появится как отдельное приложение.');
      note.innerHTML='После установки можно закрепить A4 Chat на панели задач или рабочем столе.';
    }
    steps.innerHTML=html;
    sheet.hidden=false;
    document.body.style.overflow='hidden';
  }

  function hideInstallHelp(){
    const sheet=$('installSheet'); if(sheet)sheet.hidden=true;
    document.body.style.overflow='';
  }

  if(!$('openChatBtn'))return;
  $('openChatBtn').onclick=openChat;
  setInstallButtonLabel();
  if($('installSheetClose'))$('installSheetClose').onclick=hideInstallHelp;
  if($('installSheetOk'))$('installSheetOk').onclick=hideInstallHelp;
  if($('installSheet'))$('installSheet').addEventListener('click',e=>{if(e.target===$('installSheet'))hideInstallHelp()});

  if(!window.supabase?.createClient){
    setStatus('Не удалось загрузить модуль входа. Рабочий чат можно открыть напрямую.','warn');
    $('installBtn').onclick=showInstallHelp;
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
      if(!session){setStatus('Войдите в аккаунт сотрудника или добавьте A4 Chat на экран.');return null}
      setStatus(`✅ Вход выполнен: ${session.user?.email||'сотрудник'}. Чат можно открыть сразу.`,'ok');
      if(isStandalone()||new URLSearchParams(location.search).get('installed')==='1')setTimeout(openChat,120);
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

  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();
    installPrompt=e;
    setInstallButtonLabel();
  });

  $('installBtn').onclick=async()=>{
    if(isStandalone()){
      showMessage('A4 Chat уже добавлен и запущен как приложение.','success');
      return;
    }
    if(installPrompt){
      try{
        installPrompt.prompt();
        const choice=await installPrompt.userChoice;
        if(choice?.outcome==='accepted')showMessage('A4 Chat добавляется на устройство…','success');
        else showInstallHelp();
      }catch{showInstallHelp()}
      installPrompt=null;
      return;
    }
    showInstallHelp();
  };

  window.addEventListener('appinstalled',()=>{
    showMessage('✅ A4PRINT HUB Chat добавлен на устройство. Ищите иконку A4 Chat на главном экране.','success');
    setStatus('✅ Приложение установлено. Можно открыть чат.','ok');
  });

  if('serviceWorker' in navigator)navigator.serviceWorker.register('/a4print-chat-sw-v3.js',{scope:'/'}).then(r=>r.update()).catch(()=>{});
  refreshProviders().catch(()=>{});
  checkSession();
})();