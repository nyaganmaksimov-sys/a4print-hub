import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const cfg=window.A4PRINT_CONFIG||{};
const apiBase=String(cfg.apiBaseUrl||'https://a4print-hub-api.onrender.com').replace(/\/$/,'');
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>`${Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})} ₽`;
const statusLabels={NEW:'Новые',CONFIRMED:'Подтверждённые',IN_PROGRESS:'В работе',READY:'Готовы',COMPLETED:'Завершённые',ON_HOLD:'Приостановленные',CANCELLED:'Отменённые'};
const unitLabels={A4_PRINT:'А4-Принт','3D_ARTPRINT':'3D-ARTPRINT',COMMON:'Общие'};
const successPaymentStatuses=new Set(['PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED']);
const state={period:'TODAY',orders:[],payments:[],sales:[],returns:[],customers:0,items:0,cash:null,loading:false,channel:null};
let realtimeTimer=null;

function periodStart(){
  if(state.period==='ALL')return null;
  const d=new Date();
  if(state.period==='TODAY'){d.setHours(0,0,0,0);return d}
  const days=state.period==='7D'?7:30;
  d.setDate(d.getDate()-(days-1));d.setHours(0,0,0,0);return d;
}
function inPeriod(value){const start=periodStart();if(!start)return true;const d=new Date(value);return Number.isFinite(d.getTime())&&d>=start}
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
function pct(value,max){return max>0?Math.max(2,Math.min(100,(Number(value||0)/max)*100)):0}
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

async function load(){
  if(state.loading)return;
  state.loading=true;
  const refresh=$('refresh');if(refresh){refresh.disabled=true;refresh.textContent='Обновление…'}
  try{
    const [orders,payments,sales,returns,customers,items,cash]=await Promise.all([
      supabase.from('orders').select('id,status,total,business_unit,partner_id,fulfillment_partner_id,created_at').order('created_at',{ascending:false}).limit(5000),
      supabase.from('payments').select('id,order_id,status,amount,payment_method,created_at').order('created_at',{ascending:false}).limit(5000),
      supabase.from('pos_sales').select('id,moysklad_sale_name,total,payment_method,sold_at,created_at,sync_status').order('sold_at',{ascending:false}).limit(3000),
      supabase.from('pos_returns').select('id,moysklad_return_name,amount,payment_method,returned_at,created_at,sync_status').order('returned_at',{ascending:false}).limit(3000),
      supabase.from('customers').select('id',{count:'exact',head:true}),
      supabase.from('catalog_items').select('id',{count:'exact',head:true}),
      cashBalance()
    ]);
    for(const r of [orders,payments,sales,returns,customers,items])if(r.error)throw r.error;
    state.orders=orders.data||[];state.payments=payments.data||[];state.sales=sales.data||[];state.returns=returns.data||[];
    state.customers=customers.count||0;state.items=items.count||0;state.cash=cash;
    render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
    $('syncText').textContent='Данные синхронизированы';
  }catch(error){
    console.error('Reports load failed',error);
    $('syncText').textContent='Ошибка обновления';
    $('statusRows').innerHTML=`<div class="reports-empty reports-error">${esc(error.message||error)}</div>`;
  }finally{
    state.loading=false;if(refresh){refresh.disabled=false;refresh.textContent='↻ Обновить'}
  }
}

function renderKpis(data){
  const activeOrders=data.orders.filter(x=>!['CANCELLED'].includes(String(x.status||'').toUpperCase()));
  const orderValue=activeOrders.reduce((s,x)=>s+Number(x.total||0),0);
  const paid=data.payments.filter(paymentIsSuccessful).reduce((s,x)=>s+Number(x.amount||0),0);
  const sales=data.sales.filter(saleValid);const returns=data.returns.filter(returnValid);
  const gross=sales.reduce((s,x)=>s+Number(x.total||0),0);const returned=returns.reduce((s,x)=>s+Number(x.amount||0),0);const net=gross-returned;
  $('ordersKpi').textContent=data.orders.length;
  $('ordersValueKpi').textContent=money(orderValue);
  $('paidKpi').textContent=money(paid);
  $('paidKpiNote').textContent=state.payments.length?'Только подтверждённые оплаты из HUB':'Оплаты заказов пока не заведены в HUB';
  $('kassaKpi').textContent=money(net);
  $('kassaKpiNote').textContent=`продажи ${money(gross)} · возвраты ${money(returned)}`;
  $('cashKpi').textContent=state.cash?.cash!=null?money(state.cash.cash):'—';
  $('cashKpiNote').textContent=state.cash?.error?`Ошибка: ${state.cash.error}`:(state.cash?.source==='MOYSKLAD_LEDGER'?'МойСклад ledger · подтверждено':'Текущий кассовый остаток');
  $('customersKpi').textContent=state.customers;
  $('customersKpiNote').textContent=`каталог: ${state.items} позиций`;
}

function renderStatuses(data){
  const map={};for(const o of data.orders)map[o.status||'UNKNOWN']=(map[o.status||'UNKNOWN']||0)+1;
  const max=Math.max(0,...Object.values(map));
  $('statusRows').innerHTML=Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([key,value])=>`<div class="report-row"><div class="report-row-main"><div class="report-row-title">${esc(statusLabels[key]||key)}</div><div class="report-bar"><i style="width:${pct(value,max)}%"></i></div></div><div class="report-row-value">${value}</div></div>`).join('')||'<div class="reports-empty">За выбранный период заказов нет</div>';
}

