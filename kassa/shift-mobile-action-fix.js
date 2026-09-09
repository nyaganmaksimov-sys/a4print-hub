(()=>{
  'use strict';
  if(window.__A4_KASSA_SHIFT_MOBILE_ACTION_FIX__)return;
  window.__A4_KASSA_SHIFT_MOBILE_ACTION_FIX__=true;
  if(!matchMedia('(max-width:980px)').matches)return;

  const cfg=window.A4PRINT_CONFIG||{};
  const createClient=window.supabase?.createClient;
  if(!createClient)return;
  const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{global:{fetch:window.A4SupabaseFetch||fetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const DB=window.A4KassaDB;
  const $=id=>document.getElementById(id);
  let busy=false;

  function toast(text,error=false){const n=$('toast');if(!n)return;n.textContent=text;n.className='toast show'+(error?' error':'');clearTimeout(toast.t);toast.t=setTimeout(()=>n.className='toast',3500)}
  async function token(){const r=await supabase.auth.getSession();if(r.error)throw r.error;const s=r.data?.session;if(!s)throw new Error('Сессия завершена. Войдите снова.');return s.access_token}
  async function api(path,opt={}){const t=await token();const r=await fetch(API+path,{...opt,cache:'no-store',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json',Accept:'application/json',...(opt.headers||{})}});const text=await r.text();let d={};try{d=text?JSON.parse(text):{}}catch{}if(!r.ok)throw new Error(d.message||d.error||`HTTP ${r.status}`);return d}
  function operatorId(){return $('operatorSelect')?.value||$('shiftOperatorSelect')?.value||null}
  async function waitState(wantOpen){for(let i=0;i<16;i++){await new Promise(r=>setTimeout(r,350));try{const d=await api('/api/v1/pos/shift');if(Boolean(d.shift)===wantOpen)return true}catch{}}return false}

  async function handle(e){
    const btn=e.target?.closest?.('#shiftMainAction');if(!btn||busy)return;
    e.preventDefault();e.stopImmediatePropagation();
    const mode=btn.dataset.mode||((window.A4KassaShiftSession?.active)?'close':'open');
    if(mode==='close'){
      try{const q=DB?await DB.getAll('queue'):[];if(q.length){toast(`Сначала синхронизируйте ${q.length} чек(а) из очереди.`,true);$('queueChip')?.click();return}}catch{}
      if(!confirm('Закрыть текущую смену? После закрытия новые продажи потребуют открыть следующую смену.'))return;
    }
    busy=true;btn.disabled=true;btn.textContent=mode==='close'?'Закрываю смену…':'Открываю смену…';
    try{
      const path=mode==='close'?'/api/v1/pos/shift/close':'/api/v1/pos/shift/open';
      await api(path,{method:'POST',body:JSON.stringify({operator_id:operatorId()})});
      const ok=await waitState(mode==='open');
      toast(mode==='close'?'Смена закрыта':'Смена открыта');
      $('shiftRefresh')?.click();
      if(!ok)setTimeout(()=>$('shiftRefresh')?.click(),1000);
    }catch(err){toast(String(err?.message||err||'Не удалось изменить состояние смены.'),true);$('shiftRefresh')?.click()}
    finally{busy=false;btn.disabled=false}
  }

  document.addEventListener('click',handle,true);
})();