// Route Supabase Storage through A4PRINT HUB API so uploads/downloads work
// on networks where direct access to *.supabase.co is unavailable.
(function installStorageNetworkFix(){
  if(window.__A4_STORAGE_NETWORK_FIX__)return;
  window.__A4_STORAGE_NETWORK_FIX__=true;

  const cfg=window.A4PRINT_CONFIG||{};
  const previous=window.A4SupabaseFetch;
  const nativeFetch=window.fetch.bind(window);
  const apiOrigins=['https://api.a4print-hub.ru',String(cfg.apiBaseUrl||'').replace(/\/$/,''),'https://a4print-hub-api.onrender.com'].filter((v,i,a)=>v&&a.indexOf(v)===i);
  let supabaseOrigin='';
  try{supabaseOrigin=new URL(cfg.supabaseUrl).origin}catch{}

  async function through(origin,request,target,timeoutMs){
    const headers=new Headers(request.headers);
    const method=request.method.toUpperCase();
    const options={method,headers,cache:'no-store',credentials:'omit',redirect:'follow'};
    if(!['GET','HEAD'].includes(method))options.body=await request.clone().arrayBuffer();
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    options.signal=controller.signal;
    try{return await nativeFetch(`${origin}/api/v1/supabase${target.pathname}${target.search}`,options)}
    finally{clearTimeout(timer)}
  }

  window.A4SupabaseFetch=async function a4SupabaseStorageFetch(input,init){
    let request,target;
    try{request=new Request(input,init);target=new URL(request.url)}catch{return previous?previous(input,init):nativeFetch(input,init)}
    const isStorage=target.origin===supabaseOrigin&&/^\/storage\/v1(?:\/|$)/.test(target.pathname);
    if(!isStorage)return previous?previous(request):nativeFetch(request);

    let lastError;
    for(const origin of apiOrigins){
      try{
        const response=await through(origin,request,target,65000);
        if(response.ok||response.status<500)return response;
        lastError=new Error(`Storage proxy HTTP ${response.status}`);
      }catch(error){lastError=error}
    }
    // Last-resort direct request for networks where Supabase itself is reachable.
    try{return await nativeFetch(request.clone())}catch{}
    throw lastError||new Error('Storage proxy unavailable');
  };
})();
