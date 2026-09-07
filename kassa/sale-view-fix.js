(()=>{
  'use strict';
  if(window.__A4_KASSA_SALE_VIEW_FIX__)return;
  window.__A4_KASSA_SALE_VIEW_FIX__=true;

  const $=id=>document.getElementById(id);
  const saleButton=()=>document.querySelector('.main-nav [data-section="sale"]');

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
  }

  function scheduleRestore(){
    queueMicrotask(restoreSaleView);
    setTimeout(restoreSaleView,0);
  }

  function bind(){
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
