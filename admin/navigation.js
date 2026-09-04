async function initA4Navigation(){
  if(window.__A4PRINT_NAV_READY__)return;
  window.__A4PRINT_NAV_READY__=true;
  const sidebar=document.querySelector('.sidebar');
  if(!sidebar)return;
  const COLLAPSE_KEY='a4print_sidebar_collapsed_v1';
  document.body.classList.toggle('a4-sidebar-collapsed',localStorage.getItem(COLLAPSE_KEY)==='1');
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
  const toggle=document.createElement('button');
  toggle.type='button';toggle.className='a4-sidebar-toggle';toggle.title='Свернуть/развернуть меню';toggle.innerHTML=`<span>${icons.menu}</span><small>Меню</small>`;head.appendChild(toggle);
  toggle.onclick=()=>{const next=!document.body.classList.contains('a4-sidebar-collapsed');document.body.classList.toggle('a4-sidebar-collapsed',next);localStorage.setItem(COLLAPSE_KEY,next?'1':'0')};
  const brand=sidebar.querySelector('.brand');
  if(brand){
    brand.innerHTML=`<img id="globalHubLogo" src="./assets/logo_bd_transparent.svg?v=20260830-4" alt="A4PRINT HUB"><div id="globalHubLogoFallback" style="display:none;color:#fff;font-weight:900;font-size:20px;text-align:center">A4PRINT <span style="color:#38bdf8">HUB</span></div>`;
    const img=document.getElementById('globalHubLogo'),fallback=document.getElementById('globalHubLogoFallback');
    img.onerror=()=>{img.style.display='none';fallback.style.display='block'};
  }
  const nav=sidebar.querySelector('nav');if(!nav)return;
  const path=location.pathname.split('/').pop()||'index.html';
  const items=[
    ['index.html','home','Главная'],['manager.html','manager','Менеджер'],['orders.html','orders','Заказы'],['cuim-delivery.html','delivery','ЦУИМ Доставка'],['customers.html','customers','Клиенты'],['partners.html','partners','Партнёры'],['requests.html','applications','Заявки'],['employees.html','employees','Сотрудники'],['staff-structure.html','structure','Отделы и должности'],['warehouse.html','warehouse','Склад и номенклатура'],['production.html','production','Производство'],['messages.html','messages','Сообщения'],['documents.html','documents','Документы'],['payments.html','payments','Оплаты'],['reports.html','reports','Отчёты'],['settings.html','settings','Настройки'],['help.html','help','Инструкция'],['../index.html','systems','Выбор системы']
  ];
  nav.innerHTML=items.map(([href,icon,label])=>`<a href="${href.startsWith('..')?href:'./'+href}" class="${path===href?'active':''}" title="${label}"><span class="a4-nav-icon">${icons[icon]}</span><span class="a4-nav-label">${label}</span>${href==='orders.html'?'<b id="orderCount">0</b>':''}${href==='requests.html'?'<b id="requestCount" style="display:none">0</b>':''}${href==='messages.html'?'<b id="messageCount" style="display:none;background:#ef4444;color:#fff;min-width:20px;height:20px;border-radius:999px;padding:0 6px;align-items:center;justify-content:center;font-size:11px;margin-left:auto">0</b>':''}</a>`).join('');
  initA4ChatNotifications().catch(e=>console.warn('A4 notifications init failed',e));
}

