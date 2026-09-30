import {supabase} from './guard.js?v=20260922-reports1';

const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>`${Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})} ₽`;
const statusMeta={
  ATTENTION:{label:'Требуют внимания',ordersFilter:'',attention:true},
  NEW:{label:'Новые',ordersFilter:'NEW'},
  CONFIRMED:{label:'Подтверждённые',ordersFilter:'CONFIRMED'},
  IN_PROGRESS:{label:'В работе',ordersFilter:'IN_PROGRESS'},
  READY:{label:'Готовы',ordersFilter:'READY'},
  COMPLETED:{label:'Завершённые',ordersFilter:'COMPLETED'},
  DONE:{label:'Завершённые',ordersFilter:'COMPLETED'},
  ON_HOLD:{label:'Приостановленные',ordersFilter:'ON_HOLD'},
  CANCELLED:{label:'Отменённые',ordersFilter:'CANCELLED'}
};
const reasonLabels={ON_HOLD:'Приостановлен',NEW_24H:'Новый больше суток',WORK_72H:'В работе больше 3 дней',READY_48H:'Готов больше 2 дней'};
const state={status:null,page:1,pageSize:50,total:0,rows:[],loading:false};

function activePeriod(){return document.querySelector('[data-period].active')?.dataset.period||'MONTH'}
function periodStart(period){
  if(period==='ALL')return null;
  const d=new Date();
  if(period==='TODAY'){d.setHours(0,0,0,0);return d}
  if(period==='MONTH'){d.setDate(1);d.setHours(0,0,0,0);return d}
  d.setDate(d.getDate()-6);d.setHours(0,0,0,0);return d;
}
function periodLabel(period){return({TODAY:'сегодня','7D':'за последние 7 дней',MONTH:'за этот месяц',ALL:'за всё время'})[period]||'за выбранный период'}
function fmtDate(value){
  const d=new Date(value);if(!Number.isFinite(d.getTime()))return'—';
  return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'})+' · '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
}
function customerName(order){return order.customer_full_name||order.customer_company_name||'Клиент не указан'}
function orderTitle(order){return order.model_name||order.source||(order.business_unit==='3D_ARTPRINT'?'3D-заказ':'Печать / услуга')}
function pluralOrders(value){const n=Math.abs(Number(value||0))%100,m=n%10;if(n>10&&n<20)return'заказов';if(m===1)return'заказ';if(m>=2&&m<=4)return'заказа';return'заказов'}
function reasons(order){
  const codes=Array.isArray(order.attention_reason_codes)?order.attention_reason_codes:[];
  return codes.map(code=>code==='DEBT'?`Долг ${money(order.debt)}`:reasonLabels[code]||code);
}

