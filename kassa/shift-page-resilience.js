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
  function setText(el,text){if(el&&el.textContent!==text)el.textContent=text}
  function setHidden(el,value){if(el&&el.hidden!==value)el.hidden=value}
  function setDisabled(el,value){if(el&&el.disabled!==value)el.disabled=value}

  function neutralProfileFallback(gate){
    const error=$('shiftProfileError');
    if(!error||error.hidden)return;
    const text=String(error.textContent||'');
    if(!/abort|failed to fetch|network|связ|таймаут/i.test(text))return;
    setHidden(error,true);
    const loading=$('shiftProfileLoading');
    if(loading){
      setHidden(loading,false);
      setText(loading,`Смена ${gate.remoteShift?.name||''} открыта · профиль обновится автоматически`.replace(/\s+/g,' ').trim());
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

    setText(heading,`Смена${name?' '+name:''}`);
    setHidden(closed,true);
    if(action){
      const mode=gate.pending==='open'?'open':'close';
      if(action.dataset.mode!==mode)action.dataset.mode=mode;
      setText(action,gate.pending==='close'?'Закрываю смену…':gate.pending==='open'?'Открываю смену…':'Закрыть смену');
      setDisabled(action,Boolean(gate.pending));
    }

    // If live statistics have not loaded yet, never replace a confirmed open
    // local shift with an error/"Open shift" state. Keep the page usable while
    // the heavy MoySklad summary refresh continues in the background.
    if(wrap?.hidden&&loading){
      setHidden(loading,false);
      const opened=name?`Смена ${name} открыта`:'Смена открыта';
      setText(loading,`${opened} · загружаем статистику…`);
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
