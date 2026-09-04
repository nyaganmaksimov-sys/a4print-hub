// A4PRINT HUB frontend configuration.
// Publishable keys are intended for browser use with Supabase RLS enabled.
// NEVER put a service_role/secret key here.
window.A4PRINT_CONFIG = {
  supabaseUrl: 'https://qgakliolffnwkymoqvzn.supabase.co',
  supabasePublishableKey: 'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu',
  apiBaseUrl: 'https://a4print-hub-api.onrender.com'
};

// The legacy employees UI still calls /api/v1/users on the Render API.
// Route only those staff-management calls through the protected Supabase Edge Function.
(function installStaffAdminFetchBridge(){
  const cfg = window.A4PRINT_CONFIG;
  if (!cfg?.supabaseUrl || !cfg?.supabasePublishableKey || !cfg?.apiBaseUrl) return;
  const nativeFetch = window.fetch.bind(window);
  const legacyPrefix = cfg.apiBaseUrl.replace(/\/$/, '') + '/api/v1/users';
  const edgeUrl = cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/staff-admin';

  window.fetch = async function(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url;
    if (!url || !url.startsWith(legacyPrefix)) return nativeFetch(input, init);

    const path = url.slice(legacyPrefix.length);
    const method = String(init.method || 'GET').toUpperCase();
    let requestBody = {};
    try { requestBody = init.body ? JSON.parse(init.body) : {}; } catch (_) {}

    let body;
    if (method === 'GET' && (path === '/roles' || path === '/roles/')) body = { action: 'roles' };
    else if (method === 'GET' && (!path || path === '/')) body = { action: 'list' };
    else if (method === 'POST' && (!path || path === '/')) body = { action: 'create', payload: requestBody };
    else if (method === 'PATCH' && /^\/[0-9a-f-]+\/?$/i.test(path)) body = { action: 'update', user_id: path.replace(/^\//, '').replace(/\/$/, ''), payload: requestBody };
    else return nativeFetch(input, init);

    const sourceHeaders = new Headers(init.headers || (typeof input !== 'string' ? input?.headers : undefined) || {});
    const authorization = sourceHeaders.get('Authorization') || sourceHeaders.get('authorization') || '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      return await nativeFetch(edgeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabasePublishableKey,
          ...(authorization ? { Authorization: authorization } : {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (e) {
      if (e?.name === 'AbortError') {
        return new Response(JSON.stringify({ success:false, error:'STAFF_API_TIMEOUT', message:'Не удалось загрузить сотрудников. Обновите страницу ещё раз.' }), {
          status: 504,
          headers: { 'Content-Type':'application/json' }
        });
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
})();

(function loadHubUi(){
  const base = new URL('./', document.currentScript?.src || location.href);
  const load = (file, version='20260904-4') => {
    const s = document.createElement('script');
    s.src = new URL(file, base).href + '?v=' + version;
    s.async = false;
    document.head.appendChild(s);
  };

  load('theme.js');
  load('ui-icons.js');
  load('dialog-fixes.js');
  load('ui-fixes.js');

  if (!/\/admin\/(?!login\.html$)/.test(location.pathname)) return;
  load('navigation.js');
  load('layout.js');
  load('help-context.js');
  if (/\/admin\/partners\.html$/.test(location.pathname)) load('partners-search.js');
  if (/\/admin\/employees\.html$/.test(location.pathname)) load('employees-structure.js');
})();