function escapeA4(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

function ensureNotificationCenter(){
  if(document.getElementById('a4NotificationBell'))return;
  const wrap=document.createElement('div');wrap.id='a4NotificationWrap';wrap.style.cssText='position:fixed;right:22px;top:86px;z-index:12000;font-family:inherit';
  wrap.innerHTML=`<button id="a4NotificationBell" type="button" title="Уведомления" style="position:relative;width:48px;height:48px;border:1px solid #cbd5e1;border-radius:15px;background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.16);font-size:22px;cursor:pointer">🔔<b id="a4NotificationBellCount" style="display:none;position:absolute;right:-6px;top:-6px;min-width:21px;height:21px;padding:0 5px;border-radius:999px;background:#ef4444;color:#fff;font:700 11px/21px Arial;text-align:center">0</b></button><div id="a4NotificationPanel" style="display:none;position:absolute;right:0;top:56px;width:min(390px,calc(100vw - 32px));max-height:520px;overflow:auto;background:#fff;border:1px solid #dbe2ea;border-radius:16px;box-shadow:0 22px 60px rgba(15,23,42,.22);padding:12px"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px"><strong style="font-size:16px">Уведомления</strong><button id="a4NotificationTest" type="button" style="border:1px solid #dbe2ea;background:#f8fafc;border-radius:9px;padding:7px 9px;cursor:pointer;font:inherit;font-size:12px;font-weight:800">Проверить</button></div><div id="a4NotificationList"><div style="padding:18px;text-align:center;color:#94a3b8">Загрузка...</div></div></div>`;
  document.body.appendChild(wrap);
  const bell=document.getElementById('a4NotificationBell'),panel=document.getElementById('a4NotificationPanel');
  bell.onclick=e=>{e.stopPropagation();panel.style.display=panel.style.display==='none'?'block':'none'};
  panel.onclick=e=>e.stopPropagation();
  document.addEventListener('click',()=>{panel.style.display='none'});
}

async function initA4ChatNotifications(){
  if(window.__A4PRINT_CHAT_NOTIFICATIONS__)return;
  const {supabase}=await import('./guard.js');
  const{data:{session}}=await supabase.auth.getSession();if(!session)return;
  const{data:profile}=await supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle();if(!profile)return;
  window.__A4PRINT_CHAT_NOTIFICATIONS__=true;
  ensureNotificationCenter();
  const badge=document.getElementById('messageCount');
  const bellCount=document.getElementById('a4NotificationBellCount');
  const list=document.getElementById('a4NotificationList');
  const seen=new Set();
  let firstSync=true;
  let swRegistration=null;
  if('serviceWorker'in navigator){try{swRegistration=await navigator.serviceWorker.register('./notification-sw.js',{scope:'./'});await navigator.serviceWorker.ready}catch(e){console.warn('SW registration failed',e)}}

  const showCount=n=>{
    if(badge){badge.textContent=n>99?'99+':String(n);badge.style.display=n?'inline-flex':'none'}
    if(bellCount){bellCount.textContent=n>99?'99+':String(n);bellCount.style.display=n?'block':'none'}
  };
  const renderList=rows=>{
    if(!list)return;
    if(!rows.length){list.innerHTML='<div style="padding:22px;text-align:center;color:#94a3b8">Новых сообщений нет</div>';return}
    list.innerHTML=rows.map(n=>`<button type="button" data-notification-id="${escapeA4(n.id)}" style="display:block;width:100%;border:0;border-bottom:1px solid #eef2f7;background:#fff;padding:11px 8px;text-align:left;cursor:pointer;color:#0f172a"><strong style="display:block;font-size:13px;margin-bottom:4px">💬 ${escapeA4(n.title||'Новое сообщение')}</strong><span style="display:block;font-size:12px;color:#475569;line-height:1.4">${escapeA4(n.body||'Откройте чат')}</span><small style="display:block;color:#94a3b8;margin-top:5px">${new Date(n.created_at).toLocaleString('ru-RU')}</small></button>`).join('');
    list.querySelectorAll('[data-notification-id]').forEach(btn=>btn.onclick=async()=>{const id=btn.dataset.notificationId;await supabase.from('notifications').update({is_read:true}).eq('id',id);location.href='./messages.html'});
  };
  const toast=n=>{
    let host=document.getElementById('a4MessageToastHost');
    if(!host){host=document.createElement('div');host.id='a4MessageToastHost';host.style.cssText='position:fixed;right:82px;top:18px;z-index:12500;display:grid;gap:10px;max-width:min(380px,calc(100vw - 100px))';document.body.appendChild(host)}
    const el=document.createElement('button');el.type='button';el.style.cssText='border:1px solid #93c5fd;background:#fff;border-radius:14px;padding:13px 15px;box-shadow:0 18px 48px rgba(15,23,42,.22);text-align:left;cursor:pointer;color:#0f172a;font:inherit';el.innerHTML=`<strong style="display:block;margin-bottom:4px">💬 ${escapeA4(n.title||'Новое сообщение')}</strong><span style="font-size:13px;color:#475569">${escapeA4(n.body||'Откройте чат')}</span>`;el.onclick=()=>{location.href='./messages.html'};host.appendChild(el);setTimeout(()=>el.remove(),10000);
  };
  const notifySystem=async n=>{
    if(!('Notification'in window)||Notification.permission!=='granted')return;
    const opts={body:n.body||'Новое сообщение',tag:`a4-chat-${n.id}`,renotify:true,data:{url:'./messages.html'}};
    try{
      if(swRegistration&&swRegistration.showNotification)await swRegistration.showNotification(n.title||'A4PRINT HUB',opts);
      else new Notification(n.title||'A4PRINT HUB',opts);
    }catch(e){console.warn('System notification failed',e)}
  };
  const processNew=n=>{if(!n||n.type!=='CHAT_MESSAGE'||seen.has(n.id))return;seen.add(n.id);toast(n);notifySystem(n)};
  const sync=async({announce=true}={})=>{
    const{data,error}=await supabase.from('notifications').select('id,title,body,type,entity_type,entity_id,is_read,created_at').eq('type','CHAT_MESSAGE').eq('is_read',false).order('created_at',{ascending:false}).limit(100);
    if(error){console.warn('Notification sync failed',error);return}
    const rows=data||[];showCount(rows.length);renderList(rows);
    if(firstSync){rows.forEach(n=>seen.add(n.id));firstSync=false;return}
    if(announce)rows.slice().reverse().forEach(processNew);
  };
  document.getElementById('a4NotificationTest').onclick=async()=>{
    const test={id:`test-${Date.now()}`,title:'A4PRINT HUB',body:'Тестовое уведомление работает',type:'CHAT_MESSAGE',created_at:new Date().toISOString()};
    toast(test);
    if(!('Notification'in window)){alert('Браузер не поддерживает системные уведомления.');return}
    if(Notification.permission==='default')await Notification.requestPermission();
    if(Notification.permission==='granted')await notifySystem(test);else alert('Системные уведомления запрещены браузером, но уведомления внутри HUB будут работать.');
  };
  await sync({announce:false});
  window.addEventListener('a4:notifications-changed',()=>sync({announce:true}).catch(()=>{}));
  document.addEventListener('visibilitychange',()=>sync({announce:true}).catch(()=>{}));
  window.addEventListener('focus',()=>sync({announce:true}).catch(()=>{}));
  supabase.channel(`a4-chat-notifications-${profile.id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${profile.id}`},p=>{if(p.new?.type==='CHAT_MESSAGE'){processNew(p.new);sync({announce:false}).catch(()=>{})}}).on('postgres_changes',{event:'UPDATE',schema:'public',table:'notifications',filter:`user_id=eq.${profile.id}`},()=>sync({announce:false}).catch(()=>{})).subscribe();
  setInterval(()=>sync({announce:true}).catch(()=>{}),2000);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initA4Navigation,{once:true});else initA4Navigation();
