const API_BASE = window.A4PRINT_API_URL || '';

const $ = (id) => document.getElementById(id);

function renderOrders(orders) {
  const root = $('orders');
  if (!orders?.length) {
    root.innerHTML = '<div class="empty">Заказов пока нет</div>';
    return;
  }
  root.innerHTML = orders.slice(0, 10).map(order => `
    <div class="order-row" style="display:flex;justify-content:space-between;gap:16px;padding:14px;border:1px solid #e5e7eb;border-radius:12px">
      <div><b>#${order.order_number ?? '—'}</b> · ${order.model_name || order.business_unit || 'Заказ'}<div style="color:#64748b;font-size:13px;margin-top:4px">${order.customer?.full_name || 'Клиент не указан'}</div></div>
      <div style="text-align:right"><b>${Number(order.total || 0).toLocaleString('ru-RU')} ₽</b><div style="color:#64748b;font-size:13px;margin-top:4px">${order.status || ''}</div></div>
    </div>`).join('');
}

async function loadOrders() {
  if (!API_BASE) return;
  try {
    const response = await fetch(`${API_BASE}/api/v1/orders`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const orders = data.orders || [];
    renderOrders(orders);
    $('orderCount').textContent = orders.length;
    $('newOrders').textContent = orders.filter(x => x.status === 'NEW').length;
    $('activeOrders').textContent = orders.filter(x => ['CONFIRMED','IN_PROGRESS'].includes(x.status)).length;
    $('readyOrders').textContent = orders.filter(x => x.status === 'READY').length;
  } catch (error) {
    console.error(error);
    $('orders').innerHTML = '<div class="empty">Не удалось загрузить заказы</div>';
  }
}

$('refresh').addEventListener('click', loadOrders);
loadOrders();
