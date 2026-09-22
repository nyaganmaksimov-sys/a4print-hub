(()=>{
  if(window.__A4_NAV_HEALTH__)return;
  window.__A4_NAV_HEALTH__=true;

  function ensureHealthDot(){
    const logo=document.querySelector('.sidebar .hub-logo-wrap,.sidebar .brand');
    if(!logo)return null;
    let dot=logo.querySelector('.a4-system-health-dot');
    if(dot)return dot;
    dot=document.createElement('span');
    dot.className='a4-system-health-dot checking';
    dot.title='Проверка подключения...';
    dot.setAttribute('aria-label','Проверка подключения');
    dot.setAttribute('role','status');
    logo.appendChild(dot);
    return dot;
  }

  function getAccessToken(){
    for(const store of [localStorage,sessionStorage]){
      try{
        for(let i=0;i<store.length;i++){
          const key=store.key(i)||'';
          if(!/^sb-.*-auth-token$/.test(key))continue;
          const raw=store.getItem(key);
          if(!raw)continue;
          const value=JSON.parse(raw);
          const token=value?.access_token||value?.currentSession?.access_token||value?.session?.access_token||'';
          if(token)return token;
        }
      }catch{}
    }
    return '';
  }

  function setHealth(state,message){
    const dot=ensureHealthDot();
    if(!dot)return;
    dot.className='a4-system-health-dot '+state;
    dot.title=message;
    dot.setAttribute('aria-label',message);
  }

  async function checkSystemHealth(){
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
      setHealth('checking','Ожидается авторизация HUB');
      return;
    }

    setHealth('checking','Проверка базы данных и API HUB...');
    try{
      const dbFetch=window.A4SupabaseFetch||window.fetch.bind(window);
      const results=await Promise.allSettled([
        dbFetch(supabaseUrl+'/rest/v1/orders?select=id&limit=1',{
          headers:{apikey:key,Authorization:'Bearer '+token,Accept:'application/json'},
          cache:'no-store'
        }),
        fetch(apiBase+'/api/v1/health',{cache:'no-store'})
      ]);
      const dbRes=results[0],apiRes=results[1];
      const dbOk=dbRes.status==='fulfilled'&&dbRes.value.ok;
      let apiOk=false;
      let apiStatus='недоступен';
      if(apiRes.status==='fulfilled'){
        apiStatus='HTTP '+apiRes.value.status;
        if(apiRes.value.ok){
          const data=await apiRes.value.clone().json().catch(()=>({}));
          apiOk=data?.status==='ok'&&data?.databaseConfigured===true;
        }
      }

      if(dbOk&&apiOk){
        const now=new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
        setHealth('ok','База данных и API подключены · '+now);
        return;
      }

      const parts=[];
      if(!dbOk)parts.push(dbRes.status==='fulfilled'?'База: HTTP '+dbRes.value.status:'База недоступна');
      if(!apiOk)parts.push('API: '+apiStatus);
      setHealth('error',parts.join(' · ')||'Ошибка подключения к системе');
    }catch(error){
      setHealth('error','Нет связи: '+(error?.message||'ошибка сети'));
    }
  }

  function init(){
    ensureHealthDot();
    setTimeout(checkSystemHealth,300);
    setInterval(checkSystemHealth,60000);
    window.addEventListener('online',checkSystemHealth);
    window.addEventListener('offline',()=>setHealth('error','Нет подключения к интернету'));
    window.A4Health={check:checkSystemHealth};
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
