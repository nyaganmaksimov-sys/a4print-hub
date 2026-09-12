(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  let syncing=false;
  let refreshTimer=null;

  function state(){return window.A4KassaShiftSession||{active:false,remoteShift:null,openedAt:null,pending:null}}
  function setText(el,text){if(el&&el.textContent!==text)el.textContent=text}
  function setClass(el,value){if(el&&el.className!==value)el.className=value}

  function sync(){
    if(syncing)return;
    syncing=true;
    try{
      const gate=state();
      const active=!!gate.active;
      const pending=gate.pending||null;
      const hubName=String(window.A4KassaShiftProfileDisplayName||'').trim();
      const officialName=String(gate.remoteShift?.name||'').trim();
      const name=hubName||officialName;
      const label=pending==='open'?'Открываем смену…':pending==='close'?'Закрываем смену…':active?`Смена${name?' '+name:''}`:'Смена не открыта';
      setText($('shiftInfo'),label);
      setText($('footerShift'),label);

      const chip=$('shiftChip');
      if(chip){
        setClass(chip,'status-chip '+(pending?'warn':active?'ok':'warn'));
        setText(chip.querySelector('span'),pending==='open'?'Открываем…':pending==='close'?'Закрываем…':active?'Смена открыта':'Смена закрыта');
      }

      const oldButton=$('shiftButton');
      if(oldButton){
        setText(oldButton,pending==='open'?'Открываем…':pending==='close'?'Закрываем…':active?'Закрыть смену':'Открыть смену');
      }

      const toast=$('toast');
      if(toast&&/Подключились к открытой смене/i.test(toast.textContent||''))setText(toast,'Смена открыта');
    }finally{
      syncing=false;
    }
  }

  function scheduleShiftViewRefresh(){
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(()=>{
      const view=$('shiftView');
      if(view&&view.hidden===false)$('shiftRefresh')?.click();
    },250);
  }

  function onShiftEvent(event){
    const reason=event?.detail?.reason;
    if(reason==='close'||reason==='remote-closed')window.A4KassaShiftProfileDisplayName='';
    sync();
    if(reason==='open'||reason==='close'||reason==='remote-adopted'||reason==='remote-closed')scheduleShiftViewRefresh();
    if(reason==='open'){
      setTimeout(()=>{
        const toast=$('toast');
        if(toast&&/Подключились к открытой смене/i.test(toast.textContent||''))setText(toast,'Смена открыта');
      },150);
    }
  }

  function init(){
    sync();
    window.addEventListener('a4:kassa-shift',onShiftEvent);
    // Safety reconciliation only. No MutationObserver: it can create feedback loops
    // when the synchronization itself updates the observed elements.
    setInterval(sync,5000);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
