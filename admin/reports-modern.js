import {supabase} from './guard.js?v=20260913-net2';

const $=id=>document.getElementById(id);
const cfg=window.A4PRINT_CONFIG||{};
const apiBase=String(cfg.apiBaseUrl||'https://a4print-hub-api.onrender.com').replace(/\/$/,'');
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>`${Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})} ₽`;
const statusLabels={NEW:'Новые',CONFIRMED:'Подтверждённые',IN_PROGRESS:'В работе',READY:'Готовы',COMPLETED:'Завершённые',DONE:'Завершённые',ON_HOLD:'Приостановленные',CANCELLED:'Отменённые'};
const successPaymentStatuses=new Set(['PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED']);
const state={period:'MONTH',orders:[],payments:[],sales:[],returns:[],cash:null,loading:false,channel:null,warnings:[]};
let realtimeTimer=null;

function periodStart(){
  if(state.period==='ALL')return null;
  const d=new Date();
  if(state.period==='TODAY'){d.setHours(0,0,0,0);return d}
  if(state.period==='MONTH'){d.setDate(1);d.setHours(0,0,0,0);return d}
  d.setDate(d.getDate()-6);d.setHours(0,0,0,0);return d;
}
function inPeriod(value){const start=periodStart();if(!start)return true;const d=new Date(value);return Number.isFinite(d.getTime())&&d>=start}
function ordinaryOrder(row){
  if(String(row?.source||'').toUpperCase()==='KASSA')return false;
  if(String(row?.partner_direction||'').toUpperCase()==='OUTBOUND')return false;
  if(row?.partner_id||row?.fulfillment_partner_id)return false;
  return true;
}
function filtered(){
  return{
    orders:state.orders.filter(x=>inPeriod(x.created_at)),
    payments:state.payments.filter(x=>inPeriod(x.created_at)),
    sales:state.sales.filter(x=>inPeriod(x.sold_at||x.created_at)),
    returns:state.returns.filter(x=>inPeriod(x.returned_at||x.created_at))
  };
}
function paymentIsSuccessful(row){return successPaymentStatuses.has(String(row.status||'').toUpperCase())}
function saleValid(row){return !['FAILED','ERROR','CANCELLED'].includes(String(row.sync_status||'').toUpperCase())}
function returnValid(row){return !['FAILED','ERROR','CANCELLED'].includes(String(row.sync_status||'').toUpperCase())}
function pct(value,max){return max>0?Math.max(3,Math.min(100,(Number(value||0)/max)*100)):0}
function fmtDate(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))return'—';return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}

async function cashBalance(){
  try{
    const {data:{session}}=await supabase.auth.getSession();
    if(!session?.access_token)return null;
    const r=await fetch(`${apiBase}/api/v1/pos/cash-balance`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store'});
    const data=await r.json().catch(()=>null);
    if(!r.ok||!data?.success)return data?{error:data.message||data.error||`HTTP ${r.status}`}:{error:`HTTP ${r.status}`};
    return data;
  }catch(error){return{error:String(error?.message||error)}}
}

async function safe(label,promise,fallback){
  try{const result=await promise;if(result?.error)throw result.error;return result}
  catch(error){state.warnings.push(`${label}: ${error?.message||error}`);console.warn(`Reports ${label} failed`,error);return fallback}
}

async function load(){
  if(state.loading)return;
  state.loading=true;state.warnings=[];
  const refresh=$('refresh');if(refresh){refresh.disabled=true;refresh.textContent='Обновление…'}
  $('syncText').textContent='Обновление данных…';
  try{
    const [orders,payments,sales,returns,cash]=await Promise.all([
      safe('orders',supabase.from('orders').select('id,status,total,source,partner_direction,partner_id,fulfillment_partner_id,created_at').order('created_at',{ascending:false}).limit(5000),{data:[]}),
      safe('payments',supabase.from('payments').select('id,order_id,status,amount,payment_method,created_at').order('created_at',{ascending:false}).limit(5000),{data:[]}),
      safe('sales',supabase.from('pos_sales').select('id,moysklad_sale_name,total,payment_method,sold_at,created_at,sync_status').order('sold_at',{ascending:false}).limit(3000),{data:[]}),
      safe('returns',supabase.from('pos_returns').select('id,moysklad_return_name,amount,payment_method,returned_at,created_at,sync_status').order('returned_at',{ascending:false}).limit(3000),{data:[]}),
      cashBalance()
    ]);
    state.orders=(orders.data||[]).filter(ordinaryOrder);
    const orderIds=new Set(state.orders.map(x=>String(x.id)));
    state.payments=(payments.data||[]).filter(x=>!x.order_id||orderIds.has(String(x.order_id)));
    state.sales=sales.data||[];state.returns=returns.data||[];state.cash=cash;
    render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
    $('syncText').textContent=state.warnings.length?'Часть данных недоступна':'Данные актуальны';
    document.querySelector('.reports-sync-dot')?.classList.toggle('warn',state.warnings.length>0);
  }catch(error){
    console.error('Reports load failed',error);
    $('syncText').textContent='Ошибка обновления';
  }finally{
    state.loading=false;if(refresh){refresh.disabled=false;refresh.textContent='↻ Обновить'}
  }
}

function renderKpis(data){
  const validOrders=data.orders.filter(x=>String(x.status||'').toUpperCase()!=='CANCELLED');
  const orderValue=validOrders.reduce((s,x)=>s+Number(x.total||0),0);
  const paid=data.payments.filter(paymentIsSuccessful).reduce((s,x)=>s+Number(x.amount||0),0);
  const sales=data.sales.filter(saleValid),returns=data.returns.filter(returnValid);
  const gross=sales.reduce((s,x)=>s+Number(x.total||0),0),returned=returns.reduce((s,x)=>s+Number(x.amount||0),0);
  $('ordersKpi').textContent=data.orders.length;
  $('ordersValueKpi').textContent=money(orderValue);
  $('paidKpi').textContent=money(paid);
  $('paidKpiNote').textContent=data.payments.length?'подтверждённые оплаты за период':'оплат за период нет';
  $('kassaKpi').textContent=money(gross-returned);
  $('kassaKpiNote').textContent=`продажи ${money(gross)} · возвраты ${money(returned)}`;
  $('cashKpi').textContent=state.cash?.cash!=null?money(state.cash.cash):'—';
  $('cashKpiNote').textContent=state.cash?.error?'остаток временно недоступен':(state.cash?.source==='MOYSKLAD_LEDGER'?'по журналу МойСклад':'текущий остаток');
}

function renderStatuses(data){
  const map={};for(const o of data.orders){const key=String(o.status||'UNKNOWN').toUpperCase();map[key]=(map[key]||0)+1}
  const max=Math.max(0,...Object.values(map));
  $('statusRows').innerHTML=Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([key,value])=>`<div class="report-row"><div class="report-row-main"><div class="report-row-title">${esc(statusLabels[key]||key)}</div><div class="report-bar"><i style="width:${pct(value,max)}%"></i></div></div><div class="report-row-value">${value}</div></div>`).join('')||'<div class="reports-empty">За выбранный период обычных заказов HUB нет</div>';
}

