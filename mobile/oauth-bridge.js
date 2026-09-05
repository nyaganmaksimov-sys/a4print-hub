(()=>{
  if(window.__A4_MOBILE_OAUTH_BRIDGE__)return;
  window.__A4_MOBILE_OAUTH_BRIDGE__=true;
  const RETURN_KEY='a4print_auth_return_to';

  const ensureAuthUI=()=>new Promise(resolve=>{
    if(window.A4AuthUI)return resolve(window.A4AuthUI);
    const existing=document.querySelector('script[data-a4-auth-ui]');
    if(existing){existing.addEventListener('load',()=>resolve(window.A4AuthUI||null),{once:true});existing.addEventListener('error',()=>resolve(null),{once:true});return}
    const s=document.createElement('script');s.src='/admin/auth-ui.js?v=20260905-2';s.dataset.a4AuthUi='1';s.onload=()=>resolve(window.A4AuthUI||null);s.onerror=()=>resolve(null);document.head.appendChild(s);
  });

  const safeTarget=()=>{
    const raw=new URLSearchParams(location.search).get('return')||'/mobile/';
    try{
      const u=new URL(raw,location.origin);
      if(u.origin!==location.origin)return '/mobile/';
      if(!u.pathname.startsWith('/mobile/')&&!u.pathname.startsWith('/admin/'))return '/mobile/';
      return u.pathname+u.search+u.hash;
    }catch{return '/mobile/'}
  };

  ensureAuthUI().then(ui=>ui?.apply?.('login')).catch(()=>{});

  document.addEventListener('click',async event=>{
    const button=event.target.closest?.('[data-provider]');
    if(!button)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const provider=String(button.dataset.provider||'').trim();
    if(!provider)return;
    const ui=await ensureAuthUI();
    if(ui&&!(await ui.isEnabled('login',provider)))return;
    const target=safeTarget();
    try{localStorage.setItem(RETURN_KEY,target);sessionStorage.setItem(RETURN_KEY,target)}catch{}
    button.disabled=true;
    button.dataset.oldHtml=button.innerHTML;
    button.textContent=provider==='google'?'Открываем Google…':'Открываем вход…';
    const q=new URLSearchParams({startProvider:provider,returnTo:target});
    location.assign(`/admin/login.html?${q.toString()}`);
  },true);
})();
