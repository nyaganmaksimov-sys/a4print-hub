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
  const load = (file, version='20260831-7') => {
    const s = document.createElement('script');
    s.src = new URL(file, base).href + '?v=' + version;
    s.defer = true;
    document.head.appendChild(s);
  };

  // Global visual theme is shared by HUB, login pages and POS.
  load('theme.js');

  // Internal HUB tools are only needed inside /admin/ after login.
  if (!/\/admin\/(?!login\.html$)/.test(location.pathname)) return;
  load('navigation.js');
  load('layout.js');
  load('help-context.js');
})();
