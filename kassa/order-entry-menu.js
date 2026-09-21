(()=>{
  'use strict';
  if(window.__A4_KASSA_ORDER_ENTRY_MENU__)return;
  window.__A4_KASSA_ORDER_ENTRY_MENU__=true;

  const $=id=>document.getElementById(id);
  let overlay=null;

  const stampIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v3.1c0 .8-.3 1.5-.9 2.1l-1 1V12H9.9v-1.8l-1-1A3 3 0 0 1 8 7.1V4Z"/><path d="M6 12h12v4H6z"/><path d="M4.5 19h15"/></svg>';
  const memorialIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21V8.2A4.2 4.2 0 0 1 12.2 4h.6A4.2 4.2 0 0 1 17 8.2V21"/><path d="M6 21h13"/><path d="M12.5 8v6M10 11h5"/></svg>';
  const giftIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16v10H4z"/><path d="M3 7h18v3H3z"/><path d="M12 7v13"/><path d="M12 7H8.7A2.2 2.2 0 1 1 11 4.8L12 7Zm0 0h3.3A2.2 2.2 0 1 0 13 4.8L12 7Z"/></svg>';
  const printerIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V4h10v4"/><path d="M6 17H4v-7h16v7h-2"/><path d="M7 14h10v6H7z"/><path d="M17 11h.01"/></svg>';
  const wideIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H5z"/><path d="M8 19h8"/><path d="M12 15v4"/><path d="M7.5 12 10 9.5l2 2 2.5-3 2 3.5"/></svg>';
  const cubeIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>';
  const outdoorIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H4z"/><path d="M7 8h10M7 11h6"/><path d="M8 15v5m8-5v5M6 20h12"/></svg>';

  const ITEMS=[
    {key:'STAMP',title:'Печати и штампы',copy:'Печати ИП/ООО, врачам, педагогам, факсимиле, штампы и оснастки',icon:stampIcon,tone:'blue'},
    {key:'MEMORIAL',title:'Памятники и фотокерамика',copy:'Сфера · портреты, таблички, фото на стекле и другие изделия',icon:memorialIcon,tone:'cyan'},
    {key:'SOUVENIR',title:'Сувениры и знаки',copy:'Сфера · таблички, знаки, памятные и нестандартные изделия',icon:giftIcon,tone:'cyan'},
    {key:'TYPOGRAPHY',title:'Типография',copy:'Группа М · визитки, листовки, буклеты, каталоги, календари и другое',icon:printerIcon,tone:'cyan'},
    {key:'WIDE_FORMAT',title:'Широкоформатная печать',copy:'Баннеры, постеры, плёнка, холсты, Roll-Up и большие форматы',icon:wideIcon,tone:'violet'},
    {key:'THREE_D',title:'3D-печать',copy:'FDM и фотополимер · прототипы, детали, макеты, фигурки и серии',icon:cubeIcon,tone:'violet'},
    {key:'OUTDOOR',title:'Наружная реклама',copy:'Вывески, световые короба, объёмные буквы, фасады и навигация',icon:outdoorIcon,tone:'orange',wide:true}
  ];

  function ensureUi(){
    if(overlay)return overlay;
    overlay=document.createElement('section');
    overlay.className='order-entry-overlay';
    overlay.hidden=true;
    overlay.innerHTML=`
      <div class="order-entry-dialog" role="dialog" aria-modal="true" aria-labelledby="orderEntryTitle">
        <header class="order-entry-head">
          <div><span>Новый заказ</span><h2 id="orderEntryTitle">Что оформляем?</h2><p>Выберите направление — откроется нужная форма со всеми параметрами заказа.</p></div>
          <button id="orderEntryClose" type="button" aria-label="Закрыть">×</button>
        </header>
        <div class="order-entry-grid">
          ${ITEMS.map(item=>`<button type="button" class="order-entry-card${item.wide?' wide':''}" data-order-entry="${item.key}">
            <span class="order-entry-icon ${item.tone}">${item.icon}</span>
            <span class="order-entry-copy"><b>${item.title}</b><small>${item.copy}</small></span>
            <span class="order-entry-arrow">→</span>
          </button>`).join('')}
        </div>
        <footer>Все созданные здесь заказы сразу попадают в A4PRINT HUB.</footer>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click',event=>{if(event.target===overlay)close()});
    $('orderEntryClose').addEventListener('click',close);
    overlay.querySelectorAll('[data-order-entry]').forEach(button=>button.addEventListener('click',()=>launch(button.dataset.orderEntry)));
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!overlay.hidden)close()});
    return overlay;
  }

  function open(){ensureUi();overlay.hidden=false;document.body.classList.add('order-entry-open')}
  function close(){if(!overlay)return;overlay.hidden=true;document.body.classList.remove('order-entry-open')}

  function launch(key){
    close();
    if(key==='STAMP'){
      if(window.A4KassaStampOrders?.open)return window.A4KassaStampOrders.open();
      document.getElementById('navStampOrder')?.click();
      return;
    }
    if(window.A4KassaPartnerOrders?.open)return window.A4KassaPartnerOrders.open(key);
    document.getElementById('navPartnerOrder')?.click();
  }

  function addLauncher(){
    document.getElementById('partnerOrderQuick')?.remove();
    const toolbar=document.querySelector('.catalog-toolbar .toolbar-actions');
    if(toolbar&&!$('orderEntryQuick')){
      const button=document.createElement('button');
      button.id='orderEntryQuick';
      button.className='btn light';
      button.type='button';
      button.innerHTML='<span aria-hidden="true">◇</span> Оформить заказ';
      button.addEventListener('click',open);
      toolbar.prepend(button);
    }
  }

  function init(){
    ensureUi();addLauncher();
    const app=$('appView');
    if(app)new MutationObserver(()=>{if(!app.hidden)addLauncher()}).observe(app,{attributes:true,attributeFilter:['hidden']});
    setInterval(addLauncher,3000);
  }

  window.A4KassaOrderEntry=Object.freeze({open,close});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();