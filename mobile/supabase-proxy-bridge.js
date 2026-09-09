(()=>{
  if(window.__A4_MOBILE_SUPABASE_PROXY__)return;
  window.__A4_MOBILE_SUPABASE_PROXY__=true;

  const SUPABASE_ORIGIN='https://qgakliolffnwkymoqvzn.supabase.co';
  const API_BASE='https://a4print-hub-api.onrender.com';
  const nativeFetch=window.fetch.bind(window);

  function proxyUrl(value){
    try{
      const url=new URL(value,location.href);
      if(url.origin!==SUPABASE_ORIGIN)return null;
      if(!/^\/(auth|rest|functions)\/v1(?:\/|$)/.test(url.pathname))return null;
      return `${API_BASE}/api/v1/supabase${url.pathname}${url.search}`;
    }catch{return null}
  }

  window.fetch=async function a4MobileFetch(input,init){
    let request;
    try{request=input instanceof Request?input:new Request(input,init)}catch{return nativeFetch(input,init)}
    const target=proxyUrl(request.url);
    if(!target)return nativeFetch(request);

    const headers=new Headers(request.headers);
    const options={
      method:request.method,
      headers,
      cache:'no-store',
      credentials:'omit',
      redirect:'follow'
    };
    if(!['GET','HEAD'].includes(request.method.toUpperCase()))options.body=await request.clone().arrayBuffer();
    return nativeFetch(target,options);
  };
})();
