(()=>{
  'use strict';
  const originalFetch=window.fetch.bind(window);
  const DB=window.A4KassaDB;
  const gate={active:false,remoteShift:null,openedAt:null,ready:Promise.resolve()};
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
  function withManualOpenDate(data){
    if(!data?.shift||!gate.openedAt)return data;
    return {...data,shift:{...data.shift,moyskladOpenDate:data.shift.moyskladOpenDate||data.shift.openDate,openDate:gate.openedAt}};
  }
  function emit(reason){
    const detail={active:!!gate.active,shift:gate.remoteShift?{...gate.remoteShift}:null,openedAt:gate.openedAt,reason};
    queueMicrotask(()=>window.dispatchEvent(new CustomEvent('a4:kassa-shift',{detail})));
  }
  async function liveStatus(openUrl,input,init){
    try{
      const statusUrl=new URL(openUrl.href);
      statusUrl.pathname=statusUrl.pathname.replace(/\/open\/?$/,'');
      const sourceHeaders=init?.headers||input?.headers||undefined;
      const response=await originalFetch(statusUrl.href,{method:'GET',headers:sourceHeaders,cache:'no-store'});
      if(!response.ok)return null;
      return await response.json().catch(()=>null);
    }catch{return null}
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
        let data=await response.clone().json();
        const live=await liveStatus(u,input,init);
        if(live?.shift)data={...data,shift:live.shift,store:live.store||data.store,organization:live.organization||data.organization,summary:live.summary||data.summary};
        gate.active=!!data?.shift;
        gate.remoteShift=data?.shift||null;
        gate.openedAt=gate.active?new Date().toISOString():null;
        emit('open');
        return jsonResponse(withManualOpenDate(data),response);
      }
      if(method==='POST'&&u.pathname.endsWith('/close')){
        gate.active=false;gate.remoteShift=null;gate.openedAt=null;
        await DB?.setMeta?.('shift',null);
        emit('close');
        return response;
      }
      if(method==='GET'&&/\/api\/v1\/pos\/shift\/?$/.test(u.pathname)&&gate.active){
        const data=await response.clone().json();
        gate.remoteShift=data?.shift||null;
        if(!data?.shift){gate.active=false;gate.openedAt=null;emit('remote-closed');return response}
        return jsonResponse(withManualOpenDate(data),response);
      }
    }catch{}
    return response;
  };
})();
