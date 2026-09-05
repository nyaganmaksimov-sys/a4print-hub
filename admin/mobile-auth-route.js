(()=>{
  const mobile=window.matchMedia?.('(max-width:900px)').matches||/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent||'');
  if(!mobile)return;
  const RETURN_KEY='a4print_auth_return_to';
  try{
    const u=new URL(location.href);
    const raw=u.searchParams.get('returnTo')||'';
    let target='/mobile/';
    if(raw){
      try{
        const r=new URL(raw,location.origin);
        if(r.origin===location.origin&&r.pathname.startsWith('/mobile/'))target=r.pathname+r.search+r.hash;
        else if(r.origin===location.origin&&r.pathname.startsWith('/admin/')&&!/\/admin\/login\.html$/.test(r.pathname))target=r.pathname+r.search+r.hash;
      }catch{}
    }
    // Старый A4 Chat раньше возвращал авторизацию на /chat/start.html.
    // На телефоне теперь всегда продолжаем в основном A4PRINT HUB.
    if(!raw||/^\/chat\/start\.html/i.test(raw)){
      u.searchParams.set('returnTo','/mobile/');
      history.replaceState({},'',u.pathname+u.search+u.hash);
      target='/mobile/';
    }
    localStorage.setItem(RETURN_KEY,target);
  }catch{}
})();
