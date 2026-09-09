window.A4PRINT_CONFIG={
  supabaseUrl:'https://qgakliolffnwkymoqvzn.supabase.co',
  supabasePublishableKey:'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu',
  apiBaseUrl:'https://api.a4print-hub.ru'
};

// KASSA must not depend on direct mobile/browser access to *.supabase.co.
// Route Auth / REST / Functions through the A4PRINT HUB backend immediately.
window.A4SupabaseFetch=async function a4KassaSupabaseFetch(input,init){
  const cfg=window.A4PRINT_CONFIG||{};
  let request;
  try{request=new Request(input,init)}catch{return fetch(input,init)}
  try{
    const target=new URL(request.url);
    const supabaseOrigin=new URL(cfg.supabaseUrl).origin;
    const api=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
    const isSupabase=target.origin===supabaseOrigin&&/^\/(auth|rest|functions)\/v1(?:\/|$)/.test(target.pathname);
    if(!api||!isSupabase)return fetch(request);
    const method=request.method.toUpperCase();let pathname=target.pathname;let bodyBuffer=null;
    if(method==='POST'&&pathname==='/rest/v1/rpc/record_pos_sale'){
      try{const raw=await request.clone().text();const payload=raw?JSON.parse(raw):{};if(!Object.prototype.hasOwnProperty.call(payload,'p_order_id'))payload.p_order_id=null;pathname='/rest/v1/rpc/record_pos_sale_v2';bodyBuffer=new TextEncoder().encode(JSON.stringify(payload))}catch(error){console.warn('A4PRINT KASSA order bridge payload:',error)}
    }
    const options={method,headers:new Headers(request.headers),cache:'no-store',credentials:'omit',redirect:'follow',signal:request.signal};
    if(!['GET','HEAD'].includes(method))options.body=bodyBuffer||await request.clone().arrayBuffer();
    return await fetch(`${api}/api/v1/supabase${pathname}${target.search}`,options);
  }catch(error){console.warn('A4PRINT KASSA Supabase proxy failed',error);throw error}
};
window.addEventListener('DOMContentLoaded',()=>{if(document.querySelector('script[data-a4-operator-selector]'))return;const s=document.createElement('script');s.src='./shift-operator.js?v=20260905-operator1';s.dataset.a4OperatorSelector='1';document.body.appendChild(s)},{once:true});
