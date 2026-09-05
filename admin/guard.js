const config = window.A4PRINT_CONFIG || {};
const url = config.supabaseUrl || 'https://qgakliolffnwkymoqvzn.supabase.co';
const key = config.supabasePublishableKey || 'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu';

async function loadLocalSupabase() {
  if (window.supabase?.createClient) return window.supabase.createClient;
  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-a4-supabase-local]');
    if (existing) {
      if (window.supabase?.createClient) return resolve();
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('Не удалось загрузить модуль авторизации.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = '/admin/vendor/supabase.js?v=20260905-1';
    script.dataset.a4SupabaseLocal = '1';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Не удалось загрузить модуль авторизации.'));
    document.head.appendChild(script);
  });
  if (!window.supabase?.createClient) throw new Error('Модуль авторизации загружен некорректно.');
  return window.supabase.createClient;
}

const createClient = await loadLocalSupabase();
const supabase = createClient(url, key, {
  global: { fetch: window.A4SupabaseFetch || fetch },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

const page = location.pathname.split('/').pop();
const params = new URLSearchParams(location.search);
const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const mobileContext = params.get('mobile') === '1' || params.get('app') === '1' || (standalone && window.matchMedia?.('(max-width:900px)').matches);
const publicPages = new Set(['login.html','register.html','pending.html','reset-password.html']);
const supportAllowedPages = new Set(['support.html','help.html','profile.html']);

function mobileLogin(reason='session') {
  const ret = location.pathname + location.search + location.hash;
  location.replace(`/mobile/?login=1&reason=${encodeURIComponent(reason)}&return=${encodeURIComponent(ret)}`);
}
function login(reason='session') {
  if (mobileContext) mobileLogin(reason);
  else if (page === 'messages.html') location.replace('/chat/start.html?login=1');
  else {
    const ret = location.pathname + location.search + location.hash;
    location.replace(`./login.html?returnTo=${encodeURIComponent(ret)}`);
  }
}

async function currentSession() {
  try {
    let { data: { session }, error } = await supabase.auth.getSession();
    if (error) console.warn('Auth session read failed', error);
    if (!session) return null;

    let userResult = await supabase.auth.getUser();
    if (userResult.error && /expired|jwt|token/i.test(String(userResult.error.message || ''))) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error || !refreshed.data.session) return null;
      session = refreshed.data.session;
      userResult = await supabase.auth.getUser();
    }
    if (userResult.error || !userResult.data.user) return null;
    return session;
  } catch (e) {
    console.warn('Auth validation failed', e);
    return null;
  }
}

if (!publicPages.has(page)) {
  const session = await currentSession();
  if (!session) {
    login('session');
  } else {
    if (page !== 'profile.html' && page !== 'messages.html') {
      const { data, error } = await supabase.rpc('get_my_staff_profile');
      if (error || data?.status !== 'ACTIVE') {
        if (mobileContext) mobileLogin(data?.status || 'access');
        else if (data?.status === 'UNREGISTERED') location.replace('./register.html');
        else location.replace('./pending.html');
      }
    }

    try {
      const { data: roleData, error: roleError } = await supabase.rpc('get_my_roles');
      if (!roleError && Array.isArray(roleData)) {
        const supportOnly = roleData.includes('SUPPORT') && !roleData.includes('ADMIN');
        window.__A4_SUPPORT_ONLY__ = supportOnly;
        window.__A4_CURRENT_ROLES__ = roleData;
        if (supportOnly && !supportAllowedPages.has(page)) {
          location.replace(`/admin/support.html${mobileContext?'?mobile=1':''}`);
        }
      }
    } catch (e) {
      console.warn('Support role check failed', e);
    }
  }
}

export { supabase };
