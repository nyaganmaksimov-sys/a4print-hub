(()=>{
  'use strict';
  const VERSION='20260905-shiftlive1';
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
    if(!window.A4KassaDB)await loadScript('./db.js');
    if(!window.supabase?.createClient)throw new Error('модуль авторизации Supabase недоступен');
    if(!window.A4KassaDB)throw new Error('локальная база кассы недоступна');

    await loadScript('./app.js');
    await loadScript('./modules.js');
    await loadScript('./ui.js');
    await loadScript('./shift-operator.js');
    await loadScript('./shift-live.js');
    window.__A4_KASSA_BOOT_OK__=true;
  }

  boot().catch(showBootError);
})();
