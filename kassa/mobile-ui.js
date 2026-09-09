(()=>{
  'use strict';
  if(window.__A4_KASSA_MOBILE_UI__)return;
  window.__A4_KASSA_MOBILE_UI__=true;
  const mq=matchMedia('(max-width:980px)');
  const $=id=>document.getElementById(id);
  const moneyText=()=>($('cartTotal')?.textContent||'0 ₽').trim();
  const countText=()=>($('cartCount')?.textContent||'0 поз.').trim();

  function mobile(){return mq.matches}
  function workspace(){return document.querySelector('.workspace')}
  function appOpen(){return mobile()&&!!$('appView')&&!$('appView').hidden}
  function closeDrawer(){$('appView')?.classList.remove('nav-open')}
  function showCatalog(){const w=workspace();if(!w)return;w.classList.remove('mobile-cart','mobile-categories');document.body.classList.remove('kassa-mobile-cart-open')}
  function showCart(){const w=workspace();if(!w)return;w.classList.remove('mobile-categories');w.classList.add('mobile-cart');document.body.classList.add('kassa-mobile-cart-open');$('cartItems')?.scrollTo?.({top:0,behavior:'smooth'})}
  function showCategories(){const w=workspace();if(!w)return;w.classList.remove('mobile-cart');w.classList.add('mobile-categories');document.body.classList.remove('kassa-mobile-cart-open')}

  function activate(name){document.querySelectorAll('.kassa-mobile-nav button').forEach(b=>b.classList.toggle('active',b.dataset.mobileNav===name))}
  function clickSection(name){showCatalog();closeDrawer();document.querySelector(`.main-nav [data-section="${name}"]`)?.click()}
  function openHistory(){showCatalog();closeDrawer();$('navHistory')?.click()}
  function openShift(){showCatalog();closeDrawer();$('navShift')?.click()}
  function openMore(){$('appView')?.classList.toggle('nav-open')}

  function syncVisibility(){
    const visible=appOpen();
    document.body.classList.toggle('kassa-mobile',visible);
    document.querySelector('.kassa-mobile-nav')?.classList.toggle('hidden',!visible);
    document.querySelector('.kassa-mobile-sale-tools')?.classList.toggle('auth-hidden',!visible);
  }

  function ensure(){
    if(!mobile())return;
    if(!document.querySelector('.kassa-mobile-nav')){
      const nav=document.createElement('nav');nav.className='kassa-mobile-nav hidden';nav.setAttribute('aria-label','Навигация кассы');
      nav.innerHTML=`
        <button type="button" data-mobile-nav="sale" class="active"><span>▣</span><b>Продажа</b></button>
        <button type="button" data-mobile-nav="receipts"><span>◷</span><b>Чеки</b></button>
        <button type="button" data-mobile-nav="shift"><span>▤</span><b>Смена</b></button>
        <button type="button" data-mobile-nav="reports"><span>▥</span><b>Отчёты</b></button>
        <button type="button" data-mobile-nav="more"><span>☰</span><b>Ещё</b></button>`;
      document.body.appendChild(nav);
      nav.querySelector('[data-mobile-nav="sale"]').onclick=()=>{activate('sale');clickSection('sale')};
      nav.querySelector('[data-mobile-nav="receipts"]').onclick=()=>{activate('receipts');openHistory()};
      nav.querySelector('[data-mobile-nav="shift"]').onclick=()=>{activate('shift');openShift()};
      nav.querySelector('[data-mobile-nav="reports"]').onclick=()=>{activate('reports');clickSection('reports')};
      nav.querySelector('[data-mobile-nav="more"]').onclick=()=>{activate('more');openMore()};
    }
    if(!document.querySelector('.kassa-mobile-sale-tools')){
      const tools=document.createElement('div');tools.className='kassa-mobile-sale-tools auth-hidden';
      tools.innerHTML=`<button type="button" class="kassa-mobile-cat-btn"><span>☷</span><b>Категории</b></button><button type="button" class="kassa-mobile-cart-btn"><span class="kassa-mobile-cart-label">Чек</span><strong class="kassa-mobile-cart-total">0 ₽</strong><small class="kassa-mobile-cart-count">0 поз.</small></button>`;
      document.body.appendChild(tools);
      tools.querySelector('.kassa-mobile-cat-btn').onclick=showCategories;
      tools.querySelector('.kassa-mobile-cart-btn').onclick=showCart;
    }
    if($('cart-head-mobile-back')==null&&document.querySelector('.cart-head')){
      const b=document.createElement('button');b.id='cart-head-mobile-back';b.className='cart-mobile-back';b.type='button';b.textContent='← К товарам';b.onclick=showCatalog;document.querySelector('.cart-head').prepend(b);
    }
    if($('category-mobile-back')==null&&document.querySelector('.category-head')){
      const b=document.createElement('button');b.id='category-mobile-back';b.className='category-mobile-back';b.type='button';b.textContent='← Товары';b.onclick=showCatalog;document.querySelector('.category-head').prepend(b);
    }
    syncVisibility();syncCart();
  }

  function syncCart(){
    const total=document.querySelector('.kassa-mobile-cart-total'),count=document.querySelector('.kassa-mobile-cart-count');
    if(total)total.textContent=moneyText();if(count)count.textContent=countText();
    const tools=document.querySelector('.kassa-mobile-sale-tools');
    if(tools)tools.classList.toggle('hide',!appOpen() || (!!$('shiftView')&&!$('shiftView').hidden) || (!!$('reportsView')&&!$('reportsView').hidden) || (!!$('returnsView')&&!$('returnsView').hidden));
  }

  function observe(){
    const targets=[$('cartTotal'),$('cartCount'),$('appView'),workspace(),$('shiftView'),$('reportsView'),$('returnsView')].filter(Boolean);
    const obs=new MutationObserver(()=>{ensure();syncVisibility();syncCart()});
    targets.forEach(t=>obs.observe(t,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','class']}));
    document.addEventListener('click',e=>{
      if(!appOpen())return;
      const section=e.target.closest?.('.main-nav [data-section]')?.dataset?.section;
      if(section){activate(section==='reports'?'reports':'sale');showCatalog()}
      if(e.target.closest?.('#navShift,#shiftChip'))activate('shift');
      if(e.target.closest?.('#navHistory'))activate('receipts');
    },true);
  }

  function init(){ensure();observe();mq.addEventListener?.('change',()=>{if(mobile())ensure();else{document.body.classList.remove('kassa-mobile','kassa-mobile-cart-open');workspace()?.classList.remove('mobile-cart','mobile-categories');document.querySelector('.kassa-mobile-nav')?.classList.add('hidden');document.querySelector('.kassa-mobile-sale-tools')?.classList.add('auth-hidden')}})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
