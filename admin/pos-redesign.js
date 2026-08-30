// Visual POS workspace redesign inspired by the approved cashier mockup.
(() => {
  if (!/\/admin\/pos\.html$/.test(location.pathname)) return;

  const LOGO = 'data:image/jpeg;base64,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';

  const css = `
  :root{--pos-bg:#f5f7fb;--pos-panel:#fff;--pos-line:#e3e8ef;--pos-text:#151b26;--pos-muted:#6b7280;--pos-blue:#0f6df2;--pos-green:#18aa4b}
  body{background:var(--pos-bg)!important;overflow-x:hidden}
  #app.app{display:grid!important;grid-template-columns:205px minmax(480px,1fr) 380px 315px;min-height:100vh;align-items:stretch;background:var(--pos-bg)}
  .pos-sidebar{grid-column:1;grid-row:1;background:#fff;border-right:1px solid var(--pos-line);padding:18px 12px;display:flex;flex-direction:column;min-height:100vh;position:sticky;top:0;height:100vh;z-index:5}
  .pos-logo-wrap{display:flex;align-items:center;justify-content:center;padding:0 8px 18px}.pos-logo{width:150px;height:150px;object-fit:contain;border-radius:50%;background:#fff}
  .pos-menu{display:grid;gap:5px;margin-top:4px}.pos-menu a{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:10px;text-decoration:none;color:#263244;font-size:13px;font-weight:650}.pos-menu a:hover{background:#f3f6fb}.pos-menu a.active{background:#eaf2ff;color:#0f6df2}.pos-menu i{font-style:normal;width:22px;text-align:center;font-size:16px}
  .pos-sidebar .shiftbar{margin-top:auto!important;margin-bottom:0!important;display:block!important;padding:12px!important;border-radius:13px!important;box-shadow:none!important;background:#fbfcfe!important}.pos-sidebar .shift-left{margin-bottom:10px}.pos-sidebar .shift-actions{display:grid!important}.pos-sidebar .shift-btn{width:100%}.pos-sidebar .shift-title{font-size:13px}.pos-sidebar .shift-meta{font-size:10px;line-height:1.35}.pos-sidebar .shift-dot{width:9px;height:9px;box-shadow:none}
  main.main{grid-column:2;grid-row:1;padding:0 14px 22px!important;min-width:0;background:var(--pos-bg)}
  .main .topbar{height:74px;margin:0 -14px 18px!important;padding:0 18px;background:#fff;border-bottom:1px solid var(--pos-line);position:sticky;top:0;z-index:4}.main .brand .logo{display:none}.main .brand .title h1{font-size:25px!important}.main .brand .title p{display:none}.top-actions .operator-chip{border-color:var(--pos-line);box-shadow:none}.top-actions #sync,.top-actions #operatorsLink,.top-actions #hubLink{display:none!important}.top-actions #logout{padding:9px 11px}
  .hero{display:none!important}.notice{margin:0 0 12px!important}.search-wrap{margin-bottom:10px!important}.search{border-radius:10px!important;padding-top:13px!important;padding-bottom:13px!important;box-shadow:none!important}.filters{background:#fff;border:1px solid var(--pos-line);border-radius:12px;padding:9px;margin-bottom:12px!important;gap:6px!important}.filter{border-radius:8px!important;padding:9px 13px!important}.filter.active{background:var(--pos-blue)!important;border-color:var(--pos-blue)!important}.section#quick{border-radius:12px!important;box-shadow:none!important}
  .goods{grid-template-columns:repeat(auto-fill,minmax(160px,1fr))!important;gap:9px!important}.card{border-radius:11px!important;min-height:165px!important;padding:13px!important;box-shadow:0 1px 4px rgba(15,23,42,.05)!important}.card:hover{transform:none!important;border-color:#b7c8df!important;box-shadow:0 5px 18px rgba(15,23,42,.09)!important}.card .price{font-size:17px!important;margin-top:10px!important}.card h3{font-size:13px!important;margin-right:30px!important}.card .meta{font-size:10px!important}.card .fav{width:28px!important;height:28px!important;border-radius:8px!important}.service-icon{font-size:34px;line-height:1;margin:6px 0 12px;display:block}.stock{font-size:10px!important}
  aside.cart{grid-column:3;grid-row:1;position:sticky!important;top:0!important;height:100vh!important;border:0!important;border-left:1px solid var(--pos-line)!important;border-right:1px solid var(--pos-line)!important;box-shadow:none!important;background:#fff!important}.cart-head{padding:18px 17px!important}.cart-head h2{font-size:18px!important}.cart-list{padding:8px 16px!important}.item{padding:12px 0!important}.cart-foot{padding:14px 16px 17px!important;gap:10px!important;background:#fff}.cart-foot .field{font-size:11px}.cart-foot .field select{padding:10px!important;border-radius:9px!important}.total strong{font-size:28px!important}.pay{border-radius:9px!important;padding:13px!important;background:var(--pos-green)!important;box-shadow:none!important}.cash-received{display:grid;grid-template-columns:92px 1fr;gap:10px;align-items:center;padding:9px 0 2px}.cash-received label{font-size:12px;font-weight:700}.cash-received input{width:100%;border:1px solid var(--pos-line);border-radius:9px;padding:10px 11px;font:inherit}.change-row{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #edf0f4;padding-top:10px;font-size:13px}.change-row strong{color:var(--pos-green);font-size:22px}
  .pos-customer-side{grid-column:4;grid-row:1;padding:88px 12px 18px;background:var(--pos-bg);min-width:0}.pos-customer-side #posCustomerBox{height:auto;border-radius:12px!important;background:#fff!important;border:1px solid var(--pos-line)!important;box-shadow:0 1px 4px rgba(15,23,42,.04);padding:14px!important;position:sticky;top:88px}.customer-title{font-size:15px!important}.customer-grid{grid-template-columns:1fr!important}.customer-search{padding:11px!important}.customer-notes{min-height:110px!important}.customer-save{background:var(--pos-blue)!important;border-radius:9px!important}.customer-selected{background:#eef5ff!important;border-color:#bad2fb!important;color:#174b9b!important}.customer-hint{font-size:10px!important}.customer-results{max-height:170px!important}
  @media(max-width:1350px){#app.app{grid-template-columns:175px minmax(420px,1fr) 350px 285px}.pos-logo{width:125px;height:125px}.pos-sidebar{padding-left:8px;padding-right:8px}.pos-menu a{font-size:12px;padding:10px 9px}.goods{grid-template-columns:repeat(auto-fill,minmax(145px,1fr))!important}}
  @media(max-width:1100px){#app.app{grid-template-columns:170px minmax(0,1fr) 350px}.pos-customer-side{grid-column:2/4;grid-row:2;padding:12px 14px 25px}.pos-customer-side #posCustomerBox{position:static}.customer-grid{grid-template-columns:1fr 1fr!important}.cart{grid-column:3!important}.main{grid-column:2!important}.pos-sidebar{grid-column:1!important}.pos-sidebar .shiftbar{position:static}}
  @media(max-width:780px){#app.app{display:block!important}.pos-sidebar{position:relative;height:auto;min-height:0;border-right:0;border-bottom:1px solid var(--pos-line)}.pos-logo-wrap{display:none}.pos-menu{display:flex;overflow:auto}.pos-menu a{white-space:nowrap}.pos-sidebar .shiftbar{margin-top:10px!important}.main .topbar{position:relative}.cart{position:relative!important;height:auto!important}.pos-customer-side{padding:12px}.customer-grid{grid-template-columns:1fr!important}}
  `;

  function iconFor(name='') {
    const n = name.toLowerCase();
    if (n.includes('фото')) return '🖼️';
    if (n.includes('скан')) return '📠';
    if (n.includes('копир') || n.includes('копи')) return '🖨️';
    if (n.includes('ламин')) return '📄';
    if (n.includes('брош')) return '📚';
    if (n.includes('файл')) return '📁';
    if (n.includes('дизайн') || n.includes('макет')) return '🎨';
    if (n.includes('печать')) return '🗎';
    return '◫';
  }

  function decorateCards() {
    document.querySelectorAll('#goods .card').forEach(card => {
      if (card.querySelector('.service-icon')) return;
      const h = card.querySelector('h3');
      if (!h) return;
      const icon = document.createElement('span');
      icon.className = 'service-icon';
      icon.textContent = iconFor(h.textContent);
      h.parentElement.insertBefore(icon, h);
    });
  }

  function moneyNumber(text) {
    return Number(String(text || '').replace(/\s/g,'').replace('₽','').replace(',','.').replace(/[^0-9.-]/g,'')) || 0;
  }

  function updatePaymentUi() {
    const totalEl = document.getElementById('total');
    const pay = document.getElementById('pay');
    const received = document.getElementById('cashReceived');
    const change = document.getElementById('changeValue');
    const box = document.getElementById('cashReceivedBox');
    const method = document.getElementById('method');
    if (!totalEl || !pay || !method) return;
    const total = moneyNumber(totalEl.textContent);
    const cash = method.value === 'Наличные';
    if (box) box.style.display = cash ? 'grid' : 'none';
    if (change) change.textContent = Math.max(0, (Number(received?.value || 0) - total)).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' ₽';
    if (!pay.disabled) pay.textContent = `Оплатить чек (${total.toLocaleString('ru-RU',{maximumFractionDigits:2})} ₽)`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const app = document.getElementById('app');
    const main = app?.querySelector('main.main');
    const cart = app?.querySelector('aside.cart');
    const shift = main?.querySelector('.shiftbar');
    if (!app || !main || !cart) return;

    const sidebar = document.createElement('aside');
    sidebar.className = 'pos-sidebar';
    sidebar.innerHTML = `
      <div class="pos-logo-wrap"><img class="pos-logo" src="${LOGO}" alt="А4-Принт"></div>
      <nav class="pos-menu">
        <a class="active" href="./pos.html"><i>🛒</i>Касса</a>
        <a href="./cashbox.html"><i>💰</i>Продажи</a>
        <a href="./customers.html"><i>👥</i>Клиенты</a>
        <a href="./warehouse.html"><i>📦</i>Товары</a>
        <a href="./index.html"><i>🏠</i>HUB</a>
      </nav>`;
    app.insertBefore(sidebar, main);
    if (shift) sidebar.appendChild(shift);

    const customer = document.getElementById('posCustomerBox');
    if (customer) {
      const side = document.createElement('section');
      side.className = 'pos-customer-side';
      app.appendChild(side);
      side.appendChild(customer);
    }

    const foot = cart.querySelector('.cart-foot');
    const total = foot?.querySelector('.total');
    if (foot && total && !document.getElementById('cashReceivedBox')) {
      const payExtras = document.createElement('div');
      payExtras.innerHTML = `
        <div id="cashReceivedBox" class="cash-received"><label for="cashReceived">Получено</label><input id="cashReceived" inputmode="decimal" type="number" min="0" step="0.01" placeholder="0"></div>
        <div class="change-row"><span>Сдача</span><strong id="changeValue">0,00 ₽</strong></div>`;
      total.after(payExtras);
    }

    const goods = document.getElementById('goods');
    if (goods) new MutationObserver(decorateCards).observe(goods,{childList:true,subtree:true});
    decorateCards();

    document.getElementById('cashReceived')?.addEventListener('input', updatePaymentUi);
    document.getElementById('method')?.addEventListener('change', updatePaymentUi);
    const totalEl = document.getElementById('total');
    if (totalEl) new MutationObserver(updatePaymentUi).observe(totalEl,{childList:true,subtree:true,characterData:true});
    const pay = document.getElementById('pay');
    if (pay) new MutationObserver(updatePaymentUi).observe(pay,{attributes:true,attributeFilter:['disabled']});
    updatePaymentUi();
  });
})();
