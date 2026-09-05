(()=>{
  if(window.A4AuthUI)return;
  const DEFAULTS={
    login:{email:true,google:true,yandex:false,mailru:false},
    registration:{email:true,google:true,yandex:false,mailru:false}
  };
  const FALLBACK_URL='https://qgakliolffnwkymoqvzn.supabase.co';
  const FALLBACK_KEY='sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu';
  let cache=null,pending=null;

  const cloneDefaults=()=>JSON.parse(JSON.stringify(DEFAULTS));
  const providerKey=provider=>{
    const p=String(provider||'').trim();
    if(p==='google')return'google';
    if(p==='custom:yandex'||p==='yandex')return'yandex';
    if(p==='custom:mailru'||p==='mailru')return'mailru';
    return p;
  };
  const normalize=raw=>{
    const out=cloneDefaults();
    for(const mode of ['login','registration'])for(const key of ['email','google','yandex','mailru']){
      if(typeof raw?.[mode]?.[key]==='boolean')out[mode][key]=raw[mode][key];
    }
    return out;
  };
  async function load(force=false){
    if(cache&&!force)return cache;
    if(pending&&!force)return pending;
    const cfg=window.A4PRINT_CONFIG||{};
    const url=cfg.supabaseUrl||FALLBACK_URL,key=cfg.supabasePublishableKey||FALLBACK_KEY;
    pending=(async()=>{
      try{
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);
        const r=await fetch(`${url}/rest/v1/rpc/get_public_auth_ui`,{
          method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:'{}',signal:controller.signal
        });
        clearTimeout(timer);
        if(!r.ok)throw new Error('auth ui unavailable');
        cache=normalize(await r.json());
      }catch{cache=cloneDefaults()}
      pending=null;
      return cache;
    })();
    return pending;
  }
  async function isEnabled(mode,provider){
    const cfg=await load();
    const key=provider==='email'?'email':providerKey(provider);
    return cfg?.[mode]?.[key]!==false;
  }
  function setHidden(el,hidden){if(!el)return;el.hidden=!!hidden;el.style.display=hidden?'none':''}
  async function apply(mode,root=document){
    const cfg=await load();
    const section=cfg[mode]||DEFAULTS[mode];
    root.querySelectorAll('[data-provider]').forEach(btn=>{
      const key=providerKey(btn.dataset.provider);
      setHidden(btn,section[key]===false);
    });
    const formId=mode==='registration'?'form':(root.querySelector('#loginForm')?'loginForm':'form');
    const emailForm=root.querySelector(`#${formId}`);
    setHidden(emailForm,section.email===false);
    const divider=root.querySelector('.login-divider,.divider');
    setHidden(divider,section.email===false || !['google','yandex','mailru'].some(k=>section[k]));
    if(mode==='login'){
      const registrationAvailable=Object.values(cfg.registration||{}).some(Boolean);
      root.querySelectorAll('a[href*="register.html"]').forEach(a=>setHidden(a,!registrationAvailable));
    }
    root.documentElement?.setAttribute?.(`data-a4-auth-${mode}`,'ready');
    window.dispatchEvent(new CustomEvent('a4:auth-ui',{detail:{mode,config:cfg}}));
    return cfg;
  }
  function invalidate(){cache=null;pending=null}
  window.A4AuthUI={DEFAULTS,load,isEnabled,apply,providerKey,invalidate};

  const autoApply=()=>{
    const p=location.pathname;
    let mode=null;
    if(/\/admin\/register\.html$/.test(p))mode='registration';
    else if(/\/admin\/login\.html$/.test(p)||/\/chat\/start\.html$/.test(p)||/\/mobile\/$/.test(p))mode='login';
    if(mode)apply(mode).catch(()=>{});
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',autoApply,{once:true});else autoApply();
})();
