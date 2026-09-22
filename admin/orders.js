import { supabase } from './guard.js?v=20260905-netfix1';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money = (value) => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

const labels = {
  NEW: 'Новый',
  CONFIRMED: 'Подтверждён',
  IN_PROGRESS: 'В работе',
  READY: 'Готов',
  COMPLETED: 'Завершён',
  ON_HOLD: 'Приостановлен',
  CANCELLED: 'Отменён'
};

const statusOrder = ['NEW','CONFIRMED','IN_PROGRESS','READY','COMPLETED','ON_HOLD','CANCELLED'];
const partnerStatusLabels={NOT_SENT:'Не отправлен',SENT:'Отправлен партнёру',CONFIRMED:'Подтверждён партнёром',IN_PRODUCTION:'У партнёра в работе',SHIPPED:'Отгружен партнёром',RECEIVED:'Получен',CANCELLED:'Отменён у партнёра'};
const state = {
  orders: [],
  metrics: null,
  loading: false,
  reloadQueued: false,
  channel: null,
  page: 1,
  pageSize: 50,
  total: 0
};
let realtimeTimer = null;
let searchTimer = null;

function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}

function unitLabel(unit){
  if(unit === '3D_ARTPRINT') return '3D-ARTPRINT';
  if(unit === 'A4_PRINT') return 'А4-Принт';
  return 'Общий';
}

function customerName(order){
  return order.customer_full_name || order.customer_company_name || 'Клиент не указан';
}

function customerMeta(order){
  return order.customer_phone || order.customer_email || '';
}

function orderTitle(order){
  return order.item_name || order.model_name || order.source || (order.business_unit === '3D_ARTPRINT' ? '3D-заказ' : 'Печать / услуга');
}

function orderDate(value){
  if(!value) return '—';
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'}) + ' · ' + d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
}

function paymentSummary(order){
  const paid = Number(order.paid_amount || 0);
  const total = Number(order.total || 0);
  if(paid <= 0) return { paid:0, total, label:'Не отмечена', tone:'none' };
  if(total > 0 && paid >= total) return { paid, total, label:'Оплачено', tone:'paid' };
  return { paid, total, label:`Оплачено ${money(paid)} ₽`, tone:'part' };
}

function currentFilters(){
  return {
    q: $('search')?.value.trim() || '',
    status: $('status')?.value || '',
    unit: $('unit')?.value || '',
    attention: $('attention')?.value || ''
  };
}

function syncUrl(){
  const f = currentFilters();
  const url = new URL(location.href);
  ['q','status','unit','source','attention','page'].forEach((key) => url.searchParams.delete(key));
  if(f.q) url.searchParams.set('q',f.q);
  if(f.status) url.searchParams.set('status',f.status);
  if(f.unit) url.searchParams.set('unit',f.unit);
  if(f.attention) url.searchParams.set('attention',f.attention);
  if(state.page > 1) url.searchParams.set('page',String(state.page));
  history.replaceState(null,'',url.pathname + url.search);
}

async function loadOrdersPage(){
  const f=currentFilters();
  const {data,error}=await supabase.rpc('get_orders_workspace_page',{
    p_query:f.q,
    p_status:f.status,
    p_unit:f.unit,
    p_attention:f.attention,
    p_page:state.page,
    p_page_size:state.pageSize
  });
  if(error)throw error;
  const rows=Array.isArray(data)?data:[];
  return {
    rows,
    total: rows.length ? Number(rows[0].total_count || 0) : 0
  };
}

async function loadMetrics(){
  const {data,error}=await supabase.rpc('get_orders_workspace_metrics');
  if(error)throw error;
  return Array.isArray(data)?(data[0]||null):data;
}

function renderStats(){
  const m=state.metrics||{};
  $('all').textContent = Number(m.all_count||0);
  $('new').textContent = Number(m.new_count||0);
  $('work').textContent = Number(m.work_count||0);
  $('ready').textContent = Number(m.ready_count||0);
  if($('attentionCount')) $('attentionCount').textContent = Number(m.attention_count||0);
  $('activeTotal').textContent = `${money(m.active_total||0)} ₽`;
}

