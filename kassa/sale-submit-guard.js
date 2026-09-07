(()=>{
  'use strict';
  if(window.__A4_KASSA_SALE_SUBMIT_GUARD__)return;
  window.__A4_KASSA_SALE_SUBMIT_GUARD__=true;

  const $=id=>document.getElementById(id);
  let locked=false;
  let fallbackTimer=null;

  function cartHasItems(){
    const count=String($('cartCount')?.textContent||'').trim();
    const n=parseFloat(count.replace(',','.'));
    return Number.isFinite(n)&&n>0;
  }

  function payReady(){
    const pay=$('payButton');
    return !!pay&&!pay.disabled&&cartHasItems();
  }

  function unlock(){
    locked=false;
    clearTimeout(fallbackTimer);
    fallbackTimer=null;
    const pay=$('payButton');
    if(pay)delete pay.dataset.a4Submitting;
  }

  function arm(){
    if(locked)return false;
    if(!payReady())return false;
    locked=true;
    const pay=$('payButton');
    if(pay)pay.dataset.a4Submitting='1';

    // IndexedDB queueing is normally nearly instant. If an unexpected local
    // storage error leaves the cart intact, release the guard so the cashier
    // can retry instead of getting stuck.
    clearTimeout(fallbackTimer);
    fallbackTimer=setTimeout(()=>{
      if(cartHasItems())unlock();
    },4000);
    return true;
  }

  function block(event){
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  document.addEventListener('click',event=>{
    const pay=event.target?.closest?.('#payButton');
    if(!pay)return;
    if(locked){block(event);return}
    arm();
  },true);

  window.addEventListener('keydown',event=>{
    if(event.key!=='F8')return;
    if(locked){block(event);return}
    arm();
  },true);

  function observeCart(){
    const cart=$('cartItems');
    const count=$('cartCount');
    const onChange=()=>{
      // Successful queueing clears the cart. New items start a fresh sale.
      if(!cartHasItems())unlock();
    };
    const observer=new MutationObserver(onChange);
    if(cart)observer.observe(cart,{childList:true,subtree:true,characterData:true});
    if(count)observer.observe(count,{childList:true,subtree:true,characterData:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observeCart,{once:true});
  else observeCart();
})();