function renderUnits(data){
  const map={};for(const o of data.orders){const key=o.business_unit||'COMMON';const x=map[key]||(map[key]={count:0,total:0});x.count++;if(o.status!=='CANCELLED')x.total+=Number(o.total||0)}
  const max=Math.max(0,...Object.values(map).map(x=>x.total));
  $('unitRows').innerHTML=Object.entries(map).sort((a,b)=>b[1].total-a[1].total).map(([key,x])=>`<div class="report-row"><div class="report-row-main"><div class="report-row-title">${esc(unitLabels[key]||key)}</div><div class="report-row-sub">${x.count} заказов</div><div class="report-bar"><i style="width:${pct(x.total,max)}%"></i></div></div><div class="report-row-value">${money(x.total)}</div></div>`).join('')||'<div class="reports-empty">Нет данных по направлениям</div>';
}

function renderKassa(data){
  const sales=data.sales.filter(saleValid),returns=data.returns.filter(returnValid);
  const methods={};
  for(const s of sales){const k=s.payment_method||'Не указан';const x=methods[k]||(methods[k]={sales:0,returns:0,count:0});x.sales+=Number(s.total||0);x.count++}
  for(const r of returns){const k=r.payment_method||'Не указан';const x=methods[k]||(methods[k]={sales:0,returns:0,count:0});x.returns+=Number(r.amount||0)}
  $('paymentRows').innerHTML=Object.entries(methods).sort((a,b)=>(b[1].sales-b[1].returns)-(a[1].sales-a[1].returns)).map(([name,x])=>`<div class="report-money-line"><span>${esc(name)} · ${x.count} продаж</span><b>${money(x.sales-x.returns)}</b></div>`).join('')||'<div class="reports-empty">Кассовых операций за период нет</div>';
  const gross=sales.reduce((s,x)=>s+Number(x.total||0),0),ret=returns.reduce((s,x)=>s+Number(x.amount||0),0);
  $('kassaTotals').innerHTML=`<div class="report-money-line"><span>Продажи</span><b>${money(gross)}</b></div><div class="report-money-line warning"><span>Возвраты</span><b>− ${money(ret)}</b></div><div class="report-money-line total"><span>Чистые продажи KASSA</span><b>${money(gross-ret)}</b></div>`;
}

function renderLedger(){
  const c=state.cash;
  if(!c||c.error||c.cash==null){$('ledger').innerHTML=`<div class="reports-empty ${c?.error?'reports-error':''}">${esc(c?.error||'Остаток кассы недоступен')}</div>`;return}
  const base=Number(c.baseline?.amount||0),delta=Number(c.delta||0),cash=Number(c.cash||0);
  $('ledger').innerHTML=`<div class="reports-ledger-cell"><span>Контрольная база</span><b>${money(base)}</b></div><div class="reports-ledger-cell"><span>Движение после базы</span><b>${delta>=0?'+ ':''}${money(delta)}</b></div><div class="reports-ledger-cell"><span>Наличные сейчас</span><b>${money(cash)}</b></div>`;
  const t=c.totals||{};$('ledgerNote').textContent=`Продажи наличными ${money(t.cash_sales)} · возвраты ${money(t.cash_returns)} · внесения ${money(t.cash_in)} · изъятия ${money(t.cash_out)}. Источник: ${c.source||'—'}.`;
}

function renderActivity(data){
  const events=[
    ...data.sales.filter(saleValid).map(x=>({time:x.sold_at||x.created_at,type:'Продажа',name:x.moysklad_sale_name?`Чек №${x.moysklad_sale_name}`:'Продажа KASSA',method:x.payment_method||'',amount:Number(x.total||0),tone:'plus'})),
    ...data.returns.filter(returnValid).map(x=>({time:x.returned_at||x.created_at,type:'Возврат',name:x.moysklad_return_name?`Возврат №${x.moysklad_return_name}`:'Возврат KASSA',method:x.payment_method||'',amount:Number(x.amount||0),tone:'minus'}))
  ].sort((a,b)=>new Date(b.time)-new Date(a.time)).slice(0,14);
  $('activity').innerHTML=events.map(x=>`<div class="activity-row"><span class="activity-time">${esc(fmtDate(x.time))}</span><span class="activity-main"><b>${esc(x.name)}</b><small>${esc(x.type)}${x.method?' · '+esc(x.method):''}</small></span><span class="activity-amount ${x.tone}">${x.tone==='minus'?'− ':'+ '}${money(x.amount)}</span></div>`).join('')||'<div class="reports-empty">Операций за период нет</div>';
}

function render(){const data=filtered();renderKpis(data);renderStatuses(data);renderUnits(data);renderKassa(data);renderLedger();renderActivity(data)}

function initPeriod(){
  document.querySelectorAll('[data-period]').forEach(btn=>btn.addEventListener('click',()=>{state.period=btn.dataset.period;document.querySelectorAll('[data-period]').forEach(x=>x.classList.toggle('active',x===btn));render()}));
}
function initRealtime(){
  if(typeof supabase.channel!=='function')return;
  const reload=()=>{clearTimeout(realtimeTimer);realtimeTimer=setTimeout(load,700)};
  let ch=supabase.channel('reports-live-v2');
  for(const table of ['orders','payments','pos_sales','pos_returns','customers','catalog_items'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);
  state.channel=ch.subscribe();
  window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true});
}

$('refresh')?.addEventListener('click',load);
initPeriod();
load().finally(initRealtime);
