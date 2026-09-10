(()=>{
  'use strict';
  if(window.__A4_KASSA_NETWORK_SAFETY__)return;
  window.__A4_KASSA_NETWORK_SAFETY__=true;

  const nativeFetch=window.fetch.bind(window);
  const mobile=matchMedia('(max-width:980px)').matches;
  if(!mobile)return;

  const CLOUDFLARE_API='https://api.a4print-hub.ru';
  const cfg=window.A4PRINT_CONFIG||{};
  const configured=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const API_ORIGINS=[CLOUDFLARE_API,configured].filter((v,i,a)=>v&&a.indexOf(v)===i&&v!=='https://a4print-hub-api.onrender.com');
  const PREF_KEY='a4_kassa_api_origin';
  const READ_TIMEOUT=5000;
  const WRITE_TIMEOUT=12000;

  // Old builds could remember direct Render. After Cloudflare activation this is harmful on Russian mobile networks.
  try{localStorage.removeItem(PREF_KEY)}catch{}

  function saveOrigin(v){try{if(v)localStorage.setItem(PREF_KEY,v)}catch{}}
  function clearOrigin(){try{localStorage.removeItem(PREF_KEY)}catch{}}
  function parse(input,init={}){
    try{
      const req=new Request(input,init);
      const url=new URL(req.url);
      const known=url.origin===CLOUDFLARE_API||url.origin===configured||url.origin==='https://a4print-hub-api.onrender.com';
      return known?{req,url,method:req.method.toUpperCase()}:null;
    }catch{return null}
  }
  function routeUrl(url){const target=new URL(url.href);const base=new URL(CLOUDFLARE_API);target.protocol=base.protocol;target.host=base.host;return target.href}
  async function one(req,url,timeout){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const routed=new Request(routeUrl(url),req);
      const r=await nativeFetch(routed,{signal:controller.signal,cache:'no-store'});
      if(r.ok||r.status<500){saveOrigin(CLOUDFLARE_API);return r}
      throw new Error(`HTTP ${r.status}`);
    }catch(e){clearOrigin();throw e}
    finally{clearTimeout(timer)}
  }

  window.fetch=async function a4SafeFetch(input,init={}){
    const info=parse(input,init);
    if(!info)return nativeFetch(input,init);
    const {req,url,method}=info;
    const timeout=(method==='GET'||method==='HEAD')?READ_TIMEOUT:WRITE_TIMEOUT;
    return one(req.clone(),url,timeout);
  };
})();
