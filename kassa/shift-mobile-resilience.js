(()=>{
  'use strict';
  if(window.__A4_KASSA_SHIFT_RESILIENCE__)return;
  window.__A4_KASSA_SHIFT_RESILIENCE__=true;
  if(!matchMedia('(max-width:980px)').matches)return;

  const originalFetch=window.fetch.bind(window);
  const $=id=>document.getElementById(id);
  const DB=window.A4KassaDB;
  const SHIFT_TIMEOUT=6500;

  function isShiftRequest(input){
    try{
      const raw=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
      const u=new URL(raw,location.href);
      return /\/api\/v1\/pos\/(?:shift(?:\/|$)|cash-balance(?:\/|$))/.test(u.pathname);
    }catch{return false}
  }

  window.fetch=async function a4ShiftTimeoutFetch(input,init={}){
    if(!isShiftRequest(input))return originalFetch(input,init);
    if(init?.signal)return originalFetch(input,init);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),SHIFT_TIMEOUT);
    try{return await originalFetch(input,{...init,signal:controller.signal})}
    finally{clearTimeout(timer)}
  };

  function setProfileFallback(){
    const loading=$('shiftProfileLoading');
    const body=$('shiftProfileBody');
    const error=$('shiftProfileError');
    if(loading&&!loading.hidden){
      loading.hidden=true;
      if(error){
        error.hidden=false;
        error.textContent='Связь с сервером медленная. Профиль смены временно недоступен — можно продолжать работу и повторить обновление позже.';
      }
      if(body)body.hidden=true;
    }
  }

  async function setShiftFallback(){
    const loading=$('shiftLoading');
    if(!loading||loading.hidden)return;
    let saved=null;
    try{saved=await DB?.getMeta?.('shift',null)}catch{}
    const gate=window.A4KassaShiftSession;
    const active=!!(gate?.active||saved?.id);
    loading.hidden=true;
    const closed=$('shiftClosed');
    const wrap=$('shiftSummaryWrap');
    const action=$('shiftMainAction');
    if(active){
      if(closed)closed.hidden=true;
      if(wrap)wrap.hidden=false;
      if($('shiftHeading'))$('shiftHeading').textContent=`Смена ${gate?.remoteShift?.name||saved?.name||''}`.trim();
      if($('shiftOpenedAt'))$('shiftOpenedAt').textContent='· последние сохранённые данные';
      if(action){action.textContent='Закрыть смену';action.dataset.mode='close';action.disabled=false}
    }else{
      if(wrap)wrap.hidden=true;
      if(closed)closed.hidden=false;
      if($('shiftHeading'))$('shiftHeading').textContent='Смена';
      if(action){action.textContent='Открыть смену';action.dataset.mode='open';action.disabled=false}
    }
    const note=document.createElement('div');
    note.className='a4-shift-offline-note';
    note.textContent='Сервер отвечает медленно. Показаны последние сохранённые данные.';
    const scroll=document.querySelector('#shiftView .shift-scroll');
    if(scroll&&!scroll.querySelector('.a4-shift-offline-note'))scroll.prepend(note);
  }

  function armWatchdog(){
    setTimeout(()=>{
      const view=$('shiftView');
      if(view&&!view.hidden){setProfileFallback();setShiftFallback()}
    },7600);
  }

  function init(){
    armWatchdog();
    document.addEventListener('click',e=>{
      if(e.target?.closest?.('#navShift,#shiftChip,[data-mobile-nav="shift"],#shiftRefresh,#shiftProfileRefresh'))armWatchdog();
    },true);
    const root=document.body;
    new MutationObserver(()=>{
      if($('shiftView')&&!$('shiftView').hidden)armWatchdog();
    }).observe(root,{subtree:true,attributes:true,attributeFilter:['hidden'],childList:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();