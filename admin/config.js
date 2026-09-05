// A4PRINT HUB frontend configuration.
// Publishable keys are intended for browser use with Supabase RLS enabled.
// NEVER put a service_role/secret key here.
window.A4PRINT_CONFIG = {
  supabaseUrl: 'https://qgakliolffnwkymoqvzn.supabase.co',
  supabasePublishableKey: 'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu',
  apiBaseUrl: 'https://a4print-hub-api.onrender.com'
};

(function loadHubUi(){
  const base = new URL('./', document.currentScript?.src || location.href);
  const isMobile = window.matchMedia?.('(max-width:900px)').matches || /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || '');
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  window.__A4_MOBILE__ = !!isMobile;

  const load = (file, version='20260904-23') => {
    const s = document.createElement('script');
    s.src = new URL(file, base).href + '?v=' + version;
    s.async = false;
    document.head.appendChild(s);
  };

  const background = fn => {
    const schedule = () => {
      const run = () => { try { fn(); } catch(e) { console.warn('A4 background module failed', e); } };
      if ('requestIdleCallback' in window) requestIdleCallback(run, {timeout:isMobile ? 4200 : 1800});
      else setTimeout(run, isMobile ? 1800 : 500);
    };
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, {once:true});
  };

  const isAuthPage = /\/admin\/(login|register|pending|invite|reset-password)\.html$/.test(location.pathname);
  const isAdmin = /\/admin\//.test(location.pathname) && !isAuthPage;
  const isChat = /\/admin\/messages\.html$/.test(location.pathname);
  const isManager = /\/admin\/manager\.html$/.test(location.pathname);
  const isPartners = /\/admin\/partners\.html$/.test(location.pathname);
  const params = new URLSearchParams(location.search);
  const isEmbed = isChat && params.get('embed') === '1';
  const isChatApp = isChat && (params.get('app') === '1' || standalone);
  const mobileContext = isAdmin && (params.get('mobile') === '1' || params.get('app') === '1' || (standalone && isMobile));

  if (mobileContext) load('mobile-shell.js','20260904-2');

  if (isChatApp) {
    load('dialog-fixes.js');
    load('ui-fixes.js');
    load('chat-app-mode.js','20260904-4');
    load('chat-ui-fixes.js','20260904-3');
    if (isEmbed) load('chat-embed.js','20260904-4');
    else background(() => {
      load('chat-notifications.js','20260904-7');
      load('push-client.js','20260904-4');
    });
    return;
  }

  if (isAuthPage) return;

  if (isPartners) load('partners-api-fallback.js','20260905-1');
  load('theme.js','20260905-1');
  load('ui-icons.js');
  load('dialog-fixes.js');
  load('ui-fixes.js');

  if (!isAdmin) return;

  if (isManager) load('manager-runtime.js','20260905-2');
  load('navigation.js','20260904-10');
  load('workspace-clean.js','20260904-2');
  load('nav-accordion.js','20260904-3');
  load('modern-ui.js','20260904-1');

  if (/\/admin\/employees\.html$/.test(location.pathname)) load('employees-delete.js','20260904-2');
  if (isPartners) load('partners-search.js','20260905-1');

  background(() => {
    load('chat-notifications.js','20260904-7');
    load('push-client.js','20260904-4');
    if (!isChat) load('chat-widget.js','20260904-5');
  });
})();
