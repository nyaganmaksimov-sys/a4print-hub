(()=>{
  'use strict';
  if(window.__A4_KASSA_NETWORK_SAFETY__)return;
  window.__A4_KASSA_NETWORK_SAFETY__=true;

  const nativeFetch=window.fetch.bind(window);
  const cfg=window.A4PRINT_CONFIG||{};
  const PRIMARY='https://api.a4print-hub.ru';
  const RENDER='https://a4print-hub-api.onrender.com';
  const configured=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const KNOWN=[PRIMARY,configured,RENDER].filter((v,i,a)=>v&&a.indexOf(v)===i);
  const READ_TIMEOUT=6500;
  const WRITE_TIMEOUT=14000;
  const STAGGER_MS=250;

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  function parse(input,init={}){
    try{
      const req=new Request(input,init);
      const url=new URL(req.url);
      return KNOWN.includes(url.origin)?{req,url,method:req.method.toUpperCase()}:null;
    }catch{return null}
  }

  function routedUrl(url,base){
    const target=new URL(url.href);
    const b=new URL(base);
    target.protocol=b.protocol;
    target.host=b.host;
    return target.href;
  }

  async function one(req,url,base,timeout){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const routed=new Request(routedUrl(url,base),req);
      return await nativeFetch(routed,{signal:controller.signal,cache:'no-store'});
    }finally{clearTimeout(timer)}
  }

  function usable(response){return !!response&&(response.ok||response.status<500)}

  function routeOrder(url){
    const current=url.origin;
    return [current,PRIMARY,configured,RENDER].filter((v,i,a)=>v&&a.indexOf(v)===i);
  }

  async function readWithFailover(req,url){
    const routes=routeOrder(url);
    const attempts=routes.map((base,index)=>(async()=>{
      if(index)await sleep(STAGGER_MS*index);
      const response=await one(req.clone(),url,base,READ_TIMEOUT);
      if(!usable(response))throw new Error(`HTTP ${response.status}`);
      return response;
    })());
    if(typeof Promise.any==='function')return await Promise.any(attempts);
    return await new Promise((resolve,reject)=>{
      let left=attempts.length,lastError;
      attempts.forEach(p=>p.then(resolve,error=>{lastError=error;if(--left===0)reject(lastError)}));
    });
  }

  function isSafeWriteFallback(url){
    const p=url.pathname;
    return /\/api\/v1\/mobile\/auth\/(?:password|refresh)\/?$/.test(p)
      || /\/api\/v1\/pos\/shift\/open\/?$/.test(p)
      || /\/api\/v1\/supabase\/(?:auth|rest)\/v1\//.test(p);
  }

  async function writeWithFailover(req,url){
    const routes=routeOrder(url);
    const allowFallback=isSafeWriteFallback(url);
    let lastError=null;
    for(let i=0;i<routes.length;i++){
      try{
        const response=await one(req.clone(),url,routes[i],WRITE_TIMEOUT);
        if(usable(response))return response;
        lastError=new Error(`HTTP ${response.status}`);
        if(!allowFallback)return response;
      }catch(error){
        lastError=error;
        // A timeout after a financial write is ambiguous: the server may have
        // completed it. Never duplicate those writes on another origin.
        if(!allowFallback||error?.name==='AbortError')throw error;
      }
    }
    throw lastError||new Error('API_UNREACHABLE');
  }

  window.fetch=async function a4SafeFetch(input,init={}){
    const info=parse(input,init);
    if(!info)return nativeFetch(input,init);
    const {req,url,method}=info;
    if(method==='GET'||method==='HEAD')return readWithFailover(req,url);
    return writeWithFailover(req,url);
  };
})();
