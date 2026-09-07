(()=>{
  'use strict';
  if(window.__A4_KASSA_NETWORK_SAFETY__)return;
  window.__A4_KASSA_NETWORK_SAFETY__=true;

  const nativeFetch=window.fetch.bind(window);
  const DEFAULT_TIMEOUT=12000;
  const SHIFT_TIMEOUT=8000;
  const WRITE_TIMEOUT=45000;

  function timeoutFor(input,init={}){
    try{
      const raw=input instanceof Request?input.url:String(input||'');
      const u=new URL(raw,location.href);
      const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
      if(method==='POST'&&/\/api\/v1\/pos\/(?:sale|returns)(?:\/|$)/.test(u.pathname))return WRITE_TIMEOUT;
      if(/\/api\/v1\/pos\/shift(?:\/|$)/.test(u.pathname))return SHIFT_TIMEOUT;
      return DEFAULT_TIMEOUT;
    }catch{return DEFAULT_TIMEOUT}
  }

  window.fetch=function a4SafeFetch(input,init={}){
    const existingSignal=init?.signal||(input instanceof Request?input.signal:null);
    if(existingSignal)return nativeFetch(input,init);

    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutFor(input,init));
    return nativeFetch(input,{...init,signal:controller.signal}).finally(()=>clearTimeout(timer));
  };
})();
