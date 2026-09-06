(()=>{
  'use strict';
  const originalFetch=window.fetch.bind(window);
  const DB=window.A4KassaDB;
  const gate={active:false,remoteShift:null,ready:Promise.resolve()};
  if(DB?.setMeta)gate.ready=Promise.resolve(DB.setMeta('shift',null)).catch(()=>{});
  window.A4KassaShiftSession=gate;

  function posShiftUrl(input){
    try{
      const raw=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
      const u=new URL(raw,location.href);
      return /\/api\/v1\/pos\/shift(?:\/|$)/.test(u.pathname)?u:null;
    }catch{return null}
  }
  function methodOf(input,init){return String(init?.method||input?.method||'GET').toUpperCase()}
  function jsonResponse(body,source){
    const headers=new Headers(source?.headers||{});headers.set('content-type','application/json; charset=utf-8');headers.delete('content-length');headers.delete('content-encoding');
    return new Response(JSON.stringify(body),{status:source?.status||200,statusText:source?.statusText||'OK',headers});
  }

  window.fetch=async function a4ManualShiftFetch(input,init={}){
    const u=posShiftUrl(input);const method=methodOf(input,init);
    if(!u)return originalFetch(input,init);

    if(method==='GET'&&/\/api\/v1\/pos\/shift\/?$/.test(u.pathname)&&!gate.active){
      return jsonResponse({success:true,shift:null,summary:null,manualRequired:true});
    }

    const response=await originalFetch(input,init);
    if(!response.ok)return response;

    try{
      if(method==='POST'&&u.pathname.endsWith('/open')){
        const data=await response.clone().json();
        gate.active=!!data?.shift;
        gate.remoteShift=data?.shift||null;
      }else if(method==='POST'&&u.pathname.endsWith('/close')){
        gate.active=false;gate.remoteShift=null;
        await DB?.setMeta?.('shift',null);
      }else if(method==='GET'&&/\/api\/v1\/pos\/shift\/?$/.test(u.pathname)&&gate.active){
        const data=await response.clone().json();
        gate.remoteShift=data?.shift||null;
        if(!data?.shift)gate.active=false;
      }
    }catch{}
    return response;
  };
})();
