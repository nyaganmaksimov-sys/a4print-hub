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
const state = { orders: [], payments: [], loading: false, channel: null };
let realtimeTimer = null;

function unitLabel(unit){
  if(unit === '3D_ARTPRINT') return '3D-ARTPRINT';
  if(unit === 'A4_PRINT') return 'А4-Принт';
  return 'Общий';
}

function customerName(order){
  const c = order.customers || {};
  return c.full_name || c.company_name || order.customer_name || order.client_name || 'Клиент не указан';
}

function customerMeta(order){
  const c = order.customers || {};
  return c.phone || c.email || '';
}

function orderTitle(order){
  return order.model_name || order.source || (order.business_unit === '3D_ARTPRINT' ? '3D-заказ' : 'Печать / услуга');
}

function orderDate(value){
  if(!value) return '—';
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'}) + ' · ' + d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
}

function paymentSummary(order){
  const rows = state.payments.filter((p) => p.order_id === order.id && !['CANCELLED','FAILED','REFUNDED'].includes(String(p.status || '').toUpperCase()));
  const paid = rows.reduce((sum,p) => sum + Number(p.amount || 0), 0);
  const total = Number(order.total || 0);
  if(!rows.length) return { paid:0, total, label:'Не отмечена', tone:'none' };
  if(total > 0 && paid >= total) return { paid, total, label:'Оплачено', tone:'paid' };
  return { paid, total, label:`Оплачено ${money(paid)} ₽`, tone:'part' };
}

function isManagerOrder(order){
  if(!order) return false;
  if(String(order.source||'').toUpperCase()==='KASSA') return false;
  if(String(order.partner_direction||'NONE').toUpperCase()!=='NONE') return false;
  if(order.partner_id||order.fulfillment_partner_id) return false;
  return true;
}

function managerQuery(select){
  return supabase.from('orders')
    .select(select)
    .eq('partner_direction','NONE')
    .or('source.is.null,source.neq.KASSA')
    .order('created_at',{ascending:false});
}

async function loadOrders(){
  const full = '*,customers(full_name,company_name,phone,email)';
  let result = await managerQuery(full);
  if(!result.error) return (result.data || []).filter(isManagerOrder);

  console.warn('Manager orders relation query failed, using base fallback', result.error);
  result = await managerQuery('*');
  if(result.error) throw result.error;
  return (result.data || []).filter(isManagerOrder);
}

async function loadPayments(){
  const result = await supabase.from('payments').select('id,order_id,status,amount,payment_method,created_at').order('created_at',{ascending:false}).limit(1000);
  if(result.error){
    console.warn('Payments summary unavailable', result.error);
    return [];
  }
  return result.data || [];
}

function currentFilters(){
  return {
    q: $('search').value.trim().toLowerCase(),
    status: $('status').value,
    unit: $('unit').value
  };
}

function filteredOrders(){
  const f = currentFilters();
  return state.orders.filter((o) => {
    const c = o.customers || {};
    const text = [o.order_number,o.model_name,o.source,c.full_name,c.company_name,c.phone,c.email].filter(Boolean).join(' ').toLowerCase();
    const statusOk = !f.status || (f.status === 'WORK' ? ['CONFIRMED','IN_PROGRESS'].includes(o.status) : o.status === f.status);
    return (!f.q || text.includes(f.q)) && statusOk && (!f.unit || o.business_unit === f.unit);
  });
}

function syncUrl(){
  const f = currentFilters();
  const url = new URL(location.href);
  ['q','status','unit','source'].forEach((key) => url.searchParams.delete(key));
  if(f.q) url.searchParams.set('q',$('search').value.trim());
  if(f.status) url.searchParams.set('status',f.status);
  if(f.unit) url.searchParams.set('unit',f.unit);
  history.replaceState(null,'',url.pathname + url.search);
}

function renderStats(){
  const orders = state.orders;
  const active = orders.filter((x) => ['NEW','CONFIRMED','IN_PROGRESS','READY'].includes(x.status));
  $('all').textContent = orders.length;
  $('new').textContent = orders.filter((x) => x.status === 'NEW').length;
  $('work').textContent = orders.filter((x) => ['CONFIRMED','IN_PROGRESS'].includes(x.status)).length;
  $('ready').textContent = orders.filter((x) => x.status === 'READY').length;
  $('activeTotal').textContent = `${money(active.reduce((sum,x) => sum + Number(x.total || 0),0))} ₽`;
}

