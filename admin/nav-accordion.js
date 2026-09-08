(function(){
  if(window.__A4_NAV_ACCORDION__) return;
  window.__A4_NAV_ACCORDION__=true;

  const GROUPS=[
    {key:'work',title:'Работа',pages:['index.html','manager.html','orders.html','customers.html','requests.html','partners.html']},
    {key:'operations',title:'Операции',pages:['kassa-root','warehouse.html','production.html','cuim-delivery.html','documents.html','payments.html','reports.html']},
    {key:'team',title:'Команда',pages:['messages.html','employees.html','staff-structure.html']},
    {key:'system',title:'Система',pages:['telegram.html','apps.html','settings.html','help.html','index-root']},
  ];

  const css=document.createElement('style');
  css.textContent=`
    .sidebar nav>.a4-nav-section{display:none!important}
    .a4-nav-accordion{display:grid;gap:5px;width:100%}
    .a4-nav-group{display:grid;gap:3px;min-width:0}
    .a4-nav-group-head{width:100%;border:0;background:transparent;color:#94a3b8;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px 7px;border-radius:9px;cursor:pointer;font:800 10px/1.2 system-ui;letter-spacing:.08em;text-transform:uppercase;text-align:left}
    .a4-nav-group-head:hover{background:rgba(148,163,184,.09);color:#cbd5e1}
    .a4-nav-group-head .chev{font-size:14px;line-height:1;transition:transform .18s ease;letter-spacing:0;margin-left:auto}
    .a4-nav-group.open>.a4-nav-group-head .chev{transform:rotate(90deg)}
    .a4-nav-group-body{display:none;gap:3px;min-width:0}
    .a4-nav-group.open>.a4-nav-group-body{display:grid}
    .a4-nav-group.has-active>.a4-nav-group-head{color:#e2e8f0}
    .a4-nav-group.has-active>.a4-nav-group-head:after{display:none!important;content:none!important}
    .a4-nav-group[data-group="work"]>.a4-nav-group-head .chev{margin-left:0}
    .a4-system-health-dot{width:8px;height:8px;flex:0 0 8px;margin-left:auto;border-radius:50%;background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.14);transition:background .18s ease,box-shadow .18s ease}
    .a4-system-health-dot.ok{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.15)}
    .a4-system-health-dot.error{background:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.15)}
    .a4-system-health-dot.checking{background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.15)}

    body:not(.a4-side-glass) .a4-nav-group-head{color:#64748b}
    body:not(.a4-side-glass) .a4-nav-group-head:hover{background:#eef2f7;color:#0f172a}
    body:not(.a4-side-glass) .a4-nav-group.has-active>.a4-nav-group-head{color:#334155}

    @media(min-width:901px){
      .a4-sidebar-collapsed .a4-nav-group-head{height:8px;padding:0;margin:4px 0;background:#cbd5e1;border-radius:999px;font-size:0}
      .a4-sidebar-collapsed .a4-nav-group-head .chev,.a4-sidebar-collapsed .a4-system-health-dot{display:none!important}
      .a4-sidebar-collapsed .a4-nav-group-body{display:grid!important}
    }

    @media(max-width:900px){
      .sidebar{display:block!important;width:min(88vw,320px)!important;padding-left:12px!important;padding-right:12px!important}
      .sidebar nav{width:100%!important}
      .sidebar nav a,.a4-sidebar-collapsed .sidebar nav a{justify-content:flex-start!important;padding:10px 11px!important;min-height:44px!important;gap:10px!important}
      .sidebar .a4-nav-label,.a4-sidebar-collapsed .sidebar .a4-nav-label{display:block!important;visibility:visible!important;opacity:1!important;flex:1 1 auto!important;min-width:0!important;white-space:normal!important;line-height:1.25!important}
      .sidebar .a4-nav-icon,.a4-sidebar-collapsed .sidebar .a4-nav-icon{width:24px!important;height:24px!important;flex:0 0 24px!important}
      .sidebar .a4-nav-icon svg,.a4-sidebar-collapsed .sidebar .a4-nav-icon svg{width:20px!important;height:20px!important}
      .sidebar a b,.a4-sidebar-collapsed .sidebar a b{display:inline-flex!important;margin-left:auto!important}
      .a4-sidebar-collapsed .a4-nav-group-head,.a4-nav-group-head{height:auto!important;padding:12px 10px 9px!important;margin:0!important;background:transparent!important;font-size:11px!important;color:#94a3b8!important}
      .a4-sidebar-collapsed .a4-nav-group-head .chev{display:inline!important}
      .a4-sidebar-collapsed .a4-system-health-dot{display:block!important}
      .a4-sidebar-collapsed .a4-nav-group-body{display:none!important}
      .a4-sidebar-collapsed .a4-nav-group.open>.a4-nav-group-body,.a4-nav-group.open>.a4-nav-group-body{display:grid!important}
      .a4-nav-group-body{gap:4px}
      .a4-sidebar-head{display:none!important}
    }
  `;
  document.head.appendChild(css);

  function pageKey(a){
    const raw=a.getAttribute('href')||'';
    if(/^\.\.\/kassa(?:\/|$)/.test(raw)) return 'kassa-root';
    if(raw.startsWith('../')) return 'index-root';
    return raw.split('?')[0].split('/').pop()||'';
  }

  function getAccessToken(){
    for(const store of [localStorage,sessionStorage]){
      try{
        for(let i=0;i<store.length;i++){
          const key=store.key(i)||'';
          if(!/^sb-.*-auth-token$/.test(key)) continue;
          const raw=store.getItem(key);
          if(!raw) continue;
          const value=JSON.parse(raw);
          const token=value?.access_token||value?.currentSession?.access_token||value?.session?.access_token||'';
          if(token) return token;
        }
      }catch{}
    }
    return '';
  }

  function setHealth(state,text){
    const dot=document.querySelector('.a4-system-health-dot');
    if(!dot) return;
    dot.className=`a4-system-health-dot ${state}`;
    dot.title=text;
    dot.setAttribute('aria-label',text);
  }

  async function checkSystemHealth(){
    setHealth('checking','Проверка базы данных и API HUB...');
    if(!navigator.onLine){
      setHealth('error','Нет подключения к интернету');
      return;
    }

    const cfg=window.A4PRINT_CONFIG||{};
    const supabaseUrl=String(cfg.supabaseUrl||'').replace(/\/$/,'');
    const apiBase=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
    const key=cfg.supabasePublishableKey||'';
    const token=getAccessToken();

    if(!supabaseUrl||!apiBase||!key){
      setHealth('error','Ошибка конфигурации A4PRINT HUB');
      return;
    }
    if(!token){
      setHealth('error','Нет активной авторизации HUB');
      return;
    }

    try{
      const dbFetch=window.A4SupabaseFetch||window.fetch.bind(window);
      const [dbRes,apiRes]=await Promise.all([
        dbFetch(`${supabaseUrl}/rest/v1/orders?select=id&limit=1`,{
          headers:{apikey:key,Authorization:`Bearer ${token}`,Accept:'application/json'},
          cache:'no-store'
        }),
        fetch(`${apiBase}/api/v1/health`,{cache:'no-store'})
      ]);
      const apiData=await apiRes.clone().json().catch(()=>({}));
      const dbOk=dbRes.ok;
      const apiOk=apiRes.ok&&apiData?.status==='ok'&&apiData?.databaseConfigured===true;

      if(dbOk&&apiOk){
        const now=new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
        setHealth('ok',`База данных и API подключены · проверено ${now}`);
      }else{
        const parts=[];
        if(!dbOk) parts.push(`База: HTTP ${dbRes.status}`);
        if(!apiOk) parts.push(`API: HTTP ${apiRes.status}`);
        setHealth('error',parts.join(' · ')||'Ошибка подключения к системе');
      }
    }catch(error){
      setHealth('error',`Нет связи: ${error?.message||'ошибка сети'}`);
    }
  }

  function build(){
    const nav=document.querySelector('.sidebar nav');
    if(!nav||nav.dataset.a4Accordion==='1') return false;

    const links=[...nav.querySelectorAll(':scope > a')].filter(a=>!a.classList.contains('a4-chat-nav-link'));
    if(!links.length) return false;
    nav.querySelectorAll(':scope > .a4-nav-section').forEach(x=>x.remove());

    const byPage=new Map();
    links.forEach(a=>byPage.set(pageKey(a),a));
    const used=new Set();
    const shell=document.createElement('div');
    shell.className='a4-nav-accordion';

    for(const g of GROUPS){
      const group=document.createElement('section');
      group.className='a4-nav-group';
      group.dataset.group=g.key;
      const head=document.createElement('button');
      head.type='button';
      head.className='a4-nav-group-head';
      head.innerHTML=`<span>${g.title}</span>${g.key==='work'?'<span class="a4-system-health-dot checking" title="Проверка подключения..." aria-label="Проверка подключения"></span>':''}<span class="chev">›</span>`;
      const body=document.createElement('div');body.className='a4-nav-group-body';
      let has=false,active=false;
      for(const p of g.pages){
        const a=byPage.get(p);if(!a) continue;
        has=true;used.add(a);body.appendChild(a);
        if(a.classList.contains('active')) active=true;
      }
      if(!has) continue;
      if(active) group.classList.add('has-active','open');
      head.onclick=()=>{
        const opening=!group.classList.contains('open');
        shell.querySelectorAll('.a4-nav-group.open').forEach(x=>x.classList.remove('open'));
        if(opening) group.classList.add('open');
      };
      group.append(head,body);shell.appendChild(group);
    }

    const leftovers=links.filter(a=>!used.has(a));
    if(leftovers.length){
      let sys=shell.querySelector('[data-group="system"] .a4-nav-group-body');
      if(!sys){
        const group=document.createElement('section');group.className='a4-nav-group';group.dataset.group='system';
        const head=document.createElement('button');head.type='button';head.className='a4-nav-group-head';head.innerHTML='<span>Система</span><span class="chev">›</span>';
        sys=document.createElement('div');sys.className='a4-nav-group-body';
        head.onclick=()=>{const opening=!group.classList.contains('open');shell.querySelectorAll('.a4-nav-group.open').forEach(x=>x.classList.remove('open'));if(opening)group.classList.add('open')};
        group.append(head,sys);shell.appendChild(group);
      }
      leftovers.forEach(a=>sys.appendChild(a));
    }

    nav.innerHTML='';nav.appendChild(shell);nav.dataset.a4Accordion='1';
    setTimeout(checkSystemHealth,150);
    return true;
  }

  function init(){
    if(window.matchMedia?.('(max-width:900px)').matches) document.body.classList.remove('a4-sidebar-collapsed');
    if(!build()){
      let tries=0;
      const t=setInterval(()=>{if(build()||++tries>40)clearInterval(t)},100);
    }
    setInterval(checkSystemHealth,60000);
    window.addEventListener('online',checkSystemHealth);
    window.addEventListener('offline',()=>setHealth('error','Нет подключения к интернету'));
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
