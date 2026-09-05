(()=>{
  if(window.__A4_MOBILE_OAUTH_BRIDGE__)return;
  window.__A4_MOBILE_OAUTH_BRIDGE__=true;
  const RETURN_KEY='a4print_auth_return_to';
  const OAUTH_TARGET_KEY='a4print_oauth_return_target';
  const OAUTH_PROVIDER_KEY='a4print_oauth_provider';
  const OAUTH_RETRY_KEY='a4print_oauth_retry';
  const OAUTH_STARTED_KEY='a4print_oauth_started_at';
  const SUPABASE_URL='https://qgakliolffnwkymoqvzn.supabase.co';

  const ensureAuthUI=()=>new Promise(resolve=>{
    if(window.A4AuthUI)return resolve(window.A4AuthUI);
    const existing=document.querySelector('script[data-a4-auth-ui]');
    if(existing){existing.addEventListener('load',()=>resolve(window.A4AuthUI||null),{once:true});existing.addEventListener('error',()=>resolve(null),{once:true});return}
    const s=document.createElement('script');s.src='/admin/auth-ui.js?v=20260905-3';s.dataset.a4AuthUi='1';s.onload=()=>resolve(window.A4AuthUI||null);s.onerror=()=>resolve(null);document.head.appendChild(s);
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

  const oauthUrl=provider=>{
    const redirectTo=new URL('/mobile/',location.origin).href;
    const q=new URLSearchParams({provider,redirect_to:redirectTo});
    if(provider==='google')q.set('prompt','select_account');
    return `${SUPABASE_URL}/auth/v1/authorize?${q.toString()}`;
  };

  ensureAuthUI().then(ui=>ui?.apply?.('login')).catch(()=>{});

  document.addEventListener('click',async event=>{
    const button=event.target.closest?.('[data-provider]');
    if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    const provider=String(button.dataset.provider||'').trim();if(!provider)return;
    const ui=await ensureAuthUI();if(ui&&!(await ui.isEnabled('login',provider)))return;
    const target=safeTarget();
    try{
      const last=Number(localStorage.getItem(OAUTH_STARTED_KEY)||0);
      if(last&&Date.now()-last<1800)return;
      localStorage.setItem(RETURN_KEY,target);
      localStorage.setItem(OAUTH_TARGET_KEY,target);
      localStorage.setItem(OAUTH_PROVIDER_KEY,provider);
      localStorage.setItem(OAUTH_RETRY_KEY,'0');
      localStorage.setItem(OAUTH_STARTED_KEY,String(Date.now()));
      sessionStorage.setItem(RETURN_KEY,target);
      sessionStorage.setItem(OAUTH_TARGET_KEY,target);
    }catch{}
    button.disabled=true;button.dataset.oldHtml=button.innerHTML;button.textContent=provider==='google'?'Открываем Google…':'Открываем вход…';
    location.assign(oauthUrl(provider));
  },true);
})();