function statusOptions(current){
  return statusOrder.map((status) => `<option value="${status}" ${status===current?'selected':''}>${esc(labels[status])}</option>`).join('');
}

function rowHtml(order){
  const payment = paymentSummary(order);
  const client = customerName(order);
  const meta = customerMeta(order);
  return `
    <article class="order-work-row" data-order-id="${esc(order.id)}">
      <a class="order-main-link" href="./order.html?id=${encodeURIComponent(order.id)}">
        <span class="order-number"><b>№${esc(order.order_number ?? '—')}</b><small>${esc(orderDate(order.created_at))}</small></span>
        <span class="order-client"><b>${esc(client)}</b><small>${esc(meta || 'Контакт не указан')}</small></span>
        <span class="order-service"><b>${esc(orderTitle(order))}</b><small>${esc(unitLabel(order.business_unit))}</small></span>
        <span class="order-payment"><b class="pay-${payment.tone}">${esc(payment.label)}</b><small>${payment.paid > 0 && payment.total > 0 ? `${money(payment.paid)} из ${money(payment.total)} ₽` : 'Оплата заказа'}</small></span>
        <span class="order-total"><b>${money(order.total)} ₽</b><small>${esc(labels[order.status] || order.status || '—')}</small></span>
      </a>
      <div class="order-actions">
        <select class="order-status-select" data-order-status aria-label="Статус заказа №${esc(order.order_number ?? '')}">${statusOptions(order.status)}</select>
        <a class="order-open" href="./order.html?id=${encodeURIComponent(order.id)}">Открыть →</a>
      </div>
    </article>`;
}

function render(){
  syncUrl();
  renderStats();
  const rows = filteredOrders();
  $('visibleCount').textContent = `${rows.length} из ${state.orders.length}`;
  $('list').innerHTML = rows.map(rowHtml).join('') || '<div class="orders-empty">По этим условиям заказов не найдено</div>';
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
  renderStats();

  const { error } = await supabase.from('orders').update({status:nextStatus,updated_at:new Date().toISOString()}).eq('id',orderId);
  select.disabled = false;
  select.classList.remove('saving');
  if(error){
    order.status = previous;
    select.value = previous;
    renderStats();
    window.alert(`Не удалось изменить статус: ${error.message}`);
    return;
  }
  select.classList.add('saved');
  setTimeout(() => select.classList.remove('saved'),800);
  render();
}

async function load(){
  if(state.loading) return;
  state.loading = true;
  $('refresh').disabled = true;
  $('refresh').textContent = 'Обновление…';
  try{
    const [orders,payments] = await Promise.all([loadOrders(),loadPayments()]);
    state.orders = orders;
    state.payments = payments;
    render();
    $('updatedAt').textContent = `обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){
    console.error(error);
    $('list').innerHTML = `<div class="orders-empty error">Не удалось загрузить заказы: ${esc(error.message || error)}</div>`;
    $('updatedAt').textContent = 'ошибка загрузки';
  }finally{
    state.loading = false;
    $('refresh').disabled = false;
    $('refresh').textContent = '↻ Обновить';
  }
}

function initParams(){
  const params = new URLSearchParams(location.search);
  if(params.get('q')) $('search').value = params.get('q');
  for(const id of ['status','unit']){
    const value = params.get(id);
    if(value && [...$(id).options].some((o) => o.value === value)) $(id).value = value;
  }
}

function initEvents(){
  $('search').addEventListener('input',render);
  ['status','unit'].forEach((id) => $(id).addEventListener('change',render));
  $('refresh').addEventListener('click',load);
  $('clearFilters').addEventListener('click',() => {
    $('search').value='';$('status').value='';$('unit').value='';render();
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
  const reload = () => { clearTimeout(realtimeTimer); realtimeTimer = setTimeout(load,450); };
  state.channel = supabase.channel('manager-orders-workspace-v2')
    .on('postgres_changes',{event:'*',schema:'public',table:'orders'},reload)
    .on('postgres_changes',{event:'*',schema:'public',table:'payments'},reload)
    .subscribe();
  window.addEventListener('beforeunload',() => { if(state.channel) supabase.removeChannel(state.channel); },{once:true});
}

initParams();
initEvents();
load().finally(initRealtime);
