(()=>{
  if(window.__A4_MOBILE_OAUTH_BRIDGE__)return;
  window.__A4_MOBILE_OAUTH_BRIDGE__=true;

  const safeTarget=()=>{
    const raw=new URLSearchParams(location.search).get('return')||'/mobile/';
    try{
      const u=new URL(raw,location.origin);
      if(u.origin!==location.origin)return '/mobile/';
      if(!u.pathname.startsWith('/mobile/')&&!u.pathname.startsWith('/admin/'))return '/mobile/';
      return u.pathname+u.search+u.hash;
    }catch{return '/mobile/'}
  };

  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-provider]');
    if(!button)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const provider=String(button.dataset.provider||'').trim();
    if(!provider)return;
    button.disabled=true;
    const old=button.innerHTML;
    button.dataset.oldHtml=old;
    button.textContent=provider==='google'?'Открываем Google…':'Открываем вход…';
    const q=new URLSearchParams({startProvider:provider,returnTo:safeTarget()});
    location.assign(`/admin/login.html?${q.toString()}`);
  },true);
})();
