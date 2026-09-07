import { supabase } from './guard.js?v=20260905-netfix1';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money = (value) => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });

const state = {
  orders: [],
  lowItems: [],
  production: [],
  pos: {
    shift: null,
    cash: null,
    health: null,
    sales: [],
    returns: [],
    syncIssues: 0
  }
};

let dashboardLoading = false;
let dashboardReloadQueued = false;
let shiftActionBusy = false;
let syncBusy = false;
let realtimeReloadTimer = null;
let realtimeChannel = null;

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
  if (['CONFIRMED', 'IN_PROGRESS'].includes(status)) return 'status-work';
  if (status === 'READY') return 'status-ready';
  if (status === 'COMPLETED') return 'status-completed';
  if (['ON_HOLD', 'CANCELLED'].includes(status)) return 'status-cancelled';
  return '';
}

function unitLabel(unit) {
  if (unit === '3D_ARTPRINT') return '3D-ARTPRINT';
  if (unit === 'A4_PRINT') return 'А4-Принт';
  return 'Общий';
}

function unitClass(unit) {
  if (unit === '3D_ARTPRINT') return 'unit-3d';
  if (unit === 'A4_PRINT') return '';
  return 'unit-common';
}

function customerName(order) {
  const customer = order.customers || {};
  return customer.full_name || customer.company_name || order.customer_name || order.client_name || 'Клиент не указан';
}

function customerMeta(order) {
  const customer = order.customers || {};
  return customer.phone || customer.email || customer.company_name || '';
}

function orderTitle(order) {
  return order.model_name || order.source || (order.business_unit === '3D_ARTPRINT' ? '3D-заказ' : 'Печать / услуга');
}

function orderDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' · ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function localDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayStartIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setOrderBadge(value) {
  const apply = () => {
    const badge = $('orderCount');
    if (badge) badge.textContent = value;
  };
  apply();
  setTimeout(apply, 350);
}

