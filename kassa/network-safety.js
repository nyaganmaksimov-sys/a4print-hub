(()=>{
  'use strict';
  if(window.__A4_KASSA_NETWORK_SAFETY__)return;
  window.__A4_KASSA_NETWORK_SAFETY__=true;

  const nativeFetch=window.fetch.bind(window);
  const mobile=matchMedia('(max-width:980px)').matches;
  if(!mobile)return;

  const cfg=window.A4PRINT_CONFIG||{};
  const API_ORIGINS=[
    String(cfg.apiBaseUrl||'').replace(/\/$/,''),
    'https://api.a4print-hub.ru',
    'https://a4print-hub-api.onrender.com'
  ].filter((v,i,a)=>v&&a.indexOf(v)===i);
  const PREF_KEY='a4_kassa_api_origin';
  const READ_TIMEOUT=6500;
  const WRITE_TIMEOUT=15000;

  function savedOrigin(){try{const v=localStorage.getItem(PREF_KEY);return API_ORIGINS.includes(v)?v:null}catch{return null}}
  function saveOrigin(v){try{if(v)localStorage.setItem(PREF_KEY,v)}catch{}}
  function clearOrigin(){try{localStorage.removeItem(PREF_KEY)}catch{}}
  function parse(input,init={}){
    try{
      const req=new Request(input,init);
      const url=new URL(req.url);
      const apiOrigin=API_ORIGINS.find(x=>url.origin===x);
      return{req,url,apiOrigin,method:req.method.toUpperCase()};
    }catch{return null}
  }
  function routeUrl(url,origin){
    const base=new URL(origin),target=new URL(url.href);
    target.protocol=base.protocol;target.host=base.host;return target.href;
  }
  async function one(req,url,origin,timeout){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const routed=new Request(routeUrl(url,origin),req);
      const r=await nativeFetch(routed,{signal:controller.signal,cache:'no-store'});
      if(r.ok||r.status<500){saveOrigin(origin);return r}
      throw new Error(`HTTP ${r.status}`);
    }finally{clearTimeout(timer)}
  }
  async function sequential(req,url,origins,timeout){
    let last;
    for(const origin of origins){
      try{return await one(req.clone(),url,origin,timeout)}catch(e){last=e}
    }
    throw last||new Error('API недоступен');
  }

  window.fetch=async function a4SafeFetch(input,init={}){
    const info=parse(input,init);
    if(!info||!info.apiOrigin)return nativeFetch(input,init);
    const {req,url,method}=info;
    const preferred=savedOrigin();
    const ordered=[preferred,info.apiOrigin,...API_ORIGINS].filter((v,i,a)=>v&&a.indexOf(v)===i);
    const risky=/\/api\/v1\/pos\/(?:sale|returns|cashout|shift\/(?:open|close)|orders\/pay)(?:\/|$)/.test(url.pathname);

    if(method==='GET'||method==='HEAD'||/\/api\/v1\/mobile\/auth\/(?:password|refresh)(?:\/|$)/.test(url.pathname)){
      try{return await sequential(req,url,ordered,READ_TIMEOUT)}catch(e){clearOrigin();throw e}
    }

    const origin=preferred||info.apiOrigin||API_ORIGINS[0];
    try{return await one(req.clone(),url,origin,WRITE_TIMEOUT)}
    catch(error){
      if(risky)throw error;
      const alt=ordered.find(x=>x!==origin);if(!alt)throw error;
      try{return await one(req.clone(),url,alt,WRITE_TIMEOUT)}catch(e){clearOrigin();throw e}
    }
  };
})();
