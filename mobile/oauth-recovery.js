(()=>{
  if(window.__A4_OAUTH_RECOVERY__)return;
  window.__A4_OAUTH_RECOVERY__=true;
  const SUPABASE_URL='https://qgakliolffnwkymoqvzn.supabase.co';
  const OAUTH_PROVIDER_KEY='a4print_oauth_provider';
  const OAUTH_RETRY_KEY='a4print_oauth_retry';
  const OAUTH_STARTED_KEY='a4print_oauth_started_at';
  const params=new URLSearchParams(location.search);
  const hash=new URLSearchParams(String(location.hash||'').replace(/^#/,''));
  hash.forEach((v,k)=>params.set(k,v));
  const access=params.get('access_token');
  const rawError=[params.get('error_code'),params.get('error_description'),params.get('error')].filter(Boolean).join(' ');
  if(access){
    try{localStorage.removeItem(OAUTH_RETRY_KEY);localStorage.removeItem(OAUTH_STARTED_KEY)}catch{}
    return;
  }
  if(!/oauth state not found|state.*expired|bad_oauth_state/i.test(rawError))return;
  let retry=0,provider='google';
  try{
    retry=Number(localStorage.getItem(OAUTH_RETRY_KEY)||0);
    provider=localStorage.getItem(OAUTH_PROVIDER_KEY)||'google';
  }catch{}
  if(retry>=1)return;
  try{
    localStorage.setItem(OAUTH_RETRY_KEY,'1');
    localStorage.setItem(OAUTH_STARTED_KEY,String(Date.now()));
  }catch{}
  const q=new URLSearchParams({provider,redirect_to:new URL('/mobile/',location.origin).href});
  if(provider==='google')q.set('prompt','select_account');
  location.replace(`${SUPABASE_URL}/auth/v1/authorize?${q.toString()}`);
})();
