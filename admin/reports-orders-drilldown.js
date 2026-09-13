import {supabase} from './guard.js?v=20260913-net2';

const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>`${Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})} ₽`;
const statusMeta={
  IN_PROGRESS:{label:'В работе',ordersFilter:'IN_PROGRESS'},
  READY:{label:'Готовы',ordersFilter:'READY'}
};

function ordinaryOrder(row){
  if(String(row?.source||'').toUpperCase()==='KASSA')return false;
  if(String(row?.partner_direction||'').toUpperCase()==='OUTBOUND')return false;
  if(row?.partner_id||row?.fulfillment_partner_id)return false;
  return true;
}

function activePeriod(){
  return document.querySelector('[data-period].active')?.dataset.period||'MONTH';
}

function periodStart(period){
  if(period==='ALL')return null;
  const d=new Date();
  if(period==='TODAY'){d.setHours(0,0,0,0);return d}
  if(period==='MONTH'){d.setDate(1);d.setHours(0,0,0,0);return d}
  d.setDate(d.getDate()-6);d.setHours(0,0,0,0);return d;
}

function inPeriod(value,period){
  const start=periodStart(period);
  if(!start)return true;
  const d=new Date(value);
  return Number.isFinite(d.getTime())&&d>=start;
}

function fmtDate(value){
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))return'—';
  return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'})+' · '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
}

function customerName(order){
  const c=order?.customers||{};
  return c.full_name||c.company_name||'Клиент не указан';
}

function orderTitle(order){
  return order.model_name||order.source||(order.business_unit==='3D_ARTPRINT'?'3D-заказ':'Печать / услуга');
}

function periodLabel(period){
  return ({TODAY:'сегодня','7D':'за последние 7 дней',MONTH:'за этот месяц',ALL:'за всё время'})[period]||'за выбранный период';
}

function ensureDialog(){
  let dlg=document.getElementById('reportOrdersDrilldown');
  if(dlg)return dlg;
  dlg=document.createElement('dialog');
  dlg.id='reportOrdersDrilldown';
  dlg.className='report-orders-dialog';
  dlg.innerHTML=`
    <div class="report-orders-dialog-shell">
      <div class="report-orders-dialog-head">
        <div>
          <span class="report-orders-dialog-kicker">ЗАКАЗЫ HUB</span>
          <h2 id="reportOrdersDialogTitle">Заказы</h2>
          <p id="reportOrdersDialogSub">Загрузка…</p>
        </div>
        <button type="button" class="report-orders-dialog-close" data-report-orders-close aria-label="Закрыть">×</button>
      </div>
      <div id="reportOrdersDialogList" class="report-orders-dialog-list"><div class="report-orders-loading">Загрузка заказов…</div></div>
      <div class="report-orders-dialog-foot">
        <span id="reportOrdersDialogCount">—</span>
        <a id="reportOrdersDialogAll" href="./orders.html">Открыть раздел «Заказы» →</a>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('[data-report-orders-close]')?.addEventListener('click',()=>dlg.close());
  dlg.addEventListener('click',event=>{if(event.target===dlg)dlg.close()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&dlg.open)dlg.close()});
  return dlg;
}

async function fetchOrders(status){
  const full='id,order_number,status,total,source,partner_direction,partner_id,fulfillment_partner_id,created_at,model_name,business_unit,customers(full_name,company_name,phone,email)';
  let result=await supabase.from('orders').select(full).eq('status',status).order('created_at',{ascending:false}).limit(500);
  if(!result.error)return result.data||[];
  console.warn('Report drilldown relation query failed, using base fallback',result.error);
  const base='id,order_number,status,total,source,partner_direction,partner_id,fulfillment_partner_id,created_at,model_name,business_unit';
  result=await supabase.from('orders').select(base).eq('status',status).order('created_at',{ascending:false}).limit(500);
  if(result.error)throw result.error;
  return result.data||[];
}

function orderRow(order){
  const number=order.order_number??'—';
  return `<a class="report-order-item" href="./order.html?id=${encodeURIComponent(order.id)}">
    <span class="report-order-number"><b>№${esc(number)}</b><small>${esc(fmtDate(order.created_at))}</small></span>
    <span class="report-order-client"><b>${esc(customerName(order))}</b><small>${esc(orderTitle(order))}</small></span>
    <span class="report-order-total"><b>${money(order.total)}</b><small>Открыть →</small></span>
  </a>`;
}

async function openStatus(status){
  const meta=statusMeta[status];
  if(!meta)return;
  const period=activePeriod();
  const dlg=ensureDialog();
  const title=dlg.querySelector('#reportOrdersDialogTitle');
  const sub=dlg.querySelector('#reportOrdersDialogSub');
  const list=dlg.querySelector('#reportOrdersDialogList');
  const count=dlg.querySelector('#reportOrdersDialogCount');
  const all=dlg.querySelector('#reportOrdersDialogAll');
  title.textContent=meta.label;
  sub.textContent=`Обычные заказы HUB ${periodLabel(period)}`;
  count.textContent='Загрузка…';
  all.href=`./orders.html?status=${encodeURIComponent(meta.ordersFilter)}`;
  all.textContent=`Все «${meta.label.toLowerCase()}» в разделе «Заказы» →`;
  list.innerHTML='<div class="report-orders-loading">Загрузка заказов…</div>';
  if(!dlg.open)dlg.showModal();
  try{
    const rows=(await fetchOrders(status)).filter(ordinaryOrder).filter(order=>inPeriod(order.created_at,period));
    count.textContent=`${rows.length} ${rows.length===1?'заказ':rows.length>=2&&rows.length<=4?'заказа':'заказов'}`;
    list.innerHTML=rows.map(orderRow).join('')||`<div class="report-orders-empty">Заказов со статусом «${esc(meta.label)}» ${esc(periodLabel(period))} нет.</div>`;
  }catch(error){
    console.error('Report order drilldown failed',error);
    count.textContent='Ошибка загрузки';
    list.innerHTML=`<div class="report-orders-empty error">Не удалось загрузить список заказов.<br><small>${esc(error?.message||error)}</small></div>`;
  }
}

function enhanceRows(){
  document.querySelectorAll('#statusRows .report-row').forEach(row=>{
    const title=row.querySelector('.report-row-title')?.textContent?.trim();
    const status=title==='В работе'?'IN_PROGRESS':title==='Готовы'?'READY':'';
    if(!status)return;
    row.classList.add('report-row-action');
    row.dataset.drillStatus=status;
    row.setAttribute('role','button');
    row.setAttribute('tabindex','0');
    row.setAttribute('aria-label',`Показать заказы: ${title}`);
    if(!row.querySelector('.report-row-open')){
      const open=document.createElement('span');
      open.className='report-row-open';
      open.textContent='Открыть';
      row.appendChild(open);
    }
  });
}

const statusRows=document.getElementById('statusRows');
if(statusRows){
  statusRows.addEventListener('click',event=>{
    const row=event.target.closest('.report-row-action[data-drill-status]');
    if(row)openStatus(row.dataset.drillStatus);
  });
  statusRows.addEventListener('keydown',event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    const row=event.target.closest('.report-row-action[data-drill-status]');
    if(!row)return;
    event.preventDefault();
    openStatus(row.dataset.drillStatus);
  });
  const observer=new MutationObserver(enhanceRows);
  observer.observe(statusRows,{childList:true,subtree:true});
  enhanceRows();
}
