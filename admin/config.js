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
  window.__A4_MOBILE__ = !!isMobile;

  const load = (file, version='20260904-22') => {
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

  const isAuthPage = /\/admin\/(login|register|pending|invite)\.html$/.test(location.pathname);
  const isAdmin = /\/admin\//.test(location.pathname) && !isAuthPage;
  const isChat = /\/admin\/messages\.html$/.test(location.pathname);
  const params = new URLSearchParams(location.search);
  const isEmbed = isChat && params.get('embed') === '1';
  const isChatApp = isChat && (params.get('app') === '1' || window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);

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

  load('theme.js');
  load('ui-icons.js');
  load('dialog-fixes.js');
  load('ui-fixes.js');

  if (!isAdmin) return;

  load('navigation.js','20260904-10');
  load('workspace-clean.js','20260904-2');
  load('nav-accordion.js','20260904-3');
  load('modern-ui.js','20260904-1');

  if (/\/admin\/employees\.html$/.test(location.pathname)) load('employees-delete.js','20260904-2');
  if (/\/admin\/partners\.html$/.test(location.pathname)) load('partners-search.js','20260904-2');

  background(() => {
    load('chat-notifications.js','20260904-7');
    load('push-client.js','20260904-4');
    if (!isChat) load('chat-widget.js','20260904-5');
  });
})();
