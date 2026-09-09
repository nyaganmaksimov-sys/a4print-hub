(()=>{
  'use strict';
  const originalFetch=window.fetch.bind(window);
  const DB=window.A4KassaDB;
  const gate={active:false,remoteShift:null,openedAt:null,ready:null};
  window.A4KassaShiftSession=gate;

  function posShiftUrl(input){
    try{
      const raw=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
      const u=new URL(raw,location.href);
      return /\/api\/v1\/pos\/shift(?:\/|$)/.test(u.pathname)?u:null;
    }catch{return null}
  }
  function methodOf(input,init){return String(init?.method||input?.method||'GET').toUpperCase()}
  function idOf(shift){return String(shift?.id||'').trim()}
  function sameShift(a,b){const aa=idOf(a),bb=idOf(b);return !!aa&&aa===bb}
  function jsonResponse(body,source){
    const headers=new Headers(source?.headers||{});
    headers.set('content-type','application/json; charset=utf-8');
    headers.delete('content-length');headers.delete('content-encoding');
    return new Response(JSON.stringify(body),{status:source?.status||200,statusText:source?.statusText||'OK',headers});
  }
  function closedResponse(source){return jsonResponse({success:true,shift:null,summary:null,manualRequired:true},source)}
  function emit(reason){
    const detail={active:!!gate.active,shift:gate.remoteShift?{...gate.remoteShift}:null,openedAt:gate.openedAt,reason};
    queueMicrotask(()=>window.dispatchEvent(new CustomEvent('a4:kassa-shift',{detail})));
  }
  async function saveShift(shift,extra={}){
    if(!DB?.setMeta)return;
    if(!shift){await DB.setMeta('shift',null);return}
    await DB.setMeta('shift',{...shift,...extra,checked_at:new Date().toISOString()});
  }
  async function restore(){
    try{
      const saved=await DB?.getMeta?.('shift',null);
      if(saved?.id){gate.active=true;gate.remoteShift=saved;gate.openedAt=saved.openDate||saved.openedAt||null}
    }catch(error){console.warn('Shift session restore:',error)}
  }
  gate.ready=restore();

  async function liveStatus(openUrl,input,init){
    try{
      const statusUrl=new URL(openUrl.href);statusUrl.pathname=statusUrl.pathname.replace(/\/open\/?$/,'');
      const sourceHeaders=init?.headers||input?.headers||undefined;
      const response=await originalFetch(statusUrl.href,{method:'GET',headers:sourceHeaders,cache:'no-store'});
      if(!response.ok)return null;
      return await response.json().catch(()=>null);
    }catch{return null}
  }

  window.fetch=async function a4ShiftSessionFetch(input,init={}){
    const u=posShiftUrl(input),method=methodOf(input,init);
    if(!u)return originalFetch(input,init);
    const response=await originalFetch(input,init);
    if(!response.ok)return response;

    try{
      if(method==='POST'&&u.pathname.endsWith('/open')){
        let data=await response.clone().json();
        const live=await liveStatus(u,input,init);
        if(live?.shift)data={...data,shift:live.shift,store:live.store||data.store,organization:live.organization||data.organization,summary:live.summary||data.summary};
        gate.active=!!data?.shift;gate.remoteShift=data?.shift||null;gate.openedAt=data?.shift?.openDate||data?.shift?.moment||new Date().toISOString();
        await saveShift(gate.remoteShift,{store:data?.store||null});emit('open');return jsonResponse(data,response);
      }

      if(method==='POST'&&u.pathname.endsWith('/close')){
        gate.active=false;gate.remoteShift=null;gate.openedAt=null;await saveShift(null);emit('close');return response;
      }

      if(method==='GET'&&/\/api\/v1\/pos\/shift\/?$/.test(u.pathname)){
        const data=await response.clone().json();const liveShift=data?.shift||null;
        if(liveShift){
          const wasActive=gate.active;
          gate.active=true;gate.remoteShift=liveShift;gate.openedAt=liveShift.openDate||gate.openedAt||new Date().toISOString();
          await saveShift(liveShift,{store:data?.store||null});
          if(!wasActive)emit('remote-adopted');
          return response;
        }
        if(gate.active){gate.active=false;gate.remoteShift=null;gate.openedAt=null;await saveShift(null);emit('remote-closed')}
        return closedResponse(response);
      }
    }catch(error){console.warn('Shift session gate:',error)}
    return response;
  };
})();
