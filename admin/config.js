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
  const load = (file, version='20260904-17') => {
    const s = document.createElement('script');
    s.src = new URL(file, base).href + '?v=' + version;
    s.async = false;
    document.head.appendChild(s);
  };

  const isAdmin = /\/admin\/(?!login\.html$)/.test(location.pathname);
  const isChat = /\/admin\/messages\.html$/.test(location.pathname);
  const params = new URLSearchParams(location.search);
  const isEmbed = isChat && params.get('embed') === '1';
  const isChatApp = isChat && (params.get('app') === '1' || window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);
  const isAuthPage = /\/admin\/(login|register|pending)\.html$/.test(location.pathname);

  // Установленное приложение/встроенный чат — отдельный минимальный интерфейс.
  if (isChatApp) {
    load('dialog-fixes.js');
    load('ui-fixes.js');
    load('chat-app-mode.js','20260904-3');
    load('chat-ui-fixes.js','20260904-2');
    if (isEmbed) {
      load('chat-embed.js','20260904-2');
    } else {
      load('chat-notifications.js','20260904-4');
      load('push-client.js','20260904-1');
    }
    return;
  }

  load('theme.js');
  load('ui-icons.js');
  load('dialog-fixes.js');
  load('ui-fixes.js');

  if (!isAdmin) return;
  if (isChat) {
    load('chat-app-mode.js','20260904-3');
    load('chat-ui-fixes.js','20260904-2');
  }

  // Один центр уведомлений для всей системы + настоящая Web Push подписка.
  if (!isAuthPage) {
    load('chat-notifications.js','20260904-4');
    load('push-client.js','20260904-1');
  }
  load('navigation.js','20260904-9');
  load('workspace-clean.js','20260904-1');
  load('nav-accordion.js','20260904-2');

  // Свернутый чат доступен на любой рабочей странице, кроме самой страницы сообщений.
  if (!isChat && !isAuthPage) load('chat-widget.js','20260904-1');

  if (/\/admin\/employees\.html$/.test(location.pathname)) load('employees-delete.js','20260904-1');
  if (/\/admin\/partners\.html$/.test(location.pathname)) load('partners-search.js');
})();
