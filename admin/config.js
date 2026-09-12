// A4PRINT HUB frontend configuration.
// Publishable keys are intended for browser use with Supabase RLS enabled.
// NEVER put a service_role/secret key here.
window.A4PRINT_CONFIG = {
  supabaseUrl: 'https://qgakliolffnwkymoqvzn.supabase.co',
  supabasePublishableKey: 'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu',
  apiBaseUrl: 'https://api.a4print-hub.ru'
};

// Resilient API routing for networks where one backend hostname is slow/unreachable.
// Safe reads and password/refresh auth race both public API hostnames; successful
// origin is remembered and then used for writes to avoid duplicate operations.
(function installA4ApiRouting(){
  if(window.__A4_API_ROUTING__)return;window.__A4_API_ROUTING__=true;
  const nativeFetch=window.fetch.bind(window);
  const cfg=window.A4PRINT_CONFIG||{};
  const origins=['https://api.a4print-hub.ru',String(cfg.apiBaseUrl||'').replace(/\/$/,''),'https://a4print-hub-api.onrender.com'].filter((v,i,a)=>v&&a.indexOf(v)===i);
  const key='a4_api_origin';
  const getPref=()=>{try{const v=localStorage.getItem(key);return origins.includes(v)?v:null}catch{return null}};
  const setPref=v=>{try{if(v)localStorage.setItem(key,v)}catch{}};
  const parse=(input,init={})=>{try{const req=new Request(input,init),url=new URL(req.url);const apiOrigin=origins.find(x=>url.origin===x);return{req,url,apiOrigin,method:req.method.toUpperCase()}}catch{return null}};
  const one=async(req,url,origin,ms)=>{const target=new URL(url.href);target.origin=origin;const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{const r=await nativeFetch(new Request(target.href,req),{signal:c.signal});if(r.ok||r.status<500){setPref(origin);return r}throw new Error(`HTTP ${r.status}`)}finally{clearTimeout(t)}};
  const any=promises=>typeof Promise.any==='function'?Promise.any(promises):new Promise((resolve,reject)=>{let left=promises.length,last;promises.forEach(p=>Promise.resolve(p).then(resolve,e=>{last=e;if(--left===0)reject(last)}))});
  window.fetch=async function a4RoutedFetch(input,init={}){
    const x=parse(input,init);if(!x||!x.apiOrigin)return nativeFetch(input,init);
    const ordered=[getPref(),...origins].filter((v,i,a)=>v&&a.indexOf(v)===i);
    const safe=x.method==='GET'||x.method==='HEAD'||/\/api\/v1\/mobile\/auth\/(?:password|refresh)(?:\/|$)/.test(x.url.pathname);
    const slowPosRead=x.method==='GET'&&/\/api\/v1\/pos\/(?:shift|cash-balance)(?:\/|$)/.test(x.url.pathname);
    if(safe){
      if(slowPosRead){
        const origin=getPref()||x.apiOrigin;
        try{return await one(x.req.clone(),x.url,origin,30000)}catch(e){
          const alt=ordered.find(v=>v!==origin);if(!alt)throw e;return one(x.req.clone(),x.url,alt,30000);
        }
      }
      return any(ordered.map(origin=>one(x.req.clone(),x.url,origin,5500)));
    }
    const origin=getPref()||x.apiOrigin;
    try{return await one(x.req.clone(),x.url,origin,9000)}catch(e){
      const alt=ordered.find(v=>v!==origin);if(!alt)throw e;return one(x.req.clone(),x.url,alt,9000);
    }
  };
})();

