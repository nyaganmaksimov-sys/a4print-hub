(()=>{
  'use strict';
  if(window.__A4_KASSA_CASH_OPERATION_IDEMPOTENCY__)return;
  window.__A4_KASSA_CASH_OPERATION_IDEMPOTENCY__=true;

  const originalFetch=window.fetch.bind(window);
  const PREFIX='a4_kassa_cash_op_v1:';

  function requestType(input,init){
    const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
    if(method!=='POST')return '';
    const url=String(input instanceof Request?input.url:input||'');
    if(/\/api\/v1\/pos\/cashout(?:\?|$)/.test(url))return 'CASH_OUT';
    if(/\/api\/v1\/pos\/cashin(?:\?|$)/.test(url))return 'CASH_IN';
    return '';
  }

  function stableBody(type,body){
    return JSON.stringify({
      type,
      amount:Number(body?.amount||0),
      reason:String(body?.reason||'').trim(),
      operator_id:String(body?.operator_id||'')
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
      const c=value.charCodeAt(i);
      h1=Math.imul(h1^c,16777619);
      h2=Math.imul(h2^c,2246822519);
    }
    return `${(h1>>>0).toString(16).padStart(8,'0')}${(h2>>>0).toString(16).padStart(8,'0')}${value.length.toString(16)}`;
  }

  function uuid(){
    return crypto?.randomUUID?crypto.randomUUID():`cash-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  window.fetch=async function a4CashOperationIdempotentFetch(input,init={}){
    const type=requestType(input,init);
    if(!type)return originalFetch(input,init);

    let body;
    try{body=JSON.parse(String(init.body||'{}'))}catch{return originalFetch(input,init)}
    if(!(Number(body?.amount)>0))return originalFetch(input,init);

    const fingerprint=await digest(stableBody(type,body));
    const storageKey=PREFIX+fingerprint;
    let operationId='';
    try{operationId=sessionStorage.getItem(storageKey)||''}catch{}
    if(!operationId){
      operationId=uuid();
      try{sessionStorage.setItem(storageKey,operationId)}catch{}
    }
    body.client_operation_id=operationId;

    const response=await originalFetch(input,{...init,body:JSON.stringify(body)});
    if(response.ok){try{sessionStorage.removeItem(storageKey)}catch{}}
    return response;
  };
})();
