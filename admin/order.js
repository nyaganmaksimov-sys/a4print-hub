const API_BASE = window.A4PRINT_API_URL || '';
const id = new URLSearchParams(location.search).get('id');
const $ = (x) => document.getElementById(x);

function esc(value=''){return String(value).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

function render(o){
  $('title').textContent=`Заказ #${o.order_number ?? '—'}`;
  $('subtitle').textContent=o.business_unit==='3D_ARTPRINT'?'3D-ARTPRINT':'А4-Принт';
  $('status').textContent=o.status||'—';
  const customer=o.customer||{};
  $('details').innerHTML=`
    <div style="display:grid;gap:18px">
      <div><h3>Клиент</h3><div>${esc(customer.full_name||'Не указан')}</div><div style="color:#64748b">${esc(customer.phone||'')} ${customer.email?` · ${esc(customer.email)}`:''}</div></div>
      <div><h3>Модель</h3><div><b>${esc(o.model_name||'—')}</b></div>${o.model_url?`<a href="${esc(o.model_url)}" target="_blank" rel="noopener">🔗 Открыть модель</a>`:'<span style="color:#94a3b8">Ссылка не указана</span>'}</div>
      <div><h3>Позиции</h3><div id="items">${(o.items||[]).map(i=>`<div style="padding:10px 0;border-bottom:1px solid #e5e7eb"><b>${esc(i.name)}</b> × ${esc(i.quantity)} — ${Number(i.total_price||0).toLocaleString('ru-RU')} ₽<div style="color:#64748b;font-size:13px">${esc(JSON.stringify(i.parameters||{}))}</div></div>`).join('')||'—'}</div></div>
      <div><h3>Стоимость</h3><strong style="font-size:24px">${Number(o.total||0).toLocaleString('ru-RU')} ₽</strong></div>
      <div><h3>Комментарий</h3><div>${esc(o.customer_comment||'Нет')}</div></div>
    </div>`;
  $('history').innerHTML=(o.status_history||[]).map(h=>`<div style="padding:10px 0;border-bottom:1px solid #e5e7eb"><b>${esc(h.new_status)}</b><div style="color:#64748b;font-size:13px">${esc(h.comment||'')}</div></div>`).join('')||'<div class="empty">История пока пуста</div>';
}

async function load(){
  if(!API_BASE||!id){$('details').innerHTML='<div class="empty">Не указан ID заказа</div>';return;}
  try{const r=await fetch(`${API_BASE}/api/v1/orders/${encodeURIComponent(id)}`);if(!r.ok)throw new Error(`HTTP ${r.status}`);const d=await r.json();render(d.order||d);}catch(e){console.error(e);$('details').innerHTML='<div class="empty">Не удалось загрузить заказ</div>';}
}

document.querySelectorAll('[data-status]').forEach(btn=>btn.addEventListener('click',async()=>{
  if(!API_BASE||!id)return;
  btn.disabled=true;
  try{const r=await fetch(`${API_BASE}/api/v1/orders/${encodeURIComponent(id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:btn.dataset.status})});if(!r.ok)throw new Error(`HTTP ${r.status}`);await load();}catch(e){alert('Не удалось изменить статус заказа');console.error(e)}finally{btn.disabled=false;}
}));
load();
