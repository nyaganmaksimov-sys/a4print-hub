(function(){
  if(window.__A4_NAV_ACCORDION__) return;
  window.__A4_NAV_ACCORDION__=true;

  const GROUPS=[
    {key:'work',title:'Работа',pages:['index.html','manager.html','orders.html','customers.html']},
    {key:'operations',title:'Операции',pages:['cuim-delivery.html','partners.html','requests.html','warehouse.html','production.html','messages.html']},
    {key:'team',title:'Команда',pages:['employees.html','staff-structure.html']},
    {key:'system',title:'Система',pages:['documents.html','payments.html','reports.html','settings.html','help.html','index-root']},
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
    .a4-nav-group.has-active>.a4-nav-group-head:after{content:'•';color:var(--a4-accent,#60a5fa);font-size:18px;line-height:0;margin-left:auto;margin-right:3px}
    .a4-nav-group.has-active>.a4-nav-group-head .chev{margin-left:0}

    @media(min-width:901px){
      .a4-sidebar-collapsed .a4-nav-group-head{height:8px;padding:0;margin:4px 0;background:#cbd5e1;border-radius:999px;font-size:0}
      .a4-sidebar-collapsed .a4-nav-group-head .chev,.a4-sidebar-collapsed .a4-nav-group-head:after{display:none}
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
      .a4-sidebar-collapsed .a4-nav-group-head .chev,.a4-sidebar-collapsed .a4-nav-group-head:after{display:inline!important}
      .a4-sidebar-collapsed .a4-nav-group-body{display:none!important}
      .a4-sidebar-collapsed .a4-nav-group.open>.a4-nav-group-body,.a4-nav-group.open>.a4-nav-group-body{display:grid!important}
      .a4-nav-group-body{gap:4px}
      .a4-sidebar-head{display:none!important}
      .sidebar .brand,.sidebar .hub-logo-wrap,.a4-sidebar-collapsed .sidebar .brand,.a4-sidebar-collapsed .sidebar .hub-logo-wrap{min-height:74px!important;margin:0 0 10px!important;padding:6px!important;border-radius:14px!important}
      .sidebar .brand img,.sidebar .hub-logo,.a4-sidebar-collapsed .sidebar .brand img,.a4-sidebar-collapsed .sidebar .hub-logo{max-width:150px!important;width:auto!important;height:62px!important;max-height:62px!important}
    }
  `;
  document.head.appendChild(css);

  function pageKey(a){
    const raw=a.getAttribute('href')||'';
    if(raw.startsWith('../')) return 'index-root';
    return raw.split('?')[0].split('/').pop()||'';
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

    // Каждый новый экран открывается с закрытыми разделами меню.
    try{sessionStorage.removeItem('a4_nav_open_group_v1')}catch{}

    for(const g of GROUPS){
      const group=document.createElement('section');
      group.className='a4-nav-group';
      group.dataset.group=g.key;
      const head=document.createElement('button');
      head.type='button';head.className='a4-nav-group-head';head.innerHTML=`<span>${g.title}</span><span class="chev">›</span>`;
      const body=document.createElement('div');body.className='a4-nav-group-body';
      let has=false,active=false;
      for(const p of g.pages){
        const a=byPage.get(p);if(!a)continue;
        has=true;used.add(a);body.appendChild(a);
        if(a.classList.contains('active'))active=true;
      }
      if(!has)continue;
      if(active)group.classList.add('has-active');
      head.onclick=()=>{
        const opening=!group.classList.contains('open');
        shell.querySelectorAll('.a4-nav-group.open').forEach(x=>x.classList.remove('open'));
        if(opening)group.classList.add('open');
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
    return true;
  }

  function init(){
    if(window.matchMedia?.('(max-width:900px)').matches)document.body.classList.remove('a4-sidebar-collapsed');
    if(build()) return;
    let tries=0;const t=setInterval(()=>{if(build()||++tries>40)clearInterval(t)},100);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();