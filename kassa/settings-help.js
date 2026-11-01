(()=>{
  'use strict';
  if(window.__A4_KASSA_SETTINGS_HELP__)return;
  window.__A4_KASSA_SETTINGS_HELP__=true;

  const $=id=>document.getElementById(id);
  const DB=window.A4KassaDB;
  const cfg=window.A4PRINT_CONFIG||{};
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const createClient=window.supabase?.createClient;
  const authClient=createClient?createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{global:{fetch:window.A4SupabaseFetch||fetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}):null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';

  function installStyles(){
    if($('a4SettingsHelpStyle'))return;
    const st=document.createElement('style');st.id='a4SettingsHelpStyle';st.textContent=`
      #utilityDrawer.a4-settings-mode .utility-card,#utilityDrawer.a4-help-mode .utility-card{width:min(760px,calc(100vw - 255px));max-width:none}
      #utilityDrawer.a4-settings-mode .utility-body,#utilityDrawer.a4-help-mode .utility-body{background:#f5f8fa;padding:18px 20px}
      .a4-sh-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.a4-sh-card{background:#fff;border:1px solid #dce5ed;border-radius:12px;padding:14px 16px}.a4-sh-card.wide{grid-column:1/-1}.a4-sh-card h3{margin:0 0 10px;font-size:16px}.a4-sh-card p{margin:0;color:#66758a;line-height:1.5}.a4-sh-list{display:grid;gap:8px}.a4-sh-row{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #edf1f5;padding:7px 0}.a4-sh-row:last-child{border-bottom:0}.a4-sh-row span{color:#758399}.a4-sh-row strong{text-align:right}.a4-sh-ok{color:#067647}.a4-sh-warn{color:#b54708}.a4-sh-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:12px}.a4-sh-btn{border:1px solid #d3dde7;background:#fff;border-radius:9px;padding:10px 13px;font-weight:750;cursor:pointer}.a4-sh-btn.primary{background:#0aaeba;border-color:#0aaeba;color:#fff}.a4-sh-btn:disabled{opacity:.5;cursor:not-allowed}.a4-help-steps{counter-reset:step;display:grid;gap:10px}.a4-help-step{position:relative;background:#fff;border:1px solid #dce5ed;border-radius:12px;padding:14px 16px 14px 54px;min-height:52px}.a4-help-step:before{counter-increment:step;content:counter(step);position:absolute;left:15px;top:13px;width:27px;height:27px;border-radius:50%;display:grid;place-items:center;background:#e1f7f9;color:#087f89;font-weight:900}.a4-help-step b{display:block;margin-bottom:3px}.a4-help-step span{color:#66758a;line-height:1.45}.a4-key{display:inline-block;border:1px solid #ccd6df;border-bottom-width:2px;border-radius:5px;background:#fff;padding:2px 6px;font-weight:800;font-size:12px;color:#344054}
      .a4-staff-card{display:grid;gap:10px;background:#fff;border:1px solid #dce5ed;border-radius:12px;padding:13px}.a4-staff-fields{display:grid;grid-template-columns:1.2fr 1fr;gap:8px}.a4-staff-fields input{min-width:0;width:100%;box-sizing:border-box;border:1px solid #cbd7e3;border-radius:8px;padding:9px;font:inherit}.a4-staff-actions{display:flex;gap:7px;flex-wrap:wrap}.a4-staff-status{font-size:12px;color:#66758a}.a4-staff-status.off{color:#b54708}.a4-staff-list{display:grid;gap:9px;margin-top:12px}
      .a4-cash-setup{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,.75fr);gap:16px;align-items:start}.a4-cash-now{font-size:30px;font-weight:900;color:#10213a;margin:5px 0}.a4-cash-note{font-size:12px;color:#758399;line-height:1.4}.a4-cash-form{display:flex;gap:8px;align-items:end}.a4-cash-form label{flex:1;font-size:12px;color:#66758a;font-weight:700}.a4-cash-form input{display:block;width:100%;box-sizing:border-box;margin-top:5px;border:1px solid #cbd7e3;border-radius:9px;padding:10px 11px;font:inherit;background:#fff}.a4-cash-msg{margin-top:8px;font-size:12px;min-height:17px}.a4-cash-msg.error{color:#c62828}.a4-cash-msg.ok{color:#067647}
      @media(max-width:900px){.a4-staff-fields{grid-template-columns:1fr}#utilityDrawer.a4-settings-mode .utility-card,#utilityDrawer.a4-help-mode .utility-card{width:100vw}.a4-sh-grid{grid-template-columns:1fr}.a4-sh-card.wide{grid-column:auto}.a4-cash-setup{grid-template-columns:1fr}}
    `;document.head.appendChild(st)
  }

  function openDrawer(mode,title,subtitle){
    installStyles();
    const drawer=$('utilityDrawer');if(!drawer)return false;
    drawer.classList.remove('a4-history-mode','a4-held-mode','a4-settings-mode','a4-help-mode');
    drawer.classList.add(mode==='settings'?'a4-settings-mode':'a4-help-mode');
    $('utilityTitle').textContent=title;$('utilitySubtitle').textContent=subtitle;
    drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');
    document.querySelectorAll('.main-nav .nav-item').forEach(x=>x.classList.remove('active'));
    $(mode==='settings'?'navSettings':'navHelp')?.classList.add('active');
    document.getElementById('appView')?.classList.remove('nav-open');
    return true;
  }

  async function localStatus(){
    const result={db:false,catalog:0,queue:0,receipts:0,shift:null};
    if(!DB)return result;
    try{await DB.open();result.db=true}catch{return result}
    const [catalog,queue,receipts,shift]=await Promise.all([
      DB.getAll('catalog').catch(()=>[]),DB.getAll('queue').catch(()=>[]),DB.getAll('receipts').catch(()=>[]),DB.getMeta('shift',null).catch(()=>null)
    ]);
    result.catalog=catalog.length;result.queue=queue.length;result.receipts=receipts.length;result.shift=shift;return result;
  }

  function networkText(){
    const text=$('networkChip')?.textContent?.trim()||'';
    if(!navigator.onLine)return 'Нет интернета';
    return /онлайн|готов|сеть/i.test(text)?'Сервер доступен':(text||'Интернет доступен');
  }

  async function apiFetch(path,options={},retry=true){
    if(!authClient||!API)throw new Error('API кассы недоступен');
    let session=(await authClient.auth.getSession()).data?.session;
    if(!session)throw new Error('Сессия завершена. Войдите снова.');
    const run=async()=>{
      const response=await fetch(`${API}${path}`,{...options,cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,Accept:'application/json',...(options.headers||{})}});
      if(response.status===401&&retry){
        const refreshed=await authClient.auth.refreshSession();
        if(refreshed.data?.session){session=refreshed.data.session;return apiFetch(path,options,false)}
      }
      const data=await response.json().catch(()=>({}));
      return{response,data};
    };
    return run();
  }

  async function renderCashSetup(){
    const card=$('a4CashSetup');if(!card)return;
    card.innerHTML='<h3>Наличные в кассе</h3><p>Получаю состояние денежного ящика…</p>';
    let data={};
    try{({data}=await apiFetch(`/api/v1/pos/cash-balance?settings=${Date.now()}`))}catch(error){
      card.innerHTML=`<h3>Наличные в кассе</h3><p class="a4-sh-warn">${esc(error?.message||error)}</p>`;return;
    }
    const available=Boolean(data?.available)&&Number.isFinite(Number(data?.cash));
    const baseline=data?.baseline||null;
    const source=String(data?.source||'');
    const sourceText=source==='MOYSKLAD_LEDGER'?'МойСклад · пересчёт по кассовым операциям':source==='MANUAL_BASELINE'?'Контрольный остаток':'Требуется контрольный остаток';
    card.innerHTML=`<h3>Наличные в кассе</h3><div class="a4-cash-setup"><div><div class="a4-cash-now">${available?money(data.cash):'—'}</div><div class="a4-cash-note">${esc(sourceText)}${baseline?.at?`<br>Контрольная точка: ${new Date(baseline.at).toLocaleString('ru-RU')}`:''}<br>После фиксации сумма автоматически меняется по наличным продажам, возвратам, внесениям и изъятиям МойСклад.</div></div><div><div class="a4-cash-form"><label>Фактически лежит в кассе<input id="a4CashBaselineAmount" inputmode="decimal" placeholder="0,00"></label><button id="a4CashBaselineSave" class="a4-sh-btn primary" type="button">${available?'Перефиксировать':'Зафиксировать'}</button></div><div id="a4CashBaselineMsg" class="a4-cash-msg ${data?.requires_baseline?'error':''}">${data?.requires_baseline?'Введите текущую сумму наличных один раз. Дальше касса будет считать автоматически.':''}</div></div></div>`;
    const btn=$('a4CashBaselineSave');
    btn?.addEventListener('click',async()=>{
      const input=$('a4CashBaselineAmount');const msg=$('a4CashBaselineMsg');
      const amount=Number(String(input?.value||'').replace(/\s/g,'').replace(',','.'));
      msg.className='a4-cash-msg';msg.textContent='';
      if(!Number.isFinite(amount)||amount<0){msg.classList.add('error');msg.textContent='Введите фактическую сумму наличных в кассе.';return}
      btn.disabled=true;btn.textContent='Сохраняю…';
      try{
        const out=await apiFetch('/api/v1/pos/cash-balance/baseline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount})});
        if(!out.response.ok)throw new Error(out.data?.message||out.data?.error||`HTTP ${out.response.status}`);
        msg.classList.add('ok');msg.textContent=`Контрольный остаток ${money(amount)} сохранён.`;
        window.dispatchEvent(new CustomEvent('a4:kassa-cash-balance',{detail:{cash:amount,available:true,data:out.data}}));
        setTimeout(()=>renderCashSetup(),650);
      }catch(error){msg.classList.add('error');msg.textContent=String(error?.message||error);btn.disabled=false;btn.textContent=available?'Перефиксировать':'Зафиксировать'}
    });
  }

  async function showSettings(event){
    if(event){event.preventDefault();event.stopImmediatePropagation()}
    if(!openDrawer('settings','Настройки кассы','Рабочее место A4PRINT KASSA 2.1'))return;
    const body=$('utilityBody');body.innerHTML='<div class="a4-sh-card">Проверяю состояние кассы…</div>';
    const st=await localStatus();
    const operator=$('operatorSelect')?.selectedOptions?.[0]?.textContent?.trim()||$('uiCashierName')?.textContent?.trim()||'—';
    const catalogMode=localStorage.getItem('a4_kassa_catalog_mode')||($('gridView')?.classList.contains('active')?'grid':'list');
    const shift=st.shift;
    body.innerHTML=`<div class="a4-sh-grid">
      <section class="a4-sh-card"><h3>Состояние рабочего места</h3><div class="a4-sh-list">
        <div class="a4-sh-row"><span>Интернет / API</span><strong class="${navigator.onLine?'a4-sh-ok':'a4-sh-warn'}">${esc(networkText())}</strong></div>
        <div class="a4-sh-row"><span>Локальная база</span><strong class="${st.db?'a4-sh-ok':'a4-sh-warn'}">${st.db?'Работает':'Недоступна'}</strong></div>
        <div class="a4-sh-row"><span>Оператор</span><strong>${esc(operator)}</strong></div>
        <div class="a4-sh-row"><span>Смена</span><strong>${shift?.name?esc(shift.name):'Не открыта'}</strong></div>
      </div></section>
      <section class="a4-sh-card"><h3>Локальные данные</h3><div class="a4-sh-list">
        <div class="a4-sh-row"><span>Каталог</span><strong>${st.catalog.toLocaleString('ru-RU')} позиций</strong></div>
        <div class="a4-sh-row"><span>Очередь чеков</span><strong class="${st.queue?'a4-sh-warn':'a4-sh-ok'}">${st.queue}</strong></div>
        <div class="a4-sh-row"><span>Локальная история</span><strong>${st.receipts}</strong></div>
        <div class="a4-sh-row"><span>Вид каталога</span><strong>${catalogMode==='grid'?'Плитка':'Список'}</strong></div>
      </div></section>
      <section id="a4CashSetup" class="a4-sh-card wide"><h3>Наличные в кассе</h3><p>Получаю состояние денежного ящика…</p></section>
      <section class="a4-sh-card wide"><h3>Обновления программы</h3><p id="a4UpdaterStatus">Проверяю установленную версию…</p><div class="a4-sh-actions"><button id="a4UpdaterCheck" class="a4-sh-btn primary" type="button">Проверить обновления</button><button id="a4UpdaterDownload" class="a4-sh-btn" type="button" hidden>Скачать обновление</button><button id="a4UpdaterInstall" class="a4-sh-btn" type="button" hidden>Перезапустить и установить</button></div><p id="a4UpdaterChanges"></p></section>
      ${window.A4KassaCurrentStaff?.isAdmin?'<section class="a4-sh-card wide"><h3>Сотрудники</h3><p>Добавление, блокировка и смена PIN-кодов. Управление доступно только администратору.</p><div class="a4-sh-actions"><button id="a4ManageStaff" class="a4-sh-btn primary" type="button">Управление сотрудниками</button></div></section>':''}
      <section class="a4-sh-card wide"><h3>Синхронизация</h3><p>Безопасно обновляет каталог и отправляет отложенные чеки. Открытая смена и локальная очередь при этом не удаляются.</p><div class="a4-sh-actions"><button id="a4SetSync" class="a4-sh-btn primary">↻ Синхронизировать сейчас</button><button id="a4SetCatalog" class="a4-sh-btn">Обновить каталог</button><button id="a4SetQueue" class="a4-sh-btn" ${st.queue?'':'disabled'}>Открыть отложенные чеки</button></div></section>
      <section class="a4-sh-card wide"><h3>Отображение каталога</h3><div class="a4-sh-actions"><button id="a4SetList" class="a4-sh-btn ${catalogMode==='list'?'primary':''}">☷ Список</button><button id="a4SetGrid" class="a4-sh-btn ${catalogMode==='grid'?'primary':''}">▦ Плитка</button></div></section>
    </div>`;
    const updater=window.A4KassaDesktop?.updater;
    const updaterStatus=$('a4UpdaterStatus');
    const updaterCheck=$('a4UpdaterCheck');
    const updaterDownload=$('a4UpdaterDownload');
    const updaterInstall=$('a4UpdaterInstall');
    function paintUpdater(st={}){
      if(!updaterStatus?.isConnected)return;
      const current=st.currentVersion||window.A4KassaDesktop?.version||'не определена';
      updaterStatus.textContent='Установлена версия '+current+'. '+(st.message||'');
      updaterDownload.hidden=st.status!=='available';
      updaterInstall.hidden=st.status!=='downloaded';
      const notes=st.releaseNotes||st.whatsNew;
      $('a4UpdaterChanges').textContent=notes?.changes?.length?'Изменения: '+notes.changes.join('; '):'';
    }
    if(!updater){
      updaterStatus.textContent='Проверка обновлений доступна в установленном Windows-приложении. В веб-версии она недоступна.';
      updaterCheck.disabled=true;
    }else{
      updater.state().then(paintUpdater).catch(e=>{updaterStatus.textContent='Ошибка получения версии: '+String(e?.message||e)});
      updaterCheck.addEventListener('click',()=>{updaterStatus.textContent='Проверяю обновления…';updater.check().then(paintUpdater).catch(e=>{updaterStatus.textContent=String(e?.message||e)})});
      updaterDownload.addEventListener('click',()=>{updater.download().then(paintUpdater).catch(e=>{updaterStatus.textContent=String(e?.message||e)})});
      updaterInstall.addEventListener('click',()=>updater.install());
    }
    $('a4ManageStaff')?.addEventListener('click',()=>renderStaffManagement());
    $('a4SetSync')?.addEventListener('click',()=>{$('syncNow')?.click();setTimeout(()=>showSettings(),700)});
    $('a4SetCatalog')?.addEventListener('click',()=>{$('refreshCatalog')?.click()});
    $('a4SetQueue')?.addEventListener('click',()=>{$('navSyncQueue')?.click()});
    $('a4SetList')?.addEventListener('click',()=>{$('listView')?.click();setTimeout(()=>showSettings(),120)});
    $('a4SetGrid')?.addEventListener('click',()=>{$('gridView')?.click();setTimeout(()=>showSettings(),120)});
    renderCashSetup().catch(()=>{});
  }

  async function renderStaffManagement(){
    const body=$('utilityBody');
    body.innerHTML='<div class="a4-sh-card">Загружаю сотрудников…</div>';
    try{
      const out=await apiFetch('/api/v1/pos/staff');
      if(!out.response.ok)throw new Error(out.data?.message||out.data?.error||'Не удалось загрузить сотрудников');
      const staff=out.data.staff||[];
      body.innerHTML=`<div class="a4-sh-grid">
        <section class="a4-sh-card wide"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><div><h3>Управление сотрудниками</h3><p>PIN-код от 4 до 8 цифр. Новые сотрудники получают обычный доступ кассира.</p></div><button id="a4StaffBack" class="a4-sh-btn" type="button">← Назад</button></div></section>
        <section class="a4-sh-card wide"><h3>Добавить сотрудника</h3><div class="a4-staff-fields"><input id="a4NewStaffName" placeholder="ФИО сотрудника"><input id="a4NewStaffPosition" placeholder="Должность (необязательно)"><input id="a4NewStaffPin" type="password" inputmode="numeric" maxlength="8" placeholder="PIN-код 4–8 цифр"></div><div class="a4-sh-actions"><button id="a4CreateStaff" class="a4-sh-btn primary" type="button">Добавить сотрудника</button></div><div id="a4StaffCreateMessage" class="a4-staff-status"></div></section>
        <section class="a4-sh-card wide"><h3>Список сотрудников</h3><div class="a4-staff-list">${staff.map(row=>`<article class="a4-staff-card" data-staff-card="${esc(row.id)}">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><b>${esc(row.full_name)}</b><span class="a4-staff-status ${row.is_active?'':'off'}">${row.is_active?'Активен':'В архиве'}</span></div>
          <div class="a4-staff-fields"><input data-staff-name value="${esc(row.full_name)}" aria-label="ФИО"><input data-staff-position value="${esc(row.position||'')}" placeholder="Должность" aria-label="Должность"></div>
          <div class="a4-staff-fields"><input data-staff-pin type="password" inputmode="numeric" maxlength="8" placeholder="${row.pin_enabled?'Новый PIN (необязательно)':'PIN не назначен'}"><div class="a4-staff-status">${row.pin_enabled?'PIN настроен':'Нужно назначить PIN'} · ${row.roles?.includes('ADMIN')?'Администратор':'Кассир'}</div></div>
          <div class="a4-staff-actions"><button class="a4-sh-btn primary" data-staff-save type="button">Сохранить</button><button class="a4-sh-btn" data-staff-toggle type="button">${row.is_active?'Архивировать':'Восстановить'}</button></div>
          <div class="a4-staff-status" data-staff-message></div>
        </article>`).join('')||'<p>Сотрудников пока нет.</p>'}</div></section>
      </div>`;
      $('a4StaffBack')?.addEventListener('click',()=>showSettings());
      $('a4CreateStaff')?.addEventListener('click',async()=>{
        const name=$('a4NewStaffName').value.trim(),position=$('a4NewStaffPosition').value.trim(),pin=$('a4NewStaffPin').value;
        const msg=$('a4StaffCreateMessage');msg.textContent='';
        if(!name||!/^\d{4,8}$/.test(pin)){msg.className='a4-staff-status off';msg.textContent='Укажите ФИО и PIN из 4–8 цифр.';return}
        const btn=$('a4CreateStaff');btn.disabled=true;
        try{
          const result=await apiFetch('/api/v1/pos/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({full_name:name,position,pin})});
          if(!result.response.ok)throw new Error(result.data?.message||result.data?.error||'Не удалось добавить сотрудника');
          notify('Сотрудник добавлен');
          await renderStaffManagement();
        }catch(error){msg.className='a4-staff-status off';msg.textContent=String(error?.message||error);btn.disabled=false}
      });
      document.querySelectorAll('[data-staff-card]').forEach(card=>{
        const id=card.dataset.staffCard;
        card.querySelector('[data-staff-save]')?.addEventListener('click',async()=>{
          const msg=card.querySelector('[data-staff-message]'),btn=card.querySelector('[data-staff-save]');
          msg.textContent='Сохраняю…';btn.disabled=true;
          try{
            const pin=card.querySelector('[data-staff-pin]').value;
            const payload={full_name:card.querySelector('[data-staff-name]').value.trim(),position:card.querySelector('[data-staff-position]').value.trim()};
            if(!payload.full_name)throw new Error('Укажите ФИО.');
            const updated=await apiFetch('/api/v1/pos/staff/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
            if(!updated.response.ok)throw new Error(updated.data?.message||updated.data?.error||'Не удалось сохранить сотрудника');
            if(pin){
              if(!/^\d{4,8}$/.test(pin))throw new Error('PIN должен содержать 4–8 цифр.');
              const changed=await apiFetch('/api/v1/pos/staff/'+encodeURIComponent(id)+'/pin',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});
              if(!changed.response.ok)throw new Error(changed.data?.message||changed.data?.error||'Не удалось изменить PIN');
            }
            notify('Данные сотрудника сохранены');await renderStaffManagement();
          }catch(error){msg.className='a4-staff-status off';msg.textContent=String(error?.message||error);btn.disabled=false}
        });
        card.querySelector('[data-staff-toggle]')?.addEventListener('click',async()=>{
          const button=card.querySelector('[data-staff-toggle]'),archiving=button.textContent.trim()==='Архивировать';
          if(archiving&&!confirm('Переместить сотрудника в архив? Старые чеки и история сохранятся.'))return;
          button.disabled=true;
          try{
            const result=await apiFetch('/api/v1/pos/staff/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_active:!archiving})});
            if(!result.response.ok)throw new Error(result.data?.message||result.data?.error||'Не удалось изменить статус');
            notify(archiving?'Сотрудник перемещён в архив':'Сотрудник восстановлен');await renderStaffManagement();
          }catch(error){card.querySelector('[data-staff-message]').textContent=String(error?.message||error);button.disabled=false}
        });
      });
    }catch(error){body.innerHTML=`<section class="a4-sh-card wide"><h3>Управление сотрудниками</h3><p class="a4-sh-warn">${esc(error?.message||error)}</p><button id="a4StaffBack" class="a4-sh-btn" type="button">← Назад</button></section>`;$('a4StaffBack')?.addEventListener('click',()=>showSettings())}
  }

  function showHelp(event){
    if(event){event.preventDefault();event.stopImmediatePropagation()}
    if(!openDrawer('help','Помощь','Краткая инструкция кассира'))return;
    $('utilityBody').innerHTML=`<div class="a4-sh-grid">
      <section class="a4-sh-card wide"><h3>Рабочий цикл</h3><div class="a4-help-steps">
        <div class="a4-help-step"><b>Откройте смену</b><span>После входа перейдите в «Смена», выберите оператора и нажмите «Открыть смену».</span></div>
        <div class="a4-help-step"><b>Соберите чек</b><span>Перейдите в «Продажа», найдите товар по названию, коду или штрихкоду и добавьте его в чек.</span></div>
        <div class="a4-help-step"><b>Выберите оплату</b><span>Наличные, Карта или СБП. При необходимости выберите покупателя.</span></div>
        <div class="a4-help-step"><b>Проведите продажу</b><span>Нажмите «Оплатить». После проведения можно напечатать чек или начать новую продажу.</span></div>
        <div class="a4-help-step"><b>Закройте смену</b><span>В конце работы откройте «Смена», проверьте итоговые суммы и закройте смену.</span></div>
      </div></section>
      <section class="a4-sh-card"><h3>Горячие клавиши</h3><p><span class="a4-key">F2</span> — поиск товара<br><span class="a4-key">Enter</span> — добавить точное совпадение<br><span class="a4-key">F8</span> — провести чек<br><span class="a4-key">Esc</span> — закрыть окно</p></section>
      <section class="a4-sh-card"><h3>Если пропал интернет</h3><p>Продажа сохраняется на этом компьютере и попадает в «Отложенные чеки». После восстановления связи касса отправит её автоматически. Не очищайте данные браузера, пока очередь не станет пустой.</p></section>
      <section class="a4-sh-card"><h3>Возвраты</h3><p>Откройте «Возвраты», найдите исходный чек, выберите позиции и причину. Возврат создаётся в МойСклад и сохраняется в A4PRINT HUB.</p></section>
      <section class="a4-sh-card"><h3>История и отчёты</h3><p>«История» показывает синхронизированные чеки HUB и импорт из МойСклад. «Отчёты» считают продажи и возвраты за выбранный период.</p></section>
    </div>`;
  }

  document.addEventListener('click',event=>{
    if(event.target?.closest?.('#navSettings'))showSettings(event);
    else if(event.target?.closest?.('#navHelp'))showHelp(event);
    else if(event.target?.closest?.('#navHistory,#navHeld'))$('utilityDrawer')?.classList.remove('a4-settings-mode','a4-help-mode');
  },true);
})();
