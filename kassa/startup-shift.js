(()=>{
  'use strict';
  if(window.__A4_KASSA_STARTUP_SHIFT__)return;
  window.__A4_KASSA_STARTUP_SHIFT__=true;

  // Do not force-open the shift page after login.
  // Mobile networks can make the shift status request slow; the cashier should
  // always land on the usable sale screen and open Shift explicitly when needed.
  function keepSaleVisible(){
    const app=document.getElementById('appView');
    const auth=document.getElementById('authView');
    if(!app||app.hidden||!auth||!auth.hidden)return;
    const sale=document.querySelector('[data-section="sale"]');
    const shift=document.getElementById('shiftView');
    if(shift&&!shift.hidden)return; // user explicitly opened Shift; do not interfere
    if(sale&&!sale.classList.contains('active'))sale.click();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(keepSaleVisible,0),{once:true});
  else setTimeout(keepSaleVisible,0);
})();
