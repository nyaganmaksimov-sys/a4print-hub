(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const DB=window.A4KassaDB;
  const cfg=window.A4PRINT_CONFIG||{};
  const createClient=window.supabase?.createClient;
  const shiftSupabase=createClient?createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
    global:{fetch:window.A4SupabaseFetch||fetch},
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  }):null;
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const dt=v=>v?new Date(v).toLocaleString('ru-RU'):'—';
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
  let shiftRefreshTimer=null;

  function toast(text,error=false){const n=$('toast');if(!n)return;n.textContent=text;n.className='toast show'+(error?' error':'');clearTimeout(toast.t);toast.t=setTimeout(()=>n.className='toast',3000)}

  function toggleMenu(){
    if(matchMedia('(max-width:980px)').matches){$('appView')?.classList.toggle('nav-open');return}
    document.body.classList.toggle('nav-collapsed');
  }
  function closeMobileMenu(){if(matchMedia('(max-width:980px)').matches)$('appView')?.classList.remove('nav-open')}

  function setCatalogMode(mode){
    const grid=$('catalogGrid');if(!grid)return;
    grid.classList.toggle('list-mode',mode==='list');grid.classList.toggle('grid-mode',mode==='grid');
    $('listView')?.classList.toggle('active',mode==='list');$('gridView')?.classList.toggle('active',mode==='grid');
    try{localStorage.setItem('a4_kassa_catalog_mode',mode)}catch{}
  }

  function syncCashierLabel(){
    const select=$('operatorSelect'),label=$('uiCashierName');if(!select||!label)return;
    const text=select.selectedOptions?.[0]?.textContent?.replace(' · вы','').trim();
    if(text)label.textContent=text;
  }
  function syncFooterShift(){const src=$('shiftInfo'),dst=$('footerShift');if(src&&dst)dst.textContent=src.textContent||'Смена'}
  function markSyncNow(){const e=$('uiSyncTime');if(e)e.textContent='сегодня, '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}

  function openUtility(title,subtitle,html){$('utilityTitle').textContent=title;$('utilitySubtitle').textContent=subtitle||'A4PRINT KASSA';$('utilityBody').innerHTML=html;$('utilityDrawer').classList.add('open');$('utilityDrawer').setAttribute('aria-hidden','false')}
  function closeUtility(){$('utilityDrawer').classList.remove('open');$('utilityDrawer').setAttribute('aria-hidden','true')}

  async function showHistory(){
    openUtility('История чеков','Локально сохранённые продажи','<div class="utility-section"><p>Загрузка истории…</p></div>');
    try{
      const rows=DB?await DB.getAll('receipts'):[];rows.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
      $('utilityBody').innerHTML=`<div class="utility-section"><h3>Последние продажи</h3><p>Здесь показаны чеки, которые эта касса уже синхронизировала.</p></div>${rows.slice(0,100).map(x=>`<div class="utility-section"><div style="display:flex;justify-content:space-between;gap:12px"><b>${esc(x.backend_result?.moysklad?.name||'Чек')}</b><strong>${money(x.total)}</strong></div><p>${dt(x.created_at)} · ${esc(x.operator_name||'Оператор')} · ${esc(x.payment_method||'')}</p></div>`).join('')||'<div class="utility-section"><p>Локальная история пока пуста. Серверные продажи доступны в разделе «Отчёты».</p></div>'}`;
    }catch(e){$('utilityBody').innerHTML='<div class="utility-section"><p>Не удалось открыть локальную историю.</p></div>'}
  }

  async function showHeld(){
    openUtility('Отложенные чеки','Локальная очередь кассы','<div class="utility-section"><p>Загрузка…</p></div>');
    try{
      const rows=DB?await DB.getAll('queue'):[];rows.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
      $('utilityBody').innerHTML=`<div class="utility-section"><h3>${rows.length?'Чеки ожидают отправки':'Нет отложенных чеков'}</h3><p>${rows.length?'Эти чеки сохранены на компьютере и будут отправлены автоматически, когда сервер станет доступен.':'Все продажи синхронизированы.'}</p></div>${rows.map(x=>`<div class="utility-section"><div style="display:flex;justify-content:space-between;gap:12px"><b>${dt(x.created_at)}</b><strong>${money(x.total)}</strong></div><p>${esc(x.operator_name||'Оператор')} · ${esc(x.payment_method||'')} ${x.last_error?'· '+esc(x.last_error):''}</p></div>`).join('')}`;
    }catch(e){$('utilityBody').innerHTML='<div class="utility-section"><p>Не удалось прочитать очередь.</p></div>'}
  }

  function showSettings(){
    openUtility('Настройки кассы','Рабочее место A4PRINT',`<div class="utility-section"><h3>Данные</h3><p>Каталог и продажи синхронизируются с A4PRINT HUB и МойСклад.</p><button id="utilRefresh" class="utility-action" type="button">↻ Обновить каталог</button><button id="utilSync" class="utility-action" type="button">↻ Синхронизировать сейчас</button></div><div class="utility-section"><h3>Режим каталога</h3><button id="utilList" class="utility-action" type="button">☷ Список</button><button id="utilGrid" class="utility-action" type="button">▦ Плитка</button></div><div class="utility-section"><h3>Старая касса</h3><button id="utilOld" class="utility-action" type="button">Открыть /pos/</button></div>`);
    $('utilRefresh').onclick=()=>{$('refreshCatalog')?.click();closeUtility()};$('utilSync').onclick=()=>{$('syncNow')?.click();closeUtility()};$('utilList').onclick=()=>setCatalogMode('list');$('utilGrid').onclick=()=>setCatalogMode('grid');$('utilOld').onclick=()=>location.href='../pos/';
  }
  function showHelp(){openUtility('Помощь','A4PRINT KASSA 2.1',`<div class="utility-section"><h3>Быстрая работа</h3><p><b>F2</b> — перейти в поиск товаров.<br><b>Enter</b> — добавить найденный по точному коду/штрихкоду товар.<br><b>F8</b> — оформить текущий чек.<br><b>Esc</b> — закрыть вспомогательные окна.</p></div><div class="utility-section"><h3>Офлайн-режим</h3><p>Если интернет пропадёт, касса сохранит чек на этом компьютере. После восстановления связи очередь отправится автоматически.</p></div><div class="utility-section"><h3>Возвраты</h3><p>Раздел «Возвраты» создаёт настоящий розничный возврат в МойСклад и записывает его в A4PRINT HUB.</p></div>`)}

  async function shiftAccessToken(){
    if(!shiftSupabase)throw new Error('Авторизация кассы не загружена.');
    const r=await shiftSupabase.auth.getSession();
    if(r.error)throw r.error;
    let session=r.data?.session||null;
    if(!session)throw new Error('Сессия завершена. Войдите снова.');
    return session.access_token;
  }
  async function shiftApi(path,opt={},retry=true){
    let token=await shiftAccessToken();
    const run=async()=>{
      const r=await fetch(API+path,{...opt,cache:'no-store',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Accept':'application/json',...(opt.headers||{})}});
      const text=await r.text();let d={};try{d=text?JSON.parse(text):{}}catch{}
      if(r.status===401&&retry){const rr=await shiftSupabase.auth.refreshSession();if(rr.data?.session){token=rr.data.session.access_token;return shiftApi(path,opt,false)}}
      if(!r.ok)throw new Error(d.message||d.error||`HTTP ${r.status}`);
      return d;
    };
    return run();
  }
  function parseMoySkladDate(raw){
    const value=String(raw||'').trim();if(!value)return null;
    const m=value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if(m)return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6]||0));
    const d=new Date(value);return Number.isNaN(d.getTime())?null:d;
  }
  function shiftOpenedText(raw){
    const d=parseMoySkladDate(raw);if(!d)return 'время открытия не определено';
    const date=d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}).replace(' г.','');
    return `${date} г. в ${d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }
  function ensureShiftView(){
    let view=$('shiftView');if(view)return view;
    const workspace=document.querySelector('.workspace');if(!workspace)return null;
    view=document.createElement('section');view.id='shiftView';view.className='shift-view';view.hidden=true;
    view.innerHTML=`
      <div class="shift-topline"><button id="shiftBackSale" class="shift-back" type="button">← Продажа</button><h1 id="shiftHeading">Смена</h1><button id="shiftRefresh" class="shift-refresh" type="button">↻ Обновить</button></div>
      <div class="shift-scroll">
        <div id="shiftClosed" class="shift-state-card" hidden><div class="shift-state-icon">▤</div><h2>Смена не открыта</h2><p>Откройте смену перед первой продажей.</p></div>
        <div id="shiftSummaryWrap" class="shift-summary-wrap" hidden>
          <div class="shift-open-title">Смена открыта <span id="shiftOpenedAt"></span></div>
          <div class="shift-summary-card">
            <div class="shift-group">
              <div class="shift-main-row"><b>Продажи</b><strong id="shiftSalesCount">0</strong><em id="shiftSalesTotal">0,00 ₽</em></div>
              <div class="shift-sub-row"><span>Наличными</span><em id="shiftSalesCash">0,00 ₽</em></div>
              <div class="shift-sub-row"><span>Безналичными</span><em id="shiftSalesCashless">0,00 ₽</em></div>
            </div>
            <div class="shift-group">
              <div class="shift-main-row"><b>Возвраты</b><strong id="shiftReturnsCount">0</strong><em id="shiftReturnsTotal">0,00 ₽</em></div>
              <div class="shift-sub-row"><span>Наличными</span><em id="shiftReturnsCash">0,00 ₽</em></div>
              <div class="shift-sub-row"><span>Безналичными</span><em id="shiftReturnsCashless">0,00 ₽</em></div>
            </div>
            <div class="shift-group compact"><div class="shift-main-row"><b>Внесения</b><strong id="shiftDepositsCount">0</strong><em id="shiftDepositsTotal">0,00 ₽</em></div></div>
            <div class="shift-group compact"><div class="shift-main-row"><b>Выплаты</b><strong id="shiftPayoutsCount">0</strong><em id="shiftPayoutsTotal">0,00 ₽</em></div></div>
            <div class="shift-group revenue">
              <div class="shift-main-row"><b>Выручка</b><span></span><em id="shiftRevenueTotal">0,00 ₽</em></div>
              <div class="shift-sub-row"><span>Наличными</span><em id="shiftRevenueCash">0,00 ₽</em></div>
              <div class="shift-sub-row"><span>Безналичными</span><em id="shiftRevenueCashless">0,00 ₽</em></div>
            </div>
            <div class="shift-cash-row"><b>Денег в кассе</b><strong id="shiftCashRegister">0,00 ₽</strong></div>
          </div>
          <div class="shift-note">Сумма «Денег в кассе» рассчитана по наличным операциям A4PRINT HUB за текущую смену.</div>
        </div>
        <div id="shiftLoading" class="shift-loading">Загрузка смены…</div>
      </div>
      <div class="shift-bottom"><button id="shiftMainAction" class="shift-main-action" type="button">Открыть смену</button></div>`;
    workspace.append(view);
    $('shiftBackSale').onclick=()=>document.querySelector('[data-section="sale"]')?.click();
    $('shiftRefresh').onclick=()=>loadShiftView(true);
    $('shiftMainAction').onclick=shiftMainAction;
    return view;
  }
  function setShiftTopControls(hidden){
    if($('topSearch'))$('topSearch').hidden=hidden;
    if($('quickAdd'))$('quickAdd').hidden=hidden;
    const switcher=document.querySelector('.view-switch');if(switcher)switcher.hidden=hidden;
  }
  function hideShiftView(section='sale'){
    const view=$('shiftView');if(view)view.hidden=true;
    if($('navShift'))$('navShift').classList.remove('active');
    setShiftTopControls(section!=='sale');
    clearInterval(shiftRefreshTimer);shiftRefreshTimer=null;
  }
  function enterShift(){
    closeMobileMenu();const view=ensureShiftView();if(!view)return;
    document.querySelectorAll('.main-nav .nav-item').forEach(x=>x.classList.remove('active'));
    $('navShift')?.classList.add('active');
    ['saleSidebar','saleCatalog','saleCart','returnsView','reportsView'].forEach(id=>{const el=$(id);if(el)el.hidden=true});
    setShiftTopControls(true);view.hidden=false;
    loadShiftView();clearInterval(shiftRefreshTimer);shiftRefreshTimer=setInterval(()=>{if(!$('shiftView')?.hidden)loadShiftView(false)},30000);
  }
  async function loadShiftView(showToast=false){
    const view=ensureShiftView();if(!view||view.hidden)return;
    const loading=$('shiftLoading'),closed=$('shiftClosed'),wrap=$('shiftSummaryWrap'),action=$('shiftMainAction');
    loading.hidden=false;closed.hidden=true;wrap.hidden=true;action.disabled=true;
    try{
      const status=await shiftApi('/api/v1/pos/shift');
      const shift=status.shift||null;
      if(!shift){
        loading.hidden=true;closed.hidden=false;wrap.hidden=true;action.textContent='Открыть смену';action.dataset.mode='open';action.disabled=false;$('shiftHeading').textContent='Смена не открыта';
        if(showToast)toast('Данные смены обновлены');return;
      }
      const opened=parseMoySkladDate(shift.openDate);if(!opened)throw new Error('Не удалось определить время открытия смены.');
      const r=await shiftSupabase.rpc('pos_shift_summary',{p_from:opened.toISOString(),p_to:new Date().toISOString(),p_operator_id:null});
      if(r.error)throw r.error;const d=r.data||{};
      $('shiftHeading').textContent=`Смена ${shift.name||''}`.trim();$('shiftOpenedAt').textContent=shiftOpenedText(shift.openDate);
      $('shiftSalesCount').textContent=Number(d.sales_count||0).toLocaleString('ru-RU');$('shiftSalesTotal').textContent=money(d.sales_total);$('shiftSalesCash').textContent=money(d.sales_cash);$('shiftSalesCashless').textContent=money(d.sales_cashless);
      $('shiftReturnsCount').textContent=Number(d.returns_count||0).toLocaleString('ru-RU');$('shiftReturnsTotal').textContent=money(d.returns_total);$('shiftReturnsCash').textContent=money(d.returns_cash);$('shiftReturnsCashless').textContent=money(d.returns_cashless);
      $('shiftDepositsCount').textContent=Number(d.deposits_count||0).toLocaleString('ru-RU');$('shiftDepositsTotal').textContent=money(d.deposits_total);$('shiftPayoutsCount').textContent=Number(d.payouts_count||0).toLocaleString('ru-RU');$('shiftPayoutsTotal').textContent=money(d.payouts_total);
      $('shiftRevenueTotal').textContent=money(d.revenue_total);$('shiftRevenueCash').textContent=money(d.revenue_cash);$('shiftRevenueCashless').textContent=money(d.revenue_cashless);$('shiftCashRegister').textContent=money(d.cash_in_register);
      loading.hidden=true;closed.hidden=true;wrap.hidden=false;action.textContent='Закрыть смену';action.dataset.mode='close';action.disabled=false;
      if(showToast)toast('Данные смены обновлены');
    }catch(e){loading.textContent='Не удалось загрузить смену: '+String(e?.message||e);action.disabled=false;toast('Не удалось загрузить данные смены',true)}
  }
  async function shiftMainAction(){
    const action=$('shiftMainAction'),mode=action.dataset.mode||'open';
    if(mode==='close'){
      try{const queue=DB?await DB.getAll('queue'):[];if(queue.length){toast(`Сначала синхронизируйте ${queue.length} чек(а) из очереди.`,true);$('queueChip')?.click();return}}catch{}
      if(!confirm('Закрыть текущую смену? После закрытия новые продажи потребуют открыть следующую смену.'))return;
    }
    const hiddenAction=$('shiftButton');if(!hiddenAction)return toast('Кнопка управления сменой не найдена.',true);
    action.disabled=true;action.textContent=mode==='close'?'Закрываю смену…':'Открываю смену…';hiddenAction.click();
    const wantOpen=mode==='open';
    for(let i=0;i<12;i++){
      await new Promise(r=>setTimeout(r,500));
      try{const status=await shiftApi('/api/v1/pos/shift');if(Boolean(status.shift)===wantOpen){toast(wantOpen?'Смена открыта':'Смена закрыта');await loadShiftView(false);syncFooterShift();return}}catch{}
    }
    action.disabled=false;await loadShiftView(false);
  }

  function bind(){
    $('menuToggle')?.addEventListener('click',toggleMenu);
    document.querySelectorAll('.main-nav [data-section]').forEach(b=>b.addEventListener('click',()=>{hideShiftView(b.dataset.section);closeMobileMenu()}));
    $('navShift')?.addEventListener('click',enterShift);
    $('shiftChip')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();enterShift()},{capture:true});
    $('clearSearch')?.addEventListener('click',()=>{const q=$('search');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}));q.focus()});
    $('quickAdd')?.addEventListener('click',()=>{const q=$('search');if(q){q.focus();q.select();toast('Введите название, код или штрихкод позиции')}});
    $('listView')?.addEventListener('click',()=>setCatalogMode('list'));$('gridView')?.addEventListener('click',()=>setCatalogMode('grid'));
    $('operatorSelect')?.addEventListener('change',syncCashierLabel);
    $('navHistory')?.addEventListener('click',()=>{closeMobileMenu();showHistory()});
    $('navHeld')?.addEventListener('click',()=>{closeMobileMenu();showHeld()});
    $('navSettings')?.addEventListener('click',()=>{closeMobileMenu();showSettings()});
    $('navHelp')?.addEventListener('click',()=>{closeMobileMenu();showHelp()});
    $('closeUtility')?.addEventListener('click',closeUtility);$('utilityDrawer')?.addEventListener('click',e=>{if(e.target===$('utilityDrawer'))closeUtility()});
    $('syncNow')?.addEventListener('click',()=>setTimeout(markSyncNow,400));
    window.addEventListener('keydown',e=>{if(e.key==='Escape')closeUtility()});
    const op=$('operatorSelect');if(op)new MutationObserver(()=>setTimeout(syncCashierLabel,0)).observe(op,{childList:true,subtree:true,attributes:true});
    const shift=$('shiftInfo');if(shift)new MutationObserver(syncFooterShift).observe(shift,{childList:true,subtree:true,characterData:true});
  }

  function init(){bind();ensureShiftView();let mode='list';try{mode=localStorage.getItem('a4_kassa_catalog_mode')||'list'}catch{}setCatalogMode(mode);setTimeout(()=>{syncCashierLabel();syncFooterShift();markSyncNow()},1000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();