(()=>{
  'use strict';
  if(window.__A4_KASSA_SETTINGS_HELP__)return;
  window.__A4_KASSA_SETTINGS_HELP__=true;

  const $=id=>document.getElementById(id);
  const DB=window.A4KassaDB;
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  function installStyles(){
    if($('a4SettingsHelpStyle'))return;
    const st=document.createElement('style');st.id='a4SettingsHelpStyle';st.textContent=`
      #utilityDrawer.a4-settings-mode .utility-card,#utilityDrawer.a4-help-mode .utility-card{width:min(760px,calc(100vw - 255px));max-width:none}
      #utilityDrawer.a4-settings-mode .utility-body,#utilityDrawer.a4-help-mode .utility-body{background:#f5f8fa;padding:18px 20px}
      .a4-sh-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.a4-sh-card{background:#fff;border:1px solid #dce5ed;border-radius:12px;padding:14px 16px}.a4-sh-card.wide{grid-column:1/-1}.a4-sh-card h3{margin:0 0 10px;font-size:16px}.a4-sh-card p{margin:0;color:#66758a;line-height:1.5}.a4-sh-list{display:grid;gap:8px}.a4-sh-row{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #edf1f5;padding:7px 0}.a4-sh-row:last-child{border-bottom:0}.a4-sh-row span{color:#758399}.a4-sh-row strong{text-align:right}.a4-sh-ok{color:#067647}.a4-sh-warn{color:#b54708}.a4-sh-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:12px}.a4-sh-btn{border:1px solid #d3dde7;background:#fff;border-radius:9px;padding:10px 13px;font-weight:750;cursor:pointer}.a4-sh-btn.primary{background:#0aaeba;border-color:#0aaeba;color:#fff}.a4-sh-btn:disabled{opacity:.5;cursor:not-allowed}.a4-help-steps{counter-reset:step;display:grid;gap:10px}.a4-help-step{position:relative;background:#fff;border:1px solid #dce5ed;border-radius:12px;padding:14px 16px 14px 54px;min-height:52px}.a4-help-step:before{counter-increment:step;content:counter(step);position:absolute;left:15px;top:13px;width:27px;height:27px;border-radius:50%;display:grid;place-items:center;background:#e1f7f9;color:#087f89;font-weight:900}.a4-help-step b{display:block;margin-bottom:3px}.a4-help-step span{color:#66758a;line-height:1.45}.a4-key{display:inline-block;border:1px solid #ccd6df;border-bottom-width:2px;border-radius:5px;background:#fff;padding:2px 6px;font-weight:800;font-size:12px;color:#344054}
      @media(max-width:900px){#utilityDrawer.a4-settings-mode .utility-card,#utilityDrawer.a4-help-mode .utility-card{width:100vw}.a4-sh-grid{grid-template-columns:1fr}.a4-sh-card.wide{grid-column:auto}}
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
      <section class="a4-sh-card wide"><h3>Синхронизация</h3><p>Безопасно обновляет каталог и отправляет отложенные чеки. Открытая смена и локальная очередь при этом не удаляются.</p><div class="a4-sh-actions"><button id="a4SetSync" class="a4-sh-btn primary">↻ Синхронизировать сейчас</button><button id="a4SetCatalog" class="a4-sh-btn">Обновить каталог</button><button id="a4SetQueue" class="a4-sh-btn" ${st.queue?'':'disabled'}>Открыть отложенные чеки</button></div></section>
      <section class="a4-sh-card wide"><h3>Отображение каталога</h3><div class="a4-sh-actions"><button id="a4SetList" class="a4-sh-btn ${catalogMode==='list'?'primary':''}">☷ Список</button><button id="a4SetGrid" class="a4-sh-btn ${catalogMode==='grid'?'primary':''}">▦ Плитка</button></div></section>
    </div>`;
    $('a4SetSync')?.addEventListener('click',()=>{$('syncNow')?.click();setTimeout(()=>showSettings(),700)});
    $('a4SetCatalog')?.addEventListener('click',()=>{$('refreshCatalog')?.click()});
    $('a4SetQueue')?.addEventListener('click',()=>{$('navHeld')?.click()});
    $('a4SetList')?.addEventListener('click',()=>{$('listView')?.click();setTimeout(()=>showSettings(),120)});
    $('a4SetGrid')?.addEventListener('click',()=>{$('gridView')?.click();setTimeout(()=>showSettings(),120)});
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
