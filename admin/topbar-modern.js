(()=>{
  if(window.__A4_TOPBAR_MODERN__)return;
  window.__A4_TOPBAR_MODERN__=true;

  let busy=false;
  let observer=null;

  const gearIcon=`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1.03-1.56V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.56 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"></path></svg>`;

  const css=document.createElement('style');
  css.id='a4-topbar-modern-style';
  css.textContent=`
    .topbar{
      display:flex!important;
      align-items:flex-start!important;
      gap:12px!important;
      min-width:0!important;
      position:relative!important;
    }
    .topbar>.a4-topbar-tools{
      margin-left:auto!important;
      flex:0 0 40px!important;
      width:40px!important;
      min-width:40px!important;
      height:40px!important;
      position:relative!important;
      display:block!important;
      z-index:23000!important;
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

    .a4-tools-popover{
      position:fixed!important;
      z-index:32000!important;
      left:var(--a4-tools-left,auto)!important;
      top:var(--a4-tools-top,72px)!important;
      width:min(760px,calc(100vw - 24px))!important;
      max-width:760px!important;
      max-height:min(58vh,420px)!important;
      padding:10px!important;
      overflow:visible!important;
      border:1px solid #dce5ef!important;
      border-radius:15px!important;
      background:rgba(255,255,255,.98)!important;
      box-shadow:0 18px 50px rgba(15,23,42,.16)!important;
      backdrop-filter:blur(14px)!important;
      -webkit-backdrop-filter:blur(14px)!important;
      opacity:0!important;
      visibility:hidden!important;
      pointer-events:none!important;
      transform:translateY(-6px) scale(.985)!important;
      transform-origin:top right!important;
      transition:opacity .15s ease,transform .15s ease,visibility .15s ease!important;
    }
    .a4-topbar-tools.a4-tools-open .a4-tools-popover{
      opacity:1!important;
      visibility:visible!important;
      pointer-events:auto!important;
      transform:translateY(0) scale(1)!important;
    }
    .a4-tools-popover-content{
      display:flex!important;
      align-items:center!important;
      align-content:center!important;
      justify-content:flex-start!important;
      flex-wrap:wrap!important;
      gap:7px!important;
      min-width:0!important;
      max-width:100%!important;
      max-height:min(54vh,390px)!important;
      overflow:auto!important;
      padding:1px!important;
      scrollbar-width:thin!important;
    }
    .a4-tools-popover-content>*{margin:0!important;min-width:0!important;max-width:100%!important}

    .a4-tools-popover .a4-workspace-actions,
    .a4-tools-popover .manager-user,
    .a4-tools-popover .manager-actions,
    .a4-tools-popover .layout-tools,
    .a4-tools-popover .user,
    .a4-tools-popover .toolbar,
    .a4-tools-popover .actions{
      display:flex!important;
      align-items:center!important;
      flex-wrap:wrap!important;
      gap:7px!important;
      margin:0!important;
      padding:0!important;
      border:0!important;
      background:transparent!important;
      box-shadow:none!important;
      position:relative!important;
      width:auto!important;
    }
    .a4-tools-popover .a4-block-layout-toolbar{
      display:flex!important;
      align-items:center!important;
      flex-wrap:wrap!important;
      gap:7px!important;
      margin:0!important;
    }

    .a4-tools-popover button,
    .a4-tools-popover a.button,
    .a4-tools-popover .btn,
    .a4-tools-popover .a4-block-layout-toolbar button{
      width:auto!important;
      min-width:0!important;
      min-height:34px!important;
      height:34px!important;
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
    .a4-tools-popover button:hover,
    .a4-tools-popover a.button:hover,
    .a4-tools-popover .btn:hover{
      background:#f3f7fd!important;
      border-color:#bfd0e5!important;
      color:#1d4ed8!important;
      transform:none!important;
    }
    .a4-tools-popover .a4-block-layout-toolbar .a4-layout-done{
      background:#2563eb!important;
      border-color:#2563eb!important;
      color:#fff!important;
    }
    .a4-tools-popover .manager-status{
      min-height:34px!important;
      height:34px!important;
      padding:0 11px!important;
      display:inline-flex!important;
      align-items:center!important;
      border-radius:999px!important;
      font-size:10px!important;
      white-space:nowrap!important;
    }
    .a4-tools-popover .user-email,
    .a4-tools-popover #userEmail,
    .a4-tools-popover .a4-profile-trigger{
      min-height:34px!important;
      height:34px!important;
      max-width:210px!important;
      display:inline-flex!important;
      align-items:center!important;
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
    .a4-tools-popover .a4-more-btn,
    .a4-tools-popover #hubChatNotifyCenter.a4-top-notify,
    .a4-tools-popover #hubChatNotifyCenter.a4-top-notify #hubChatNotifyBell{
      width:34px!important;
      min-width:34px!important;
      height:34px!important;
      min-height:34px!important;
      padding:0!important;
      border-radius:9px!important;
    }
    .a4-tools-popover #hubChatNotifyCenter.a4-top-notify{position:relative!important}

    /* Вложенные меню продолжают открываться поверх горизонтальной панели. */
    .a4-tools-popover .a4-more-menu{
      right:0!important;
      top:42px!important;
      z-index:32100!important;
    }
    .a4-tools-popover #hubChatNotifyCenter.a4-top-notify #hubChatNotifyPanel{
      position:fixed!important;
      right:18px!important;
      left:auto!important;
      top:var(--a4-notify-top,82px)!important;
      width:min(390px,calc(100vw - 36px))!important;
      max-height:min(68vh,520px)!important;
      z-index:32110!important;
    }

    @media(max-width:900px){
      .topbar{align-items:center!important;gap:8px!important}
      .topbar>.a4-topbar-tools{width:40px!important;min-width:40px!important;flex:0 0 40px!important}
      .a4-tools-popover{
        width:calc(100vw - 16px)!important;
        max-width:none!important;
        left:8px!important;
        border-radius:14px!important;
        padding:9px!important;
        max-height:62dvh!important;
      }
      .a4-tools-popover-content{gap:6px!important;max-height:58dvh!important}
      .a4-tools-popover button,
      .a4-tools-popover a.button,
      .a4-tools-popover .btn,
      .a4-tools-popover .a4-block-layout-toolbar button{
        min-height:36px!important;
        height:36px!important;
        padding:0 10px!important;
        font-size:11px!important;
      }
      .a4-tools-popover .user-email,
      .a4-tools-popover #userEmail,
      .a4-tools-popover .a4-profile-trigger{max-width:170px!important}
    }
    @media(max-width:520px){
      .a4-tools-popover-content{align-items:stretch!important}
      .a4-tools-popover .a4-workspace-actions,
      .a4-tools-popover .manager-user,
      .a4-tools-popover .manager-actions,
      .a4-tools-popover .layout-tools,
      .a4-tools-popover .user{gap:6px!important}
      .a4-tools-popover .a4-block-layout-toolbar{gap:6px!important}
    }
    @media(prefers-reduced-motion:reduce){.a4-tools-popover{transition:none!important}}
  `;
  document.head.appendChild(css);

  function titleNode(top){
    const direct=[...top.children];
    return direct.find(el=>el.matches?.('div,section')&&el.querySelector?.(':scope > h1,:scope > h2'))
      || direct.find(el=>el.matches?.('h1,h2'))
      || direct.find(el=>!el.classList?.contains('a4-mobile-menu')&&!el.classList?.contains('a4-topbar-tools'))
      || null;
  }

  function positionPopover(wrap){
    if(!wrap?.classList.contains('a4-tools-open'))return;
    const gear=wrap.querySelector(':scope > .a4-tools-gear');
    const pop=wrap.querySelector(':scope > .a4-tools-popover');
    if(!gear||!pop)return;
    const r=gear.getBoundingClientRect();
    const vw=document.documentElement.clientWidth||window.innerWidth;
    const panelWidth=Math.min(760,Math.max(280,vw-24));
    const left=Math.max(12,Math.min(vw-panelWidth-12,r.right-panelWidth));
    const top=Math.max(8,r.bottom+9);
    pop.style.setProperty('--a4-tools-left',`${left}px`);
    pop.style.setProperty('--a4-tools-top',`${top}px`);
    pop.style.setProperty('--a4-notify-top',`${Math.min(window.innerHeight-90,top+48)}px`);
  }

  function setOpen(wrap,open){
    if(!wrap)return;
    wrap.classList.toggle('a4-tools-open',!!open);
    const gear=wrap.querySelector(':scope > .a4-tools-gear');
    if(gear){
      gear.setAttribute('aria-expanded',open?'true':'false');
      gear.title=open?'Закрыть панель управления':'Открыть панель управления';
      gear.setAttribute('aria-label',gear.title);
    }
    if(open)requestAnimationFrame(()=>positionPopover(wrap));
  }

  function ensure(top){
    if(!top||busy)return;
    busy=true;
    try{
      let wrap=top.querySelector(':scope > .a4-topbar-tools');
      let content=wrap?.querySelector(':scope > .a4-tools-popover > .a4-tools-popover-content');
      if(!wrap){
        wrap=document.createElement('div');
        wrap.className='a4-topbar-tools';

        const gear=document.createElement('button');
        gear.type='button';
        gear.className='a4-tools-gear';
        gear.innerHTML=gearIcon;
        gear.setAttribute('aria-expanded','false');
        gear.title='Открыть панель управления';
        gear.setAttribute('aria-label',gear.title);

        const pop=document.createElement('div');
        pop.className='a4-tools-popover';
        pop.setAttribute('role','dialog');
        pop.setAttribute('aria-label','Панель управления страницей');
        content=document.createElement('div');
        content.className='a4-tools-popover-content';
        pop.appendChild(content);

        gear.onclick=e=>{
          e.stopPropagation();
          setOpen(wrap,!wrap.classList.contains('a4-tools-open'));
        };
        pop.onclick=e=>e.stopPropagation();
        wrap.append(gear,pop);
        top.appendChild(wrap);
      }

      const title=titleNode(top);
      [...top.children].forEach(el=>{
        if(el===wrap||el===title||el.classList?.contains('a4-mobile-menu'))return;
        if(el.tagName==='SCRIPT'||el.tagName==='STYLE')return;
        content.appendChild(el);
      });

      const actions=top.querySelector('.a4-workspace-actions');
      if(actions&&!actions.closest('.a4-tools-popover-content'))content.appendChild(actions);
    }finally{busy=false}
  }

  function scan(){document.querySelectorAll('.topbar').forEach(ensure)}

  function closeAll(){document.querySelectorAll('.a4-topbar-tools.a4-tools-open').forEach(w=>setOpen(w,false))}

  const init=()=>{
    scan();
    document.addEventListener('click',e=>{
      const wrap=e.target.closest?.('.a4-topbar-tools');
      if(!wrap)closeAll();
    });
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAll()});
    const reposition=()=>document.querySelectorAll('.a4-topbar-tools.a4-tools-open').forEach(positionPopover);
    window.addEventListener('resize',reposition,{passive:true});
    window.addEventListener('scroll',reposition,{passive:true,capture:true});

    observer=new MutationObserver(()=>{
      if(busy)return;
      clearTimeout(observer._a4Timer);
      observer._a4Timer=setTimeout(scan,80);
    });
    observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(scan,350);
    setTimeout(scan,1100);
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
