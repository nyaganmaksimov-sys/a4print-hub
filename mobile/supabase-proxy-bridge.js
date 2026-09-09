(()=>{
  if(window.__A4_MOBILE_SUPABASE_PROXY__)return;
  window.__A4_MOBILE_SUPABASE_PROXY__=true;

  const SUPABASE_ORIGIN='https://qgakliolffnwkymoqvzn.supabase.co';
  const API_ORIGINS=['https://api.a4print-hub.ru','https://a4print-hub-api.onrender.com'];
  const nativeFetch=window.fetch.bind(window);
  const PREF_KEY='a4_mobile_api_origin';
  const TIMEOUT=5500;

  function preferred(){try{const v=localStorage.getItem(PREF_KEY);return API_ORIGINS.includes(v)?v:null}catch{return null}}
  function remember(v){try{if(v)localStorage.setItem(PREF_KEY,v)}catch{}}
  function isSupabaseRequest(value){
    try{
      const u=new URL(value,location.href);
      if(u.origin!==SUPABASE_ORIGIN)return null;
      if(!/^\/(auth|rest|functions)\/v1(?:\/|$)/.test(u.pathname))return null;
      return u;
    }catch{return null}
  }
  function withTimeout(promiseFactory,ms=TIMEOUT){
    const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
    return Promise.resolve().then(()=>promiseFactory(c.signal)).finally(()=>clearTimeout(t));
  }
  async function direct(req){return withTimeout(signal=>nativeFetch(new Request(req,{signal}))) }
  async function proxied(req,url,origin){
    const headers=new Headers(req.headers);
    const method=req.method.toUpperCase();
    const options={method,headers,cache:'no-store',credentials:'omit',redirect:'follow'};
    if(!['GET','HEAD'].includes(method))options.body=await req.clone().arrayBuffer();
    return withTimeout(async signal=>{
      options.signal=signal;
      const r=await nativeFetch(`${origin}/api/v1/supabase${url.pathname}${url.search}`,options);
      if(r.ok||r.status<500){remember(origin);return r}
      throw new Error(`HTTP ${r.status}`);
    });
  }
  async function firstSuccess(tasks){
    if(typeof Promise.any==='function')return Promise.any(tasks.map(fn=>fn()));
    return new Promise((resolve,reject)=>{let left=tasks.length,last;tasks.forEach(fn=>fn().then(resolve,e=>{last=e;if(--left===0)reject(last)}))});
  }

  window.fetch=async function a4MobileFetch(input,init){
    let req;
    try{req=input instanceof Request?new Request(input,init):new Request(input,init)}catch{return nativeFetch(input,init)}
    const url=isSupabaseRequest(req.url);
    if(!url)return nativeFetch(req);

    const method=req.method.toUpperCase();
    const order=[preferred(),...API_ORIGINS].filter((v,i,a)=>v&&a.indexOf(v)===i);
    const isPassword=method==='POST'&&url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='password';
    const safeRace=['GET','HEAD'].includes(method)||isPassword;

    if(safeRace){
      const tasks=order.map(origin=>()=>proxied(req.clone(),url,origin));
      tasks.push(()=>direct(req.clone()));
      return firstSuccess(tasks);
    }

    // Refresh and other writes are sequential to avoid duplicate mutations.
    let last;
    for(const origin of order){
      try{return await proxied(req.clone(),url,origin)}catch(e){last=e}
    }
    try{return await direct(req.clone())}catch(e){throw last||e}
  };
})();