// In some networks direct access to *.supabase.co is unstable or unavailable.
// HUB therefore uses our backend proxy first for Auth / REST / Functions.
window.A4SupabaseFetch = async function a4SupabaseFetch(input, init) {
  const cfg = window.A4PRINT_CONFIG || {};
  let request;
  try { request = new Request(input, init); } catch { return fetch(input, init); }

  let target;
  try { target = new URL(request.url); } catch { return fetch(request); }
  const apiBase = String(cfg.apiBaseUrl || '').replace(/\/$/, '');
  let supabaseOrigin = '';
  try { supabaseOrigin = new URL(cfg.supabaseUrl).origin; } catch {}
  const isSupabase = target.origin === supabaseOrigin && /^\/(auth|rest|functions)\/v1(?:\/|$)/.test(target.pathname);
  if (!apiBase || !isSupabase) return fetch(request);

  const proxyFetch = async () => {
    const headers = new Headers(request.headers);
    const method = request.method.toUpperCase();
    const options = { method, headers, cache: 'no-store', credentials: 'omit', redirect: 'follow' };
    if (!['GET', 'HEAD'].includes(method)) options.body = await request.clone().arrayBuffer();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    options.signal = controller.signal;
    try {
      return await fetch(`${apiBase}/api/v1/supabase${target.pathname}${target.search}`, options);
    } finally { clearTimeout(timer); }
  };

  try { return await proxyFetch(); }
  catch (proxyError) {
    try {
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5500);
      try{return await fetch(request.clone(),{signal:controller.signal})}finally{clearTimeout(timer)}
    }
    catch (directError) { console.warn('A4 Supabase proxy/direct failed', proxyError, directError); throw proxyError; }
  }
};

