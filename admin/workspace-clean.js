(function(){
  if(window.__A4_WORKSPACE_CLEAN__)return;
  window.__A4_WORKSPACE_CLEAN__=true;
  document.documentElement.classList.add('a4-workspace-clean');

  const css=document.createElement('style');
  css.id='a4-workspace-clean-style';
  css.textContent=`
    /* Единое спокойное рабочее пространство без плавающих дублей. */
    .a4-theme-fab,.a4-help-btn,.a4-help-pop,.a4-layout-toolbar,.a4-chat-dashboard,.a4-chat-nav-link,#a4NotificationWrap{display:none!important}

    .sidebar{padding-top:12px!important}
    .sidebar nav{gap:2px!important}
    .sidebar nav .a4-nav-section{margin:14px 10px 5px;color:#94a3b8;font:800 10px/1.2 system-ui;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
    .sidebar nav a{min-height:40px!important;padding:8px 10px!important;border-radius:10px!important;font-size:13px!important}
    .sidebar .hub-logo-wrap,.sidebar .brand{min-height:94px!important;margin-bottom:12px!important}
    .sidebar .hub-logo,.sidebar .brand img{max-height:82px!important}
    .a4-sidebar-collapsed .a4-nav-section{display:none!important}

    .main{padding-top:22px!important;min-width:0}
    .topbar{min-height:54px;margin-bottom:18px!important;align-items:center!important}
    .topbar h1{font-size:27px!important}
    .topbar p{margin-top:4px!important}
    .a4-workspace-actions{margin-left:auto;display:flex;align-items:center;gap:8px;position:relative;flex:0 0 auto}
    .a4-workspace-actions>.user{margin:0!important}
    .a4-more-btn,.a4-mobile-menu{width:40px;height:40px;border:1px solid #dbe2ea!important;background:#fff!important;color:#334155!important;border-radius:11px!important;display:grid!important;place-items:center!important;padding:0!important;font:900 20px/1 system-ui!important;cursor:pointer;box-shadow:none!important}
    .a4-more-menu{display:none;position:absolute;right:0;top:48px;z-index:21000;width:230px;background:#fff;border:1px solid #dbe2ea;border-radius:14px;padding:6px;box-shadow:0 20px 55px rgba(15,23,42,.18)}
    .a4-more-menu.open{display:grid;gap:2px}
    .a4-more-menu a,.a4-more-menu button{width:100%;border:0!important;background:#fff!important;color:#334155!important;border-radius:9px!important;padding:10px 11px!important;text-align:left!important;text-decoration:none!important;font:700 13px/1.25 system-ui!important;cursor:pointer!important;display:flex!important;align-items:center!important;gap:9px!important;justify-content:flex-start!important}
    .a4-more-menu a:hover,.a4-more-menu button:hover{background:#f1f5f9!important;color:#0f172a!important}
    .a4-more-sep{height:1px;background:#eef2f7;margin:4px 5px}

    #hubChatNotifyCenter.a4-top-notify{position:relative!important;right:auto!important;top:auto!important;z-index:20000!important;font-family:inherit!important;width:40px!important;height:40px!important}
    #hubChatNotifyCenter.a4-top-notify #hubChatNotifyBell{width:40px!important;height:40px!important;border-radius:11px!important;font-size:18px!important;box-shadow:none!important;padding:0!important}
    #hubChatNotifyCenter.a4-top-notify #hubChatNotifyPanel{position:absolute!important;right:0!important;left:auto!important;top:48px!important;width:min(390px,calc(100vw - 28px))!important;max-height:min(68vh,520px)!important;border-radius:14px!important}

    .a4-theme-panel{right:18px!important;top:76px!important;bottom:auto!important;z-index:22000!important}
    .stats{gap:12px!important;margin-bottom:14px!important}
    .stats article,.panel{border-radius:15px!important;box-shadow:0 5px 18px rgba(15,23,42,.045)!important}
    .stats article{min-height:96px!important;padding:17px!important}
    .stats strong{font-size:28px!important;margin-top:12px!important}
    .grid{gap:14px!important}
    .panel{padding:18px!important;min-width:0;max-width:100%}

    .a4-mobile-menu{display:none!important}
    .a4-mobile-nav-shade{display:none}

    @media(max-width:900px){
      html,body{max-width:100%;overflow-x:hidden}
      body.a4-sidebar-collapsed .sidebar,.sidebar{width:min(88vw,320px)!important;transform:translateX(-102%);transition:transform .2s ease!important;z-index:30000!important;box-shadow:20px 0 55px rgba(15,23,42,.20)!important;padding-left:12px!important;padding-right:12px!important}
      body.a4-mobile-nav-open .sidebar,body.a4-sidebar-collapsed.a4-mobile-nav-open .sidebar{transform:translateX(0)}
      .main,.a4-sidebar-collapsed .main{margin-left:0!important;padding:12px 12px 28px!important;width:100%!important;max-width:100%!important;min-width:0!important}
      .a4-mobile-menu{display:grid!important;flex:0 0 40px}
      .a4-mobile-nav-shade{position:fixed;inset:0;z-index:29990;background:rgba(15,23,42,.38);backdrop-filter:blur(2px)}
      body.a4-mobile-nav-open .a4-mobile-nav-shade{display:block}
      .a4-sidebar-head{display:none!important}
      .sidebar nav{width:100%!important}
      .sidebar nav a,.a4-sidebar-collapsed .sidebar nav a{justify-content:flex-start!important;gap:10px!important;padding:10px 11px!important;width:100%!important}
      .sidebar .a4-nav-label,.a4-sidebar-collapsed .sidebar .a4-nav-label{display:block!important;visibility:visible!important;opacity:1!important;flex:1 1 auto!important;white-space:normal!important}
      .sidebar .a4-nav-icon,.a4-sidebar-collapsed .sidebar .a4-nav-icon{width:24px!important;height:24px!important;flex:0 0 24px!important}
      .sidebar .a4-nav-icon svg,.a4-sidebar-collapsed .sidebar .a4-nav-icon svg{width:20px!important;height:20px!important}
      .sidebar a b,.a4-sidebar-collapsed .sidebar a b{display:inline-flex!important;margin-left:auto!important}
      .sidebar .hub-logo-wrap,.sidebar .brand,.a4-sidebar-collapsed .sidebar .hub-logo-wrap,.a4-sidebar-collapsed .sidebar .brand{min-height:74px!important;margin:0 0 10px!important;padding:6px!important;border-radius:14px!important}
      .sidebar .hub-logo,.sidebar .brand img,.a4-sidebar-collapsed .sidebar .hub-logo,.a4-sidebar-collapsed .sidebar .brand img{max-width:150px!important;width:auto!important;height:62px!important;max-height:62px!important}

      .topbar{display:flex!important;flex-direction:row!important;align-items:center!important;gap:9px!important;min-height:48px!important;margin-bottom:12px!important;width:100%!important}
      .topbar>div:first-of-type{min-width:0;flex:1}
      .topbar h1{font-size:21px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .topbar p{display:none!important}
      .topbar .user{display:none!important}
      .a4-workspace-actions{margin-left:0;flex:0 0 auto}
      #hubChatNotifyCenter.a4-top-notify #hubChatNotifyPanel{position:fixed!important;left:10px!important;right:10px!important;top:64px!important;width:auto!important;max-height:72dvh!important}
      .a4-more-menu{position:fixed;right:10px;top:64px;width:min(270px,calc(100vw - 20px));max-height:calc(100dvh - 74px);overflow:auto}

      .stats{grid-template-columns:1fr 1fr!important;gap:8px!important}
      .stats article{min-height:82px!important;padding:13px!important}
      .stats span{font-size:11px!important}.stats strong{font-size:24px!important;margin-top:8px!important}
      .grid{grid-template-columns:1fr!important}
      .panel{padding:14px!important;border-radius:13px!important;max-width:100%!important;overflow-x:auto}
      .a4-theme-panel{left:10px!important;right:10px!important;top:64px!important;width:auto!important;max-height:78dvh;overflow:auto}

      /* Формы и панели действий не выходят за экран телефона. */
      input,select,textarea{max-width:100%}
      .toolbar,.actions,.filters,.form-actions,.panel-head{flex-wrap:wrap!important;max-width:100%!important}
      table{max-width:100%}
    }

    @media(max-width:520px){
      .main,.a4-sidebar-collapsed .main{padding:10px 9px 24px!important}
      .stats{grid-template-columns:1fr 1fr!important}
      .topbar h1{font-size:19px!important}
      .panel{padding:12px!important}
    }
  `;
  document.head.appendChild(css);

  const sectionFor=(href)=>{
    const p=(href||'').split('?')[0].split('/').pop();
    if(['index.html','manager.html','orders.html','customers.html'].includes(p))return'Работа';
    if(['cuim-delivery.html','partners.html','requests.html','warehouse.html','production.html','messages.html'].includes(p))return'Операции';
    if(['employees.html','staff-structure.html'].includes(p))return'Команда';
    if(['documents.html','payments.html','reports.html','settings.html','help.html'].includes(p)||href?.startsWith('../'))return'Система';
    return'';
  };

  function groupNavigation(){
    const nav=document.querySelector('.sidebar nav');if(!nav||nav.dataset.a4Grouped==='1')return;
    const links=[...nav.querySelectorAll(':scope > a')].filter(a=>!a.classList.contains('a4-chat-nav-link'));
    let last='';
    for(const a of links){
      const sec=sectionFor(a.getAttribute('href')||'');
      if(sec&&sec!==last){const h=document.createElement('div');h.className='a4-nav-section';h.textContent=sec;nav.insertBefore(h,a);last=sec}
    }
    nav.dataset.a4Grouped='1';
  }

  function removeClutter(){
    document.querySelectorAll('.a4-chat-dashboard,.a4-chat-nav-link,.a4-layout-toolbar,.a4-help-btn,.a4-help-pop,#a4NotificationWrap').forEach(x=>x.remove());
  }

  function placeNotification(){
    const top=document.querySelector('.topbar');if(!top)return false;
    const actions=ensureTopActions(top);
    const center=document.getElementById('hubChatNotifyCenter');
    if(!center)return false;
    if(center.parentElement!==actions){center.classList.add('a4-top-notify');actions.insertBefore(center,actions.querySelector('.a4-more-btn'))}
    return true;
  }

  function ensureTopActions(top){
    let actions=top.querySelector('.a4-workspace-actions');if(actions)return actions;
    actions=document.createElement('div');actions.className='a4-workspace-actions';
    const user=top.querySelector(':scope > .user');if(user)actions.appendChild(user);
    const more=document.createElement('button');more.type='button';more.className='a4-more-btn';more.title='Ещё';more.setAttribute('aria-label','Ещё');more.textContent='⋯';
    const menu=document.createElement('div');menu.className='a4-more-menu';
    menu.innerHTML=`
      <a href="./messages.html">💬 <span>Сообщения</span></a>
      <a href="/chat/start.html">📲 <span>Установить A4 Chat</span></a>
      <div class="a4-more-sep"></div>
      <button type="button" data-a4-theme-open>🎨 <span>Оформление</span></button>
      <a href="./settings.html">⚙️ <span>Настройки</span></a>
      <a href="./help.html">❓ <span>Инструкция</span></a>
      <div class="a4-more-sep"></div>
      <a href="../index.html">▦ <span>Выбор системы</span></a>`;
    more.onclick=e=>{e.stopPropagation();menu.classList.toggle('open')};
    menu.onclick=e=>e.stopPropagation();
    const themeButton=menu.querySelector('[data-a4-theme-open]');
    if(themeButton)themeButton.onclick=()=>{menu.classList.remove('open');document.querySelector('.a4-theme-fab')?.click()};
    document.addEventListener('click',()=>menu.classList.remove('open'));
    actions.append(more,menu);top.appendChild(actions);return actions;
  }

  function mobileMenu(){
    const top=document.querySelector('.topbar'),sidebar=document.querySelector('.sidebar');if(!top||!sidebar)return;
    if(window.matchMedia?.('(max-width:900px)').matches)document.body.classList.remove('a4-sidebar-collapsed');
    if(!top.querySelector('.a4-mobile-menu')){
      const b=document.createElement('button');b.type='button';b.className='a4-mobile-menu';b.title='Меню';b.setAttribute('aria-label','Открыть меню');b.textContent='☰';top.prepend(b);
      let shade=document.querySelector('.a4-mobile-nav-shade');if(!shade){shade=document.createElement('div');shade.className='a4-mobile-nav-shade';document.body.appendChild(shade)}
      const close=()=>document.body.classList.remove('a4-mobile-nav-open');
      b.onclick=()=>document.body.classList.toggle('a4-mobile-nav-open');
      shade.onclick=close;
      sidebar.addEventListener('click',e=>{if(e.target.closest('a'))close()});
      window.addEventListener('resize',()=>{if(!window.matchMedia('(max-width:900px)').matches)close()},{passive:true});
    }
  }

  function init(){
    removeClutter();groupNavigation();
    const top=document.querySelector('.topbar');if(top)ensureTopActions(top);
    mobileMenu();placeNotification();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  const obs=new MutationObserver(()=>{removeClutter();groupNavigation();placeNotification()});
  const startObs=()=>document.body&&obs.observe(document.body,{childList:true,subtree:true});
  if(document.body)startObs();else document.addEventListener('DOMContentLoaded',startObs,{once:true});
})();