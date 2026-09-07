(()=>{
  'use strict';
  if(window.__A4_KASSA_REPORT_SOURCE__)return;
  window.__A4_KASSA_REPORT_SOURCE__=true;
  const cfg=window.A4PRINT_CONFIG||{};
  const createClient=window.supabase?.createClient;if(!createClient)return;
  const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{global:{fetch:window.A4SupabaseFetch||fetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const DB=window.A4KassaDB;
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const $=id=>document.getElementById(id);
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})+' ₽';
  let timer=null;
  let liveTimer=null;

  async function range(){
    const active=document.querySelector('[data-report-period].active')?.dataset.reportPeriod||'today';
    const now=new Date(),end=new Date(now.getTime()+1000);let start;
    if(active==='shift'){
      const shift=DB?await DB.getMeta('shift'):null;
      if(!shift?.openDate)return null;
      start=new Date(shift.openDate);
    }else if(active==='today'){start=new Date(now);start.setHours(0,0,0,0)}
    else if(active==='7d'){start=new Date(now);start.setDate(start.getDate()-7)}
    else if(active==='30d'){start=new Date(now);start.setDate(start.getDate()-30)}
    else start=new Date(now.getFullYear(),0,1);
    return{start,end};
  }

  function ensureCashCard(){
    let card=$('reportCashRegisterCard');
    if(card)return card;
    const grid=$('reportSalesTotal')?.closest('.stats-grid');
    if(!grid)return null;
    card=document.createElement('article');
    card.id='reportCashRegisterCard';
    card.className='stat-card cash-stat';
    card.innerHTML='<span>Наличные в кассе</span><strong id="reportCashRegister">—</strong><small id="reportCashRegisterNote">МойСклад</small>';
    grid.append(card);
    return card;
  }

  async function accessToken(){
    const r=await supabase.auth.getSession();
    const session=r.data?.session||null;
    if(!session)return null;
    return session.access_token;
  }

  async function fetchCashBalance(retry=true){
    if(!API)return null;
    let token=await accessToken();
    if(!token)return null;
    const response=await fetch(`${API}/api/v1/pos/cash-balance?report_cash=${Date.now()}`,{
      cache:'no-store',
      headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}
    });
    if(response.status===401&&retry){
      const refreshed=await supabase.auth.refreshSession();
      if(refreshed.data?.session)return fetchCashBalance(false);
    }
    const data=await response.json().catch(()=>null);
    if(!response.ok)return data||{success:false};
    return data;
  }

  async function refreshCash(){
    const card=ensureCashCard();if(!card)return;
    const value=$('reportCashRegister'),note=$('reportCashRegisterNote');
    try{
      const status=await fetchCashBalance();
      const cash=Number(status?.cash);
      if(status?.success&&status?.available&&Number.isFinite(cash)){
        value.textContent=money(cash);
        note.textContent=status?.shift?`Смена ${status.shift.name||''} · МойСклад`.trim():'МойСклад · смена не открыта';
        return;
      }
      value.textContent='—';
      note.textContent='Остаток МойСклад недоступен';
    }catch{
      value.textContent='—';
      note.textContent='Не удалось получить остаток';
    }
  }

  async function refresh(){
    if($('reportsView')?.hidden)return;
    ensureCashCard();
    refreshCash().catch(()=>{});
    const r=await range();if(!r)return;
    const operator=$('reportOperator')&&!$('reportOperator').hidden&&$('reportOperator').value?$('reportOperator').value:null;
    const out=await supabase.rpc('pos_dashboard',{p_from:r.start.toISOString(),p_to:r.end.toISOString(),p_operator_id:operator});
    if(out.error)return;
    const card=$('reportSalesCount')?.closest('.stat-card');if(!card)return;
    let note=$('reportSourceNote');
    if(!note){note=document.createElement('small');note.id='reportSourceNote';note.style.cssText='display:block;margin-top:6px;color:#718096;font-size:11px;line-height:1.35';card.append(note)}
    const d=out.data||{};
    note.textContent=`A4PRINT KASSA: ${Number(d.sales_kassa_count||0).toLocaleString('ru-RU')} · из МойСклад: ${Number(d.sales_imported_count||0).toLocaleString('ru-RU')}`;
  }

  function schedule(){clearTimeout(timer);timer=setTimeout(()=>refresh().catch(()=>{}),350)}
  function maintainLiveCash(){
    clearInterval(liveTimer);
    liveTimer=setInterval(()=>{if(!$('reportsView')?.hidden)refreshCash().catch(()=>{})},15000);
  }
  document.addEventListener('click',e=>{if(e.target?.closest?.('[data-section="reports"],[data-report-period]'))schedule()},true);
  document.addEventListener('change',e=>{if(e.target?.id==='reportOperator')schedule()},true);
  window.addEventListener('a4:kassa-shift',()=>{if(!$('reportsView')?.hidden)refreshCash().catch(()=>{})});
  window.addEventListener('a4:kassa-cash-operation',()=>{if(!$('reportsView')?.hidden)refreshCash().catch(()=>{})});
  window.addEventListener('a4:kassa-cash-balance',e=>{
    if($('reportsView')?.hidden)return;
    const cash=Number(e.detail?.cash);
    if(e.detail?.available&&Number.isFinite(cash)){
      const value=$('reportCashRegister'),note=$('reportCashRegisterNote');
      if(value)value.textContent=money(cash);
      if(note)note.textContent=e.detail?.data?.shift?`Смена ${e.detail.data.shift.name||''} · МойСклад`.trim():'МойСклад · смена не открыта';
    }
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{ensureCashCard();maintainLiveCash()},{once:true});
  else{ensureCashCard();maintainLiveCash()}
})();
