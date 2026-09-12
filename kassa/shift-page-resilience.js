(()=>{
  'use strict';
  if(window.__A4_KASSA_SHIFT_PAGE_RESILIENCE__)return;
  window.__A4_KASSA_SHIFT_PAGE_RESILIENCE__=true;

  const $=id=>document.getElementById(id);
  let observer=null;
  let scheduled=false;

  function activeGate(){
    const gate=window.A4KassaShiftSession;
    return gate?.active?gate:null;
  }

  function neutralProfileFallback(gate){
    const error=$('shiftProfileError');
    if(!error||error.hidden)return;
    const text=String(error.textContent||'');
    if(!/abort|failed to fetch|network|связ|таймаут/i.test(text))return;
    error.hidden=true;
    const loading=$('shiftProfileLoading');
    if(loading){
      loading.hidden=false;
      loading.textContent=`Смена ${gate.remoteShift?.name||''} открыта · профиль обновится автоматически`.replace(/\s+/g,' ').trim();
    }
  }

  function paint(){
    scheduled=false;
    const gate=activeGate();
    const view=$('shiftView');
    if(!gate||!view||view.hidden)return;

    const shift=gate.remoteShift||{};
    const name=String(shift.name||'').trim();
    const heading=$('shiftHeading');
    const action=$('shiftMainAction');
    const closed=$('shiftClosed');
    const wrap=$('shiftSummaryWrap');
    const loading=$('shiftLoading');

    if(heading)heading.textContent=`Смена${name?' '+name:''}`;
    if(closed)closed.hidden=true;
    if(action){
      action.dataset.mode=gate.pending==='close'?'close':gate.pending==='open'?'open':'close';
      action.textContent=gate.pending==='close'?'Закрываю смену…':gate.pending==='open'?'Открываю смену…':'Закрыть смену';
      action.disabled=Boolean(gate.pending);
    }

    // If live statistics have not loaded yet, never replace a confirmed open
    // local shift with an error/"Open shift" state. Keep the page usable while
    // the heavy MoySklad summary refresh continues in the background.
    if(wrap?.hidden&&loading){
      loading.hidden=false;
      const opened=name?`Смена ${name} открыта`:'Смена открыта';
      loading.textContent=`${opened} · загружаем статистику…`;
    }

    neutralProfileFallback(gate);
  }

  function schedule(delay=0){
    if(scheduled)return;
    scheduled=true;
    setTimeout(paint,delay);
  }

  function observe(){
    const view=$('shiftView');
    if(!view||observer)return;
    observer=new MutationObserver(()=>schedule(0));
    observer.observe(view,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','disabled','class']});
  }

  function init(){
    observe();
    document.addEventListener('click',event=>{
      if(event.target?.closest?.('#navShift,#shiftChip,#shiftRefresh')){
        schedule(0);setTimeout(()=>{observe();paint()},80);
      }
    },true);
    window.addEventListener('a4:kassa-shift',()=>{schedule(0);setTimeout(paint,80)});
    setInterval(()=>{observe();if(!$('shiftView')?.hidden)paint()},1500);
    schedule(0);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
