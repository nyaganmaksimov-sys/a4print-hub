window.A4PRINT_CONFIG={
  supabaseUrl:'https://qgakliolffnwkymoqvzn.supabase.co',
  supabasePublishableKey:'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu',
  apiBaseUrl:'https://a4print-hub-api.onrender.com'
};

// KASSA: proxy Supabase through HUB first, but never let a blocked API domain
// prevent login. If the proxy path is unavailable, fall back to direct Supabase.
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

  const proxyBases=[
    'https://api.a4print-hub.ru',
    String(cfg.apiBaseUrl||'').replace(/\/$/,''),
    'https://a4print-hub-api.onrender.com'
  ].filter((v,i,a)=>v&&a.indexOf(v)===i);

  async function proxy(base){
    const headers=new Headers(request.headers);
    const options={method,headers,cache:'no-store',credentials:'omit',redirect:'follow'};
    if(!['GET','HEAD'].includes(method))options.body=bodyBuffer||await request.clone().arrayBuffer();
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    options.signal=controller.signal;
    try{return await fetch(`${base}/api/v1/supabase${pathname}${target.search}`,options)}
    finally{clearTimeout(timer)}
  }

  // Reads/auth can safely race routes. Financial writes must stay single-route.
  const riskyWrite=method!=='GET'&&method!=='HEAD'&&/record_pos_sale|record_pos_return|cashout|shift/i.test(pathname);
  if(!riskyWrite){
    const jobs=proxyBases.map(base=>proxy(base).then(r=>{if(!r.ok&&r.status>=500)throw new Error(`HTTP ${r.status}`);return r}));
    try{
      if(typeof Promise.any==='function')return await Promise.any(jobs);
      return await new Promise((resolve,reject)=>{let left=jobs.length,last;jobs.forEach(p=>p.then(resolve,e=>{last=e;if(--left===0)reject(last)}))});
    }catch(proxyError){
      try{return await fetch(request.clone())}
      catch(directError){console.warn('A4PRINT KASSA Supabase proxy/direct failed',proxyError,directError);throw proxyError}
    }
  }

  try{return await proxy(proxyBases[0])}
  catch(error){throw error}
};

window.addEventListener('DOMContentLoaded',()=>{if(document.querySelector('script[data-a4-operator-selector]'))return;const s=document.createElement('script');s.src='./shift-operator.js?v=20260905-operator1';s.dataset.a4OperatorSelector='1';document.body.appendChild(s)},{once:true});
