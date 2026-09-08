(()=>{
  if(window.__A4_TOPBAR_MODERN__)return;
  window.__A4_TOPBAR_MODERN__=true;

  const KEY='a4print_topbar_tools_collapsed_v1';
  let observer=null;
  let busy=false;

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
      display:flex!important;
      align-items:flex-start!important;
      justify-content:flex-end!important;
      gap:6px!important;
      min-width:0!important;
      max-width:min(72%,920px)!important;
      flex:0 1 auto!important;
    }
    .a4-topbar-tools-content{
      display:flex!important;
      align-items:center!important;
      justify-content:flex-end!important;
      flex-wrap:wrap!important;
      gap:5px!important;
      min-width:0!important;
      padding:4px!important;
      border:1px solid #e1e8f0!important;
      border-radius:13px!important;
      background:rgba(255,255,255,.82)!important;
      box-shadow:0 4px 16px rgba(15,23,42,.045)!important;
      backdrop-filter:blur(12px)!important;
      -webkit-backdrop-filter:blur(12px)!important;
    }
    .a4-topbar-tools-content>*{margin:0!important}
    .a4-topbar-tools-content .a4-workspace-actions,
    .a4-topbar-tools-content .layout-tools,
    .a4-topbar-tools-content .manager-user,
    .a4-topbar-tools-content .manager-actions,
    .a4-topbar-tools-content .user{
      display:flex!important;
      align-items:center!important;
      justify-content:flex-end!important;
      gap:5px!important;
      margin:0!important;
      flex-wrap:wrap!important;
    }
    .a4-topbar-tools-content .a4-workspace-actions{position:relative!important}

    /* Единый компактный размер управляющих кнопок в шапке. */
    .a4-topbar-tools-content button,
    .a4-topbar-tools-content a.button,
    .a4-topbar-tools-content .btn{
      min-height:32px!important;
      height:32px!important;
      padding:0 9px!important;
      border-radius:9px!important;
      font-size:11px!important;
      line-height:1!important;
      font-weight:800!important;
      box-shadow:none!important;
      white-space:nowrap!important;
    }
    .a4-topbar-tools-content .a4-block-layout-toolbar{
      display:flex!important;
      align-items:center!important;
      gap:4px!important;
      margin:0!important;
    }
    .a4-topbar-tools-content .a4-block-layout-toolbar button{
      min-height:32px!important;
      height:32px!important;
      padding:0 9px!important;
      border-radius:9px!important;
      font-size:11px!important;
    }
    .a4-topbar-tools-content .a4-more-btn,
    .a4-topbar-tools-content #hubChatNotifyBell{
      width:32px!important;
      min-width:32px!important;
      height:32px!important;
      min-height:32px!important;
      padding:0!important;
      border-radius:9px!important;
    }
    .a4-topbar-tools-content #hubChatNotifyCenter.a4-top-notify{
      width:32px!important;
      height:32px!important;
    }
    .a4-topbar-tools-content .a4-profile-trigger{
      min-height:32px!important;
      padding:0 8px!important;
      border-radius:8px!important;
      font-size:11px!important;
      display:inline-flex!important;
      align-items:center!important;
    }
    .a4-topbar-tools-content .manager-status{
      min-height:30px!important;
      padding:0 9px!important;
      font-size:10px!important;
      border-radius:999px!important;
    }
    .a4-topbar-tools-content .user-email,
    .a4-topbar-tools-content #userEmail{
      font-size:11px!important;
      color:#64748b!important;
      white-space:nowrap!important;
    }

    .a4-topbar-collapse{
      flex:0 0 32px!important;
      width:32px!important;
      min-width:32px!important;
      height:32px!important;
      min-height:32px!important;
      padding:0!important;
      display:grid!important;
      place-items:center!important;
      border:1px solid #dce5ef!important;
      border-radius:9px!important;
      background:rgba(255,255,255,.92)!important;
      color:#64748b!important;
      box-shadow:0 3px 10px rgba(15,23,42,.04)!important;
      font:900 17px/1 system-ui!important;
      cursor:pointer!important;
      transition:background .15s ease,border-color .15s ease,color .15s ease,transform .15s ease!important;
    }
    .a4-topbar-collapse:hover{
      background:#f8fbff!important;
      border-color:#bfd0e5!important;
      color:#2563eb!important;
      transform:none!important;
    }
    .a4-topbar-tools.a4-collapsed .a4-topbar-tools-content{display:none!important}
    .a4-topbar-tools.a4-collapsed{
      max-width:32px!important;
      flex:0 0 32px!important;
    }
    .a4-topbar-tools.a4-collapsed .a4-topbar-collapse{
      background:#eef5ff!important;
      border-color:#d5e5ff!important;
      color:#2563eb!important;
    }

    /* Старые локальные панели действий больше не создают визуальные островки. */
    .a4-topbar-tools-content .layout-tools,
    .a4-topbar-tools-content .manager-user{
      padding:0!important;
      background:transparent!important;
      border:0!important;
      box-shadow:none!important;
    }

    @media(max-width:1180px){
      .topbar{flex-wrap:wrap!important}
      .topbar>.a4-topbar-tools{max-width:100%!important}
      .a4-topbar-tools-content{max-width:100%!important}
    }
    @media(max-width:900px){
      .topbar{
        align-items:center!important;
        flex-wrap:nowrap!important;
        gap:7px!important;
      }
      .topbar>.a4-topbar-tools{
        margin-left:auto!important;
        max-width:calc(100% - 52px)!important;
        align-items:center!important;
      }
      .a4-topbar-tools-content{
        flex-wrap:nowrap!important;
        overflow-x:auto!important;
        max-width:min(72vw,520px)!important;
        scrollbar-width:none;
      }
      .a4-topbar-tools-content::-webkit-scrollbar{display:none}
      .a4-topbar-tools-content .user-email,
      .a4-topbar-tools-content #userEmail,
      .a4-topbar-tools-content .a4-profile-trigger{display:none!important}
      .a4-topbar-collapse{width:34px!important;min-width:34px!important;height:34px!important;min-height:34px!important}
    }
    @media(max-width:560px){
      .topbar>.a4-topbar-tools:not(.a4-collapsed) .a4-topbar-tools-content{max-width:62vw!important}
      .a4-topbar-tools-content .a4-block-layout-toolbar [data-a4-reset]{display:none!important}
    }
  `;
  document.head.appendChild(css);

  function readCollapsed(){
    try{
      const stored=localStorage.getItem(KEY);
      if(stored!==null)return stored==='1';
    }catch{}
    return !!window.matchMedia?.('(max-width:900px)').matches;
  }

  function writeCollapsed(value){
    try{localStorage.setItem(KEY,value?'1':'0')}catch{}
  }

  function titleNode(top){
    const direct=[...top.children];
    return direct.find(el=>el.matches?.('div,section')&&el.querySelector?.(':scope > h1,:scope > h2'))
      || direct.find(el=>el.matches?.('h1,h2'))
      || direct.find(el=>!el.classList?.contains('a4-mobile-menu'))
      || null;
  }

  function updateToggle(wrap,collapsed){
    wrap.classList.toggle('a4-collapsed',collapsed);
    const btn=wrap.querySelector(':scope > .a4-topbar-collapse');
    if(!btn)return;
    btn.textContent=collapsed?'‹':'›';
    btn.title=collapsed?'Развернуть панель действий':'Свернуть панель действий';
    btn.setAttribute('aria-label',btn.title);
    btn.setAttribute('aria-expanded',collapsed?'false':'true');
  }

  function ensure(top){
    if(!top||busy)return;
    busy=true;
    try{
      let wrap=top.querySelector(':scope > .a4-topbar-tools');
      let content=wrap?.querySelector(':scope > .a4-topbar-tools-content');
      if(!wrap){
        wrap=document.createElement('div');
        wrap.className='a4-topbar-tools';
        content=document.createElement('div');
        content.className='a4-topbar-tools-content';
        const toggle=document.createElement('button');
        toggle.type='button';
        toggle.className='a4-topbar-collapse';
        toggle.onclick=()=>{
          const next=!wrap.classList.contains('a4-collapsed');
          updateToggle(wrap,next);
          writeCollapsed(next);
        };
        wrap.append(content,toggle);
        top.appendChild(wrap);
        updateToggle(wrap,readCollapsed());
      }

      const title=titleNode(top);
      [...top.children].forEach(el=>{
        if(el===wrap||el===title||el.classList?.contains('a4-mobile-menu'))return;
        if(el.tagName==='SCRIPT'||el.tagName==='STYLE')return;
        content.appendChild(el);
      });

      // Некоторые страницы добавляют служебные элементы немного позже.
      const actions=top.querySelector('.a4-workspace-actions');
      if(actions&&actions.parentElement!==content&&actions!==content)content.appendChild(actions);
    }finally{busy=false}
  }

  function scan(){
    document.querySelectorAll('.topbar').forEach(ensure);
  }

  const init=()=>{
    scan();
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
