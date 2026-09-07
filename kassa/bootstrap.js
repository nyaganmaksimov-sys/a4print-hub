(()=>{
  'use strict';
  const VERSION='20260907-stabilityfinal1';
  const $=id=>document.getElementById(id);

  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      const sep=src.includes('?')?'&':'?';
      s.src=`${src}${sep}boot=${VERSION}-${Date.now()}`;
      s.async=false;
      s.onload=()=>resolve();
      s.onerror=()=>reject(new Error(`Не загрузился модуль ${src}`));
      document.head.appendChild(s);
    });
  }

  function loadStyle(src){
    return new Promise((resolve,reject)=>{
      const l=document.createElement('link');
      const sep=src.includes('?')?'&':'?';
      l.rel='stylesheet';l.href=`${src}${sep}boot=${VERSION}-${Date.now()}`;
      l.onload=()=>resolve();l.onerror=()=>reject(new Error(`Не загрузился стиль ${src}`));
      document.head.appendChild(l);
    });
  }

  async function ensureLocalDb(){
    for(let attempt=1;attempt<=2;attempt++){
      if(!window.A4KassaDB){
        try{await loadScript(`./db.js?dbtry=${attempt}`)}catch(error){if(attempt===2)throw error}
      }
      if(window.A4KassaDB){
        try{
          await Promise.race([
            window.A4KassaDB.open(),
            new Promise((_,reject)=>setTimeout(()=>reject(new Error('таймаут открытия IndexedDB')),7000))
          ]);
          return;
        }catch(error){
          console.warn(`A4PRINT KASSA IndexedDB attempt ${attempt}:`,error);
          if(attempt===2)throw new Error(`локальная база кассы недоступна: ${error?.message||error}`);
        }
      }
    }
    throw new Error('локальная база кассы недоступна');
  }

  function showBootError(error){
    const text=String(error?.message||error||'Неизвестная ошибка запуска');
    const err=$('loginError');
    if(err){
      err.innerHTML=`Не удалось запустить кассу: ${text}. <button id="bootRetry" type="button" style="border:0;background:none;color:inherit;text-decoration:underline;font-weight:700;cursor:pointer">Перезапустить</button>`;
      $('bootRetry')?.addEventListener('click',()=>location.replace(`./?repair=${Date.now()}`));
    }
    const submit=$('loginSubmit');
    if(submit){submit.disabled=false;submit.textContent='Перезапустить кассу';submit.type='button';submit.onclick=()=>location.replace(`./?repair=${Date.now()}`)}
    console.error('A4PRINT KASSA bootstrap:',error);
  }

  async function boot(){
    if(!window.A4PRINT_CONFIG)await loadScript('./config.js');
    if(!window.supabase?.createClient)await loadScript('../admin/vendor/supabase.js');
    await ensureLocalDb();
    if(!window.supabase?.createClient)throw new Error('модуль авторизации Supabase недоступен');

    await loadScript('./network-safety.js');
    await loadScript('./shift-session-gate.js');
    await window.A4KassaShiftSession?.ready;
    await loadScript('./app.js');
    await loadScript('./modules.js');
    await loadScript('./ui.js');
    await loadStyle('./shift-layout-fix.css');
    await loadStyle('./sale-finish.css');
    await loadScript('./shift-operator.js');
    await loadScript('./shift-state-sync.js');
    await loadScript('./sale-submit-guard.js');
    await loadScript('./sale-finish.js');
    await loadScript('./return-finish.js');
    await loadScript('./history-hub.js');
    await loadScript('./held-receipts.js');
    await loadScript('./report-source-summary.js');
    await loadScript('./settings-help.js');
    await loadScript('./sale-view-fix.js');
    await loadScript('./startup-shift.js');
    await loadScript('./runtime-stability.js');
    window.__A4_KASSA_BOOT_OK__=true;
  }

  boot().catch(showBootError);
})();
