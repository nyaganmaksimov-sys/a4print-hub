(()=>{
  if(window.__A4_JARVIS_MASTER_GUARD__)return;
  window.__A4_JARVIS_MASTER_GUARD__=true;
  const KEY='a4print_jarvis_enabled_v1';
  const disabled=()=>{try{return localStorage.getItem(KEY)==='0'}catch{return false}};
  const runtimeSelector='#jarvisLauncher,#jarvisPanel,#jarvisWakeToggle,#jarvisSentinelToast,#jarvisSentinelBadge';

  function cleanup(){
    const off=disabled();
    window.__A4_JARVIS_DISABLED__=off;
    document.documentElement.classList.toggle('a4-jarvis-off',off);
    if(!off)return;
    try{window.A4JarvisWake?.disable?.()}catch{}
    try{window.A4VoiceEngine?.stop?.()}catch{}
    try{window.speechSynthesis?.cancel?.()}catch{}
    document.querySelectorAll(runtimeSelector).forEach(el=>el.remove());
    document.querySelectorAll('script[data-a4-jarvis="1"]').forEach(el=>el.remove());
  }

  const style=document.createElement('style');
  style.id='a4-jarvis-master-guard-style';
  style.textContent='.a4-jarvis-off #jarvisLauncher,.a4-jarvis-off #jarvisPanel,.a4-jarvis-off #jarvisWakeToggle,.a4-jarvis-off #jarvisSentinelToast,.a4-jarvis-off #jarvisSentinelBadge{display:none!important;visibility:hidden!important;pointer-events:none!important}';
  document.head.appendChild(style);

  cleanup();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',cleanup,{once:true});
  window.addEventListener('pageshow',event=>{
    cleanup();
    if(event.persisted&&disabled()&&document.querySelector(runtimeSelector))location.reload();
  });
  window.addEventListener('storage',event=>{
    if(event.key!==KEY)return;
    cleanup();
    location.reload();
  });
  window.addEventListener('a4:jarvis-master-change',cleanup);
  window.A4JarvisMasterGuard={isDisabled:disabled,cleanup};
})();
