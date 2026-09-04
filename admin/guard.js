const config = window.A4PRINT_CONFIG || {};
const url = config.supabaseUrl || 'https://qgakliolffnwkymoqvzn.supabase.co';
const key = config.supabasePublishableKey || '';

let createClient = window.supabase?.createClient;
if (!createClient) {
  const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  createClient = mod.createClient;
}
const supabase = createClient(url, key);

const page = location.pathname.split('/').pop();
const params = new URLSearchParams(location.search);
const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const mobileContext = params.get('mobile') === '1' || params.get('app') === '1' || (standalone && window.matchMedia?.('(max-width:900px)').matches);
const publicPages = new Set(['login.html','register.html','pending.html','reset-password.html']);

function mobileLogin(reason='session') {
  const ret = location.pathname + location.search + location.hash;
  location.replace(`/mobile/?login=1&reason=${encodeURIComponent(reason)}&return=${encodeURIComponent(ret)}`);
}

if (!publicPages.has(page)) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    if (mobileContext) mobileLogin('session');
    else if (page === 'messages.html') location.replace('/chat/start.html?login=1');
    else location.replace('./login.html');
  } else if (page !== 'profile.html' && page !== 'messages.html') {
    const { data, error } = await supabase.rpc('get_my_staff_profile');
    if (error || data?.status !== 'ACTIVE') {
      if (mobileContext) mobileLogin(data?.status || 'access');
      else if (data?.status === 'UNREGISTERED') location.replace('./register.html');
      else location.replace('./pending.html');
    }
  }
}

export { supabase };
