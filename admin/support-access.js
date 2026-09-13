(()=>{
  if(window.__A4_SUPPORT_ACCESS__)return;
  window.__A4_SUPPORT_ACCESS__=true;
  const supportHref='./support.html';

  function supportIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.8 9.3a3.4 3.4 0 0 1 6.4 1.6c0 2.4-3.2 2.7-3.2 5M12 18h.01"/></svg>'}
  function helpIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h6"/></svg>'}
  function profileIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>'}
  function equipmentIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h8M9 17h6"/></svg>'}
  function expensesIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h4"/><path d="M16 15v4M14 17h4"/></svg>'}
  function link(href,label,icon,active=false){return `<a href="${href}" class="${active?'active':''}" title="${label}"><span class="a4-nav-icon">${icon}</span><span class="a4-nav-label">${label}</span></a>`}

  function ensureSupportLink(){
    const nav=document.querySelector('.sidebar nav');if(!nav)return false;
    if(!nav.querySelector('a[href$="support.html"]')){
      const target=[...nav.querySelectorAll('a')].find(a=>/messages\.html/.test(a.getAttribute('href')||''));
      const wrap=document.createElement('div');wrap.innerHTML=link(supportHref,'Поддержка',supportIcon(),/support\.html$/.test(location.pathname));
      const a=wrap.firstElementChild;
      if(target?.parentNode)target.parentNode.insertBefore(a,target.nextSibling);
      else (nav.querySelector('.a4-nav-group[data-group="operations"] .a4-nav-group-body')||nav).appendChild(a);
    }
    return true;
  }

  function ensureEquipmentLink(){
    const nav=document.querySelector('.sidebar nav');if(!nav)return false;
    let a=nav.querySelector('a[href$="equipment.html"]');
    if(!a){
      const wrap=document.createElement('div');
      wrap.innerHTML=link('./equipment.html','Оборудование',equipmentIcon(),/equipment\.html$/.test(location.pathname));
      a=wrap.firstElementChild;
    }
    const operations=nav.querySelector('.a4-nav-group[data-group="operations"] .a4-nav-group-body');
    const warehouse=[...nav.querySelectorAll('a')].find(x=>/warehouse\.html/.test(x.getAttribute('href')||''));
    if(operations){
      if(a.parentElement!==operations){
        if(warehouse?.parentElement===operations)operations.insertBefore(a,warehouse.nextSibling);
        else operations.appendChild(a);
      }else if(warehouse?.parentElement===operations&&warehouse.nextSibling!==a){operations.insertBefore(a,warehouse.nextSibling)}
      if(/equipment\.html$/.test(location.pathname)){
        a.classList.add('active');
        const group=operations.closest('.a4-nav-group');
        group?.classList.add('has-active','open');
      }
      return true;
    }
    if(warehouse?.parentNode){warehouse.parentNode.insertBefore(a,warehouse.nextSibling);return true}
    nav.appendChild(a);return true;
  }

  function ensureExpensesLink(){
    const nav=document.querySelector('.sidebar nav');if(!nav)return false;
    let a=nav.querySelector('a[href$="expenses.html"]');
    if(!a){
      const wrap=document.createElement('div');
      wrap.innerHTML=link('./expenses.html','Расходы',expensesIcon(),/expenses\.html$/.test(location.pathname));
      a=wrap.firstElementChild;
    }
    const payments=[...nav.querySelectorAll('a')].find(x=>/payments\.html/.test(x.getAttribute('href')||''));
    const parent=payments?.parentElement||nav;
    if(a.parentElement!==parent){
      if(payments?.parentElement===parent)parent.insertBefore(a,payments.nextSibling);
      else parent.appendChild(a);
    }else if(payments&&payments.nextSibling!==a){parent.insertBefore(a,payments.nextSibling)}
    if(/expenses\.html$/.test(location.pathname)){
      a.classList.add('active');
      const group=a.closest('.a4-nav-group');
      group?.classList.add('has-active','open');
    }
    return true;
  }

  function loadContextModules(){
    const path=location.pathname;
    const add=(src,id)=>{
      if(document.getElementById(id))return;
      const s=document.createElement('script');s.id=id;s.type='module';s.src=src;document.head.appendChild(s);
    };
    if(/\/admin\/(?:index\.html)?$/.test(path))add('./dashboard-equipment-widget.js?v=20260908-2','a4-dashboard-equipment-module');
    if(/\/admin\/equipment\.html$/.test(path))add('./equipment-service-kpis.js?v=20260908-1','a4-equipment-service-kpis-module');
    if(/\/admin\/reports\.html$/.test(path))add('./reports-equipment-widget.js?v=20260908-1','a4-reports-equipment-module');
  }

  function isolateSupportNav(){
    const nav=document.querySelector('.sidebar nav');if(!nav)return false;
    nav.innerHTML=[
      link('./support.html','Поддержка',supportIcon(),/support\.html$/.test(location.pathname)),
      link('./expenses.html','Расходы',expensesIcon(),/expenses\.html$/.test(location.pathname)),
      link('./help.html','Инструкция',helpIcon(),/help\.html$/.test(location.pathname)),
      link('./profile.html','Мой профиль',profileIcon(),/profile\.html$/.test(location.pathname))
    ].join('');
    return true;
  }

  function applyRoles(rs){
    const supportOnly=Array.isArray(rs)&&rs.includes('SUPPORT')&&!rs.includes('ADMIN');
    window.__A4_SUPPORT_ONLY__=supportOnly;
    if(!supportOnly)loadContextModules();
    let tries=0;
    const timer=setInterval(()=>{
      tries++;
      try{
        const ok=supportOnly?isolateSupportNav():(ensureSupportLink()&&ensureEquipmentLink()&&ensureExpensesLink());
        if(ok||tries>30)clearInterval(timer);
      }catch(error){console.warn('Support navigation init failed',error);clearInterval(timer)}
    },100);
    if(!supportOnly){setTimeout(ensureEquipmentLink,500);setTimeout(ensureEquipmentLink,1400);setTimeout(ensureExpensesLink,500);setTimeout(ensureExpensesLink,1400)}
  }

  function apply(){
    if(Array.isArray(window.__A4_CURRENT_ROLES__))return applyRoles(window.__A4_CURRENT_ROLES__);
    let checks=0;
    const wait=setInterval(()=>{
      checks++;
      if(Array.isArray(window.__A4_CURRENT_ROLES__)){
        clearInterval(wait);applyRoles(window.__A4_CURRENT_ROLES__);return;
      }
      if(checks>=50){clearInterval(wait);applyRoles([])}
    },100);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
})();
