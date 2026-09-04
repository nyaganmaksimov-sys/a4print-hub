// A4PRINT HUB frontend configuration.
// Publishable keys are intended for browser use with Supabase RLS enabled.
// NEVER put a service_role/secret key here.
window.A4PRINT_CONFIG = {
  supabaseUrl: 'https://qgakliolffnwkymoqvzn.supabase.co',
  supabasePublishableKey: 'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu',
  apiBaseUrl: 'https://a4print-hub-api.onrender.com'
};

// Fast staff bootstrap. The old Employees page asks for users, roles, requests,
// departments, organizations and positions separately. On employees.html we collapse
// those browser round trips into one protected staff-admin Edge Function request and
// serve the remaining reads from the in-page bootstrap cache.
(function installStaffAdminFetchBridge(){
  const cfg = window.A4PRINT_CONFIG;
  if (!cfg?.supabaseUrl || !cfg?.supabasePublishableKey || !cfg?.apiBaseUrl) return;

  const nativeFetch = window.fetch.bind(window);
  const staffPage = /\/admin\/employees\.html$/.test(location.pathname);
  const legacyPrefix = cfg.apiBaseUrl.replace(/\/$/, '') + '/api/v1/users';
  const edgeUrl = cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/staff-admin';
  const restPrefix = cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/';
  let bootstrapPromise = null;
  let bootstrapAuth = '';

  const authFrom = (input, init={}) => {
    const h = new Headers(init.headers || (typeof input !== 'string' ? input?.headers : undefined) || {});
    return h.get('Authorization') || h.get('authorization') || '';
  };
  const jsonResponse = (body, status=200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }
  });

  async function bootstrap(authorization){
    if (!authorization) throw new Error('AUTH_REQUIRED');
    if (bootstrapPromise && bootstrapAuth === authorization) return bootstrapPromise;
    bootstrapAuth = authorization;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    bootstrapPromise = nativeFetch(edgeUrl, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'apikey':cfg.supabasePublishableKey,
        'Authorization':authorization
      },
      body:JSON.stringify({action:'bootstrap'}),
      signal:controller.signal
    }).then(async r => {
      const d = await r.json().catch(()=>({}));
      if (!r.ok) {
        const e = new Error(d.message || d.error || 'Не удалось загрузить сотрудников.');
        e.status = r.status;
        e.payload = d;
        throw e;
      }
      return d;
    }).catch(e => {
      bootstrapPromise = null;
      if (e?.name === 'AbortError') throw new Error('Загрузка сотрудников заняла слишком много времени. Обновите страницу.');
      throw e;
    }).finally(()=>clearTimeout(timer));
    return bootstrapPromise;
  }

  window.fetch = async function(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url;
    if (!url) return nativeFetch(input, init);
    const method = String(init.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();
    const authorization = authFrom(input, init);

    // Legacy users API used by employees.html.
    if (url.startsWith(legacyPrefix)) {
      const path = url.slice(legacyPrefix.length);
      let requestBody = {};
      try { requestBody = init.body ? JSON.parse(init.body) : {}; } catch (_) {}

      if (staffPage && method === 'GET' && (path === '/roles' || path === '/roles/')) {
        try { const d = await bootstrap(authorization); return jsonResponse({success:true,roles:d.roles||[]}); }
        catch(e){ return jsonResponse({success:false,error:'STAFF_BOOTSTRAP_ERROR',message:e.message}, e.status||504); }
      }
      if (staffPage && method === 'GET' && (!path || path === '/')) {
        try { const d = await bootstrap(authorization); return jsonResponse({success:true,users:d.users||[]}); }
        catch(e){ return jsonResponse({success:false,error:'STAFF_BOOTSTRAP_ERROR',message:e.message}, e.status||504); }
      }

      let body;
      if (method === 'GET' && (path === '/roles' || path === '/roles/')) body={action:'roles'};
      else if (method === 'GET' && (!path || path === '/')) body={action:'list'};
      else if (method === 'POST' && (!path || path === '/')) body={action:'create',payload:requestBody};
      else if (method === 'PATCH' && /^\/[0-9a-f-]+\/?$/i.test(path)) body={action:'update',user_id:path.replace(/^\//,'').replace(/\/$/,''),payload:requestBody};
      else return nativeFetch(input, init);

      const controller = new AbortController();
      const timer = setTimeout(()=>controller.abort(),8000);
      try {
        const r = await nativeFetch(edgeUrl, {
          method:'POST',
          headers:{'Content-Type':'application/json','apikey':cfg.supabasePublishableKey,...(authorization?{Authorization:authorization}:{})},
          body:JSON.stringify(body),
          signal:controller.signal
        });
        if (method !== 'GET' && r.ok) bootstrapPromise = null;
        return r;
      } catch(e) {
        if (e?.name === 'AbortError') return jsonResponse({success:false,error:'STAFF_API_TIMEOUT',message:'Операция с сотрудниками заняла слишком много времени.'},504);
        throw e;
      } finally { clearTimeout(timer); }
    }

    // Supabase reads made by employees.html and employees-structure.js.
    // They are satisfied from the same bootstrap payload, avoiding another 5-6 requests.
    if (staffPage && method === 'GET' && url.startsWith(restPrefix)) {
      const table = url.slice(restPrefix.length).split(/[?/#]/)[0];
      const map = {
        staff_registration_requests:'requests',
        organizations:'organizations',
        organization_units:'organization_units',
        staff_positions:'staff_positions',
        users:'users'
      };
      const key = map[table];
      if (key) {
        try { const d = await bootstrap(authorization); return jsonResponse(d[key] || []); }
        catch(e){ return jsonResponse({message:e.message,code:'STAFF_BOOTSTRAP_ERROR'},e.status||504); }
      }
    }

    return nativeFetch(input, init);
  };
})();

(function loadHubUi(){
  const base = new URL('./', document.currentScript?.src || location.href);
  const load = (file, version='20260904-5') => {
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