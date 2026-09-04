import { supabase } from './guard.js';

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
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' · ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function localDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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

function renderRecentOrders() {
  const root = $('recentOrders');
  if (!root) return;
  const rows = state.orders.slice(0, 10);
  root.innerHTML = rows.map((order) => `
    <a class="dash-order-row" href="./order.html?id=${encodeURIComponent(order.id)}">
      <span class="dash-order-number">№${esc(order.order_number ?? String(order.id || '').slice(0,8) || '—')}</span>
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
    work: '<svg viewBox="0 0 24 24"><path d="M4 20h16M7 20v-9h10v9M9 11V7h6v4"></path></svg>'
  };
  return icons[type] || icons.orders;
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
    }
  ];
  root.innerHTML = items.map((item) => `
    <a class="dash-attention-item ${item.tone}" href="${item.href}">
      <span class="dash-attention-icon">${attentionIcon(item.icon)}</span>
      <span class="dash-attention-copy"><b>${esc(item.title)}</b><span>${esc(item.text)}</span></span>
      <span class="dash-attention-count">${item.count}</span>
    </a>`).join('');
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
      <span><b>Заказ №${esc(order.order_number ?? String(order.id || '').slice(0,8))} · ${esc(customerName(order))}</b><span>${esc(orderTitle(order))} · ${esc(unitLabel(order.business_unit))}</span></span>
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

async function loadDashboard() {
  const recent = $('recentOrders');
  try {
    const [ordersResult, countResult, itemsResult, movesResult] = await Promise.all([
      supabase.from('orders').select('*,customers(full_name,company_name,phone,email)').order('created_at', { ascending: false }).limit(200),
      supabase.from('orders').select('id', { count: 'exact', head: true }),
      supabase.from('catalog_items').select('id,name,sku,item_type,min_stock').eq('is_active', true),
      supabase.from('inventory_transactions').select('catalog_item_id,transaction_type,quantity')
    ]);

    if (ordersResult.error) throw ordersResult.error;
    state.orders = ordersResult.data || [];
    setOrderBadge(countResult.error ? state.orders.length : (countResult.count ?? state.orders.length));

    const qtyByItem = new Map();
    if (!movesResult.error) {
      for (const move of movesResult.data || []) {
        const current = qtyByItem.get(move.catalog_item_id) || 0;
        const quantity = Number(move.quantity || 0);
        const positive = ['RECEIPT','TRANSFER_IN','PRODUCTION_IN','ADJUSTMENT'].includes(move.transaction_type);
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

    const orders = state.orders;
    const newCount = orders.filter((x) => x.status === 'NEW').length;
    const workCount = orders.filter((x) => ['CONFIRMED','IN_PROGRESS'].includes(x.status)).length;
    const readyCount = orders.filter((x) => x.status === 'READY').length;
    const lowCount = state.lowItems.length;
    const today = localDateKey(new Date());
    const revenue = orders
      .filter((x) => x.status !== 'CANCELLED' && localDateKey(x.created_at) === today)
      .reduce((sum, x) => sum + Number(x.total || x.total_amount || 0), 0);

    setText('newOrders', newCount);
    setText('activeOrders', workCount);
    setText('readyOrders', readyCount);
    setText('lowStock', lowCount);
    setText('revenueToday', `${money(revenue)} ₽`);

    const activeStatuses = ['NEW','CONFIRMED','IN_PROGRESS'];
    const a4 = orders.filter((x) => x.business_unit === 'A4_PRINT');
    const d3 = orders.filter((x) => x.business_unit === '3D_ARTPRINT');
    setText('a4Active', a4.filter((x) => activeStatuses.includes(x.status)).length);
    setText('a4Ready', a4.filter((x) => x.status === 'READY').length);
    setText('d3Active', d3.filter((x) => activeStatuses.includes(x.status)).length);
    setText('d3Ready', d3.filter((x) => x.status === 'READY').length);

    renderRecentOrders();
    renderAttention({ newCount, workCount, readyCount, lowCount });
    setText('lastUpdated', `обновлено ${new Date().toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' })}`);

    const search = $('dashboardSearch');
    if (search?.value.trim()) renderSearch(search.value);
  } catch (error) {
    console.error(error);
    if (recent) recent.innerHTML = `<div class="dash-empty">Не удалось загрузить данные: ${esc(error.message)}</div>`;
    const attention = $('attention');
    if (attention) attention.innerHTML = '<div class="dash-empty">Сводка временно недоступна</div>';
    setText('lastUpdated', 'ошибка обновления');
  }
}

const todayText = new Intl.DateTimeFormat('ru-RU', { weekday:'long', day:'numeric', month:'long' }).format(new Date());
setText('todayLabel', `Сегодня, ${todayText} · А4-Принт + 3D-ARTPRINT`);
initSearch();
loadDashboard();
setInterval(loadDashboard, 60000);
