(()=>{
  if(window.__A4_TOPBAR_MODERN__)return;
  window.__A4_TOPBAR_MODERN__=true;

  let observer=null;
  let busy=false;

  const gearIcon=`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1.03-1.56V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.56 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"></path></svg>`;

  const css=document.createElement('style');
  css.id='a4-topbar-modern-style';
  css.textContent=`
    .topbar{
      display:flex!important;
      align-items:flex-start!important;
      gap:14px!important;
      min-width:0!important;
    }
    .topbar>.a4-topbar-tools{
      margin-left:auto!important;
      flex:0 0 40px!important;
      width:40px!important;
      min-width:40px!important;
      height:40px!important;
      position:relative!important;
      display:block!important;
    }
    .a4-tools-gear{
      width:40px!important;
      min-width:40px!important;
      height:40px!important;
      min-height:40px!important;
      padding:0!important;
      display:grid!important;
      place-items:center!important;
      border:1px solid #dbe3ee!important;
      border-radius:11px!important;
      background:#fff!important;
      color:#475569!important;
      box-shadow:0 2px 9px rgba(15,23,42,.045)!important;
      cursor:pointer!important;
      transition:background .14s ease,border-color .14s ease,color .14s ease,box-shadow .14s ease!important;
    }
    .a4-tools-gear svg{width:19px!important;height:19px!important;display:block!important}
    .a4-tools-gear:hover,.a4-tools-gear[aria-expanded="true"]{
      background:#eff6ff!important;
      border-color:#bfdbfe!important;
      color:#2563eb!important;
      box-shadow:0 4px 14px rgba(37,99,235,.10)!important;
      transform:none!important;
    }

    .a4-tools-shade{
      position:fixed!important;
      inset:0!important;
      z-index:31990!important;
      background:rgba(15,23,42,.18)!important;
      backdrop-filter:blur(2px)!important;
      -webkit-backdrop-filter:blur(2px)!important;
      opacity:0!important;
      visibility:hidden!important;
      pointer-events:none!important;
      transition:opacity .18s ease,visibility .18s ease!important;
    }
    .a4-tools-drawer{
      position:fixed!important;
      z-index:32000!important;
      top:18px!important;
      right:18px!important;
      bottom:18px!important;
      width:min(440px,calc(100vw - 36px))!important;
      max-width:440px!important;
      display:flex!important;
      flex-direction:column!important;
      overflow:hidden!important;
      border:1px solid #dce4ee!important;
      border-radius:18px!important;
      background:#fff!important;
      box-shadow:0 28px 80px rgba(15,23,42,.20)!important;
      transform:translateX(calc(100% + 34px))!important;
      opacity:.98!important;
      visibility:hidden!important;
      pointer-events:none!important;
      transition:transform .22s ease,visibility .22s ease!important;
    }
    .a4-topbar-tools.a4-tools-open .a4-tools-shade{
      opacity:1!important;
      visibility:visible!important;
      pointer-events:auto!important;
    }
    .a4-topbar-tools.a4-tools-open .a4-tools-drawer{
      transform:translateX(0)!important;
      visibility:visible!important;
      pointer-events:auto!important;
    }

    .a4-tools-drawer-head{
      display:flex!important;
      align-items:center!important;
      justify-content:space-between!important;
      gap:12px!important;
      min-height:66px!important;
      padding:14px 16px!important;
      border-bottom:1px solid #edf1f5!important;
      background:#fff!important;
      flex:0 0 auto!important;
    }
    .a4-tools-drawer-head-copy{min-width:0!important}
    .a4-tools-drawer-head strong{
      display:block!important;
      color:#172033!important;
      font-size:17px!important;
      line-height:1.2!important;
      font-weight:850!important;
      letter-spacing:-.02em!important;
    }
    .a4-tools-drawer-head small{
      display:block!important;
      margin-top:3px!important;
      color:#94a3b8!important;
      font-size:11px!important;
      line-height:1.3!important;
      font-weight:650!important;
    }
    .a4-tools-close{
      width:34px!important;
      min-width:34px!important;
      height:34px!important;
      min-height:34px!important;
      padding:0!important;
      display:grid!important;
      place-items:center!important;
      border:1px solid #e2e8f0!important;
      border-radius:9px!important;
      background:#f8fafc!important;
      color:#64748b!important;
      font:800 20px/1 system-ui!important;
      cursor:pointer!important;
      box-shadow:none!important;
    }
    .a4-tools-close:hover{background:#eef4ff!important;border-color:#cbdcf5!important;color:#2563eb!important;transform:none!important}

    .a4-tools-drawer-content{
      flex:1 1 auto!important;
      min-height:0!important;
      overflow:auto!important;
      padding:14px!important;
      display:grid!important;
      align-content:start!important;
      gap:10px!important;
      background:#f8fafc!important;
      scrollbar-width:thin!important;
    }
    .a4-tools-drawer-content>*{min-width:0!important;max-width:100%!important;margin:0!important}

    /* Любые старые группы действий превращаем в аккуратные карточки внутри боковой панели. */
    .a4-tools-drawer-content>.a4-workspace-actions,
    .a4-tools-drawer-content>.manager-user,
    .a4-tools-drawer-content>.layout-tools,
    .a4-tools-drawer-content>.user,
    .a4-tools-drawer-content>.toolbar,
    .a4-tools-drawer-content>.actions{
      width:100%!important;
      padding:10px!important;
      border:1px solid #e3e9f1!important;
      border-radius:13px!important;
      background:#fff!important;
      box-shadow:none!important;
    }

    .a4-tools-drawer .a4-workspace-actions{
      display:grid!important;
      grid-template-columns:1fr 1fr!important;
      gap:8px!important;
      margin:0!important;
      position:relative!important;
      width:100%!important;
      align-items:stretch!important;
    }
    .a4-tools-drawer .a4-workspace-actions>.a4-block-layout-toolbar,
    .a4-tools-drawer .a4-workspace-actions>.user,
    .a4-tools-drawer .a4-workspace-actions>.a4-more-menu{
      grid-column:1/-1!important;
    }
    .a4-tools-drawer .a4-block-layout-toolbar{
      display:grid!important;
      grid-template-columns:repeat(3,minmax(0,1fr))!important;
      gap:7px!important;
      width:100%!important;
      margin:0!important;
    }
    .a4-tools-drawer .manager-user,
    .a4-tools-drawer .manager-actions,
    .a4-tools-drawer .layout-tools,
    .a4-tools-drawer .user{
      display:grid!important;
      grid-template-columns:1fr!important;
      gap:8px!important;
      width:100%!important;
      justify-items:stretch!important;
      align-items:stretch!important;
      margin:0!important;
    }

    /* Единый размер кнопок внутри панели. */
    .a4-tools-drawer button,
    .a4-tools-drawer a.button,
    .a4-tools-drawer .btn,
    .a4-tools-drawer .a4-block-layout-toolbar button{
      width:100%!important;
      min-width:0!important;
      min-height:36px!important;
      height:36px!important;
      padding:0 11px!important;
      border:1px solid #dbe3ee!important;
      border-radius:9px!important;
      background:#fff!important;
      color:#334155!important;
      font-size:11px!important;
      line-height:1!important;
      font-weight:800!important;
      box-shadow:none!important;
      white-space:nowrap!important;
      justify-content:center!important;
    }
    .a4-tools-drawer button:hover,
    .a4-tools-drawer a.button:hover,
    .a4-tools-drawer .btn:hover{
      background:#f3f7fd!important;
      border-color:#bfd0e5!important;
      color:#1d4ed8!important;
      transform:none!important;
    }
    .a4-tools-drawer .a4-block-layout-toolbar .a4-layout-done{
      background:#2563eb!important;
      border-color:#2563eb!important;
      color:#fff!important;
    }
    .a4-tools-drawer .manager-status{
      display:flex!important;
      align-items:center!important;
      justify-content:flex-start!important;
      min-height:36px!important;
      padding:0 11px!important;
      border-radius:9px!important;
      font-size:11px!important;
      width:100%!important;
    }
    .a4-tools-drawer .user-email,
    .a4-tools-drawer #userEmail,
    .a4-tools-drawer .a4-profile-trigger{
      display:flex!important;
      align-items:center!important;
      min-height:36px!important;
      width:100%!important;
      padding:0 10px!important;
      border:1px solid #edf1f5!important;
      border-radius:9px!important;
      background:#f8fafc!important;
      color:#64748b!important;
      font-size:11px!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
    }

    /* Иконки уведомлений и меню занимают по половине строки, а не торчат отдельными квадратами. */
    .a4-tools-drawer #hubChatNotifyCenter.a4-top-notify{
      width:100%!important;
      height:36px!important;
      position:relative!important;
    }
    .a4-tools-drawer #hubChatNotifyCenter.a4-top-notify #hubChatNotifyBell,
    .a4-tools-drawer .a4-more-btn{
      width:100%!important;
      min-width:0!important;
      height:36px!important;
      min-height:36px!important;
      border-radius:9px!important;
      padding:0!important;
    }
    .a4-tools-drawer .a4-more-menu{
      position:static!important;
      right:auto!important;
      top:auto!important;
      width:100%!important;
      margin-top:0!important;
      padding:5px!important;
      border:1px solid #e5eaf1!important;
      border-radius:10px!important;
      box-shadow:none!important;
      background:#fbfdff!important;
    }
    .a4-tools-drawer .a4-more-menu a,
    .a4-tools-drawer .a4-more-menu button{
      min-height:34px!important;
      height:auto!important;
      padding:8px 9px!important;
      justify-content:flex-start!important;
      text-align:left!important;
      border:0!important;
      background:transparent!important;
    }
    .a4-tools-drawer #hubChatNotifyCenter.a4-top-notify #hubChatNotifyPanel{
      position:fixed!important;
      right:28px!important;
      left:auto!important;
      top:82px!important;
      width:min(380px,calc(100vw - 56px))!important;
      max-height:min(70vh,560px)!important;
      border-radius:14px!important;
      z-index:32100!important;
    }

    @media(max-width:900px){
      .topbar{align-items:center!important;gap:8px!important}
      .topbar>.a4-topbar-tools{width:40px!important;min-width:40px!important;flex:0 0 40px!important}
      .a4-tools-drawer{
        top:10px!important;
        right:10px!important;
        bottom:10px!important;
        width:min(420px,calc(100vw - 20px))!important;
        max-width:none!important;
        border-radius:16px!important;
      }
      .a4-tools-drawer-content{padding:10px!important}
      .a4-tools-drawer .a4-block-layout-toolbar{grid-template-columns:1fr!important}
      .a4-tools-drawer .a4-workspace-actions{grid-template-columns:1fr 1fr!important}
      body.a4-tools-drawer-open{overflow:hidden!important}
    }
    @media(max-width:520px){
      .a4-tools-drawer{width:calc(100vw - 16px)!important;right:8px!important;top:8px!important;bottom:8px!important}
      .a4-tools-drawer-head{min-height:60px!important;padding:12px!important}
      .a4-tools-drawer-content{padding:8px!important;gap:8px!important}
    }
    @media(prefers-reduced-motion:reduce){
      .a4-tools-shade,.a4-tools-drawer{transition:none!important}
    }
  `;
  document.head.appendChild(css);

  function titleNode(top){
    const direct=[...top.children];
    return direct.find(el=>el!==top.querySelector(':scope > .a4-topbar-tools')&&el.matches?.('div,section')&&el.querySelector?.(':scope > h1,:scope > h2'))
      || direct.find(el=>el.matches?.('h1,h2'))
      || direct.find(el=>!el.classList?.contains('a4-mobile-menu')&&!el.classList?.contains('a4-topbar-tools'))
      || null;
  }

  function setOpen(wrap,open){
    if(!wrap)return;
    wrap.classList.toggle('a4-tools-open',!!open);
    document.body.classList.toggle('a4-tools-drawer-open',!!open);
    const gear=wrap.querySelector(':scope > .a4-tools-gear');
    if(gear){
      gear.setAttribute('aria-expanded',open?'true':'false');
      gear.title=open?'Закрыть панель управления':'Открыть панель управления';
    }
    const drawer=wrap.querySelector(':scope > .a4-tools-drawer');
    if(drawer)drawer.setAttribute('aria-hidden',open?'false':'true');
  }

  function createWrap(top){
    const wrap=document.createElement('div');
    wrap.className='a4-topbar-tools';

    const gear=document.createElement('button');
    gear.type='button';
    gear.className='a4-tools-gear';
    gear.innerHTML=gearIcon;
    gear.title='Открыть панель управления';
    gear.setAttribute('aria-label','Открыть панель управления');
    gear.setAttribute('aria-expanded','false');

    const shade=document.createElement('div');
    shade.className='a4-tools-shade';
    shade.setAttribute('aria-hidden','true');

    const drawer=document.createElement('aside');
    drawer.className='a4-tools-drawer';
    drawer.setAttribute('role','dialog');
    drawer.setAttribute('aria-modal','true');
    drawer.setAttribute('aria-label','Панель управления');
    drawer.setAttribute('aria-hidden','true');
    drawer.innerHTML=`
      <div class="a4-tools-drawer-head">
        <div class="a4-tools-drawer-head-copy"><strong>Управление</strong><small>Настройки и действия текущей страницы</small></div>
        <button type="button" class="a4-tools-close" aria-label="Закрыть панель">×</button>
      </div>
      <div class="a4-tools-drawer-content"></div>`;

    gear.onclick=e=>{e.stopPropagation();setOpen(wrap,!wrap.classList.contains('a4-tools-open'))};
    shade.onclick=()=>setOpen(wrap,false);
    drawer.querySelector('.a4-tools-close').onclick=()=>setOpen(wrap,false);
    drawer.addEventListener('click',e=>e.stopPropagation());

    wrap.append(gear,shade,drawer);
    top.appendChild(wrap);
    return wrap;
  }

  function ensure(top){
    if(!top||busy)return;
    busy=true;
    try{
      let wrap=top.querySelector(':scope > .a4-topbar-tools');
      if(!wrap)wrap=createWrap(top);
      const content=wrap.querySelector('.a4-tools-drawer-content');
      const title=titleNode(top);

      [...top.children].forEach(el=>{
        if(el===wrap||el===title||el.classList?.contains('a4-mobile-menu'))return;
        if(el.tagName==='SCRIPT'||el.tagName==='STYLE')return;
        content.appendChild(el);
      });

      // Служебные элементы могут появиться позже (уведомления, настройка блоков и т.п.).
      // Пока они остаются потомками .topbar, остальные модули продолжают находить их штатно.
      const actions=top.querySelector('.a4-workspace-actions');
      if(actions&&actions.parentElement!==content&&actions!==content)content.appendChild(actions);
    }finally{busy=false}
  }

  function scan(){document.querySelectorAll('.topbar').forEach(ensure)}

  const init=()=>{
    scan();
    observer=new MutationObserver(()=>{
      if(busy)return;
      clearTimeout(observer._a4Timer);
      observer._a4Timer=setTimeout(scan,90);
    });
    observer.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('keydown',e=>{
      if(e.key!=='Escape')return;
      document.querySelectorAll('.a4-topbar-tools.a4-tools-open').forEach(w=>setOpen(w,false));
    });
    setTimeout(scan,350);
    setTimeout(scan,1100);
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
