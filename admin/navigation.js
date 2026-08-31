async function initA4Navigation(){
  if(window.__A4PRINT_NAV_READY__)return;window.__A4PRINT_NAV_READY__=true;
  const sidebar=document.querySelector('.sidebar');if(!sidebar)return;
  const COLLAPSE_KEY='a4print_sidebar_collapsed_v1';
  const collapsed=localStorage.getItem(COLLAPSE_KEY)==='1';
  document.body.classList.toggle('a4-sidebar-collapsed',collapsed);

  const svg=(body)=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const icons={
    menu:svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    home:svg('<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>'),
    manager:svg('<circle cx="12" cy="8" r="3"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/><path d="M18 5h3M19.5 3.5v3"/>'),
    orders:svg('<path d="M4 5h2l2 10h9l2-7H7"/><circle cx="10" cy="19" r="1"/><circle cx="17" cy="19" r="1"/>'),
    customers:svg('<path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M17 11a4 4 0 0 1 4 4v2M16 3.2a4 4 0 0 1 0 7.6"/>'),
    partners:svg('<path d="M8 12 4.5 8.5a2.1 2.1 0 0 1 3-3L11 9"/><path d="m16 12 3.5-3.5a2.1 2.1 0 0 0-3-3L13 9"/><path d="m8 12 3 3a1.4 1.4 0 0 0 2 0l3-3M10 14l-2 2M14 14l2 2"/>'),
    applications:svg('<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h3"/><path d="m16.5 16 1.5 1.5 3-3"/>'),
    users:svg('<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2"/>'),
    warehouse:svg('<path d="m3 9 9-5 9 5v11H3Z"/><path d="M7 20v-7h10v7M7 9h.01M12 9h.01M17 9h.01"/>'),
    production:svg('<path d="M3 21V10l6 3V9l6 4V5h6v16Z"/><path d="M7 17h2M12 17h2M17 17h2"/>'),
    messages:svg('<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8M8 13h5"/>'),
    documents:svg('<path d="M6 2h8l4 4v16H6Z"/><path d="M14 2v5h5M9 12h6M9 16h6"/>'),
    payments:svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>'),
    reports:svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    settings:svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/>'),
    help:svg('<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.2.9-1.2 1.8M12 17h.01"/>'),
    systems:svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>')
  };

  let head=sidebar.querySelector('.a4-sidebar-head');if(!head){head=document.createElement('div');head.className='a4-sidebar-head';sidebar.prepend(head)}
  const toggle=document.createElement('button');toggle.type='button';toggle.className='a4-sidebar-toggle';toggle.title='Свернуть/развернуть меню';toggle.innerHTML=`<span>${icons.menu}</span><small>Меню</small>`;head.appendChild(toggle);
  toggle.onclick=()=>{const next=!document.body.classList.contains('a4-sidebar-collapsed');document.body.classList.toggle('a4-sidebar-collapsed',next);localStorage.setItem(COLLAPSE_KEY,next?'1':'0')};

  const brand=sidebar.querySelector('.brand');if(brand){brand.innerHTML=`<img id="globalHubLogo" src="./assets/logo_bd_transparent.svg?v=20260830-4" alt="A4PRINT HUB"><div id="globalHubLogoFallback" style="display:none;color:#fff;font-weight:900;font-size:20px;text-align:center">A4PRINT <span style="color:#38bdf8">HUB</span></div>`;const img=document.getElementById('globalHubLogo'),fallback=document.getElementById('globalHubLogoFallback');img.onerror=()=>{img.style.display='none';fallback.style.display='block'};let normalLogo=localStorage.getItem('a4print_hub_logo')||'./assets/logo_bd_transparent.svg?v=20260830-4';const syncSidebarLogo=()=>{img.style.display='block';fallback.style.display='none';img.src=document.body.classList.contains('a4-side-light')?'./assets/logo_bd1.png?v=20260831-1':normalLogo};syncSidebarLogo();new MutationObserver(syncSidebarLogo).observe(document.body,{attributes:true,attributeFilter:['class']});try{const cfg=window.A4PRINT_CONFIG||{};if(cfg.supabaseUrl&&cfg.supabasePublishableKey){const{createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);const{data:{session}}=await supabase.auth.getSession();if(session){const{data}=await supabase.from('settings').select('value').eq('key','hub_branding').maybeSingle();const saved=data?.value?.logo||'';if(saved){normalLogo=saved;localStorage.setItem('a4print_hub_logo',saved)}else{localStorage.removeItem('a4print_hub_logo');normalLogo='./assets/logo_bd_transparent.svg?v=20260830-4'}syncSidebarLogo()}}}catch(e){console.warn('Не удалось загрузить логотип HUB из настроек',e)}}

  const nav=sidebar.querySelector('nav');if(!nav)return;const path=location.pathname.split('/').pop()||'index.html';const items=[['index.html','home','Главная'],['manager.html','manager','Менеджер'],['orders.html','orders','Заказы'],['customers.html','customers','Клиенты'],['partners.html','partners','Партнёры'],['executor-requests.html','applications','Заявки исполнителей'],['users.html','users','Пользователи'],['warehouse.html','warehouse','Склад и номенклатура'],['production.html','production','Производство'],['messages.html','messages','Сообщения'],['documents.html','documents','Документы'],['payments.html','payments','Оплаты'],['reports.html','reports','Отчёты'],['settings.html','settings','Настройки'],['help.html','help','Инструкция'],['../index.html','systems','Выбор системы']];nav.innerHTML=items.map(([href,icon,label])=>`<a href="${href.startsWith('..')?href:'./'+href}" class="${path===href?'active':''}" title="${href==='manager.html'?'Рабочий стол менеджера':label}"><span class="a4-nav-icon">${icons[icon]}</span><span class="a4-nav-label">${label}</span>${href==='orders.html'?'<b id="orderCount">0</b>':''}</a>`).join('');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initA4Navigation,{once:true});else initA4Navigation();