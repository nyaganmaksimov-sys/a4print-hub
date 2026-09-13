(()=>{
  if(window.__A4_DASHBOARD_HOME_V2__)return;
  window.__A4_DASHBOARD_HOME_V2__=true;

  const collapsePrefix='a4hub.dashboard.collapse.';

  function clearLegacyCollapse(){
    try{
      for(let i=localStorage.length-1;i>=0;i--){
        const key=localStorage.key(i);
        if(key&&key.startsWith(collapsePrefix))localStorage.removeItem(key);
      }
    }catch{}
  }

  function normalize(){
    if(!document.body.classList.contains('dashboard-home'))return;

    document.querySelectorAll('.dash-card.is-collapsed').forEach(card=>card.classList.remove('is-collapsed'));
    document.querySelectorAll('.dash-collapse-btn').forEach(btn=>btn.remove());

    const launcher=document.querySelector('.dash-app-launcher');
    if(launcher)launcher.setAttribute('aria-hidden','true');

    const shell=document.querySelector('.dashboard-shell');
    const kpis=shell?.querySelector('.dash-kpis');
    const rates=document.getElementById('a4CbrRates');
    if(shell&&kpis&&rates&&rates.previousElementSibling!==kpis)kpis.insertAdjacentElement('afterend',rates);
  }

  function init(){
    clearLegacyCollapse();
    normalize();
    let scheduled=false;
    const observer=new MutationObserver(()=>{
      if(scheduled)return;
      scheduled=true;
      requestAnimationFrame(()=>{scheduled=false;normalize()});
    });
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    setTimeout(normalize,300);
    setTimeout(normalize,1200);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