function renderKassa(data){
  const sales=data.sales.filter(saleValid),returns=data.returns.filter(returnValid),methods={};
  for(const s of sales){const k=s.payment_method||'Не указан';const x=methods[k]||(methods[k]={sales:0,returns:0,count:0});x.sales+=Number(s.total||0);x.count++}
  for(const r of returns){const k=r.payment_method||'Не указан';const x=methods[k]||(methods[k]={sales:0,returns:0,count:0});x.returns+=Number(r.amount||0)}
  const rows=Object.entries(methods).sort((a,b)=>(b[1].sales-b[1].returns)-(a[1].sales-a[1].returns));
  $('paymentRows').innerHTML=rows.map(([name,x])=>`<div class="report-money-line"><span>${esc(name)} <small>${x.count} продаж</small></span><b>${money(x.sales-x.returns)}</b></div>`).join('')||'<div class="reports-empty">Операций KASSA за выбранный период нет</div>';
}

function renderLedger(){
  const c=state.cash;
  if(!c||c.error||c.cash==null){$('ledger').innerHTML=`<div class="reports-empty ${c?.error?'reports-error':''}">${esc(c?.error||'Остаток кассы недоступен')}</div>`;$('ledgerNote').textContent='';return}
  const base=Number(c.baseline?.amount||0),delta=Number(c.delta||0),cash=Number(c.cash||0);
  $('ledger').innerHTML=`<div class="reports-ledger-cell"><span>База</span><b>${money(base)}</b></div><div class="reports-ledger-cell"><span>Изменение</span><b>${delta>=0?'+ ':''}${money(delta)}</b></div><div class="reports-ledger-cell accent"><span>Сейчас</span><b>${money(cash)}</b></div>`;
  const t=c.totals||{};$('ledgerNote').textContent=`Наличные продажи ${money(t.cash_sales)} · возвраты ${money(t.cash_returns)} · внесения ${money(t.cash_in)} · изъятия ${money(t.cash_out)}`;
}

function renderActivity(data){
  const events=[
    ...data.orders.map(x=>({time:x.created_at,type:'Заказ',name:`Заказ · ${statusLabels[String(x.status||'').toUpperCase()]||x.status||'без статуса'}`,amount:Number(x.total||0),tone:'order'})),
    ...data.sales.filter(saleValid).map(x=>({time:x.sold_at||x.created_at,type:'Продажа',name:x.moysklad_sale_name?`Чек №${x.moysklad_sale_name}`:'Продажа KASSA',amount:Number(x.total||0),tone:'plus'})),
    ...data.returns.filter(returnValid).map(x=>({time:x.returned_at||x.created_at,type:'Возврат',name:x.moysklad_return_name?`Возврат №${x.moysklad_return_name}`:'Возврат KASSA',amount:Number(x.amount||0),tone:'minus'}))
  ].sort((a,b)=>new Date(b.time)-new Date(a.time)).slice(0,10);
  $('activity').innerHTML=events.map(x=>`<div class="activity-row"><span class="activity-time">${esc(fmtDate(x.time))}</span><span class="activity-main"><b>${esc(x.name)}</b><small>${esc(x.type)}</small></span><span class="activity-amount ${x.tone}">${x.tone==='minus'?'− ':x.tone==='plus'?'+ ':''}${money(x.amount)}</span></div>`).join('')||'<div class="reports-empty">За выбранный период активности нет</div>';
}

function render(){const data=filtered();renderKpis(data);renderStatuses(data);renderKassa(data);renderLedger();renderActivity(data)}

function initPeriod(){
  document.querySelectorAll('[data-period]').forEach(btn=>btn.addEventListener('click',()=>{
    state.period=btn.dataset.period;
    document.querySelectorAll('[data-period]').forEach(x=>x.classList.toggle('active',x===btn));
    render();
  }));
}
function initRealtime(){
  if(typeof supabase.channel!=='function')return;
  const reload=()=>{clearTimeout(realtimeTimer);realtimeTimer=setTimeout(load,900)};
  let ch=supabase.channel('reports-live-v3');
  for(const table of ['orders','payments','pos_sales','pos_returns'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);
  state.channel=ch.subscribe();
  window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true});
}

$('refresh')?.addEventListener('click',load);
initPeriod();
load().finally(initRealtime);
