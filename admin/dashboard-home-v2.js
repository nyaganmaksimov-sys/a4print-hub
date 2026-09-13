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

  function cardByTitle(title){
    return [...document.querySelectorAll('.dash-card')].find(card=>card.querySelector(':scope > .dash-card-head h2')?.textContent?.trim()===title)||null;
  }

  function ensureZone(id,className,label,anchor){
    let zone=document.getElementById(id);
    if(zone)return zone;
    zone=document.createElement('section');
    zone.id=id;
    zone.className=className;
    zone.setAttribute('aria-label',label);
    anchor?.insertAdjacentElement('afterend',zone);
    return zone;
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

    if(!shell||!rates)return;
    const primary=ensureZone('a4DashboardPrimary','dash-command-grid','Оперативная работа',rates);
    const secondary=ensureZone('a4DashboardSecondary','dash-secondary-grid','Служебные блоки',primary);

    const orders=cardByTitle('Последние заказы');
    const attention=cardByTitle('Требует внимания');
    const cash=cardByTitle('Касса и синхронизация');
    const production=cardByTitle('Производство');

    if(orders&&orders.parentElement!==primary)primary.appendChild(orders);
    if(attention&&attention.parentElement!==primary)primary.appendChild(attention);
    if(cash&&cash.parentElement!==secondary)secondary.appendChild(cash);
    if(production&&production.parentElement!==secondary)secondary.appendChild(production);

    const units=shell.querySelector('.dash-units');
    if(units&&units.previousElementSibling!==secondary)secondary.insertAdjacentElement('afterend',units);

    const legacyBoard=document.getElementById('a4DashboardPanelColumns');
    if(legacyBoard&&!legacyBoard.querySelector('.dash-card'))legacyBoard.remove();
    [...shell.querySelectorAll(':scope > .dash-grid')].forEach(grid=>{if(!grid.querySelector('.dash-card'))grid.remove()});
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
    setTimeout(normalize,250);
    setTimeout(normalize,900);
    setTimeout(normalize,1800);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
