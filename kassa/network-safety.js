(()=>{
  'use strict';
  if(window.__A4_KASSA_NETWORK_SAFETY__)return;
  window.__A4_KASSA_NETWORK_SAFETY__=true;

  const nativeFetch=window.fetch.bind(window);
  const DEFAULT_TIMEOUT=10000;
  const SHORT_TIMEOUT=7000;

  function timeoutFor(input){
    try{
      const raw=input instanceof Request?input.url:String(input||'');
      const u=new URL(raw,location.href);
      if(/\/api\/v1\/pos\/shift(?:\/|$)/.test(u.pathname))return SHORT_TIMEOUT;
      return DEFAULT_TIMEOUT;
    }catch{return DEFAULT_TIMEOUT}
  }

  window.fetch=function a4SafeFetch(input,init={}){
    const existingSignal=init?.signal||(input instanceof Request?input.signal:null);
    if(existingSignal)return nativeFetch(input,init);

    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutFor(input));
    return nativeFetch(input,{...init,signal:controller.signal}).finally(()=>clearTimeout(timer));
  };
})();
