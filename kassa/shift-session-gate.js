(()=>{
  'use strict';
  const originalFetch=window.fetch.bind(window);
  const DB=window.A4KassaDB;
  const gate={active:false,remoteShift:null,openedAt:null,ready:null,pending:null};
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
    const headers=new Headers(source?.headers||{});
    headers.set('content-type','application/json; charset=utf-8');
    headers.delete('content-length');headers.delete('content-encoding');
    return new Response(JSON.stringify(body),{status:source?.status||200,statusText:source?.statusText||'OK',headers});
  }
  function closedResponse(source){return jsonResponse({success:true,shift:null,summary:null,manualRequired:true},source)}
  function emit(reason){
    const detail={active:!!gate.active,shift:gate.remoteShift?{...gate.remoteShift}:null,openedAt:gate.openedAt,pending:gate.pending,reason};
    queueMicrotask(()=>window.dispatchEvent(new CustomEvent('a4:kassa-shift',{detail})));
  }
  async function saveShift(shift,extra={}){
    if(!DB?.setMeta)return;
    if(!shift){await DB.setMeta('shift',null);return}
    await DB.setMeta('shift',{...shift,...extra,checked_at:new Date().toISOString()});
  }
  function saveShiftInBackground(shift,extra={}){
    Promise.resolve(saveShift(shift,extra)).catch(error=>console.warn('Shift session cache:',error));
  }
  async function restore(){
    try{
      const saved=await DB?.getMeta?.('shift',null);
      if(saved?.id){gate.active=true;gate.remoteShift=saved;gate.openedAt=saved.openDate||saved.openedAt||null}
    }catch(error){console.warn('Shift session restore:',error)}
  }
  gate.ready=restore();

  window.fetch=async function a4ShiftSessionFetch(input,init={}){
    const u=posShiftUrl(input),method=methodOf(input,init);
    if(!u)return originalFetch(input,init);

    const opening=method==='POST'&&u.pathname.endsWith('/open');
    const closing=method==='POST'&&u.pathname.endsWith('/close');
    if(opening||closing){gate.pending=opening?'open':'close';emit(opening?'opening':'closing')}

    let response;
    try{response=await originalFetch(input,init)}
    catch(error){
      if(opening||closing){gate.pending=null;emit(opening?'open-error':'close-error')}
      throw error;
    }
    if(!response.ok){
      if(opening||closing){gate.pending=null;emit(opening?'open-error':'close-error')}
      return response;
    }

    try{
      if(opening){
        const data=await response.clone().json();
        gate.pending=null;gate.active=!!data?.shift;gate.remoteShift=data?.shift||null;gate.openedAt=data?.shift?.openDate||data?.shift?.moment||new Date().toISOString();
        saveShiftInBackground(gate.remoteShift,{store:data?.store||null});
        emit('open');
        return jsonResponse(data,response);
      }

      if(closing){
        gate.pending=null;gate.active=false;gate.remoteShift=null;gate.openedAt=null;
        saveShiftInBackground(null);emit('close');return response;
      }

      if(method==='GET'&&/\/api\/v1\/pos\/shift\/?$/.test(u.pathname)){
        const data=await response.clone().json();const liveShift=data?.shift||null;
        if(liveShift){
          const wasActive=gate.active;
          gate.active=true;gate.remoteShift=liveShift;gate.openedAt=liveShift.openDate||gate.openedAt||new Date().toISOString();
          saveShiftInBackground(liveShift,{store:data?.store||null});
          if(!wasActive)emit('remote-adopted');
          return response;
        }
        if(gate.active){gate.active=false;gate.remoteShift=null;gate.openedAt=null;saveShiftInBackground(null);emit('remote-closed')}
        return closedResponse(response);
      }
    }catch(error){console.warn('Shift session gate:',error)}
    return response;
  };
})();
