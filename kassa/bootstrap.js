(()=>{
  'use strict';
  const VERSION='20260910-kassa-boot-fastfail3';
  const $=id=>document.getElementById(id);
  const MOBILE=matchMedia('(max-width:980px)').matches;
  const ASSET_TIMEOUT=7000;

  if(MOBILE){
    document.documentElement.classList.add('kassa-mobile-booting');
    const s=document.createElement('style');
    s.id='kassa-mobile-boot-cloak';
    s.textContent='@media(max-width:980px){html.kassa-mobile-booting #appView:not([hidden]){visibility:hidden!important}html.kassa-mobile-booting body:after{content:"Загрузка кассы…";position:fixed;inset:0;display:grid;place-items:center;background:#f5f7fb;color:#334155;font:700 15px system-ui;z-index:9999}}';
    document.head.appendChild(s);
  }

  function loadScript(src,timeout=ASSET_TIMEOUT){
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      const sep=src.includes('?')?'&':'?';
      const timer=setTimeout(()=>{s.remove();reject(new Error(`таймаут загрузки ${src}`))},timeout);
      s.src=`${src}${sep}boot=${VERSION}-${Date.now()}`;
      s.async=false;
      s.onload=()=>{clearTimeout(timer);resolve()};
      s.onerror=()=>{clearTimeout(timer);reject(new Error(`не загрузился модуль ${src}`))};
      document.head.appendChild(s);
    });
  }

  function loadStyle(src,timeout=ASSET_TIMEOUT){
    return new Promise((resolve,reject)=>{
      const l=document.createElement('link');
      const sep=src.includes('?')?'&':'?';
      const timer=setTimeout(()=>{l.remove();reject(new Error(`таймаут загрузки стиля ${src}`))},timeout);
      l.rel='stylesheet';l.href=`${src}${sep}boot=${VERSION}-${Date.now()}`;
      l.onload=()=>{clearTimeout(timer);resolve()};
      l.onerror=()=>{clearTimeout(timer);reject(new Error(`не загрузился стиль ${src}`))};
      document.head.appendChild(l);
    });
  }

  const soft=async(fn,label)=>{try{return await fn()}catch(error){console.warn(`A4PRINT KASSA optional ${label}:`,error);return null}};
  const withTimeout=(promise,ms,label)=>Promise.race([Promise.resolve(promise),new Promise((_,reject)=>setTimeout(()=>reject(new Error(`таймаут ${label}`)),ms))]);

  async function ensureLocalDb(){
    for(let attempt=1;attempt<=2;attempt++){
      if(!window.A4KassaDB){
        try{await loadScript(`./db.js?dbtry=${attempt}`)}catch(error){if(attempt===2)throw error}
      }
      if(window.A4KassaDB){
        try{await withTimeout(window.A4KassaDB.open(),6000,'открытия локальной базы');return}
        catch(error){console.warn(`A4PRINT KASSA IndexedDB attempt ${attempt}:`,error);if(attempt===2)throw new Error(`локальная база кассы недоступна: ${error?.message||error}`)}
      }
    }
    throw new Error('локальная база кассы недоступна');
  }

  function releaseBootCloak(){
    window.__A4_KASSA_BOOT_OK__=true;
    requestAnimationFrame(()=>{
      document.documentElement.classList.remove('kassa-mobile-booting');
      document.getElementById('kassa-mobile-boot-cloak')?.remove();
    });
  }

  function showBootError(error){
    document.documentElement.classList.remove('kassa-mobile-booting');
    document.getElementById('kassa-mobile-boot-cloak')?.remove();
    const text=String(error?.message||error||'Неизвестная ошибка запуска');
    const err=$('loginError');
    if(err){
      err.style.display='block';
      err.innerHTML=`Не удалось запустить кассу: ${text}. <button id="bootRetry" type="button" style="border:0;background:none;color:inherit;text-decoration:underline;font-weight:700;cursor:pointer">Перезапустить</button>`;
      $('bootRetry')?.addEventListener('click',()=>location.replace(`./?repair=${Date.now()}`));
    }
    const submit=$('loginSubmit');
    if(submit){submit.disabled=false;submit.textContent='Перезапустить кассу';submit.type='button';submit.onclick=()=>location.replace(`./?repair=${Date.now()}`)}
    console.error('A4PRINT KASSA bootstrap:',error);
  }

  async function loadOptionalModules(){
    const styles=['./shift-layout-fix.css','./sale-finish.css','./shift-profile.css','./shift-compact.css','./mobile-responsive.css','./mobile-ui.css','./mobile-ui-state.css','./shift-mobile-action-fix.css','./shift-mobile-v2.css','./order-bridge.css'];
    await Promise.allSettled(styles.map(src=>loadStyle(src,5000)));
    const scripts=['./catalog-quick-add.js','./shift-operator.js','./shift-state-sync.js','./shift-profile.js','./shift-profile-compact.js','./cash-operations.js','./sale-submit-guard.js','./sale-finish.js','./return-finish.js','./history-hub.js','./held-receipts.js','./report-source-summary.js','./settings-help.js','./sale-view-fix.js','./order-bridge.js','./customer-directory.js','./startup-shift.js','./runtime-stability.js','./mobile-ui.js','./shift-mobile-action-fix.js','./shift-mobile-v2.js'];
    for(const src of scripts)await soft(()=>loadScript(src,5000),src);
  }

  async function boot(){
    await loadScript('./config.js');
    if(!window.supabase?.createClient)await loadScript('../admin/vendor/supabase.js');
    await ensureLocalDb();
    if(!window.supabase?.createClient)throw new Error('модуль авторизации Supabase недоступен');

    await soft(()=>loadScript('./network-safety.js',5000),'network-safety');
    await loadScript('./shift-session-gate.js');
    if(window.A4KassaShiftSession?.ready)await soft(()=>withTimeout(window.A4KassaShiftSession.ready,2500,'восстановления смены'),'shift-session-ready');
    await soft(()=>loadScript('./shift-mobile-resilience.js',5000),'shift-mobile-resilience');
    await soft(()=>loadScript('./sync-throttle.js',5000),'sync-throttle');

    // Critical core only. The cashier UI becomes usable before secondary modules finish loading.
    await loadScript('./app.js');
    await loadScript('./modules.js');
    await loadScript('./ui.js');
    releaseBootCloak();

    setTimeout(()=>{loadOptionalModules().catch(error=>console.warn('A4PRINT KASSA background modules:',error))},0);
  }

  boot().catch(showBootError);
})();
