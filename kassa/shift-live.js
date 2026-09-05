(()=>{
  'use strict';
  const cfg=window.A4PRINT_CONFIG||{};
  const createClient=window.supabase?.createClient;
  if(!createClient)return;
  const client=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
    global:{fetch:window.A4SupabaseFetch||fetch},
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const $=id=>document.getElementById(id);
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  let busy=false;

  function openedText(raw){
    const value=String(raw||'').trim();
    const m=value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    const d=m?new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6]||0)):new Date(value);
    if(Number.isNaN(d.getTime()))return raw||'—';
    const date=d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}).replace(' г.','');
    return `${date} г. в ${d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }

  async function token(){
    const r=await client.auth.getSession();
    if(r.error)throw r.error;
    if(!r.data?.session)throw new Error('Сессия завершена');
    return r.data.session.access_token;
  }

  function set(id,value){const el=$(id);if(el)el.textContent=value}

  function apply(data){
    const shift=data?.shift,d=data?.summary;
    if(!shift||!d)return;
    set('shiftHeading',`Смена ${shift.name||''}`.trim());
    set('shiftOpenedAt',openedText(shift.openDate));
    set('shiftSalesCount',Number(d.sales_count||0).toLocaleString('ru-RU'));
    set('shiftSalesTotal',money(d.sales_total));
    set('shiftSalesCash',money(d.sales_cash));
    set('shiftSalesCashless',money(d.sales_cashless));
    set('shiftReturnsCount',Number(d.returns_count||0).toLocaleString('ru-RU'));
    set('shiftReturnsTotal',money(d.returns_total));
    set('shiftReturnsCash',money(d.returns_cash));
    set('shiftReturnsCashless',money(d.returns_cashless));
    set('shiftDepositsCount',Number(d.deposits_count||0).toLocaleString('ru-RU'));
    set('shiftDepositsTotal',money(d.deposits_total));
    set('shiftPayoutsCount',Number(d.payouts_count||0).toLocaleString('ru-RU'));
    set('shiftPayoutsTotal',money(d.payouts_total));
    set('shiftRevenueTotal',money(d.revenue_total));
    set('shiftRevenueCash',money(d.revenue_cash));
    set('shiftRevenueCashless',money(d.revenue_cashless));
    set('shiftCashRegister',money(d.cash_in_register));
    const note=document.querySelector('.shift-note');
    if(note)note.textContent='Данные получены напрямую из текущей смены МойСклад.';
    const wrap=$('shiftSummaryWrap');if(wrap)wrap.dataset.source='moysklad-live';
  }

  async function refresh(){
    if(busy||$('shiftView')?.hidden!==false)return;
    busy=true;
    try{
      const access=await token();
      const r=await fetch(API+'/api/v1/pos/shift',{cache:'no-store',headers:{Authorization:`Bearer ${access}`,Accept:'application/json'}});
      const data=await r.json().catch(()=>({}));
      if(r.ok&&data?.summary)apply(data);
    }catch(e){console.warn('A4PRINT live shift:',e)}finally{busy=false}
  }

  function init(){
    $('navShift')?.addEventListener('click',()=>{setTimeout(refresh,250);setTimeout(refresh,1100);setTimeout(refresh,2400)});
    $('shiftChip')?.addEventListener('click',()=>{setTimeout(refresh,250);setTimeout(refresh,1100)});
    document.addEventListener('click',e=>{if(e.target?.id==='shiftRefresh')setTimeout(refresh,350)});
    setInterval(refresh,10000);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
