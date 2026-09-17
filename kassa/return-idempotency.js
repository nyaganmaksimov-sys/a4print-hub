(()=>{
  'use strict';
  if(window.__A4_KASSA_RETURN_IDEMPOTENCY__)return;
  window.__A4_KASSA_RETURN_IDEMPOTENCY__=true;

  const originalFetch=window.fetch.bind(window);
  const PREFIX='a4_kassa_return_op_v1:';

  function isReturnRequest(input,init){
    const method=String(init?.method||'GET').toUpperCase();
    if(method!=='POST')return false;
    const url=String(typeof input==='string'?input:input?.url||'');
    return /\/api\/v1\/pos\/returns(?:\?|$)/.test(url);
  }

  function stableBody(body){
    const positions=(Array.isArray(body?.positions)?body.positions:[])
      .map(x=>({id:String(x?.id||''),quantity:Number(x?.quantity||0)}))
      .sort((a,b)=>a.id.localeCompare(b.id)||a.quantity-b.quantity);
    return JSON.stringify({
      sale_id:String(body?.sale_id||''),
      positions,
      account_id:String(body?.account_id||''),
      payment_method:String(body?.payment_method||''),
      reason:String(body?.reason||'').trim()
    });
  }

  async function digest(value){
    try{
      if(crypto?.subtle&&typeof TextEncoder!=='undefined'){
        const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
        return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);
      }
    }catch{}
    let h1=2166136261,h2=0x9e3779b9;
    for(let i=0;i<value.length;i++){
      const c=value.charCodeAt(i);h1=Math.imul(h1^c,16777619);h2=Math.imul(h2^c,2246822519);
    }
    return `${(h1>>>0).toString(16).padStart(8,'0')}${(h2>>>0).toString(16).padStart(8,'0')}${value.length.toString(16)}`;
  }

  function uuid(){
    return crypto?.randomUUID?crypto.randomUUID():`ret-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  window.fetch=async function a4ReturnIdempotentFetch(input,init={}){
    if(!isReturnRequest(input,init))return originalFetch(input,init);
    let body;
    try{body=JSON.parse(String(init.body||'{}'))}catch{return originalFetch(input,init)}
    if(!body?.sale_id||!Array.isArray(body?.positions)||!body.positions.length)return originalFetch(input,init);

    const fingerprint=await digest(stableBody(body));
    const storageKey=PREFIX+fingerprint;
    let operationId='';
    try{operationId=sessionStorage.getItem(storageKey)||''}catch{}
    if(!operationId){
      operationId=uuid();
      try{sessionStorage.setItem(storageKey,operationId)}catch{}
    }
    body.client_operation_id=operationId;

    try{
      const response=await originalFetch(input,{...init,body:JSON.stringify(body)});
      if(response.ok){try{sessionStorage.removeItem(storageKey)}catch{}}
      return response;
    }catch(error){
      throw error;
    }
  };
})();