(()=>{
  if(window.__A4_SUPPORT_ACCESS__)return;
  window.__A4_SUPPORT_ACCESS__=true;
  const cfg=window.A4PRINT_CONFIG||{};
  const supportHref='./support.html';

  function authToken(){
    try{
      const direct=localStorage.getItem('sb-qgakliolffnwkymoqvzn-auth-token');
      if(direct){const v=JSON.parse(direct);if(v?.access_token)return v.access_token}
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);if(!k||!/^sb-.*-auth-token$/.test(k))continue;
        const v=JSON.parse(localStorage.getItem(k)||'null');if(v?.access_token)return v.access_token;
      }
    }catch{}
    return '';
  }

  async function roles(){
    if(Array.isArray(window.__A4_CURRENT_ROLES__))return window.__A4_CURRENT_ROLES__;
    const token=authToken();if(!token||!cfg.supabaseUrl||!cfg.supabasePublishableKey)return [];
    const r=await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/get_my_roles`,{method:'POST',headers:{apikey:cfg.supabasePublishableKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'});
    if(!r.ok)return [];
    const d=await r.json().catch(()=>[]);return Array.isArray(d)?d:[];
  }

  function supportIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.8 9.3a3.4 3.4 0 0 1 6.4 1.6c0 2.4-3.2 2.7-3.2 5M12 18h.01"/></svg>'}
  function helpIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h6"/></svg>'}
  function profileIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>'}
  function link(href,label,icon,active=false){return `<a href="${href}" class="${active?'active':''}" title="${label}"><span class="a4-nav-icon">${icon}</span><span class="a4-nav-label">${label}</span></a>`}

  function ensureSupportLink(){
    const nav=document.querySelector('.sidebar nav');if(!nav)return false;
    if(!nav.querySelector('a[href$="support.html"]')){
      const target=[...nav.querySelectorAll('a')].find(a=>/messages\.html/.test(a.getAttribute('href')||''));
      const wrap=document.createElement('div');wrap.innerHTML=link(supportHref,'Поддержка',supportIcon(),/support\.html$/.test(location.pathname));
      const a=wrap.firstElementChild;
      if(target?.nextSibling)nav.insertBefore(a,target.nextSibling);else nav.appendChild(a);
    }
    return true;
  }

  function isolateSupportNav(){
    const nav=document.querySelector('.sidebar nav');if(!nav)return false;
    nav.innerHTML=[
      link('./support.html','Поддержка',supportIcon(),/support\.html$/.test(location.pathname)),
      link('./help.html','Инструкция',helpIcon(),/help\.html$/.test(location.pathname)),
      link('./profile.html','Мой профиль',profileIcon(),/profile\.html$/.test(location.pathname))
    ].join('');
    return true;
  }

  async function apply(){
    const rs=await roles().catch(()=>[]);
    const supportOnly=rs.includes('SUPPORT')&&!rs.includes('ADMIN');
    window.__A4_SUPPORT_ONLY__=supportOnly;
    let tries=0;
    const timer=setInterval(()=>{
      tries++;
      const ok=supportOnly?isolateSupportNav():ensureSupportLink();
      if(ok||tries>30)clearInterval(timer);
    },100);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
})();
