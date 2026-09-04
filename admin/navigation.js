async function initA4Navigation(){
  if(window.__A4PRINT_NAV_READY__)return;
  window.__A4PRINT_NAV_READY__=true;

  const sidebar=document.querySelector('.sidebar');
  if(!sidebar)return;

  const COLLAPSE_KEY='a4print_sidebar_collapsed_v1';
  const mobile=window.matchMedia?.('(max-width:900px)').matches;
  if(mobile){
    document.body.classList.remove('a4-sidebar-collapsed');
  }else{
    try{document.body.classList.toggle('a4-sidebar-collapsed',localStorage.getItem(COLLAPSE_KEY)==='1')}catch{}
  }

  const svg=body=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const icons={
    menu:svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    home:svg('<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>'),
    manager:svg('<circle cx="12" cy="8" r="3"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/>'),
    orders:svg('<path d="M4 5h2l2 10h9l2-7H7"/><circle cx="10" cy="19" r="1"/><circle cx="17" cy="19" r="1"/>'),
    delivery:svg('<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
    customers:svg('<circle cx="9" cy="7" r="4"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 11a4 4 0 0 1 4 4v2"/>'),
    partners:svg('<path d="M8 12 4.5 8.5a2.1 2.1 0 0 1 3-3L11 9M16 12l3.5-3.5a2.1 2.1 0 0 0-3-3L13 9M8 12l3 3a1.4 1.4 0 0 0 2 0l3-3"/>'),
    applications:svg('<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h3"/>'),
    employees:svg('<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3.5 20v-1.5A5.5 5.5 0 0 1 9 13a5.5 5.5 0 0 1 5.5 5.5V20M14.5 14.5a4.5 4.5 0 0 1 6 4.25V20"/>'),
    structure:svg('<path d="M12 4v5M5 20v-5h14v5M5 15v-3h14v3M12 9v3"/><circle cx="12" cy="3" r="2"/><circle cx="5" cy="21" r="2"/><circle cx="19" cy="21" r="2"/>'),
    warehouse:svg('<path d="m3 9 9-5 9 5v11H3ZM7 20v-7h10v7"/>'),
    production:svg('<path d="M3 21V10l6 3V9l6 4V5h6v16Z"/>'),
    messages:svg('<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>'),
    documents:svg('<path d="M6 2h8l4 4v16H6ZM14 2v5h5"/>'),
    payments:svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>'),
    reports:svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    settings:svg('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/>'),
    help:svg('<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.2.9-1.2 1.8M12 17h.01"/>'),
    systems:svg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>')
  };

  let head=sidebar.querySelector('.a4-sidebar-head');
  if(!head){head=document.createElement('div');head.className='a4-sidebar-head';sidebar.prepend(head)}
  head.innerHTML='';
  const toggle=document.createElement('button');
  toggle.type='button';toggle.className='a4-sidebar-toggle';toggle.title='Свернуть/развернуть меню';toggle.innerHTML=`<span>${icons.menu}</span><small>Меню</small>`;head.appendChild(toggle);
  toggle.onclick=()=>{
    if(window.matchMedia?.('(max-width:900px)').matches){document.body.classList.remove('a4-mobile-nav-open');return}
    const next=!document.body.classList.contains('a4-sidebar-collapsed');
    document.body.classList.toggle('a4-sidebar-collapsed',next);
    try{localStorage.setItem(COLLAPSE_KEY,next?'1':'0')}catch{}
  };

  const brand=sidebar.querySelector('.brand');
  if(brand){
    brand.innerHTML=`<img id="globalHubLogo" src="./assets/logo_bd_transparent.svg?v=20260830-4" alt="A4PRINT HUB"><div id="globalHubLogoFallback" style="display:none;color:#fff;font-weight:900;font-size:20px;text-align:center">A4PRINT <span style="color:#38bdf8">HUB</span></div>`;
    const img=document.getElementById('globalHubLogo'),fallback=document.getElementById('globalHubLogoFallback');
    if(img&&fallback)img.onerror=()=>{img.style.display='none';fallback.style.display='block'};
  }

  const nav=sidebar.querySelector('nav');if(!nav)return;
  const path=location.pathname.split('/').pop()||'index.html';
  const items=[
    ['index.html','home','Главная'],
    ['manager.html','manager','Менеджер'],
    ['orders.html','orders','Заказы'],
    ['customers.html','customers','Клиенты'],
    ['cuim-delivery.html','delivery','ЦУИМ Доставка'],
    ['partners.html','partners','Партнёры'],
    ['requests.html','applications','Заявки'],
    ['warehouse.html','warehouse','Склад и номенклатура'],
    ['production.html','production','Производство'],
    ['messages.html','messages','Сообщения'],
    ['employees.html','employees','Сотрудники'],
    ['staff-structure.html','structure','Отделы и должности'],
    ['documents.html','documents','Документы'],
    ['payments.html','payments','Оплаты'],
    ['reports.html','reports','Отчёты'],
    ['settings.html','settings','Настройки'],
    ['help.html','help','Инструкция'],
    ['../index.html','systems','Выбор системы']
  ];

  nav.innerHTML=items.map(([href,icon,label])=>`<a href="${href.startsWith('..')?href:'./'+href}" class="${path===href?'active':''}" title="${label}"><span class="a4-nav-icon">${icons[icon]}</span><span class="a4-nav-label">${label}</span>${href==='orders.html'?'<b id="orderCount">0</b>':''}${href==='requests.html'?'<b id="requestCount" style="display:none">0</b>':''}${href==='messages.html'?'<b id="messageCount" style="display:none;background:#ef4444;color:#fff;min-width:20px;height:20px;border-radius:999px;padding:0 6px;align-items:center;justify-content:center;font-size:11px;margin-left:auto">0</b>':''}</a>`).join('');

  // Уведомления и Push инициализируются отдельно через config.js.
  // Навигация больше не запускает опрос базы и не регистрирует второй Service Worker.
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initA4Navigation,{once:true});else initA4Navigation();