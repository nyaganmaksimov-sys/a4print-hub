(()=>{
  if(window.__A4_SUPPORT_ACCESS__)return;
  window.__A4_SUPPORT_ACCESS__=true;

  let rolesApplied=false;

  function supportIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.8 9.3a3.4 3.4 0 0 1 6.4 1.6c0 2.4-3.2 2.7-3.2 5M12 18h.01"/></svg>'}
  function helpIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h6"/></svg>'}
  function profileIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>'}
  function expensesIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h4"/><path d="M16 15v4M14 17h4"/></svg>'}
  function link(href,label,icon,active=false){return `<a href="${href}" class="${active?'active':''}" title="${label}"><span class="a4-nav-icon">${icon}</span><span class="a4-nav-label">${label}</span></a>`}

  function loadContextModules(){
    if(!/\/admin\/equipment\.html$/.test(location.pathname))return;
    if(document.getElementById('a4-equipment-service-kpis-module'))return;
    const s=document.createElement('script');
    s.id='a4-equipment-service-kpis-module';
    s.type='module';
    s.src='./equipment-service-kpis.js?v=20260908-1';
    document.head.appendChild(s);
  }

  function isolateSupportNav(){
    const nav=document.querySelector('.sidebar nav');
    if(!nav)return false;
    nav.innerHTML=[
      link('./support.html','Поддержка',supportIcon(),/support\.html$/.test(location.pathname)),
      link('./expenses.html','Расходы',expensesIcon(),/expenses\.html$/.test(location.pathname)),
      link('./help.html','Инструкция',helpIcon(),/help\.html$/.test(location.pathname)),
      link('./profile.html','Мой профиль',profileIcon(),/profile\.html$/.test(location.pathname))
    ].join('');
    return true;
  }

  function applyRoles(rs){
    if(rolesApplied)return;
    rolesApplied=true;
    const roles=Array.isArray(rs)?rs:[];
    const supportOnly=roles.includes('SUPPORT')&&!roles.includes('ADMIN');
    window.__A4_SUPPORT_ONLY__=supportOnly;

    if(supportOnly){
      if(!isolateSupportNav())setTimeout(isolateSupportNav,250);
      return;
    }

    // Normal navigation is rendered once by navigation.js. Do not insert or reorder
    // links after startup; specialized equipment screens now live inside equipment.html.
    loadContextModules();
  }

  function apply(){
    if(Array.isArray(window.__A4_CURRENT_ROLES__)){
      applyRoles(window.__A4_CURRENT_ROLES__);
      return;
    }

    window.addEventListener('a4:roles-ready',event=>{
      applyRoles(Array.isArray(event.detail?.roles)?event.detail.roles:window.__A4_CURRENT_ROLES__);
    },{once:true});

    // Defensive fallback only. No 100 ms role polling or repeated navigation rebuilds.
    setTimeout(()=>{
      if(!rolesApplied)applyRoles(Array.isArray(window.__A4_CURRENT_ROLES__)?window.__A4_CURRENT_ROLES__:[]);
    },4000);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
})();