function ensureDialog(){
  let dlg=document.getElementById('reportOrdersDrilldown');
  if(dlg)return dlg;
  dlg=document.createElement('dialog');
  dlg.id='reportOrdersDrilldown';dlg.className='report-orders-dialog';
  dlg.innerHTML=`
    <div class="report-orders-dialog-shell">
      <div class="report-orders-dialog-head">
        <div><span class="report-orders-dialog-kicker">ЗАКАЗЫ HUB</span><h2 id="reportOrdersDialogTitle">Заказы</h2><p id="reportOrdersDialogSub">Загрузка…</p></div>
        <button type="button" class="report-orders-dialog-close" data-report-orders-close aria-label="Закрыть">×</button>
      </div>
      <div id="reportOrdersDialogList" class="report-orders-dialog-list"><div class="report-orders-loading">Загрузка заказов…</div></div>
      <div class="report-orders-dialog-foot">
        <span id="reportOrdersDialogCount">—</span>
        <button id="reportOrdersLoadMore" type="button" class="report-orders-load-more" hidden>Показать ещё</button>
        <a id="reportOrdersDialogAll" href="./orders.html">Открыть раздел «Заказы» →</a>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('[data-report-orders-close]')?.addEventListener('click',()=>dlg.close());
  dlg.addEventListener('click',event=>{if(event.target===dlg)dlg.close()});
  dlg.querySelector('#reportOrdersLoadMore')?.addEventListener('click',()=>loadPage(true));
  return dlg;
}

async function fetchPage(page){
  const period=activePeriod(),start=periodStart(period);
  const {data,error}=await supabase.rpc('get_reports_order_drilldown',{
    p_start:start?start.toISOString():null,
    p_status:state.status,
    p_page:page,
    p_page_size:state.pageSize
  });
  if(error)throw error;
  const rows=Array.isArray(data)?data:[];
  return{rows,total:rows.length?Number(rows[0].total_count||0):0,period};
}

function orderRow(order){
  const number=order.order_number??'—',attention=reasons(order);
  return `<a class="report-order-item" href="./order.html?id=${encodeURIComponent(order.id)}">
    <span class="report-order-number"><b>№${esc(number)}</b><small>${esc(fmtDate(order.created_at))}</small></span>
    <span class="report-order-client"><b>${esc(customerName(order))}</b><small>${esc(orderTitle(order))}</small>${attention.length?`<em class="report-order-alert">${attention.map(esc).join(' · ')}</em>`:''}</span>
    <span class="report-order-total"><b>${money(order.total)}</b><small>Открыть →</small></span>
  </a>`;
}

function renderRows(period){
  const dlg=ensureDialog(),list=dlg.querySelector('#reportOrdersDialogList'),count=dlg.querySelector('#reportOrdersDialogCount'),more=dlg.querySelector('#reportOrdersLoadMore');
  count.textContent=`${state.total} ${pluralOrders(state.total)} · показано ${state.rows.length}`;
  list.innerHTML=state.rows.map(orderRow).join('')||`<div class="report-orders-empty">${state.status==='ATTENTION'?'Заказов, требующих внимания,':'Заказов с этим статусом'} ${esc(periodLabel(period))} нет.</div>`;
  more.hidden=state.rows.length>=state.total||state.total===0;
  more.disabled=false;more.textContent='Показать ещё';
}

async function loadPage(append=false){
  if(state.loading)return;state.loading=true;
  const dlg=ensureDialog(),list=dlg.querySelector('#reportOrdersDialogList'),more=dlg.querySelector('#reportOrdersLoadMore');
  if(append){more.disabled=true;more.textContent='Загрузка…'}
  else list.innerHTML='<div class="report-orders-loading">Загрузка заказов…</div>';
  const targetPage=append?state.page+1:1;
  try{
    const result=await fetchPage(targetPage);
    state.page=targetPage;
    state.total=result.total;
    state.rows=append?[...state.rows,...result.rows]:result.rows;
    renderRows(result.period);
  }catch(error){
    console.error('Report order drilldown failed',error);
    if(!append){
      state.rows=[];state.total=0;
      dlg.querySelector('#reportOrdersDialogCount').textContent='Ошибка загрузки';
      list.innerHTML=`<div class="report-orders-empty error">Не удалось загрузить список заказов.<br><small>${esc(error?.message||error)}</small></div>`;
    }else{more.disabled=false;more.textContent='Повторить'}
  }finally{state.loading=false}
}

async function openStatus(status){
  const meta=statusMeta[status];if(!meta)return;
  state.status=status;state.page=1;state.total=0;state.rows=[];
  const period=activePeriod(),dlg=ensureDialog(),title=dlg.querySelector('#reportOrdersDialogTitle'),sub=dlg.querySelector('#reportOrdersDialogSub'),all=dlg.querySelector('#reportOrdersDialogAll');
  title.textContent=meta.label;
  sub.textContent=meta.attention?`Зависшие, приостановленные и неоплаченные заказы ${periodLabel(period)}`:`Обычные заказы HUB ${periodLabel(period)}`;
  all.href=meta.attention?'./orders.html?attention=ATTENTION':`./orders.html?status=${encodeURIComponent(meta.ordersFilter)}`;
  all.textContent=meta.attention?'Открыть все проблемные заказы →':`Все «${meta.label.toLowerCase()}» в разделе «Заказы» →`;
  if(!dlg.open)dlg.showModal();
  await loadPage(false);
}

const statusRows=document.getElementById('statusRows');
statusRows?.addEventListener('click',event=>{
  const row=event.target.closest('.report-row-action[data-report-status]');
  if(row)openStatus(String(row.dataset.reportStatus||'').toUpperCase());
});
statusRows?.addEventListener('keydown',event=>{
  if(event.key!=='Enter'&&event.key!==' ')return;
  const row=event.target.closest('.report-row-action[data-report-status]');if(!row)return;
  event.preventDefault();openStatus(String(row.dataset.reportStatus||'').toUpperCase());
});
document.addEventListener('a4:reports-period-changed',()=>{
  const dlg=document.getElementById('reportOrdersDrilldown');
  if(dlg?.open)dlg.close();
});