function statusOptions(current){
  return statusOrder.map((status) => `<option value="${status}" ${status===current?'selected':''}>${esc(labels[status])}</option>`).join('');
}

function rowHtml(order){
  const payment = paymentSummary(order);
  const client = customerName(order);
  const meta = customerMeta(order);
  const isPartner=String(order.partner_direction||'NONE').toUpperCase()==='OUTBOUND'&&order.fulfillment_partner_id;
  const partnerMeta=isPartner?`Партнёр: ${order.executor_name||'не указан'} · ${partnerStatusLabels[order.partner_fulfillment_status]||order.partner_fulfillment_status||'Не отправлен'}`:unitLabel(order.business_unit);
  const productionMeta=order.has_production?'Производство связано':'Без производственного задания';
  return `
    <article class="order-work-row" data-order-id="${esc(order.id)}">
      <a class="order-main-link" href="./order.html?id=${encodeURIComponent(order.id)}">
        <span class="order-number"><b>№${esc(order.order_number ?? '—')}</b><small>${esc(orderDate(order.created_at))}</small></span>
        <span class="order-client"><b>${esc(client)}</b><small>${esc(meta || 'Контакт не указан')}</small></span>
        <span class="order-service"><b>${esc(orderTitle(order))}</b><small>${esc(partnerMeta)} · ${esc(productionMeta)}</small></span>
        <span class="order-payment"><b class="pay-${payment.tone}">${esc(payment.label)}</b><small>${payment.paid > 0 && payment.total > 0 ? `${money(payment.paid)} из ${money(payment.total)} ₽` : 'Оплата заказа'}</small></span>
        <span class="order-total"><b>${money(order.total)} ₽</b><small>${esc(labels[order.status] || order.status || '—')}</small></span>
      </a>
      <div class="order-actions">
        <select class="order-status-select" data-order-status aria-label="Статус заказа №${esc(order.order_number ?? '')}">${statusOptions(order.status)}</select>
        <a class="order-open" href="./order.html?id=${encodeURIComponent(order.id)}">Открыть →</a>
      </div>
    </article>`;
}

function renderPagination(){
  const totalPages=Math.max(1,Math.ceil(state.total/state.pageSize));
  const pager=$('ordersPager');
  if(!pager)return;
  pager.hidden=state.total<=state.pageSize;
  $('pageLabel').textContent=`Страница ${state.page} из ${totalPages}`;
  $('prevPage').disabled=state.page<=1;
  $('nextPage').disabled=state.page>=totalPages;
}

function render(){
  syncUrl();
  renderStats();
  $('visibleCount').textContent = `${state.orders.length} на странице · всего ${state.total}`;
  $('list').innerHTML = state.orders.map(rowHtml).join('') || '<div class="orders-empty">По этим условиям заказов не найдено</div>';
  renderPagination();
  document.dispatchEvent(new CustomEvent('a4:orders-rendered'));
}

async function changeStatus(orderId,nextStatus,select){
  const order = state.orders.find((x) => x.id === orderId);
  if(!order || order.status === nextStatus) return;

  if(nextStatus === 'CANCELLED' && !window.confirm(`Отменить заказ №${order.order_number || ''}?`)){
    select.value = order.status;
    return;
  }

  const previous = order.status;
  select.disabled = true;
  select.classList.add('saving');
  order.status = nextStatus;

  const { error } = await supabase.from('orders').update({status:nextStatus,updated_at:new Date().toISOString()}).eq('id',orderId);
  select.disabled = false;
  select.classList.remove('saving');
  if(error){
    order.status = previous;
    select.value = previous;
    notify('error','Не удалось изменить статус',error.message||'Повторите действие');
    return;
  }
  select.classList.add('saved');
  setTimeout(() => select.classList.remove('saved'),800);
  await load(true);
}

