(()=>{
  'use strict';
  if(window.__A4_KASSA_RUNTIME_STABILITY__)return;
  window.__A4_KASSA_RUNTIME_STABILITY__=true;

  const $=id=>document.getElementById(id);

  function toast(text,error=false){
    const node=$('toast');
    if(!node)return;
    node.textContent=text;
    node.className='toast show'+(error?' error':'');
    clearTimeout(toast.timer);
    toast.timer=setTimeout(()=>{node.className='toast'},4200);
  }

  function closeDrawer(id){
    const drawer=$(id);
    if(!drawer)return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden','true');
  }

  function closeUtility(){
    const drawer=$('utilityDrawer');
    if(!drawer)return;
    drawer.classList.remove('open','a4-history-mode','a4-held-mode','a4-settings-mode','a4-help-mode');
    drawer.setAttribute('aria-hidden','true');
  }

  function closeRouteOverlays(){
    closeUtility();
    closeDrawer('queueDrawer');
    $('customerPanel')?.setAttribute('hidden','');
    $('appView')?.classList.remove('nav-open');
  }

  function normalizeSection(section){
    if(!['sale','returns','reports'].includes(section))return;

    const shift=$('shiftView');
    if(shift)shift.hidden=true;

    const visible={
      sale:['saleSidebar','saleCatalog','saleCart'],
      returns:['returnsView'],
      reports:['reportsView']
    };
    ['saleSidebar','saleCatalog','saleCart','returnsView','reportsView'].forEach(id=>{
      const el=$(id);if(el)el.hidden=!visible[section].includes(id);
    });

    const saleMode=section==='sale';
    if($('topSearch'))$('topSearch').hidden=!saleMode;
    if($('quickAdd'))$('quickAdd').hidden=!saleMode;
    const switcher=document.querySelector('.view-switch');
    if(switcher)switcher.hidden=!saleMode;

    document.querySelectorAll('.main-nav .nav-item').forEach(el=>el.classList.remove('active'));
    document.querySelector(`.main-nav [data-section="${section}"]`)?.classList.add('active');
    $('navShift')?.classList.remove('active');
  }

  function routeSection(section){
    closeRouteOverlays();
    queueMicrotask(()=>normalizeSection(section));
    setTimeout(()=>normalizeSection(section),0);
  }

  function bindNavigation(){
    document.addEventListener('click',event=>{
      const sectionButton=event.target?.closest?.('.main-nav [data-section]');
      if(sectionButton){routeSection(sectionButton.dataset.section);return}
      if(event.target?.closest?.('#navShift,#shiftChip'))closeRouteOverlays();
    },true);
  }

  function visible(el){return !!el&&!el.hidden&&getComputedStyle(el).display!=='none'}

  function bindEscape(){
    window.addEventListener('keydown',event=>{
      if(event.key!=='Escape')return;
      const saleFinish=document.querySelector('.sale-finish-overlay');
      if(visible(saleFinish)){
        saleFinish.querySelector('.sale-finish-next')?.click();
        event.preventDefault();event.stopImmediatePropagation();return;
      }
      const returnFinish=document.querySelector('.a4-return-finish');
      if(visible(returnFinish)){
        returnFinish.querySelector('#a4ReturnClose')?.click();
        event.preventDefault();event.stopImmediatePropagation();return;
      }
      const customerCreate=document.querySelector('.customer-create-overlay');
      if(visible(customerCreate)){
        customerCreate.querySelector('.customer-create-cancel')?.click();
        event.preventDefault();event.stopImmediatePropagation();
      }
    },true);
  }

  function guardLocalQueueWrites(){
    const DB=window.A4KassaDB;
    if(!DB?.put||DB.put.__a4RuntimeGuard)return;
    const previous=DB.put.bind(DB);
    const guarded=async function(name,value){
      try{return await previous(name,value)}
      catch(error){
        if(name==='queue'){
          toast('Чек не сохранён: локальная база кассы недоступна. Повторите оплату после восстановления базы.',true);
          console.error('A4PRINT KASSA local queue write failed:',error);
        }
        throw error;
      }
    };
    guarded.__a4RuntimeGuard=true;
    DB.put=guarded;
  }

  function bindUnhandledErrors(){
    window.addEventListener('unhandledrejection',event=>{
      const text=String(event.reason?.message||event.reason||'');
      if(/AbortError|signal is aborted/i.test(text))return;
      if(/indexeddb|database|transaction|object store/i.test(text)){
        toast('Ошибка локальной базы кассы. Проверьте «Настройки» и повторите операцию.',true);
      }
    });
  }

  function init(){
    bindNavigation();
    bindEscape();
    guardLocalQueueWrites();
    bindUnhandledErrors();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
