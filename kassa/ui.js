(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const DB=window.A4KassaDB;
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})+' ₽';
  const dt=v=>v?new Date(v).toLocaleString('ru-RU'):'—';
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  function toast(text,error=false){const n=$('toast');if(!n)return;n.textContent=text;n.className='toast show'+(error?' error':'');clearTimeout(toast.t);toast.t=setTimeout(()=>n.className='toast',2600)}

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

  function bind(){
    $('menuToggle')?.addEventListener('click',toggleMenu);
    document.querySelectorAll('.main-nav [data-section]').forEach(b=>b.addEventListener('click',closeMobileMenu));
    $('clearSearch')?.addEventListener('click',()=>{const q=$('search');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}));q.focus()});
    $('quickAdd')?.addEventListener('click',()=>{const q=$('search');if(q){q.focus();q.select();toast('Введите название, код или штрихкод позиции')}});
    $('listView')?.addEventListener('click',()=>setCatalogMode('list'));$('gridView')?.addEventListener('click',()=>setCatalogMode('grid'));
    $('operatorSelect')?.addEventListener('change',syncCashierLabel);
    $('navShift')?.addEventListener('click',()=>{closeMobileMenu();$('shiftButton')?.click()});
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

  function init(){bind();let mode='list';try{mode=localStorage.getItem('a4_kassa_catalog_mode')||'list'}catch{}setCatalogMode(mode);setTimeout(()=>{syncCashierLabel();syncFooterShift();markSyncNow()},1000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();