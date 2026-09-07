(()=>{
  'use strict';
  if(window.__A4_KASSA_NETWORK_SAFETY__)return;
  window.__A4_KASSA_NETWORK_SAFETY__=true;

  const nativeFetch=window.fetch.bind(window);
  const DEFAULT_TIMEOUT=12000;
  const SHIFT_READ_TIMEOUT=20000;
  const WRITE_TIMEOUT=45000;

  function infoFor(input,init={}){
    try{
      const raw=input instanceof Request?input.url:String(input||'');
      const u=new URL(raw,location.href);
      const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
      const isShift=/\/api\/v1\/pos\/shift(?:\/|$)/.test(u.pathname);
      const isMoneyWrite=method==='POST'&&/\/api\/v1\/pos\/(?:sale|returns|cashout)(?:\/|$)/.test(u.pathname);
      const isShiftWrite=isShift&&method!=='GET'&&method!=='HEAD';
      return{
        timeout:isShiftWrite||isMoneyWrite?WRITE_TIMEOUT:isShift?SHIFT_READ_TIMEOUT:DEFAULT_TIMEOUT,
        overrideSignal:isShift||isMoneyWrite
      };
    }catch{return{timeout:DEFAULT_TIMEOUT,overrideSignal:false}}
  }

  window.fetch=function a4SafeFetch(input,init={}){
    const info=infoFor(input,init);
    const existingSignal=init?.signal||(input instanceof Request?input.signal:null);
    // The legacy app creates an 8-second AbortController for every API call.
    // For shift and money operations we intentionally replace that signal so a
    // slow MoySklad request is not reported as a fake network outage.
    if(existingSignal&&!info.overrideSignal)return nativeFetch(input,init);

    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),info.timeout);
    return nativeFetch(input,{...init,signal:controller.signal}).finally(()=>clearTimeout(timer));
  };
})();
