window.A4PRINT_PARTNER_CONFIG={
  supabaseUrl:'https://qgakliolffnwkymoqvzn.supabase.co',
  supabasePublishableKey:'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu',
  apiBaseUrl:'https://a4print-hub-api.onrender.com'
};

(function loadPartnerUi(){
  const scripts=['./pwa.js?v=20260901-2','../admin/theme.js?v=20260831-15','../admin/ui-fixes.js?v=20260831-15'];
  const isAuthPage=/\/partner\/(login|register|set-password)\.html$/.test(location.pathname);
  if(!isAuthPage)scripts.push('../admin/layout.js?v=20260831-15','./help.js?v=20260831-2','./crm-entry.js?v=20260831-2','./marketplace-nav.js?v=20260831-2','./courier-orders.js?v=20260901-1');
  scripts.forEach(src=>{
    const s=document.createElement('script');
    s.src=src;
    s.defer=true;
    document.head.appendChild(s);
  });
})();
