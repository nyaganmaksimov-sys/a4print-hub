// POS customer panel. Loaded only on admin/pos.html from config.js.
(() => {
  if (!/\/admin\/pos\.html$/.test(location.pathname)) return;

  const state = { customer: null, searchTimer: null };
  window.A4PRINT_POS_CUSTOMER = state;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const base = () => window.A4PRINT_CONFIG?.apiBaseUrl || '';

  async function token() {
    const raw = localStorage.getItem('sb-qgakliolffnwkymoqvzn-auth-token');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return parsed?.access_token || parsed?.currentSession?.access_token || null;
      } catch (_) {}
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('sb-') || !k.endsWith('-auth-token')) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(k));
        const access = parsed?.access_token || parsed?.currentSession?.access_token;
        if (access) return access;
      } catch (_) {}
    }
    return null;
  }

  async function api(path, options = {}) {
    const access = await token();
    if (!access) throw new Error('Сессия кассы не найдена');
    const r = await originalFetch(base() + path, {
      ...options,
      headers: {
        Authorization: `Bearer ${access}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message || d.error || 'Ошибка API');
    return d;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function(input, init = {}) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    let nextInit = init;

    if (url.includes('/api/v1/pos/sale') && method === 'POST' && state.customer?.id) {
      try {
        const body = JSON.parse(init.body || '{}');
        body.customer_id = state.customer.id;
        nextInit = { ...init, body: JSON.stringify(body) };
      } catch (_) {}
    }

    if (url.includes('/rest/v1/cash_transactions') && method === 'POST' && state.customer?.id) {
      try {
        const body = JSON.parse(init.body || '{}');
        const addCustomer = row => ({ ...row, customer_id: state.customer.id });
        nextInit = { ...init, body: JSON.stringify(Array.isArray(body) ? body.map(addCustomer) : addCustomer(body)) };
      } catch (_) {}
    }

    const response = await originalFetch(input, nextInit);
    if (response.ok && url.includes('/rest/v1/cash_transactions') && method === 'POST') {
      setTimeout(() => clearCustomer(), 0);
    }
    return response;
  };

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .customer-box{border:1px solid #e6ebf2;border-radius:13px;background:#f8fafc;padding:11px;display:grid;gap:9px}
      .customer-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.customer-title{font-size:13px;font-weight:850;color:#334155}.customer-clear{border:0;background:transparent;color:#64748b;cursor:pointer;font-size:12px}
      .customer-search{width:100%;border:1px solid #e2e8f0;border-radius:10px;padding:10px 11px;background:#fff;outline:0}.customer-search:focus{border-color:#a9bcff;box-shadow:0 0 0 3px rgba(37,99,235,.08)}
      .customer-results{display:grid;gap:5px;max-height:150px;overflow:auto}.customer-result{border:1px solid #e2e8f0;background:#fff;border-radius:9px;padding:8px 9px;text-align:left;cursor:pointer}.customer-result b{display:block;font-size:12px}.customer-result span{font-size:11px;color:#64748b}
      .customer-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.customer-grid input,.customer-notes{width:100%;border:1px solid #e2e8f0;border-radius:9px;padding:9px;background:#fff;font:inherit;font-size:12px;outline:0}.customer-notes{min-height:66px;resize:vertical}.customer-save{border:0;border-radius:10px;background:#2563eb;color:#fff;padding:10px 12px;font-weight:800;cursor:pointer}.customer-save:disabled{opacity:.55}.customer-selected{font-size:12px;background:#ecfdf3;color:#166534;border:1px solid #bbf7d0;border-radius:9px;padding:8px 9px}.customer-hint{font-size:11px;color:#64748b;line-height:1.35}
      @media(max-width:460px){.customer-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function panelHtml() {
    return `<div id="posCustomerBox" class="customer-box">
      <div class="customer-head"><div class="customer-title">👤 Клиент</div><button id="customerClear" class="customer-clear" type="button">Очистить</button></div>
      <input id="customerSearch" class="customer-search" placeholder="Найти по имени, телефону или email…" autocomplete="off">
      <div id="customerResults" class="customer-results"></div>
      <div id="customerSelected" class="customer-selected" style="display:none"></div>
      <div class="customer-grid">
        <input id="customerName" placeholder="Имя клиента *">
        <input id="customerPhone" placeholder="Телефон">
        <input id="customerEmail" placeholder="Email">
        <input id="customerCompany" placeholder="Компания">
      </div>
      <textarea id="customerNotes" class="customer-notes" placeholder="Комментарий для менеджеров: что важно учесть, пожелания, детали заказа…"></textarea>
      <div class="customer-hint">Комментарий сохраняется в карточке клиента и доступен менеджерам. Клиента можно указать без привязки к МойСклад.</div>
      <button id="customerSave" class="customer-save" type="button">Сохранить клиента</button>
    </div>`;
  }

  function el(id) { return document.getElementById(id); }

  function fill(c) {
    state.customer = c || null;
    el('customerName').value = c?.full_name || '';
    el('customerPhone').value = c?.phone || '';
    el('customerEmail').value = c?.email || '';
    el('customerCompany').value = c?.company_name || '';
    el('customerNotes').value = '';
    el('customerResults').innerHTML = '';
    const selected = el('customerSelected');
    if (c) {
      selected.style.display = 'block';
      selected.innerHTML = `<b>${esc(c.full_name)}</b>${c.phone ? ` · ${esc(c.phone)}` : ''}${c.email ? ` · ${esc(c.email)}` : ''}`;
    } else {
      selected.style.display = 'none';
      selected.textContent = '';
    }
  }

  function clearCustomer() {
    state.customer = null;
    if (!el('posCustomerBox')) return;
    ['customerSearch','customerName','customerPhone','customerEmail','customerCompany','customerNotes'].forEach(id => { el(id).value = ''; });
    el('customerResults').innerHTML = '';
    el('customerSelected').style.display = 'none';
  }
  window.A4PRINT_CLEAR_POS_CUSTOMER = clearCustomer;

  async function searchCustomers(q) {
    if (q.trim().length < 2) { el('customerResults').innerHTML = ''; return; }
    try {
      const d = await api('/api/v1/pos/customers?q=' + encodeURIComponent(q.trim()));
      const rows = d.customers || [];
      el('customerResults').innerHTML = rows.map(c => `<button type="button" class="customer-result" data-customer-id="${c.id}"><b>${esc(c.full_name)}</b><span>${esc(c.phone || '')}${c.phone && c.email ? ' · ' : ''}${esc(c.email || '')}</span></button>`).join('') || '<div class="customer-hint">Клиент не найден — заполните данные ниже и сохраните.</div>';
      document.querySelectorAll('[data-customer-id]').forEach(btn => btn.onclick = () => {
        const c = rows.find(x => x.id === btn.dataset.customerId);
        if (c) fill(c);
      });
    } catch (e) {
      el('customerResults').innerHTML = `<div class="customer-hint">Ошибка поиска: ${esc(e.message)}</div>`;
    }
  }

  async function saveCustomer() {
    const payload = {
      id: state.customer?.id || null,
      full_name: el('customerName').value.trim(),
      phone: el('customerPhone').value.trim(),
      email: el('customerEmail').value.trim(),
      company_name: el('customerCompany').value.trim(),
      manager_comment: el('customerNotes').value.trim()
    };
    if (!payload.full_name) { el('customerName').focus(); return; }
    const btn = el('customerSave');
    try {
      btn.disabled = true;
      btn.textContent = 'Сохраняю…';
      const d = await api('/api/v1/pos/customers', { method: 'POST', body: JSON.stringify(payload) });
      fill(d.customer);
      btn.textContent = '✓ Клиент сохранён';
      setTimeout(() => { if (btn) btn.textContent = 'Сохранить клиента'; }, 1200);
    } catch (e) {
      btn.textContent = 'Ошибка: ' + e.message;
      setTimeout(() => { if (btn) btn.textContent = 'Сохранить клиента'; }, 2200);
    } finally {
      btn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    const foot = document.querySelector('.cart-foot');
    if (!foot || document.getElementById('posCustomerBox')) return;
    foot.insertAdjacentHTML('afterbegin', panelHtml());
    el('customerClear').onclick = clearCustomer;
    el('customerSave').onclick = saveCustomer;
    el('customerSearch').addEventListener('input', e => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => searchCustomers(e.target.value), 250);
    });
  });
})();
