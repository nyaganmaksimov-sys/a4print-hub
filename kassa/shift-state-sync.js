(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  let syncing=false;

  function state(){return window.A4KassaShiftSession||{active:false,remoteShift:null,openedAt:null}}
  function setText(el,text){if(el&&el.textContent!==text)el.textContent=text}
  function sync(){
    if(syncing)return;
    syncing=true;
    try{
      const gate=state();
      const active=!!gate.active;
      const name=String(gate.remoteShift?.name||'').trim();
      const label=active?`Смена${name?' '+name:''}`:'Смена не открыта';
      setText($('shiftInfo'),label);
      setText($('footerShift'),label);
      const chip=$('shiftChip');
      if(chip){
        chip.className='status-chip '+(active?'ok':'warn');
        setText(chip.querySelector('span'),active?'Смена открыта':'Смена закрыта');
      }
      const oldButton=$('shiftButton');
      if(oldButton)setText(oldButton,active?'Закрыть смену':'Открыть смену');
      const toast=$('toast');
      if(toast&&/Подключились к открытой смене/i.test(toast.textContent||''))setText(toast,'Смена открыта');
    }finally{syncing=false}
  }

  function onShiftEvent(event){
    sync();
    const view=$('shiftView');
    if(view&&view.hidden===false){
      setTimeout(()=>{$('shiftRefresh')?.click()},40);
    }
    if(event?.detail?.reason==='open')setTimeout(()=>{
      const toast=$('toast');
      if(toast&&/Подключились к открытой смене/i.test(toast.textContent||''))setText(toast,'Смена открыта');
    },120);
  }

  function observe(el){
    if(!el)return;
    new MutationObserver(()=>queueMicrotask(sync)).observe(el,{childList:true,subtree:true,characterData:true,attributes:true});
  }
  function init(){
    sync();
    observe($('shiftInfo'));
    observe($('shiftChip'));
    observe($('toast'));
    window.addEventListener('a4:kassa-shift',onShiftEvent);
    setInterval(sync,1500);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
