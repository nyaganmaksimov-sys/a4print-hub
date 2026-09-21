(()=>{
  'use strict';
  if(window.__A4_KASSA_ORDER_ENTRY_MENU__)return;
  window.__A4_KASSA_ORDER_ENTRY_MENU__=true;

  const $=id=>document.getElementById(id);
  let overlay=null;

  const ICONS={
    order:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h10a2 2 0 0 1 2 2v15H5v-15a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M9 7h6M9 11h6M9 15h3M15.5 14.5v5M13 17h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    stamp:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.1 3.2h7.8c.7 0 1.3.6 1.3 1.3v2.2c0 .7-.3 1.3-.8 1.8l-1.3 1.2c-.3.3-.5.7-.5 1.1v1H9.4v-1c0-.4-.2-.8-.5-1.1L7.6 8.5c-.5-.5-.8-1.1-.8-1.8V4.5c0-.7.6-1.3 1.3-1.3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M6.1 12.2h11.8c.8 0 1.5.7 1.5 1.5v2.4H4.6v-2.4c0-.8.7-1.5 1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.6 18.1h16.8v2.7H3.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    memorial:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 20V8.5C7 5.5 9.2 3 12 3s5 2.5 5 5.5V20" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 20h14M9.5 8.5h5M12 6v5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    souvenir:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16v11H4zM3 6h18v4H3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 6v14M8.5 6c-2.2 0-3.4-3 0-3 2.3 0 3.5 3 3.5 3M15.5 6c2.2 0 3.4-3 0-3C13.2 3 12 6 12 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    print:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v5H7zM6 16h12v5H6zM5 8h14a2 2 0 0 1 2 2v6h-3v-2H6v2H3v-6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M17.5 11h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    wide:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H4z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 19h8M12 15v4M7.5 12 10 9.5l2 2 2.5-3 2 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cube:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    outdoor:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H4zM8 15v5m8-5v5M6 20h12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M7 8h10M7 11h6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
  };

  function ensureUi(){
    if(overlay)return;
    overlay=document.createElement('section');
    overlay.id='orderEntryOverlay';
    overlay.className='order-entry-overlay';
    overlay.hidden=true;
    overlay.innerHTML=`
      <div class="order-entry-shell" role="dialog" aria-modal="true" aria-labelledby="orderEntryTitle">
        <header class="order-entry-head">
          <div>
            <span>НОВЫЙ ЗАКАЗ</span>
            <h2 id="orderEntryTitle">Что оформляем?</h2>
            <p>Выберите направление — откроется нужная форма со всеми параметрами заказа.</p>
          </div>
          <button id="orderEntryClose" type="button" aria-label="Закрыть">×</button>
        </header>
        <div class="order-entry-grid">
          <button type="button" class="order-entry-card" data-order-entry="STAMP">
            <span class="order-entry-icon stamp">${ICONS.stamp}</span>
            <span class="order-entry-copy"><b>Печати и штампы</b><small>Печати ИП/ООО, врачам, педагогам, факсимиле, штампы и оснастки</small></span>
            <span class="order-entry-arrow">→</span>
          </button>
          <button type="button" class="order-entry-card" data-order-entry="MEMORIAL">
            <span class="order-entry-icon">${ICONS.memorial}</span>
            <span class="order-entry-copy"><b>Памятники и фотокерамика</b><small>Сфера · портреты, таблички, фото на стекле и другие изделия</small></span>
            <span class="order-entry-arrow">→</span>
          </button>
          <button type="button" class="order-entry-card" data-order-entry="SOUVENIR">
            <span class="order-entry-icon">${ICONS.souvenir}</span>
            <span class="order-entry-copy"><b>Сувениры и знаки</b><small>Сфера · таблички, знаки, памятные и нестандартные изделия</small></span>
            <span class="order-entry-arrow">→</span>
          </button>
          <button type="button" class="order-entry-card" data-order-entry="TYPOGRAPHY">
            <span class="order-entry-icon">${ICONS.print}</span>
            <span class="order-entry-copy"><b>Типография</b><small>Группа М · визитки, листовки, буклеты, каталоги, календари и другое</small></span>
            <span class="order-entry-arrow">→</span>
          </button>
          <button type="button" class="order-entry-card" data-order-entry="WIDE_FORMAT">
            <span class="order-entry-icon wide">${ICONS.wide}</span>
            <span class="order-entry-copy"><b>Широкоформатная печать</b><small>Баннеры, постеры, плёнка, холсты, Roll-Up и большие форматы</small></span>
            <span class="order-entry-arrow">→</span>
          </button>
          <button type="button" class="order-entry-card" data-order-entry="THREE_D">
            <span class="order-entry-icon three-d">${ICONS.cube}</span>
            <span class="order-entry-copy"><b>3D-печать</b><small>FDM и фотополимер · прототипы, детали, макеты, фигурки и серии</small></span>
            <span class="order-entry-arrow">→</span>
          </button>
          <button type="button" class="order-entry-card order-entry-card-wide" data-order-entry="OUTDOOR">
            <span class="order-entry-icon outdoor">${ICONS.outdoor}</span>
            <span class="order-entry-copy"><b>Наружная реклама</b><small>Вывески, световые короба, объёмные буквы, фасады, витрины и навигация</small></span>
            <span class="order-entry-arrow">→</span>
          </button>
        </div>
        <footer class="order-entry-foot">Все созданные здесь заказы сразу попадают в A4PRINT HUB.</footer>
      </div>`;
    document.body.appendChild(overlay);
    $('orderEntryClose').addEventListener('click',close);
    overlay.addEventListener('click',event=>{if(event.target===overlay)close()});
    overlay.querySelector('.order-entry-grid').addEventListener('click',event=>{
      const button=event.target.closest('[data-order-entry]');
      if(!button)return;
      launch(button.dataset.orderEntry);
    });
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&overlay&&!overlay.hidden)close()});
  }

  function launch(kind){
    close();
    if(kind==='STAMP'){
      window.A4KassaStampOrders?.open?.();
      return;
    }
    if(['MEMORIAL','SOUVENIR','TYPOGRAPHY','WIDE_FORMAT','THREE_D','OUTDOOR'].includes(kind)){
      window.A4KassaPartnerOrders?.open?.(kind);
    }
  }

  function open(){
    ensureUi();
    overlay.hidden=false;
    document.body.classList.add('order-entry-open');
  }

  function close(){
    if(!overlay)return;
    overlay.hidden=true;
    document.body.classList.remove('order-entry-open');
  }

  function addLauncher(){
    document.getElementById('navStampOrder')?.remove();
    document.getElementById('navPartnerOrder')?.remove();
    document.getElementById('partnerOrderQuick')?.remove();

    const nav=document.querySelector('.nav-menu');
    if(nav&&!$('navCreateOrder')){
      const button=document.createElement('button');
      button.id='navCreateOrder';
      button.className='nav-item';
      button.type='button';
      button.innerHTML='<span class="nav-icon order-entry-nav-icon" aria-hidden="true">'+ICONS.order+'</span><b>Оформить заказ</b>';
      button.addEventListener('click',()=>{
        document.getElementById('appView')?.classList.remove('nav-open');
        open();
      });
      const hub=$('navHubOrders');
      if(hub&&hub.nextSibling)nav.insertBefore(button,hub.nextSibling);
      else nav.insertBefore(button,nav.querySelector('[data-section="returns"]')||null);
    }

    const toolbar=document.querySelector('.catalog-toolbar .toolbar-actions');
    if(toolbar&&!$('orderEntryQuick')){
      const button=document.createElement('button');
      button.id='orderEntryQuick';
      button.className='btn light';
      button.type='button';
      button.innerHTML='＋ Оформить заказ';
      button.addEventListener('click',open);
      toolbar.prepend(button);
    }
  }

  function init(){
    ensureUi();
    addLauncher();
    const app=$('appView');
    if(app)new MutationObserver(()=>{if(!app.hidden)addLauncher()}).observe(app,{attributes:true,attributeFilter:['hidden']});
    setInterval(addLauncher,3000);
  }

  window.A4KassaOrderEntry=Object.freeze({open,close,launch});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();