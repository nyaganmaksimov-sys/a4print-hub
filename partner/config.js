window.A4PRINT_PARTNER_CONFIG={supabaseUrl:'https://qgakliolffnwkymoqvzn.supabase.co',supabasePublishableKey:'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu'};

(function loadPartnerUi(){
  const scripts=['../admin/theme.js?v=20260831-15','../admin/ui-fixes.js?v=20260831-15'];
  if (!/\/partner\/login\.html$/.test(location.pathname)) scripts.push('../admin/layout.js?v=20260831-15','./help.js?v=20260831-2','./crm-entry.js?v=20260831-2','./marketplace-nav.js?v=20260831-2');
  scripts.forEach(src=>{
    const s=document.createElement('script');
    s.src=src;
    s.defer=true;
    document.head.appendChild(s);
  });
})();