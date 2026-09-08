(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  let syncing=false;
  let refreshTimer=null;

  function state(){return window.A4KassaShiftSession||{active:false,remoteShift:null,openedAt:null}}
  function setText(el,text){if(el&&el.textContent!==text)el.textContent=text}
  function setClass(el,value){if(el&&el.className!==value)el.className=value}

  function sync(){
    if(syncing)return;
    syncing=true;
    try{
      const gate=state();
      const active=!!gate.active;
      const hubName=String(window.A4KassaShiftProfileDisplayName||'').trim();
      const officialName=String(gate.remoteShift?.name||'').trim();
      const name=hubName||officialName;
      const label=active?`Смена${name?' '+name:''}`:'Смена не открыта';
      setText($('shiftInfo'),label);
      setText($('footerShift'),label);

      const chip=$('shiftChip');
      if(chip){
        setClass(chip,'status-chip '+(active?'ok':'warn'));
        setText(chip.querySelector('span'),active?'Смена открыта':'Смена закрыта');
      }

      const oldButton=$('shiftButton');
      setText(oldButton,active?'Закрыть смену':'Открыть смену');

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
    },120);
  }

  function onShiftEvent(event){
    if(event?.detail?.reason==='close'||event?.detail?.reason==='remote-closed')window.A4KassaShiftProfileDisplayName='';
    sync();
    scheduleShiftViewRefresh();
    if(event?.detail?.reason==='open'){
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