async function apiRequest(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Требуется повторный вход в HUB');

  const base = String(window.A4PRINT_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
  if (!base) throw new Error('API HUB не настроен');

  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${session.access_token}`);
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${base}${path}`, { ...options, headers, cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function apiHealth() {
  const base = String(window.A4PRINT_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
  if (!base) return null;
  const response = await fetch(`${base}/api/v1/health`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`API HTTP ${response.status}`);
  return response.json();
}

function renderRecentOrders() {
  const root = $('recentOrders');
  if (!root) return;
  const rows = state.orders.slice(0, 10);
  root.innerHTML = rows.map((order) => `
    <a class="dash-order-row" href="./order.html?id=${encodeURIComponent(order.id)}">
      <span class="dash-order-number">№${esc(order.order_number ?? String(order.id || '').slice(0, 8) || '—')}</span>
      <span class="dash-order-customer"><b>${esc(customerName(order))}</b><small>${esc(customerMeta(order) || orderDate(order.created_at))}</small></span>
      <span class="dash-order-service"><b>${esc(orderTitle(order))}</b><small>${esc(orderDate(order.created_at))}</small></span>
      <span class="dash-unit ${unitClass(order.business_unit)}">${esc(unitLabel(order.business_unit))}</span>
      <span class="dash-order-total">${money(order.total || order.total_amount)} ₽</span>
      <span class="dash-status ${statusClass(order.status)}">${esc(statusNames[order.status] || order.status || '—')}</span>
    </a>`).join('') || '<div class="dash-empty">Заказов пока нет</div>';
}

function attentionIcon(type) {
  const icons = {
    orders: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18H6z"></path><path d="M9 8h6M9 12h6"></path></svg>',
    ready: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"></path></svg>',
    stock: '<svg viewBox="0 0 24 24"><path d="m3 9 9-5 9 5v11H3z"></path><path d="M8 20v-7h8v7"></path></svg>',
    work: '<svg viewBox="0 0 24 24"><path d="M4 20h16M7 20v-9h10v9M9 11V7h6v4"></path></svg>',
    cash: '<svg viewBox="0 0 24 24"><path d="M4 7h16v10H4z"></path><path d="M8 12h8M12 9v6"></path></svg>',
    sync: '<svg viewBox="0 0 24 24"><path d="M20 7h-5V2"></path><path d="M20 7a8 8 0 0 0-14-2"></path><path d="M4 17h5v5"></path><path d="M4 17a8 8 0 0 0 14 2"></path></svg>'
  };
  return icons[type] || icons.orders;
}

function attentionRow({ href = '#', tone = 'info', icon = 'orders', title, text, count, extraClass = '' }) {
  return `
    <a class="dash-attention-item ${tone} ${extraClass}" href="${href}">
      <span class="dash-attention-icon">${attentionIcon(icon)}</span>
      <span class="dash-attention-copy"><b>${esc(title)}</b><span>${esc(text)}</span></span>
      <span class="dash-attention-count">${esc(count)}</span>
    </a>`;
}

function renderAttention(metrics) {
  const root = $('attention');
  if (!root) return;
  const lowNames = state.lowItems.slice(0, 3).map((x) => x.name).filter(Boolean);
  const items = [
    {
      href: './orders.html?status=NEW',
      tone: metrics.newCount ? 'info' : 'good',
      icon: 'orders',
      title: metrics.newCount ? 'Новые заказы' : 'Новых заказов нет',
      text: metrics.newCount ? 'Ждут обработки менеджером' : 'Входящие заказы обработаны',
      count: metrics.newCount
    },
    {
      href: './orders.html?status=READY',
      tone: metrics.readyCount ? 'good' : 'info',
      icon: 'ready',
      title: 'Готово к выдаче',
      text: metrics.readyCount ? 'Можно связаться с клиентами' : 'Сейчас готовых заказов нет',
      count: metrics.readyCount
    },
    {
      href: './warehouse.html',
      tone: metrics.lowCount ? 'danger' : 'good',
      icon: 'stock',
      title: metrics.lowCount ? 'Заканчиваются материалы' : 'Остатки в норме',
      text: metrics.lowCount ? (lowNames.join(', ') || 'Нужно проверить склад') : 'Критических остатков не найдено',
      count: metrics.lowCount
    },
    {
      href: './orders.html?status=WORK',
      tone: metrics.workCount ? 'warn' : 'good',
      icon: 'work',
      title: 'Заказы в работе',
      text: metrics.workCount ? 'Проверьте текущий прогресс' : 'Активных работ сейчас нет',
      count: metrics.workCount
    },
    {
      href: '../kassa/',
      tone: metrics.syncIssues ? 'danger' : 'good',
      icon: 'sync',
      title: metrics.syncIssues ? 'Есть ошибки синхронизации кассы' : 'Касса синхронизирована',
      text: metrics.syncIssues ? 'Проверьте проблемные продажи или возвраты' : 'Продажи и возвраты без предупреждений',
      count: metrics.syncIssues
    }
  ];
  root.innerHTML = items.map(attentionRow).join('');
}

function renderPos() {
  const root = $('posControlSummary');
  if (!root) return;

  const shiftPayload = state.pos.shift;
  const shift = shiftPayload?.shift || null;
  const shiftOpen = Boolean(shift);
  const summary = shiftPayload?.summary || null;
  const cash = state.pos.cash;
  const salesTotal = state.pos.sales.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const returnsTotal = state.pos.returns.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const net = salesTotal - returnsTotal;
  const syncIssues = state.pos.syncIssues;
  const apiOk = state.pos.health?.success === true && state.pos.health?.status === 'ok';
  const msOk = state.pos.health?.moyskladConfigured === true;

  const shiftText = shiftOpen
    ? `Смена №${shift.name || '—'} · открыта ${orderDate(shift.openDate)}`
    : 'Открытой розничной смены сейчас нет';
  const cashAvailable = cash?.available === true && Number.isFinite(Number(cash.cash));
  const cashText = cashAvailable
    ? `Источник: ${cash.source === 'MOYSKLAD_LEDGER' ? 'МойСклад ledger' : (cash.source || 'кассовый ledger')}${cash.delta ? ` · изменение ${cash.delta > 0 ? '+' : ''}${money(cash.delta)} ₽` : ''}`
    : (cash?.requires_baseline ? 'Нужно задать контрольный остаток в настройках KASSA' : 'Точный остаток временно недоступен');

  root.innerHTML = [
    attentionRow({ href: '../kassa/', tone: shiftOpen ? 'good' : 'warn', icon: 'work', title: shiftOpen ? 'Смена открыта' : 'Смена закрыта', text: shiftText, count: shiftOpen ? 'OPEN' : 'CLOSED' }),
    attentionRow({ href: '../kassa/', tone: cashAvailable ? 'good' : 'warn', icon: 'cash', title: 'Наличные в кассе', text: cashText, count: cashAvailable ? `${money(cash.cash)} ₽` : '—' }),
    attentionRow({ href: '../kassa/', tone: 'info', icon: 'orders', title: 'Продажи сегодня', text: `${state.pos.sales.length} операций · после возвратов ${money(net)} ₽`, count: `${money(salesTotal)} ₽` }),
    attentionRow({ href: '../kassa/', tone: returnsTotal ? 'warn' : 'good', icon: 'ready', title: 'Возвраты сегодня', text: `${state.pos.returns.length} операций`, count: `${money(returnsTotal)} ₽` }),
    attentionRow({ href: '../kassa/', tone: syncIssues || !apiOk || !msOk ? 'danger' : 'good', icon: 'sync', title: syncIssues ? 'Синхронизация требует проверки' : 'Синхронизация работает', text: `${apiOk ? 'API онлайн' : 'API недоступен'} · ${msOk ? 'МойСклад подключён' : 'МойСклад не подтверждён'}${summary ? ` · ${summary.source || 'live'}` : ''}`, count: syncIssues ? `${syncIssues} ошибок` : 'OK' })
  ].join('');

  setText('revenueToday', `${money(net)} ₽`);
  const shiftAction = $('posShiftAction');
  if (shiftAction && !shiftActionBusy) shiftAction.textContent = shiftOpen ? 'Закрыть смену' : 'Открыть смену';
}

function renderProduction() {
  const root = $('productionSummary');
  if (!root) return;
  const rows = state.production;
  const queued = rows.filter((x) => ['NEW', 'QUEUED'].includes(x.status)).length;
  const work = rows.filter((x) => ['IN_PROGRESS', 'PAUSED'].includes(x.status)).length;
  const done = rows.filter((x) => x.status === 'DONE').length;
  const latest = rows[0];

  root.innerHTML = [
    attentionRow({ href: './production.html', tone: queued ? 'info' : 'good', icon: 'orders', title: 'Новые задания', text: queued ? 'Ожидают запуска в производство' : 'Очередь свободна', count: queued }),
    attentionRow({ href: './production.html', tone: work ? 'warn' : 'good', icon: 'work', title: 'В производстве', text: work ? 'Активные или приостановленные задания' : 'Активных заданий нет', count: work }),
    attentionRow({ href: './production.html', tone: 'good', icon: 'ready', title: 'Выполнено', text: latest ? `Последнее: ${latest.title || 'производственное задание'}` : 'Производственных заданий пока нет', count: done }),
    attentionRow({ href: './production.html', tone: 'info', icon: 'sync', title: 'Всего заданий', text: 'Данные общей производственной очереди HUB', count: rows.length })
  ].join('');
}

function renderSearch(query) {
  const root = $('dashboardSearchResults');
  if (!root) return;
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    root.classList.remove('open');
    root.innerHTML = '';
    return;
  }

  const matches = state.orders.filter((order) => {
    const customer = order.customers || {};
    const haystack = [
      order.order_number,
      order.model_name,
      order.source,
      order.business_unit,
      customer.full_name,
      customer.company_name,
      customer.phone,
      customer.email,
      order.customer_name,
      order.client_name
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
  }).slice(0, 7);

  const rows = matches.map((order) => `
    <a class="dashboard-search-result" href="./order.html?id=${encodeURIComponent(order.id)}">
      <span><b>Заказ №${esc(order.order_number ?? String(order.id || '').slice(0, 8))} · ${esc(customerName(order))}</b><span>${esc(orderTitle(order))} · ${esc(unitLabel(order.business_unit))}</span></span>
      <strong>${money(order.total || order.total_amount)} ₽</strong>
    </a>`).join('');

  root.innerHTML = (rows || '<div class="dashboard-search-empty">Среди загруженных заказов совпадений нет</div>') + `
    <a class="dashboard-search-all" href="./orders.html?q=${encodeURIComponent(query)}"><span>Искать во всех заказах</span><span>→</span></a>`;
  root.classList.add('open');
}

function initSearch() {
  const input = $('dashboardSearch');
  const wrap = $('dashboardSearchWrap');
  if (!input || !wrap) return;

  input.addEventListener('input', () => renderSearch(input.value));
  input.addEventListener('focus', () => { if (input.value.trim()) renderSearch(input.value); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && input.value.trim()) {
      event.preventDefault();
      location.href = `./orders.html?q=${encodeURIComponent(input.value.trim())}`;
    }
    if (event.key === 'Escape') $('dashboardSearchResults')?.classList.remove('open');
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#dashboardSearchWrap')) $('dashboardSearchResults')?.classList.remove('open');
  });
}

function initControlActions() {
  $('posShiftAction')?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (shiftActionBusy) return;

    const open = Boolean(state.pos.shift?.shift);
    const actionLabel = open ? 'закрыть текущую кассовую смену' : 'открыть новую кассовую смену';
    if (!window.confirm(`Точно ${actionLabel}? Изменение будет выполнено в общей кассе и МойСклад.`)) return;

    shiftActionBusy = true;
    const button = $('posShiftAction');
    if (button) button.textContent = open ? 'Закрываю...' : 'Открываю...';
    try {
      await apiRequest(`/api/v1/pos/shift/${open ? 'close' : 'open'}`, { method: 'POST', body: '{}' });
      await loadDashboard(true);
    } catch (error) {
      console.error(error);
      window.alert(`Не удалось изменить смену: ${error.message}`);
    } finally {
      shiftActionBusy = false;
      renderPos();
    }
  });

  $('syncMoySklad')?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (syncBusy) return;

    syncBusy = true;
    const button = $('syncMoySklad');
    if (button) button.textContent = 'Обновляю каталог...';
    try {
      const result = await apiRequest('/api/v1/integrations/moysklad/sync', { method: 'POST', body: '{}' });
      const details = [
        result.updated ? `обновлено ${result.updated}` : '',
        result.created ? `добавлено ${result.created}` : ''
      ].filter(Boolean).join(', ');
      if (button) button.textContent = details ? `Готово: ${details}` : 'Каталог обновлён';
      await loadDashboard(true);
    } catch (error) {
      console.error(error);
      if (button) button.textContent = 'Ошибка обновления';
      window.alert(`Каталог МойСклад не обновлён: ${error.message}`);
    } finally {
      syncBusy = false;
      setTimeout(() => { if (button) button.textContent = 'Обновить каталог'; }, 2500);
    }
  });
}

