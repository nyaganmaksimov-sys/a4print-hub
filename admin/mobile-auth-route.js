(()=>{
  const mobile=window.matchMedia?.('(max-width:900px)').matches||/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent||'');
  if(!mobile)return;

  const SUPABASE_URL='https://qgakliolffnwkymoqvzn.supabase.co';
  const RETURN_KEY='a4print_auth_return_to';
  const OAUTH_TARGET_KEY='a4print_oauth_return_target';

  const safeTarget=raw=>{
    if(!raw)return '/mobile/';
    try{
      const r=new URL(raw,location.origin);
      if(r.origin!==location.origin)return '/mobile/';
      if(/^\/chat\/start\.html/i.test(r.pathname))return '/mobile/';
      if(r.pathname.startsWith('/mobile/'))return r.pathname+r.search+r.hash;
      if(r.pathname.startsWith('/admin/')&&!/\/admin\/login\.html$/.test(r.pathname))return r.pathname+r.search+r.hash;
    }catch{}
    return '/mobile/';
  };

  const remember=target=>{
    try{
      localStorage.setItem(RETURN_KEY,target);
      localStorage.setItem(OAUTH_TARGET_KEY,target);
      sessionStorage.setItem(RETURN_KEY,target);
      sessionStorage.setItem(OAUTH_TARGET_KEY,target);
    }catch{}
  };

  try{
    const u=new URL(location.href);
    const target=safeTarget(u.searchParams.get('returnTo'));
    remember(target);

    // Старые закешированные кнопки мобильного входа могли отправлять сюда
    // с startProvider. Перехватываем такой маршрут и сразу запускаем OAuth
    // с возвратом в основной мобильный HUB.
    const startProvider=String(u.searchParams.get('startProvider')||'').trim();
    if(startProvider){
      const callback=new URL('/mobile/',location.origin).href;
      const auth=new URL('/auth/v1/authorize',SUPABASE_URL);
      auth.searchParams.set('provider',startProvider);
      auth.searchParams.set('redirect_to',callback);
      location.replace(auth.href);
      return;
    }

    // Если старый OAuth уже вернул токены в hash на /admin/login.html,
    // переносим их в /mobile/, чтобы app-v3.js завершил вход без второго круга.
    if(/(?:^|[&#])access_token=/.test(location.hash)){
      location.replace('/mobile/'+location.hash);
      return;
    }

    // Обычная страница входа на телефоне больше не нужна: вся мобильная
    // авторизация живёт в /mobile/. OAuth callback без hash оставляем login.js.
    if(u.searchParams.get('oauth')!=='1'){
      const next=new URL('/mobile/',location.origin);
      if(target!=='/mobile/')next.searchParams.set('return',target);
      location.replace(next.href);
    }
  }catch{}
})();
