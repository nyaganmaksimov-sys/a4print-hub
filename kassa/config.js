window.A4PRINT_CONFIG={
  supabaseUrl:'https://qgakliolffnwkymoqvzn.supabase.co',
  supabasePublishableKey:'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu',
  apiBaseUrl:'https://api.a4print-hub.ru'
};

// Jarvis voice/assistant modules stay off until A4-owned infrastructure is ready.
window.A4PRINT_FEATURES={...(window.A4PRINT_FEATURES||{}),jarvis:false};
window.__A4_JARVIS_DISABLED__=true;
try{localStorage.setItem('a4print_jarvis_enabled_v1','0')}catch{}

// KASSA: use our API proxy first. Every network branch is time-bounded so a
// blocked Supabase/Render hostname can never freeze the whole POS UI.
window.A4SupabaseFetch=async function a4KassaSupabaseFetch(input,init){
  const cfg=window.A4PRINT_CONFIG||{};
  let request;
  try{request=new Request(input,init)}catch{return fetch(input,init)}
  let target;
  try{target=new URL(request.url)}catch{return fetch(request)}
  let supabaseOrigin='';
  try{supabaseOrigin=new URL(cfg.supabaseUrl).origin}catch{}
  const isSupabase=target.origin===supabaseOrigin&&/^\/(auth|rest|functions)\/v1(?:\/|$)/.test(target.pathname);
  if(!isSupabase)return fetch(request);

  const method=request.method.toUpperCase();
  let pathname=target.pathname;
  let bodyBuffer=null;
  if(method==='POST'&&pathname==='/rest/v1/rpc/record_pos_sale'){
    try{
      const raw=await request.clone().text();
      const payload=raw?JSON.parse(raw):{};
      if(!Object.prototype.hasOwnProperty.call(payload,'p_order_id'))payload.p_order_id=null;
      pathname='/rest/v1/rpc/record_pos_sale_v2';
      bodyBuffer=new TextEncoder().encode(JSON.stringify(payload));
    }catch(error){console.warn('A4PRINT KASSA order bridge payload:',error)}
  }

  const allowedBases=[
    'https://api.a4print-hub.ru',
    String(cfg.apiBaseUrl||'').replace(/\/$/,''),
    'https://a4print-hub-api.onrender.com'
  ].filter((v,i,a)=>v&&a.indexOf(v)===i);
  const preferred=String(window.A4KassaApiPreferred||'');
  const proxyBases=[...(allowedBases.includes(preferred)?[preferred]:[]),...allowedBases]
    .filter((v,i,a)=>a.indexOf(v)===i);

  async function fetchWithTimeout(url,options={},ms=4500){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),ms);
    try{return await fetch(url,{...options,signal:controller.signal})}
    finally{clearTimeout(timer)}
  }

  async function proxy(base){
    const headers=new Headers(request.headers);
    const options={method,headers,cache:'no-store',credentials:'omit',redirect:'follow'};
    if(!['GET','HEAD'].includes(method))options.body=bodyBuffer||await request.clone().arrayBuffer();
    const response=await fetchWithTimeout(`${base}/api/v1/supabase${pathname}${target.search}`,options,9000);
    if(response.ok)window.A4KassaApiPreferred=base;
    return response;
  }

  async function direct(){
    const clone=request.clone();
    const options={method:clone.method,headers:new Headers(clone.headers),cache:'no-store',credentials:'omit',redirect:'follow'};
    if(!['GET','HEAD'].includes(method))options.body=await clone.arrayBuffer();
    return fetchWithTimeout(clone.url,options,3200);
  }

  // Reads/auth may race safe routes. Financial writes must stay single-route.
  const riskyWrite=method!=='GET'&&method!=='HEAD';
  // Never race multiple copies of the same POST. Auth refresh can rotate tokens;
  // RPC writes may have effects even when the HTTP response is lost.
  if(!riskyWrite){
    // Sequential fallback avoids Promise.any AggregateError, redundant bursts,
    // and opaque login failures when the ISP blocks every route.
    let lastError=null;
    let serverResponse=null;
    for(const base of proxyBases){
      try{
        const response=await proxy(base);
        if(response.ok)return response;
        if(response.status<500)return response;
        serverResponse=response;
        lastError=new Error('API '+base+': HTTP '+response.status);
      }catch(error){lastError=error}
    }
    try{return await direct()}
    catch(error){
      console.warn('KASSA all Supabase GET routes failed',lastError,error);
      if(serverResponse)return serverResponse;
      throw new Error('AUTH_NETWORK_UNAVAILABLE: сервер авторизации недоступен без VPN');
    }
  }

  // The original API may be inaccessible on an ISP without VPN. For login
  // password grants (not token refresh), try the alternate host sequentially.
  // Never race or repeat refresh tokens and financial RPC writes.
  if(method==='POST'&&pathname==='/auth/v1/token'&&target.searchParams.get('grant_type')==='password'){
    let lastError=null;
    for(const base of proxyBases){
      try{
        const response=await proxy(base);
        if(response.ok||response.status<500)return response;
        lastError=new Error('HTTP '+response.status);
      }catch(error){lastError=error}
    }
    throw lastError||new Error('AUTH_UNREACHABLE');
  }
  return proxy(proxyBases[0]);
};

window.addEventListener('DOMContentLoaded',()=>{if(document.querySelector('script[data-a4-operator-selector]'))return;const s=document.createElement('script');s.src='./shift-operator.js?v=20260905-operator1';s.dataset.a4OperatorSelector='1';document.body.appendChild(s)},{once:true});