(()=>{
 if(window.__A4PRINT_UI_FIXES__)return;window.__A4PRINT_UI_FIXES__=true;
 const css=`
 :root{--a4-btn-h:40px;--a4-btn-radius:10px}
 button,input[type="button"],input[type="submit"],input[type="reset"],a.btn,.btn,.button,[role="button"]{box-sizing:border-box;max-width:100%;font-family:inherit}
 button,.btn,a.btn,.button{min-height:var(--a4-btn-h);line-height:1.15;vertical-align:middle}
 button:not(.a4-sidebar-toggle):not(.a4-help-fab):not(.a4-theme-fab):not(.a4-layout-toggle),.btn,a.btn,.button{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px 14px;border-radius:var(--a4-btn-radius);white-space:normal;text-align:center}
 button svg,.btn svg,a.btn svg,.button svg{width:18px;height:18px;flex:0 0 18px}
 .topbar,.top,.crm-top,.panel-head,.row-head{min-width:0}
 .topbar>*,.top>*,.crm-top>*{min-width:0}
 .user,.actions,.toolbar,.modal-actions{flex-wrap:wrap}
 .actions button,.actions .btn,.actions a,.toolbar button,.toolbar .btn{flex:0 0 auto}
 dialog button,.modal button{max-width:100%}
 body>.a4-help-fab,body>.a4-theme-fab,body>.a4-layout-toggle{position:fixed!important;right:18px!important;left:auto!important;z-index:2147483000!important;margin:0!important;box-shadow:0 8px 24px rgba(15,23,42,.18)!important}
 body>.a4-layout-toggle{bottom:18px!important}
 body>.a4-help-fab{bottom:72px!important}
 body>.a4-theme-fab{bottom:126px!important}
 @media(max-width:700px){
   .topbar,.top,.crm-top{gap:12px}
   .topbar .user,.top .user{width:100%}
   .actions{gap:7px}
   .actions button,.actions .btn,.actions a{min-height:38px}
   body>.a4-help-fab,body>.a4-theme-fab,body>.a4-layout-toggle{right:12px!important}
   body>.a4-layout-toggle{bottom:12px!important}
   body>.a4-help-fab{bottom:64px!important}
   body>.a4-theme-fab{bottom:116px!important}
 }
 `;
 const install=()=>{if(document.getElementById('a4-global-ui-fixes'))return;const s=document.createElement('style');s.id='a4-global-ui-fixes';s.textContent=css;document.head.appendChild(s)};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();