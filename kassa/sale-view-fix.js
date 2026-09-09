(()=>{
  'use strict';
  if(window.__A4_KASSA_SALE_VIEW_FIX__)return;
  window.__A4_KASSA_SALE_VIEW_FIX__=true;

  const $=id=>document.getElementById(id);
  const saleButton=()=>document.querySelector('.main-nav [data-section="sale"]');

  function ensureScrollLayout(){
    if(document.getElementById('a4-kassa-scroll-fix'))return;
    const style=document.createElement('style');
    style.id='a4-kassa-scroll-fix';
    style.textContent=`
      @media (min-width:981px){
        html,body{height:100%;overflow:hidden}
        .app-view{height:100dvh;min-height:0;overflow:hidden}
        .main-stage{height:100%;min-height:0;overflow:hidden}
        .workspace{height:100%;min-height:0;overflow:hidden}
        #saleSidebar,#saleCatalog,#saleCart{min-height:0;max-height:100%}
        #saleSidebar{overflow-y:auto;overscroll-behavior:contain}
        #saleCatalog,#saleCart{overflow:hidden}
        #catalogGrid,#cartItems{min-height:0;flex:1 1 0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;-webkit-overflow-scrolling:touch}
      }
    `;
    document.head.appendChild(style);
  }

  function bindScrollFallback(){
    ['saleSidebar','catalogGrid','cartItems'].forEach(id=>{
      const el=$(id);
      if(!el||el.dataset.a4ScrollFix==='1')return;
      el.dataset.a4ScrollFix='1';
      el.addEventListener('wheel',event=>{
        if(matchMedia('(max-width:980px)').matches)return;
        if(Math.abs(event.deltaY)<=Math.abs(event.deltaX))return;
        if(el.scrollHeight<=el.clientHeight+1)return;
        const delta=event.deltaMode===1?event.deltaY*16:event.deltaMode===2?event.deltaY*el.clientHeight:event.deltaY;
        const before=el.scrollTop;
        el.scrollTop+=delta;
        if(el.scrollTop!==before)event.preventDefault();
      },{passive:false});
    });
  }

  function restoreSaleView(){
    const shift=$('shiftView');
    if(shift)shift.hidden=true;

    ['saleSidebar','saleCatalog','saleCart'].forEach(id=>{
      const el=$(id);
      if(el)el.hidden=false;
    });
    ['returnsView','reportsView'].forEach(id=>{
      const el=$(id);
      if(el)el.hidden=true;
    });

    const search=$('topSearch');
    const quick=$('quickAdd');
    const switcher=document.querySelector('.view-switch');
    if(search)search.hidden=false;
    if(quick)quick.hidden=false;
    if(switcher)switcher.hidden=false;

    document.querySelectorAll('.main-nav .nav-item').forEach(el=>el.classList.remove('active'));
    saleButton()?.classList.add('active');
    $('navShift')?.classList.remove('active');
    $('appView')?.classList.remove('nav-open');

    ensureScrollLayout();
    bindScrollFallback();
  }

  function scheduleRestore(){
    queueMicrotask(restoreSaleView);
    setTimeout(restoreSaleView,0);
  }

  function bind(){
    ensureScrollLayout();
    bindScrollFallback();

    const sale=saleButton();
    if(sale) sale.addEventListener('click',scheduleRestore);

    document.addEventListener('click',event=>{
      const back=event.target?.closest?.('#shiftBackSale');
      if(back) scheduleRestore();
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();
