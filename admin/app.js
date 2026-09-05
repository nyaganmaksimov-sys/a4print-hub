import { supabase } from './guard.js?v=20260905-netfix1';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money = (value) => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const state = { orders: [], lowItems: [] };

const statusNames = {
  NEW: 'Новый',
  CONFIRMED: 'Подтверждён',
  IN_PROGRESS: 'В работе',
  READY: 'Готов',
  COMPLETED: 'Завершён',
  ON_HOLD: 'Приостановлен',
  CANCELLED: 'Отменён'
};

function statusClass(status) {
  if (status === 'NEW') return 'status-new';
  if (['CONFIRMED','IN_PROGRESS'].includes(status)) return 'status-work';
  if (status === 'READY') return 'status-ready';
  if (status === 'COMPLETED') return 'status-completed';
  if (['ON_HOLD','CANCELLED'].includes(status)) return 'status-cancelled';
  return '';
}

function unitLabel(unit) {
  if (unit === '3D_ARTPRINT') return '3D-ARTPRINT';
  if (unit === 'A4_PRINT') return 'А4-Принт';
  return 'Общий';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function renderRecentOrders() {
  const root = $('recentOrders');
  if (!root) return;
  if (!state.orders.length) {
    root.innerHTML = '<div class="dash-empty">Пока нет заказов</div>';
    return;
  }
  root.innerHTML = state.orders.slice(0, 8).map(order => {
    const customer = order.customers?.company_name || order.customers?.full_name || 'Без клиента';
    return `<a class="dash-row" href="./orders.html?open=${encodeURIComponent(order.id)}"><span class="dash-row-main"><b>${esc(order.order_number || 'Заказ')}</b><small>${esc(customer)} · ${esc(unitLabel(order.business_unit))}</small></span><span class="dash-row-side"><b>${money(order.total)} ₽</b><span class="dash-status ${statusClass(order.status)}">${esc(statusNames[order.status] || order.status || '—')}</span></span></a>`;
  }).join('');
}

function renderProductionSummary(rows) {
  const root = $('productionSummary');
  if (!root) return;
  const groups = new Map();
  for (const row of rows || []) {
    const key = row.status || 'UNKNOWN';
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const items = [
    ['NEW','Ожидают запуска'],
    ['IN_PROGRESS','Сейчас в работе'],
    ['READY','Готовы'],
    ['ON_HOLD','Приостановлены']
  ];
  root.innerHTML = items.map(([key,label]) => `<a class="dash-row" href="./production.html?status=${key}"><span class="dash-row-main"><b>${esc(label)}</b><small>Производственные задания</small></span><span class="dash-row-side"><b>${groups.get(key) || 0}</b></span></a>`).join('');
}

function updateKpis() {
  const orders = state.orders;
  if ($('newOrders')) $('newOrders').textContent = orders.filter(x => x.status === 'NEW').length;
  if ($('activeOrders')) $('activeOrders').textContent = orders.filter(x => ['CONFIRMED','IN_PROGRESS'].includes(x.status)).length;
  if ($('readyOrders')) $('readyOrders').textContent = orders.filter(x => x.status === 'READY').length;
  if ($('lowStock')) $('lowStock').textContent = state.lowItems.length;
}

function renderSearchResults(items) {
  const root = $('dashboardSearchResults');
  if (!root) return;
  if (!items.length) {
    root.innerHTML = '<div class="dashboard-search-empty">Ничего не найдено</div>';
    root.classList.add('open');
    return;
  }
  root.innerHTML = items.map(item => {
    const href = item.type === 'order' ? `./orders.html?open=${encodeURIComponent(item.id)}` : `./customers.html?open=${encodeURIComponent(item.id)}`;
    return `<a href="${href}"><b>${esc(item.title)}</b><small>${esc(item.subtitle || '')}</small></a>`;
  }).join('');
  root.classList.add('open');
}

async function searchDashboard(term) {
  const q = String(term || '').trim();
  if (q.length < 2) {
    $('dashboardSearchResults')?.classList.remove('open');
    return;
  }
  const safe = q.replace(/[,%()]/g, ' ');
  const [orders, customers] = await Promise.all([
    supabase.from('orders').select('id,order_number,status,total,customers(full_name,company_name)').or(`order_number.ilike.%${safe}%,model_name.ilike.%${safe}%`).limit(8),
    supabase.from('customers').select('id,full_name,company_name,email,phone').or(`full_name.ilike.%${safe}%,company_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`).limit(8)
  ]);
  const result = [];
  for (const x of orders.data || []) result.push({ type:'order', id:x.id, title:x.order_number || 'Заказ', subtitle:`${x.customers?.company_name || x.customers?.full_name || 'Без клиента'} · ${statusNames[x.status] || x.status || ''}` });
  for (const x of customers.data || []) result.push({ type:'customer', id:x.id, title:x.company_name || x.full_name || 'Клиент', subtitle:[x.phone,x.email].filter(Boolean).join(' · ') });
  renderSearchResults(result.slice(0, 12));
}

async function loadDashboard() {
  const [{ data: { user } }, ordersResult, lowResult, productionResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('orders').select('id,order_number,status,total,business_unit,created_at,customers(full_name,company_name)').order('created_at',{ascending:false}).limit(100),
    supabase.from('inventory_items').select('id').lte('current_stock', 5).limit(100),
    supabase.from('production_tasks').select('id,status').order('created_at',{ascending:false}).limit(200)
  ]);
  if ($('userEmail')) $('userEmail').textContent = user?.email || '';
  state.orders = ordersResult.data || [];
  state.lowItems = lowResult.data || [];
  renderRecentOrders();
  renderProductionSummary(productionResult.data || []);
  updateKpis();

  try {
    const start = new Date();
    start.setHours(0,0,0,0);
    const { data: sales } = await supabase.from('pos_sales').select('total,sold_at').gte('sold_at', start.toISOString());
    const revenue = (sales || []).reduce((s,x) => s + Number(x.total || 0), 0);
    if ($('revenueToday')) $('revenueToday').textContent = `${money(revenue)} ₽`;
  } catch {}
}

$('logout')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.replace('./login.html');
});

const searchInput = $('dashboardSearch');
let searchTimer = null;
searchInput?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchDashboard(searchInput.value).catch(() => {}), 220);
});
searchInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const first = $('dashboardSearchResults')?.querySelector('a');
    if (first) { e.preventDefault(); first.click(); }
  }
});
document.addEventListener('click', e => {
  if (!e.target.closest('#dashboardSearchWrap')) $('dashboardSearchResults')?.classList.remove('open');
});

const now = new Date();
if ($('todayLabel')) $('todayLabel').textContent = now.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});
loadDashboard().catch(error => console.error('Dashboard load failed', error));
