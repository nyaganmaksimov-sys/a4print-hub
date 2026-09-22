import {supabase} from './guard.js?v=20260922-reports1';

const $=id=>document.getElementById(id);
const cfg=window.A4PRINT_CONFIG||{};
const apiBase=String(cfg.apiBaseUrl||'https://a4print-hub-api.onrender.com').replace(/\/$/,'');
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>`${Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})} ₽`;
const statusLabels={NEW:'Новые',CONFIRMED:'Подтверждённые',IN_PROGRESS:'В работе',READY:'Готовы',COMPLETED:'Завершённые',ON_HOLD:'Приостановленные',CANCELLED:'Отменённые'};
const state={period:'MONTH',summary:null,cash:null,loading:false,reloadQueued:false,channel:null,warnings:[]};
let realtimeTimer=null;

function periodStart(){
  if(state.period==='ALL')return null;
  const d=new Date();
  if(state.period==='TODAY'){d.setHours(0,0,0,0);return d}
  if(state.period==='MONTH'){d.setDate(1);d.setHours(0,0,0,0);return d}
  d.setDate(d.getDate()-6);d.setHours(0,0,0,0);return d;
}
function pct(value,max){return max>0?Math.max(3,Math.min(100,(Number(value||0)/max)*100)):0}
function fmtDate(value){
  const d=new Date(value);if(!Number.isFinite(d.getTime()))return'—';
  return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
}
function reportStartIso(){return periodStart()?.toISOString()||null}

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

async function loadSummary(){
  const {data,error}=await supabase.rpc('get_reports_workspace',{p_start:reportStartIso()});
  if(error)throw error;
  return Array.isArray(data)?(data[0]||null):data;
}

async function load(){
  if(state.loading){state.reloadQueued=true;return}
  state.loading=true;state.warnings=[];
  const refresh=$('refresh');if(refresh){refresh.disabled=true;refresh.textContent='Обновление…'}
  $('syncText').textContent='Обновление данных…';
  try{
    const [summaryR,cashR]=await Promise.allSettled([loadSummary(),cashBalance()]);
    if(summaryR.status==='rejected')throw summaryR.reason;
    state.summary=summaryR.value||{};
    if(cashR.status==='fulfilled'){state.cash=cashR.value;if(state.cash?.error)state.warnings.push('cash')}
    else{state.cash={error:String(cashR.reason?.message||cashR.reason)};state.warnings.push('cash')}
    render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
    $('syncText').textContent=state.warnings.length?'Основные данные актуальны · касса недоступна':'Данные актуальны';
    document.querySelector('.reports-sync-dot')?.classList.toggle('warn',state.warnings.length>0);
  }catch(error){
    console.error('Reports load failed',error);
    $('syncText').textContent='Ошибка обновления';
    $('statusRows').innerHTML=`<div class="a4-error"><b>Не удалось загрузить отчёт</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="reportsRetry" class="a4-btn" type="button" style="margin-top:10px">Повторить</button></div>`;
    $('reportsRetry')?.addEventListener('click',load);
  }finally{
    state.loading=false;if(refresh){refresh.disabled=false;refresh.textContent='↻ Обновить'}
    if(state.reloadQueued){state.reloadQueued=false;setTimeout(load,0)}
  }
}

function renderKpis(){
  const s=state.summary||{};
  $('ordersKpi').textContent=Number(s.orders_count||0);
  $('ordersValueKpi').textContent=money(s.orders_value||0);
  $('paidKpi').textContent=money(s.paid_total||0);
  $('paidKpiNote').textContent='подтверждённые оплаты за период';
  const gross=Number(s.kassa_gross||0),returned=Number(s.kassa_returns||0);
  $('kassaKpi').textContent=money(gross-returned);
  $('kassaKpiNote').textContent=`продажи ${money(gross)} · возвраты ${money(returned)}`;
  $('cashKpi').textContent=state.cash?.cash!=null?money(state.cash.cash):'—';
  $('cashKpiNote').textContent=state.cash?.error?'остаток временно недоступен':(state.cash?.source==='MOYSKLAD_LEDGER'?'по журналу МойСклад':'текущий остаток');
}

