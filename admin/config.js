// A4PRINT HUB frontend configuration.
// Publishable keys are intended for browser use with Supabase RLS enabled.
// NEVER put a service_role/secret key here.
window.A4PRINT_CONFIG = {
  supabaseUrl: 'https://qgakliolffnwkymoqvzn.supabase.co',
  supabasePublishableKey: 'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu',
  apiBaseUrl: 'https://a4print-hub-api.onrender.com'
};

if (/\/admin\/(?!login\.html$)/.test(location.pathname)) {
  document.write('<script defer src="./navigation.js?v=20260830-1"></' + 'script>');
}
