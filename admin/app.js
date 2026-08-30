import { supabase } from './guard.js';

const $ = (id) => document.getElementById(id);
const money = (v) => Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function statusLabel(status) {
  return ({NEW:'Новый',CONFIRMED:'Подтверждён',IN_PROGRESS:'В работе',READY:'Готов',COMPLETED:'Завершён',CANCELLED:'Отменён'})[status] || status || '—';
}

async function loadDashboard() {
  try {
    const [{ data: orders, error: ordersError }, { data: items, error: itemsError }] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('catalog_items').select('id,name,sku,item_type,min_stock').eq('is_active', true)
    ]);
    if (ordersError) throw ordersError;
    if (itemsError) throw itemsError;

    const list = orders || [];
    $('orderCount').textContent = list.length;
    $('newOrders').textContent = list.filter(x => x.status === 'NEW').length;
    $('activeOrders').textContent = list.filter(x => ['CONFIRMED','IN_PROGRESS'].includes(x.status)).length;
    $('readyOrders').textContent = list.filter(x => x.status === 'READY').length;

    const low = [];
    for (const item of items || []) {
      const { data: moves } = await supabase.from('inventory_transactions').select('transaction_type,quantity').eq('catalog_item_id', item.id);
      let qty = 0;
      for (const m of moves || []) {
        qty += ['RECEIPT','TRANSFER_IN','PRODUCTION_IN','ADJUSTMENT'].includes(m.transaction_type) ? Number(m.quantity) : -Number(m.quantity);
      }
      if (qty <= Number(item.min_stock || 0)) low.push(item);
    }
    $('lowStock').textContent = low.length;

    $('orders').innerHTML = list.slice(0, 10).map(order => `
      <div class="order-row" style="display:flex;justify-content:space-between;gap:16px;padding:14px;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:8px">
        <div><b>#${order.order_number ?? order.id?.slice(0,8) ?? '—'}</b> · ${order.model_name || order.business_unit || 'Заказ'}<div style="color:#64748b;font-size:13px;margin-top:4px">${order.customer_name || order.client_name || 'Клиент не указан'}</div></div>
        <div style="text-align:right"><b>${money(order.total || order.total_amount)} ₽</b><div style="color:#64748b;font-size:13px;margin-top:4px">${statusLabel(order.status)}</div></div>
      </div>`).join('') || '<div class="empty">Заказов пока нет</div>';
  } catch (error) {
    console.error(error);
    $('orders').innerHTML = `<div class="empty">Не удалось загрузить данные: ${error.message}</div>`;
  }
}

$('refresh')?.addEventListener('click', loadDashboard);
loadDashboard();