function renderLoading(){
  $('list').innerHTML='<div class="orders-loading-list" aria-label="Загрузка заказов"><div class="a4-skeleton"></div><div class="a4-skeleton"></div><div class="a4-skeleton"></div><div class="a4-skeleton"></div></div>';
}

function renderError(error){
  $('list').innerHTML=`<div class="a4-error"><b>Не удалось загрузить заказы</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="ordersRetry" type="button" class="a4-btn" style="margin-top:10px">Повторить</button></div>`;
  $('ordersRetry')?.addEventListener('click',()=>load(true));
}

async function load(force=false){
  if(state.loading){if(force)state.reloadQueued=true;return}
  state.loading=true;
  $('refresh').disabled=true;
  $('refresh').textContent='Обновление…';
  if(!state.orders.length)renderLoading();
  try{
    const [pageResult,metricsResult]=await Promise.allSettled([loadOrdersPage(),loadMetrics()]);
    if(pageResult.status==='rejected')throw pageResult.reason;

    const page=pageResult.value;
    state.orders=page.rows;
    state.total=page.total;

    if(!state.orders.length && state.page>1){
      state.page=Math.max(1,state.page-1);
      state.loading=false;
      return load(true);
    }

    if(metricsResult.status==='fulfilled')state.metrics=metricsResult.value;
    else console.warn('Orders metrics unavailable',metricsResult.reason);

    render();
    $('updatedAt').textContent = `обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){
    console.error(error);
    renderError(error);
    $('updatedAt').textContent = 'ошибка загрузки';
  }finally{
    state.loading=false;
    $('refresh').disabled=false;
    $('refresh').textContent='↻ Обновить';
    if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>load(),0)}
  }
}

function resetPageAndLoad(){
  state.page=1;
  void load(true);
}

function initParams(){
  const params = new URLSearchParams(location.search);
  if(params.get('q')) $('search').value = params.get('q');
  for(const id of ['status','unit','attention']){
    const value = params.get(id);
    const control = $(id);
    if(control && value && [...control.options].some((o) => o.value === value)) control.value = value;
  }
  const page=Number(params.get('page')||1);
  state.page=Number.isInteger(page)&&page>0?page:1;
}

function initEvents(){
  $('search').addEventListener('input',()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(resetPageAndLoad,280);
  });
  ['status','unit','attention'].forEach((id) => $(id)?.addEventListener('change',resetPageAndLoad));
  $('refresh').addEventListener('click',()=>load(true));
  $('clearFilters').addEventListener('click',() => {
    $('search').value='';$('status').value='';$('unit').value='';if($('attention')) $('attention').value='';
    resetPageAndLoad();
  });
  $('prevPage')?.addEventListener('click',()=>{if(state.page>1){state.page--;void load(true)}});
  $('nextPage')?.addEventListener('click',()=>{
    const totalPages=Math.max(1,Math.ceil(state.total/state.pageSize));
    if(state.page<totalPages){state.page++;void load(true)}
  });
  $('list').addEventListener('change',(event) => {
    const select = event.target.closest('[data-order-status]');
    if(!select) return;
    const row = select.closest('[data-order-id]');
    if(!row) return;
    changeStatus(row.dataset.orderId,select.value,select);
  });
}

function initRealtime(){
  if(typeof supabase.channel !== 'function') return;
  const reload = () => { clearTimeout(realtimeTimer); realtimeTimer = setTimeout(()=>load(true),450); };
  state.channel = supabase.channel('manager-orders-workspace-v4')
    .on('postgres_changes',{event:'*',schema:'public',table:'orders'},reload)
    .on('postgres_changes',{event:'*',schema:'public',table:'payments'},reload)
    .on('postgres_changes',{event:'*',schema:'public',table:'order_items'},reload)
    .on('postgres_changes',{event:'*',schema:'public',table:'production_jobs'},reload)
    .subscribe();
  window.addEventListener('beforeunload',() => { if(state.channel) supabase.removeChannel(state.channel); },{once:true});
}

initParams();
initEvents();
load().finally(initRealtime);
