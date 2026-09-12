(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  let syncing=false;
  let refreshTimer=null;

  function state(){return window.A4KassaShiftSession||{active:false,remoteShift:null,openedAt:null,pending:null}}
  function setText(el,text){if(el&&el.textContent!==text)el.textContent=text}
  function setClass(el,value){if(el&&el.className!==value)el.className=value}
  function localShift(gate){return !!gate?.remoteShift&&(gate.remoteShift._local_pending===true||String(gate.remoteShift.id||'').startsWith('local-'))}

  function sync(){
    if(syncing)return;
    syncing=true;
    try{
      const gate=state();
      const active=!!gate.active;
      const pending=gate.pending||null;
      const local=active&&localShift(gate);
      const backgroundSync=local||pending==='sync'||pending==='sync-error';
      const hubName=String(window.A4KassaShiftProfileDisplayName||'').trim();
      const officialName=String(gate.remoteShift?.name||'').trim();
      const name=hubName||officialName;
      let label;
      if(backgroundSync&&active){
        label=pending==='sync-error'?'Смена открыта · ждём синхронизацию':'Смена открыта · синхронизация…';
      }else if(pending==='close'||pending==='sync-close')label='Закрываем смену…';
      else if(pending==='open'&&!active)label='Открываем смену…';
      else label=active?`Смена${name?' '+name:''}`:'Смена не открыта';
      setText($('shiftInfo'),label);
      setText($('footerShift'),label);

      const chip=$('shiftChip');
      if(chip){
        const visuallyOpen=active&&pending!=='close'&&pending!=='sync-close';
        setClass(chip,'status-chip '+(visuallyOpen?'ok':pending?'warn':'warn'));
        setText(chip.querySelector('span'),visuallyOpen?'Смена открыта':pending==='close'||pending==='sync-close'?'Закрываем…':pending==='open'?'Открываем…':'Смена закрыта');
      }

      const oldButton=$('shiftButton');
      if(oldButton){
        const visuallyOpen=active&&pending!=='close'&&pending!=='sync-close';
        setText(oldButton,visuallyOpen?'Закрыть смену':pending==='close'||pending==='sync-close'?'Закрываем…':pending==='open'?'Открываем…':'Открыть смену');
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
    if(reason==='close'||reason==='remote-closed'||reason==='local-close')window.A4KassaShiftProfileDisplayName='';
    sync();
    if(reason==='open'||reason==='close'||reason==='remote-adopted'||reason==='remote-closed'||reason==='sync-complete')scheduleShiftViewRefresh();
    if(reason==='open'||reason==='sync-complete'){
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
