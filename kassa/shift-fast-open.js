(()=>{
  'use strict';
  if(window.__A4_KASSA_FAST_SHIFT_OPEN__)return;
  window.__A4_KASSA_FAST_SHIFT_OPEN__=true;

  const DB=window.A4KassaDB;
  const cfg=window.A4PRINT_CONFIG||{};
  const gate=window.A4KassaShiftSession;
  const previousFetch=window.fetch.bind(window);
  const supabaseGlobal=window.supabase;
  const originalCreate=supabaseGlobal?.createClient?.bind(supabaseGlobal);
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const state={local:null,confirmed:null,openTask:null,lastOpen:null,lastError:null,retryTimer:null};
  window.A4KassaFastShift=state;

  const nowIso=()=>new Date().toISOString();
  const localId=()=>`local-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

  function requestUrl(input){
    try{
      const raw=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
      return new URL(raw,location.href);
    }catch{return null}
  }
  function methodOf(input,init){return String(init?.method||input?.method||'GET').toUpperCase()}
  function isShiftUrl(u){return !!u&&/\/api\/v1\/pos\/shift(?:\/|$)/.test(u.pathname)}
  function isSaleUrl(u){return !!u&&/\/api\/v1\/pos\/sale\/?$/.test(u.pathname)}
  function isLocalShift(shift){return !!shift&&(shift._local_pending===true||String(shift.id||'').startsWith('local-'))}
  function cloneInit(init={}){
    const out={...init};
    if(init.headers instanceof Headers)out.headers=new Headers(init.headers);
    else if(init.headers)out.headers={...init.headers};
    return out;
  }
  function responseJson(body,status=200){
    return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8'}});
  }
  function emit(reason,extra={}){
    const detail={active:!!gate?.active,shift:gate?.remoteShift?{...gate.remoteShift}:null,openedAt:gate?.openedAt||null,pending:gate?.pending||null,reason,...extra};
    queueMicrotask(()=>window.dispatchEvent(new CustomEvent('a4:kassa-shift',{detail})));
  }
  function persistLocal(shift){
    if(!DB?.setMeta)return;
    DB.setMeta('shift',{...shift,checked_at:nowIso()}).catch(error=>console.warn('Fast shift cache:',error));
  }
  function makeLocal(body={}){
    const openedAt=nowIso();
    return{
      id:localId(),name:'',openDate:openedAt,openedAt,
      operator_id:body?.operator_id||null,_local_pending:true,_sync_state:'pending'
    };
  }
  function parseBody(init={}){
    try{return typeof init.body==='string'?JSON.parse(init.body):{}}
    catch{return{}}
  }
  function setLocalActive(shift){
    state.local=shift;state.confirmed=null;state.lastError=null;
    if(gate){gate.active=true;gate.remoteShift=shift;gate.openedAt=shift.openDate||shift.openedAt||nowIso();gate.pending='sync'}
    persistLocal(shift);emit('local-open',{local:true});
  }
  function keepLocalSyncState(reason='sync-start'){
    if(!state.local||!gate)return;
    gate.active=true;gate.remoteShift=state.local;gate.openedAt=state.local.openDate||state.local.openedAt||gate.openedAt||nowIso();gate.pending='sync';
    emit(reason,{local:true});
  }
  function setSyncError(error){
    state.lastError=error;
    if(gate&&isLocalShift(gate.remoteShift)){gate.active=true;gate.pending='sync-error'}
    emit('sync-error',{local:true,message:String(error?.message||error||'')});
  }
  function setConfirmed(data){
    const shift=data?.shift||null;
    if(!shift?.id)return false;
    state.confirmed=shift;state.local=null;state.lastError=null;
    if(gate){gate.active=true;gate.remoteShift=shift;gate.openedAt=shift.openDate||gate.openedAt||nowIso();gate.pending=null}
    DB?.setMeta?.('shift',{...shift,store:data?.store||null,checked_at:nowIso()}).catch(()=>{});
    emit('sync-complete',{local:false});
    setTimeout(()=>{
      const chip=document.getElementById('queueChip');
      const text=String(chip?.textContent||'');
      if(!/Очередь\s+0\b/.test(text))document.getElementById('retryQueue')?.click();
    },100);
    return true;
  }

  async function runRemoteOpen(input,init){
    const response=await previousFetch(input,cloneInit(init));
    const data=await response.clone().json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||data.error||`HTTP ${response.status}`);
    if(!setConfirmed(data))throw new Error('Сервер не вернул созданную смену');
    return data;
  }

  function startRemoteOpen(input,init){
    state.lastOpen={input,init:cloneInit(init)};
    if(state.openTask)return state.openTask;
    const task=runRemoteOpen(input,init)
      .catch(error=>{setSyncError(error);throw error})
      .finally(()=>{if(state.openTask===task)state.openTask=null});
    state.openTask=task;
    // shift-session-gate marks the actual network request as "opening".
    // Restore the cashier-facing state immediately: locally the shift is already open.
    keepLocalSyncState('sync-start');
    task.catch(()=>scheduleRetry());
    return task;
  }

  function scheduleRetry(delay=3000){
    clearTimeout(state.retryTimer);
    if(!state.local&&!isLocalShift(gate?.remoteShift))return;
    state.retryTimer=setTimeout(()=>{ensureRemoteOpen().catch(()=>{})},delay);
  }

  async function ensureRemoteOpen(){
    if(state.confirmed?.id&&!isLocalShift(state.confirmed))return state.confirmed;
    if(gate?.remoteShift?.id&&!isLocalShift(gate.remoteShift)&&gate.active){state.confirmed=gate.remoteShift;return state.confirmed}
    if(state.openTask){await state.openTask;return state.confirmed}
    if(state.lastOpen){await startRemoteOpen(state.lastOpen.input,state.lastOpen.init);return state.confirmed}
    await recoverPending();
    return state.confirmed;
  }

  async function waitForConfirmed(timeoutMs=30000){
    const started=Date.now();
    while(Date.now()-started<timeoutMs){
      const remote=gate?.remoteShift;
      if(remote?.id&&!isLocalShift(remote)){state.confirmed=remote;return remote}
      try{await ensureRemoteOpen()}catch{}
      if(state.confirmed?.id&&!isLocalShift(state.confirmed))return state.confirmed;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw new Error('SHIFT_SYNC_PENDING');
  }

  async function recoverPending(){
    let saved=null;
    try{saved=await DB?.getMeta?.('shift',null)}catch{}
    if(!isLocalShift(saved)&&!isLocalShift(gate?.remoteShift))return null;
    const local=isLocalShift(saved)?saved:gate.remoteShift;
    state.local=local;
    if(gate){gate.active=true;gate.remoteShift=local;gate.openedAt=local.openDate||local.openedAt||nowIso();gate.pending='sync'}
    if(!originalCreate||!API)return null;
    const client=originalCreate(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
    const session=(await client.auth.getSession()).data?.session;
    if(!session?.access_token)return null;
    const init={method:'POST',cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({operator_id:local.operator_id||null})};
    return startRemoteOpen(API+'/api/v1/pos/shift/open',init);
  }

  window.fetch=async function a4FastShiftFetch(input,init={}){
    const u=requestUrl(input),method=methodOf(input,init);

    // A cashier may finish a sale immediately after the local shift opens.
    // Hold only the background sale request until MoySklad confirms the shift;
    // the UI and the local receipt queue remain instant.
    if(method==='POST'&&isSaleUrl(u)&&(state.local||isLocalShift(gate?.remoteShift))&&!state.confirmed){
      await waitForConfirmed(30000);
      const delayed=cloneInit(init);
      delete delayed.signal;
      return previousFetch(input,delayed);
    }

    if(!isShiftUrl(u))return previousFetch(input,init);

    if(method==='POST'&&u.pathname.endsWith('/open')){
      const body=parseBody(init);
      const local=makeLocal(body);
      setLocalActive(local);
      startRemoteOpen(input,init).catch(()=>{});
      return responseJson({success:true,alreadyOpen:false,localPending:true,shift:local,store:null,operator:{id:body.operator_id||null,name:null}});
    }

    if(method==='GET'&&/\/api\/v1\/pos\/shift\/?$/.test(u.pathname)){
      const local=state.local||((gate?.active&&isLocalShift(gate.remoteShift))?gate.remoteShift:null);
      if(local&&!state.confirmed){
        ensureRemoteOpen().catch(()=>{});
        return responseJson({success:true,localPending:true,shift:local,store:null,summary:null});
      }
    }

    if(method==='POST'&&u.pathname.endsWith('/close')&&(state.local||isLocalShift(gate?.remoteShift))&&!state.confirmed){
      const local=state.local||gate.remoteShift;
      const pendingOpen=state.openTask;
      if(gate){gate.active=false;gate.remoteShift=null;gate.openedAt=null;gate.pending='sync-close'}
      DB?.setMeta?.('shift',null).catch(()=>{});emit('local-close',{local:true});
      (async()=>{
        try{
          if(pendingOpen)await pendingOpen;
          else await waitForConfirmed(30000);
          state.local=null;
          await previousFetch(input,cloneInit(init));
          state.confirmed=null;
          if(gate){gate.active=false;gate.remoteShift=null;gate.openedAt=null;gate.pending=null}
          emit('sync-close-complete');
        }catch(error){console.warn('Fast shift close sync:',error)}
      })();
      return responseJson({success:true,localPending:true,shift:local});
    }

    return previousFetch(input,init);
  };

  if(originalCreate){
    supabaseGlobal.createClient=function a4FastShiftCreateClient(...args){
      const client=originalCreate(...args);
      if(!client?.rpc||client.rpc.__a4FastShift)return client;
      const nativeRpc=client.rpc.bind(client);
      const patched=function(fn,params,options){
        if(fn!=='record_pos_sale')return nativeRpc(fn,params,options);
        return (async()=>{
          const next={...(params||{})};
          const current=String(next.p_moysklad_shift_id||'');
          if(!current||current.startsWith('local-')||isLocalShift(state.local)){
            const remote=await waitForConfirmed(30000);
            next.p_moysklad_shift_id=remote.id;
          }
          return await nativeRpc(fn,next,options);
        })();
      };
      patched.__a4FastShift=true;
      client.rpc=patched;
      return client;
    };
  }

  if(isLocalShift(gate?.remoteShift)){state.local=gate.remoteShift;setTimeout(()=>recoverPending().catch(()=>{}),50)}
  window.addEventListener('online',()=>{if(state.local||isLocalShift(gate?.remoteShift))ensureRemoteOpen().catch(()=>{})});
})();
