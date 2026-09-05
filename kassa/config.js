window.A4PRINT_CONFIG={
  supabaseUrl:'https://qgakliolffnwkymoqvzn.supabase.co',
  supabasePublishableKey:'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu',
  apiBaseUrl:'https://a4print-hub-api.onrender.com'
};
window.A4SupabaseFetch=async function(input,init){
  const cfg=window.A4PRINT_CONFIG||{};let request;
  try{request=new Request(input,init)}catch{return fetch(input,init)}
  try{return await fetch(request.clone())}catch(directError){
    try{
      const target=new URL(request.url),origin=new URL(cfg.supabaseUrl).origin,api=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
      if(!api||target.origin!==origin||!/^\/(auth|rest|functions)\/v1(?:\/|$)/.test(target.pathname))throw directError;
      const method=request.method.toUpperCase(),options={method,headers:new Headers(request.headers),cache:'no-store',credentials:'omit',redirect:'follow'};
      if(!['GET','HEAD'].includes(method))options.body=await request.clone().arrayBuffer();
      return await fetch(`${api}/api/v1/supabase${target.pathname}${target.search}`,options);
    }catch{throw directError}
  }
};
window.addEventListener('DOMContentLoaded',()=>{
  if(document.querySelector('script[data-a4-operator-selector]'))return;
  const s=document.createElement('script');
  s.src='./shift-operator.js?v=20260905-operator1';
  s.dataset.a4OperatorSelector='1';
  document.body.appendChild(s);
},{once:true});