function renderStatuses(){
  const map=state.summary?.status_counts||{};
  const entries=Object.entries(map).map(([key,value])=>[key,Number(value||0)]).sort((a,b)=>b[1]-a[1]);
  const max=Math.max(0,...entries.map(([,v])=>v));
  const attention=Number(state.summary?.attention_count||0);
  const row=(key,label,value,extra='')=>`<div class="report-row report-row-action ${extra}" data-report-status="${esc(key)}" role="button" tabindex="0" aria-label="Показать заказы: ${esc(label)}"><div class="report-row-main"><div class="report-row-title">${esc(label)}</div><div class="report-bar"><i style="width:${pct(value,Math.max(max,attention))}%"></i></div></div><div class="report-row-value">${value}</div><span class="report-row-open">Смотреть</span></div>`;
  const attentionHtml=attention?row('ATTENTION','Требуют внимания',attention,'report-row-attention'):'';
  const statusHtml=entries.map(([key,value])=>row(key,statusLabels[key]||key,value)).join('');
  $('statusRows').innerHTML=(attentionHtml+statusHtml)||'<div class="reports-empty">За выбранный период обычных заказов HUB нет</div>';
  document.dispatchEvent(new CustomEvent('a4:reports-status-rendered',{detail:{period:state.period,start:reportStartIso()}}));
}

function renderKassa(){
  const rows=Array.isArray(state.summary?.payment_methods)?state.summary.payment_methods:[];
  $('paymentRows').innerHTML=rows.map(x=>`<div class="report-money-line"><span>${esc(x.name||'Не указан')} <small>${Number(x.count||0)} продаж</small></span><b>${money(Number(x.sales||0)-Number(x.returns||0))}</b></div>`).join('')||'<div class="reports-empty">Операций KASSA за выбранный период нет</div>';
}

function renderLedger(){
  const c=state.cash;
  if(!c||c.error||c.cash==null){
    $('ledger').innerHTML=`<div class="reports-empty ${c?.error?'reports-error':''}">${esc(c?.error||'Остаток кассы недоступен')}</div>`;
    $('ledgerNote').textContent='';return;
  }
  const base=Number(c.baseline?.amount||0),delta=Number(c.delta||0),cash=Number(c.cash||0);
  $('ledger').innerHTML=`<div class="reports-ledger-cell"><span>База</span><b>${money(base)}</b></div><div class="reports-ledger-cell"><span>Изменение</span><b>${delta>=0?'+ ':''}${money(delta)}</b></div><div class="reports-ledger-cell accent"><span>Сейчас</span><b>${money(cash)}</b></div>`;
  const t=c.totals||{};
  $('ledgerNote').textContent=`Наличные продажи ${money(t.cash_sales)} · возвраты ${money(t.cash_returns)} · внесения ${money(t.cash_in)} · изъятия ${money(t.cash_out)}`;
}

function renderActivity(){
  const events=Array.isArray(state.summary?.activity)?state.summary.activity:[];
  $('activity').innerHTML=events.map(x=>{
    const kind=String(x.kind||'').toUpperCase();
    const type=kind==='SALE'?'Продажа':kind==='RETURN'?'Возврат':'Заказ';
    const name=kind==='SALE'?(x.ref?`Чек №${x.ref}`:'Продажа KASSA'):kind==='RETURN'?(x.ref?`Возврат №${x.ref}`:'Возврат KASSA'):`Заказ · ${statusLabels[String(x.status||'').toUpperCase()]||x.status||'без статуса'}`;
    const tone=x.tone||'order';
    return `<div class="activity-row"><span class="activity-time">${esc(fmtDate(x.time))}</span><span class="activity-main"><b>${esc(name)}</b><small>${esc(type)}</small></span><span class="activity-amount ${esc(tone)}">${tone==='minus'?'− ':tone==='plus'?'+ ':''}${money(x.amount)}</span></div>`;
  }).join('')||'<div class="reports-empty">За выбранный период активности нет</div>';
}

function render(){renderKpis();renderStatuses();renderKassa();renderLedger();renderActivity()}

function initPeriod(){
  document.querySelectorAll('[data-period]').forEach(btn=>btn.addEventListener('click',()=>{
    if(state.period===btn.dataset.period)return;
    state.period=btn.dataset.period;
    document.querySelectorAll('[data-period]').forEach(x=>x.classList.toggle('active',x===btn));
    document.dispatchEvent(new CustomEvent('a4:reports-period-changed',{detail:{period:state.period,start:reportStartIso()}}));
    load();
  }));
}
function initRealtime(){
  if(typeof supabase.channel!=='function')return;
  const reload=()=>{clearTimeout(realtimeTimer);realtimeTimer=setTimeout(load,900)};
  let ch=supabase.channel('reports-live-v5');
  for(const table of ['orders','payments','pos_sales','pos_returns'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);
  state.channel=ch.subscribe();
  window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true});
}

$('refresh')?.addEventListener('click',load);
initPeriod();
load().finally(initRealtime);
