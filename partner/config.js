window.A4PRINT_PARTNER_CONFIG={supabaseUrl:'https://qgakliolffnwkymoqvzn.supabase.co',supabasePublishableKey:'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu'};

(function loadPartnerUi(){
  if (/\/partner\/login\.html$/.test(location.pathname)) return;
  ['../admin/layout.js?v=20260831-5','./help.js?v=20260831-1'].forEach(src=>{
    const s=document.createElement('script');
    s.src=src;
    s.defer=true;
    document.head.appendChild(s);
  });
})();
