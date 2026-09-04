(function(){
  if(window.__A4_MODERN_UI__)return;
  window.__A4_MODERN_UI__=true;
  document.documentElement.classList.add('a4-modern-ui');

  const style=document.createElement('style');
  style.id='a4-modern-ui-style';
  style.textContent=`
    :root{
      --a4-bg:#f4f7fb;
      --a4-surface:#ffffff;
      --a4-surface-soft:#f8fafc;
      --a4-line:#e2e8f0;
      --a4-line-strong:#cbd5e1;
      --a4-text:#0f172a;
      --a4-muted:#64748b;
      --a4-primary:#2563eb;
      --a4-primary-soft:#eff6ff;
      --a4-danger:#dc2626;
      --a4-success:#15803d;
      --a4-radius:16px;
      --a4-shadow:0 8px 28px rgba(15,23,42,.065);
      --a4-shadow-float:0 20px 55px rgba(15,23,42,.16);
    }

    html{background:var(--a4-bg);-webkit-text-size-adjust:100%}
    body{background:var(--a4-bg)!important;color:var(--a4-text)!important;font-size:14px;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
    button,input,select,textarea{font-family:inherit}
    button,a,input,select,textarea{ -webkit-tap-highlight-color:transparent }
    button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid rgba(37,99,235,.18)!important;outline-offset:2px}

    /* Sidebar */
    .sidebar{background:linear-gradient(180deg,#111827 0%,#0f172a 100%)!important;border-right:1px solid rgba(255,255,255,.06)!important;box-shadow:none!important}
    .sidebar .brand,.sidebar .hub-logo-wrap{background:#fff!important;border:1px solid rgba(255,255,255,.14)!important;box-shadow:0 8px 24px rgba(2,6,23,.18)!important}
    .sidebar nav a{color:#cbd5e1!important;font-weight:650!important;letter-spacing:-.01em;transition:background .14s ease,color .14s ease,transform .14s ease!important}
    .sidebar nav a:hover{background:rgba(255,255,255,.075)!important;color:#fff!important;transform:translateX(1px)}
    .sidebar nav a.active{background:linear-gradient(90deg,rgba(37,99,235,.28),rgba(37,99,235,.11))!important;color:#fff!important;box-shadow:inset 3px 0 0 #60a5fa!important}
    .sidebar .a4-nav-icon{opacity:.96}
    .sidebar .a4-nav-group-head{color:#8391a6!important}
    .sidebar .a4-nav-group.has-active>.a4-nav-group-head{color:#cbd5e1!important}

    /* Main layout */
    .main{max-width:1700px;margin-right:auto;min-width:0}
    .topbar{background:transparent}
    .topbar h1{color:#0f172a!important;font-weight:820!important;letter-spacing:-.035em!important}
    .topbar p{color:#64748b!important}
    .topbar .user{color:#475569!important}
    .a4-workspace-actions{gap:7px!important}
    .a4-more-btn,.a4-mobile-menu,#hubChatNotifyBell{background:rgba(255,255,255,.92)!important;border:1px solid var(--a4-line)!important;box-shadow:0 2px 9px rgba(15,23,42,.045)!important}

    /* Cards */
    .panel,.stats article,.card,.box,.section-card{background:rgba(255,255,255,.96)!important;border:1px solid var(--a4-line)!important;box-shadow:var(--a4-shadow)!important}
    .panel{border-radius:18px!important}
    .panel-head{min-width:0}
    .panel h2,.panel-head h2{color:#172033!important;font-weight:800!important;letter-spacing:-.02em}
    .stats article{position:relative;overflow:hidden;border-radius:17px!important}
    .stats article:before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(#3b82f6,#60a5fa);opacity:.9}
    .stats span{color:#64748b!important;font-weight:650!important}
    .stats strong{color:#0f172a!important;font-weight:850!important}

    /* Buttons */
    button,.btn,a.button{border-radius:11px;transition:transform .12s ease,box-shadow .12s ease,background .12s ease,border-color .12s ease}
    button:not(:disabled):active,.btn:not(:disabled):active,a.button:active{transform:translateY(1px)}
    button:disabled,.btn:disabled{opacity:.55;cursor:not-allowed}
    .primary,.btn-primary,button.primary,[data-variant="primary"]{background:var(--a4-primary)!important;color:#fff!important;border-color:var(--a4-primary)!important}
    .danger,.btn-danger,button.danger,[data-variant="danger"]{background:#fff!important;color:var(--a4-danger)!important;border-color:#fecaca!important}

    /* Forms */
    input:not([type="checkbox"]):not([type="radio"]):not([type="file"]),select,textarea{
      min-height:42px;border:1px solid var(--a4-line-strong)!important;border-radius:11px!important;background:#fff!important;color:#0f172a!important;padding:9px 11px;box-shadow:0 1px 2px rgba(15,23,42,.02);transition:border-color .15s ease,box-shadow .15s ease
    }
    textarea{line-height:1.45}
    input::placeholder,textarea::placeholder{color:#94a3b8}
    input:focus,select:focus,textarea:focus{border-color:#60a5fa!important;box-shadow:0 0 0 3px rgba(37,99,235,.10)!important;outline:0!important}
    label{color:#475569}

    /* Tables */
    table{width:100%;border-collapse:separate!important;border-spacing:0!important;background:#fff;border:1px solid var(--a4-line);border-radius:14px;overflow:hidden}
    thead th{background:#f8fafc!important;color:#64748b!important;font-size:11px!important;text-transform:uppercase;letter-spacing:.045em;font-weight:800!important;border-bottom:1px solid var(--a4-line)!important;padding:11px 12px!important;text-align:left}
    tbody td{padding:12px!important;border-bottom:1px solid #edf2f7!important;color:#334155;vertical-align:middle}
    tbody tr:last-child td{border-bottom:0!important}
    tbody tr:hover td{background:#fbfdff}

    /* Lists / rows */
    .order-row,.list-row,.item-row{border:1px solid var(--a4-line)!important;background:#fff!important;border-radius:13px!important;box-shadow:none!important}
    .empty{background:#f8fafc!important;border:1px dashed #cbd5e1!important;color:#94a3b8!important}

    /* Dialogs */
    .modal,.dialog,.modal-content,[role="dialog"]{border-radius:18px!important;border-color:var(--a4-line)!important;box-shadow:var(--a4-shadow-float)!important}
    .modal-backdrop,.overlay,.dialog-backdrop{backdrop-filter:blur(3px)}

    /* Dropdowns */
    .a4-more-menu,#hubChatNotifyPanel,.dropdown,.menu-popover{border:1px solid var(--a4-line)!important;border-radius:15px!important;box-shadow:var(--a4-shadow-float)!important;background:#fff!important}

    /* Mobile / tablet */
    @media(max-width:900px){
      body{background:#f6f8fc!important}
      .sidebar{width:min(88vw,320px)!important;border-radius:0 18px 18px 0;box-shadow:20px 0 55px rgba(2,6,23,.24)!important}
      .sidebar nav a,.a4-sidebar-collapsed .sidebar nav a{min-height:46px!important;border-radius:11px!important;font-size:14px!important}
      .sidebar .a4-nav-label,.a4-sidebar-collapsed .sidebar .a4-nav-label{display:block!important;color:inherit!important;font-weight:650!important}
      .a4-nav-group-head{font-size:11px!important;letter-spacing:.075em!important;min-height:38px}
      .main,.a4-sidebar-collapsed .main{padding:10px 10px calc(24px + env(safe-area-inset-bottom))!important}
      .topbar{position:sticky!important;top:0!important;z-index:15000!important;margin:0 -2px 12px!important;padding:8px 2px!important;background:rgba(246,248,252,.88)!important;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
      .topbar h1{font-size:20px!important}
      .a4-mobile-menu,.a4-more-btn,#hubChatNotifyBell{width:42px!important;height:42px!important;border-radius:12px!important}
      .panel,.stats article,.card,.box,.section-card{box-shadow:0 4px 16px rgba(15,23,42,.045)!important}
      .panel{border-radius:15px!important;padding:13px!important}
      .stats{gap:8px!important}
      .stats article{border-radius:14px!important;padding:13px!important}
      .stats strong{font-size:23px!important}
      .panel-head{gap:9px!important;align-items:flex-start!important}
      .panel-head h2{font-size:17px!important}
      button,.btn,a.button{min-height:42px}
      table{min-width:680px;border-radius:12px}
      .panel:has(table),.table-wrap,.table-container{overflow-x:auto!important;-webkit-overflow-scrolling:touch}
      .a4-more-menu{top:60px!important;right:8px!important;width:min(290px,calc(100vw - 16px))!important}
      #hubChatNotifyCenter.a4-top-notify #hubChatNotifyPanel{top:60px!important;left:8px!important;right:8px!important}
    }

    @media(max-width:540px){
      .main,.a4-sidebar-collapsed .main{padding-left:8px!important;padding-right:8px!important}
      .stats{grid-template-columns:1fr 1fr!important}
      .stats article{min-height:78px!important}
      .stats span{font-size:10.5px!important}
      .stats strong{font-size:21px!important}
      .panel{padding:12px!important}
      .topbar h1{font-size:18px!important}
      .topbar{gap:7px!important}
      .a4-mobile-menu,.a4-more-btn,#hubChatNotifyBell{width:40px!important;height:40px!important}
    }

    @media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
  `;
  document.head.appendChild(style);
})();