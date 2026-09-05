(() => {
  'use strict';

  const cfg = window.A4PRINT_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
  const rub = value => Number(value || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }) + ' ₽';
  const dt = value => value ? new Date(value).toLocaleString('ru-RU') : '—';

  let timer = null;

  function projectRef() {
    try { return new URL(cfg.supabaseUrl || '').hostname.split('.')[0] || ''; }
    catch { return ''; }
  }

  function extractToken(value) {
    if (!value) return '';
    try {
      const data = typeof value === 'string' ? JSON.parse(value) : value;
      if (data?.access_token) return data.access_token;
      if (data?.currentSession?.access_token) return data.currentSession.access_token;
      if (Array.isArray(data)) {
        for (const item of data) {
          const token = extractToken(item);
          if (token) return token;
        }
      }
      if (data && typeof data === 'object') {
        for (const item of Object.values(data)) {
          if (item && typeof item === 'object') {
            const token = extractToken(item);
            if (token) return token;
          }
        }
      }
    } catch {}
    return '';
  }

  function authToken() {
    const ref = projectRef();
    const preferred = ref ? localStorage.getItem(`sb-${ref}-auth-token`) : null;
    const first = extractToken(preferred);
    if (first) return first;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
      const token = extractToken(localStorage.getItem(key));
      if (token) return token;
    }
    return localStorage.getItem('a4print_mobile_access') || '';
  }

  async function getShiftStart(token) {
    if (!cfg.apiBaseUrl || !token) return null;
    try {
      const r = await fetch(`${cfg.apiBaseUrl}/api/v1/pos/shift`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) return null;
      const data = await r.json();
      return data?.shift?.openDate ? new Date(data.shift.openDate) : null;
    } catch { return null; }
  }

  async function reportRange(token) {
    const active = document.querySelector('[data-period].on')?.dataset.period || 'today';
    const now = new Date();
    const end = new Date(now.getTime() + 1000);
    let start;

    if (active === 'shift') start = await getShiftStart(token);
    if (!start && active === 'today') {
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
    } else if (!start && active === '7d') {
      start = new Date(now);
      start.setDate(start.getDate() - 7);
    } else if (!start && active === '30d') {
      start = new Date(now);
      start.setDate(start.getDate() - 30);
    } else if (!start) {
      start = new Date(now);
      start.setFullYear(start.getFullYear() - 1);
    }
    return { start, end };
  }

  function ensureCard() {
    const grid = document.querySelector('#view-reports .report-grid');
    if (!grid || $('returnHistoryCard')) return;
    const card = document.createElement('article');
    card.id = 'returnHistoryCard';
    card.className = 'report-card';
    card.style.gridColumn = '1 / -1';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <h3 style="margin-bottom:4px">Последние возвраты</h3>
          <div id="returnHistorySummary" class="small muted">Возвратов за период нет</div>
        </div>
      </div>
      <div style="overflow:auto;margin-top:10px">
        <table class="table">
          <thead><tr><th>Время</th><th>Возврат</th><th>Продажа</th><th>Оператор</th><th>Причина</th><th>Оплата</th><th>Сумма</th></tr></thead>
          <tbody id="recentReturns"><tr><td colspan="7" class="muted">Загрузка…</td></tr></tbody>
        </table>
      </div>`;
    grid.appendChild(card);
  }

  function render(data) {
    ensureCard();
    const rows = Array.isArray(data?.recent_returns) ? data.recent_returns : [];
    const count = Number(data?.returns_count || 0);
    const total = Number(data?.returns_total || 0);

    if ($('statReturns')) $('statReturns').textContent = rub(total);
    if ($('statNet')) $('statNet').textContent = rub(data?.net_total || 0);
    if ($('returnHistorySummary')) {
      $('returnHistorySummary').textContent = count
        ? `${count.toLocaleString('ru-RU')} возврат(а) · ${rub(total)}`
        : 'Возвратов за период нет';
    }

    const body = $('recentReturns');
    if (!body) return;
    body.innerHTML = rows.map(x => `
      <tr>
        <td>${dt(x.returned_at)}</td>
        <td><b>${esc(x.return_name || '—')}</b></td>
        <td>${esc(x.sale_name || '—')}</td>
        <td>${esc(x.operator || '—')}</td>
        <td>${esc(x.reason || '—')}</td>
        <td>${esc(x.payment_method || '—')}</td>
        <td><b>−${rub(x.amount)}</b></td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">Возвратов за выбранный период нет</td></tr>';
  }

  async function refresh() {
    if (!$('view-reports')?.classList.contains('active')) return;
    const token = authToken();
    if (!token || !cfg.supabaseUrl || !cfg.supabasePublishableKey) return;
    ensureCard();

    try {
      const { start, end } = await reportRange(token);
      const operator = $('reportOperator');
      const r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/pos_dashboard`, {
        method: 'POST',
        headers: {
          apikey: cfg.supabasePublishableKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_from: start.toISOString(),
          p_to: end.toISOString(),
          p_operator_id: operator && operator.offsetParent !== null && operator.value ? operator.value : null
        })
      });
      if (!r.ok) throw new Error(await r.text());
      render(await r.json());
    } catch (e) {
      console.warn('POS return report:', e);
      const body = $('recentReturns');
      if (body) body.innerHTML = '<tr><td colspan="7" class="muted">Не удалось обновить список возвратов</td></tr>';
    }
  }

  function schedule(delay = 120) {
    clearTimeout(timer);
    timer = setTimeout(refresh, delay);
  }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-view="reports"], [data-period]')) schedule(180);
  });
  document.addEventListener('change', e => {
    if (e.target?.id === 'reportOperator') schedule(80);
  });
  window.addEventListener('focus', () => schedule(150));
  window.addEventListener('pageshow', () => schedule(250));
  setTimeout(() => { ensureCard(); schedule(350); }, 350);
})();