function scheduleRealtimeReload() {
  clearTimeout(realtimeReloadTimer);
  realtimeReloadTimer = setTimeout(() => loadDashboard(true), 450);
}

function initRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = supabase
    .channel('admin-control-center-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, scheduleRealtimeReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_sales' }, scheduleRealtimeReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_returns' }, scheduleRealtimeReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_shift_sessions' }, scheduleRealtimeReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'production_jobs' }, scheduleRealtimeReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_transactions' }, scheduleRealtimeReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'catalog_items' }, scheduleRealtimeReload)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.info('A4PRINT HUB realtime подключён');
      if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) console.warn('A4PRINT HUB realtime:', status);
    });

  window.addEventListener('beforeunload', () => {
    if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  }, { once: true });
}

async function loadDashboard(force = false) {
  if (dashboardLoading) {
    if (force) dashboardReloadQueued = true;
    return;
  }

  dashboardLoading = true;
  const recent = $('recentOrders');
  const start = dayStartIso();

  try {
    const [
      ordersResult,
      countResult,
      itemsResult,
      movesResult,
      productionResult,
      posSalesResult,
      posReturnsResult,
      posSalesIssuesResult,
      posReturnIssuesResult
    ] = await Promise.all([
      supabase.from('orders').select('*,customers(full_name,company_name,phone,email)').order('created_at', { ascending: false }).limit(200),
      supabase.from('orders').select('id', { count: 'exact', head: true }),
      supabase.from('catalog_items').select('id,name,sku,item_type,min_stock').eq('is_active', true),
      supabase.from('inventory_transactions').select('catalog_item_id,transaction_type,quantity'),
      supabase.from('production_jobs').select('id,title,status,priority,planned_start,planned_end,created_at').order('created_at', { ascending: false }).limit(200),
      supabase.from('pos_sales').select('id,total,payment_method,sold_at,sync_status,sync_error').gte('sold_at', start).order('sold_at', { ascending: false }).limit(500),
      supabase.from('pos_returns').select('id,amount,payment_method,returned_at,sync_status,sync_error').gte('returned_at', start).order('returned_at', { ascending: false }).limit(500),
      supabase.from('pos_sales').select('id', { count: 'exact', head: true }).in('sync_status', ['FAILED', 'WARNING']),
      supabase.from('pos_returns').select('id', { count: 'exact', head: true }).in('sync_status', ['FAILED', 'WARNING'])
    ]);

    if (ordersResult.error) throw ordersResult.error;
    state.orders = ordersResult.data || [];
    setOrderBadge(countResult.error ? state.orders.length : (countResult.count ?? state.orders.length));

    const qtyByItem = new Map();
    if (!movesResult.error) {
      for (const move of movesResult.data || []) {
        const current = qtyByItem.get(move.catalog_item_id) || 0;
        const quantity = Number(move.quantity || 0);
        const positive = ['RECEIPT', 'TRANSFER_IN', 'PRODUCTION_IN', 'ADJUSTMENT'].includes(move.transaction_type);
        qtyByItem.set(move.catalog_item_id, current + (positive ? quantity : -quantity));
      }
    }

    state.lowItems = [];
    if (!itemsResult.error && !movesResult.error) {
      for (const item of itemsResult.data || []) {
        const qty = qtyByItem.get(item.id) || 0;
        const min = Number(item.min_stock || 0);
        if (qty <= min) state.lowItems.push({ ...item, qty, min });
      }
    } else {
      console.warn('Не удалось обновить складскую сводку', itemsResult.error || movesResult.error);
    }

    state.production = productionResult.error ? [] : (productionResult.data || []);
    if (productionResult.error) console.warn('Не удалось обновить производство', productionResult.error);

    state.pos.sales = posSalesResult.error ? [] : (posSalesResult.data || []);
    state.pos.returns = posReturnsResult.error ? [] : (posReturnsResult.data || []);
    if (posSalesResult.error) console.warn('Не удалось загрузить продажи кассы', posSalesResult.error);
    if (posReturnsResult.error) console.warn('Не удалось загрузить возвраты кассы', posReturnsResult.error);

    const todayIssueFallback = [...state.pos.sales, ...state.pos.returns]
      .filter((row) => ['FAILED', 'WARNING'].includes(row.sync_status)).length;
    if (!posSalesIssuesResult.error && !posReturnIssuesResult.error) {
      state.pos.syncIssues = Number(posSalesIssuesResult.count || 0) + Number(posReturnIssuesResult.count || 0);
    } else {
      state.pos.syncIssues = todayIssueFallback;
      console.warn('Не удалось получить полный счётчик ошибок синхронизации', posSalesIssuesResult.error || posReturnIssuesResult.error);
    }

    const orders = state.orders;
    const newCount = orders.filter((x) => x.status === 'NEW').length;
    const workCount = orders.filter((x) => ['CONFIRMED', 'IN_PROGRESS'].includes(x.status)).length;
    const readyCount = orders.filter((x) => x.status === 'READY').length;
    const lowCount = state.lowItems.length;

    setText('newOrders', newCount);
    setText('activeOrders', workCount);
    setText('readyOrders', readyCount);
    setText('lowStock', lowCount);

    const activeStatuses = ['NEW', 'CONFIRMED', 'IN_PROGRESS'];
    const a4 = orders.filter((x) => x.business_unit === 'A4_PRINT');
    const d3 = orders.filter((x) => x.business_unit === '3D_ARTPRINT');
    setText('a4Active', a4.filter((x) => activeStatuses.includes(x.status)).length);
    setText('a4Ready', a4.filter((x) => x.status === 'READY').length);
    setText('d3Active', d3.filter((x) => activeStatuses.includes(x.status)).length);
    setText('d3Ready', d3.filter((x) => x.status === 'READY').length);

    const [shiftResult, cashResult, healthResult] = await Promise.allSettled([
      apiRequest('/api/v1/pos/shift'),
      apiRequest('/api/v1/pos/cash-balance'),
      apiHealth()
    ]);

    state.pos.shift = shiftResult.status === 'fulfilled' ? shiftResult.value : null;
    state.pos.cash = cashResult.status === 'fulfilled' ? cashResult.value : (cashResult.reason?.payload || null);
    state.pos.health = healthResult.status === 'fulfilled' ? healthResult.value : null;

    if (shiftResult.status === 'rejected') console.warn('Статус смены недоступен', shiftResult.reason);
    if (cashResult.status === 'rejected') console.warn('Точный остаток кассы недоступен', cashResult.reason);
    if (healthResult.status === 'rejected') console.warn('API health недоступен', healthResult.reason);

    renderRecentOrders();
    renderAttention({ newCount, workCount, readyCount, lowCount, syncIssues: state.pos.syncIssues });
    renderPos();
    renderProduction();
    setText('lastUpdated', `обновлено ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);

    const search = $('dashboardSearch');
    if (search?.value.trim()) renderSearch(search.value);
  } catch (error) {
    console.error(error);
    if (recent) recent.innerHTML = `<div class="dash-empty">Не удалось загрузить данные: ${esc(error.message)}</div>`;
    const attention = $('attention');
    if (attention) attention.innerHTML = '<div class="dash-empty">Сводка временно недоступна</div>';
    setText('lastUpdated', 'ошибка обновления');
  } finally {
    dashboardLoading = false;
    if (dashboardReloadQueued) {
      dashboardReloadQueued = false;
      setTimeout(() => loadDashboard(), 0);
    }
  }
}

const todayText = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
setText('todayLabel', `Сегодня, ${todayText} · А4-Принт + 3D-ARTPRINT + KASSA`);
initSearch();
initControlActions();
initRealtime();
loadDashboard();
setInterval(loadDashboard, 60000);