(function loadHubUi(){
  const base = new URL('./', document.currentScript?.src || location.href);
  const isMobile = window.matchMedia?.('(max-width:900px)').matches || /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || '');
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  window.__A4_MOBILE__ = !!isMobile;
  const load=(file,version='20260910-1')=>{const s=document.createElement('script');s.src=new URL(file,base).href+'?v='+version;s.async=false;document.head.appendChild(s)};
  const loadModule=(file,version='20260910-1')=>{const s=document.createElement('script');s.type='module';s.src=new URL(file,base).href+'?v='+version;document.head.appendChild(s)};
  const loadCss=(file,version='20260910-1')=>{const l=document.createElement('link');l.rel='stylesheet';l.href=new URL(file,base).href+'?v='+version;document.head.appendChild(l)};
  const background=fn=>{const schedule=()=>{const run=()=>{try{fn()}catch(e){console.warn('A4 background module failed',e)}};if('requestIdleCallback'in window)requestIdleCallback(run,{timeout:isMobile?4200:1800});else setTimeout(run,isMobile?1800:500)};if(document.readyState==='complete')schedule();else window.addEventListener('load',schedule,{once:true})};
  const isAuthPage=/\/admin\/(login|register|pending|invite|reset-password)\.html$/.test(location.pathname);
  const isAdmin=/\/admin\//.test(location.pathname)&&!isAuthPage;
  const isDashboard=/\/admin\/(?:index\.html)?$/.test(location.pathname);
  const isChat=/\/admin\/messages\.html$/.test(location.pathname);
  const isManager=/\/admin\/manager\.html$/.test(location.pathname);
  const isPartners=/\/admin\/partners\.html$/.test(location.pathname);
  const isSettings=/\/admin\/settings\.html$/.test(location.pathname);
  const isEmployees=/\/admin\/employees\.html$/.test(location.pathname);
  const params=new URLSearchParams(location.search);
  const isEmbed=isChat&&params.get('embed')==='1';
  const isChatApp=isChat&&(params.get('app')==='1'||standalone);
  const mobileContext=isAdmin&&(params.get('mobile')==='1'||params.get('app')==='1'||(standalone&&isMobile));
  if(isAdmin&&!document.querySelector('link[rel="icon"]')){const icon=document.createElement('link');icon.rel='icon';icon.type='image/svg+xml';icon.href=new URL('assets/logo_bd_transparent.svg?v=20260908-favicon1',base).href;document.head.appendChild(icon)}
  if(isAdmin&&!document.querySelector('link[rel="manifest"]')){const manifest=document.createElement('link');manifest.rel='manifest';manifest.href=new URL('manifest.webmanifest?v=20260908-2',base).href;document.head.appendChild(manifest)}
  if(isAdmin)loadCss('button-system.css','20260908-1');
  if(isPartners)loadCss('partners-modern.css','20260908-2');
  if(isAdmin&&!mobileContext){loadCss('sidebar-light.css','20260908-2');loadCss('logo-clean.css','20260908-2')}
  if(isAdmin){
    const logoStyle=document.createElement('style');logoStyle.id='a4-logo-transparent-fix';logoStyle.textContent=`html body .sidebar .hub-logo-wrap,html body .sidebar .brand{background:transparent!important;background-image:none!important;border:0!important;box-shadow:none!important;border-radius:0!important;padding:0!important;min-height:0!important;height:auto!important;margin:4px 8px 20px!important}html body .sidebar .hub-logo,html body .sidebar .brand img{display:block!important;opacity:1!important;background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important;width:100%!important;max-width:190px!important;height:auto!important;max-height:126px!important;object-fit:contain!important;filter:none!important;border-radius:0!important}html body.a4-sidebar-collapsed .sidebar .hub-logo-wrap,html body.a4-sidebar-collapsed .sidebar .brand{margin:4px 0 14px!important}html body.a4-sidebar-collapsed .sidebar .hub-logo,html body.a4-sidebar-collapsed .sidebar .brand img{width:54px!important;max-width:54px!important;height:auto!important;max-height:54px!important}`;document.head.appendChild(logoStyle);
    const useTransparentLogo=()=>{const logo=document.getElementById('hubLogo');if(logo)logo.src=new URL('assets/logo_bd_transparent.svg?v=20260908-transparent4',base).href;document.querySelectorAll('.brand img').forEach(img=>{img.src=new URL('assets/logo_bd_transparent.svg?v=20260908-transparent4',base).href})};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',useTransparentLogo,{once:true});else useTransparentLogo();
  }
  if(mobileContext)load('mobile-shell.js','20260905-4');
  if(isChatApp){load('dialog-fixes.js');load('ui-fixes.js');load('chat-app-mode.js','20260904-4');load('chat-ui-fixes.js','20260904-3');if(isEmbed)load('chat-embed.js','20260908-2');else background(()=>{load('chat-notifications.js','20260904-7');load('support-notifications.js','20260905-1');load('push-client.js','20260904-4')});return}
  if(isAuthPage){load('auth-ui.js','20260910-api-routing2');return}
  load('theme.js','20260905-1');load('ui-icons.js');load('dialog-fixes.js');load('ui-fixes.js');if(!isAdmin)return;
  if(isDashboard){loadModule('dashboard-payment-split.js','20260908-2');loadModule('dashboard-equipment-widget.js','20260909-1')}
  if(isManager)load('manager-runtime.js','20260905-4');
  if(isSettings){load('auth-settings.js','20260905-2');load('settings-collapsible.js','20260905-1')}
  load('navigation.js','20260909-equipment1');load('support-access.js','20260908-clean2');load('onboarding.js','20260905-1');load('workspace-clean.js','20260908-profile1');load('topbar-modern.js','20260908-3');load('nav-accordion.js','20260909-equipment1');load('modern-ui.js','20260904-1');loadModule('equipment-maintenance-badge.js','20260909-1');
  if(isEmployees){load('employees-delete.js','20260904-2');load('support-employee-helper.js','20260905-1')}
  if(isPartners){load('partners-search.js','20260905-1');load('partner-invites.js','20260908-2');load('partners-modern.js','20260908-1')}
  background(()=>{load('chat-notifications.js','20260904-7');load('support-notifications.js','20260905-1');load('push-client.js','20260904-4');if(!isChat)load('chat-widget.js','20260908-2')});
})();