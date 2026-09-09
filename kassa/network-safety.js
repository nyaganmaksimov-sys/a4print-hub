(()=>{
  'use strict';
  if(window.__A4_KASSA_NETWORK_SAFETY__)return;
  window.__A4_KASSA_NETWORK_SAFETY__=true;

  const nativeFetch=window.fetch.bind(window);
  const cfg=window.A4PRINT_CONFIG||{};
  const API_ORIGINS=[
    'https://api.a4print-hub.ru',
    String(cfg.apiBaseUrl||'').replace(/\/$/,''),
    'https://a4print-hub-api.onrender.com'
  ].filter((v,i,a)=>v&&a.indexOf(v)===i);
  const PREF_KEY='a4_kassa_api_origin';
  const READ_TIMEOUT=5000;
  const WRITE_TIMEOUT=12000;

  function savedOrigin(){try{const v=localStorage.getItem(PREF_KEY);return API_ORIGINS.includes(v)?v:null}catch{return null}}
  function saveOrigin(v){try{if(v)localStorage.setItem(PREF_KEY,v)}catch{}}
  function timeoutError(ms){try{return new DOMException(`Сервер не ответил за ${Math.ceil(ms/1000)} сек.`,'TimeoutError')}catch{return new Error('Таймаут сети')}}
  function parse(input,init={}){
    try{
      const req=new Request(input,init);
      const url=new URL(req.url);
      const apiOrigin=API_ORIGINS.find(x=>url.origin===x);
      return{req,url,apiOrigin,method:req.method.toUpperCase()};
    }catch{return null}
  }
  function routeUrl(url,origin){
    const base=new URL(origin);
    const target=new URL(url.href);
    target.protocol=base.protocol;
    target.host=base.host;
    return target.href;
  }
  async function one(req,url,origin,timeout){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(timeoutError(timeout)),timeout);
    try{
      const target=routeUrl(url,origin);
      const routed=new Request(target,req);
      const r=await nativeFetch(routed,{signal:controller.signal});
      if(r.ok||r.status<500){saveOrigin(origin);return r}
      throw new Error(`HTTP ${r.status}`);
    }finally{clearTimeout(timer)}
  }
  async function firstSuccess(promises){
    if(typeof Promise.any==='function')return Promise.any(promises);
    return new Promise((resolve,reject)=>{let left=promises.length,last;promises.forEach(p=>Promise.resolve(p).then(resolve,e=>{last=e;if(--left===0)reject(last)}))});
  }

  window.fetch=async function a4SafeFetch(input,init={}){
    const info=parse(input,init);
    if(!info||!info.apiOrigin)return nativeFetch(input,init);
    const {req,url,method}=info;
    const preferred=savedOrigin();
    const ordered=[preferred,...API_ORIGINS].filter((v,i,a)=>v&&a.indexOf(v)===i);
    const safeRace=method==='GET'||method==='HEAD'||/\/api\/v1\/mobile\/auth\/(?:password|refresh)(?:\/|$)/.test(url.pathname);

    if(safeRace){
      return firstSuccess(ordered.map(origin=>one(req.clone(),url,origin,READ_TIMEOUT)));
    }

    // Never race financial/shift writes: a timed-out request may still complete server-side.
    const origin=preferred||info.apiOrigin;
    try{return await one(req.clone(),url,origin,WRITE_TIMEOUT)}
    catch(error){
      const risky=/\/api\/v1\/pos\/(?:sale|returns|cashout|shift\/(?:open|close)|orders\/pay)(?:\/|$)/.test(url.pathname);
      if(risky)throw error;
      const alt=ordered.find(x=>x!==origin);if(!alt)throw error;
      return one(req.clone(),url,alt,WRITE_TIMEOUT);
    }
  };
})();
