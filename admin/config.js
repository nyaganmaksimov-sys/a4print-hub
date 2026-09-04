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
  const load = (file, version='20260904-9') => {
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
  if (/\/admin\/messages\.html$/.test(location.pathname)) load('chat-app-mode.js','20260904-1');
  load('navigation.js');
  load('layout.js');
  load('help-context.js');
  if (!/\/admin\/(login|register|pending)\.html$/.test(location.pathname)) load('chat-notifications.js','20260904-2');
  if (/\/admin\/partners\.html$/.test(location.pathname)) load('partners-search.js');
})();