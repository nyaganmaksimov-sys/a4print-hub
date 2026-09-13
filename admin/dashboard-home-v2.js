(()=>{
  if(window.__A4_DASHBOARD_HOME_V4__)return;
  window.__A4_DASHBOARD_HOME_V4__=true;

  const collapsePrefix='a4hub.dashboard.collapse.';
  const scriptBase=new URL('./',document.currentScript?.src||location.href);

  function clearLegacyCollapse(){
    try{
      for(let i=localStorage.length-1;i>=0;i--){
        const key=localStorage.key(i);
        if(key&&key.startsWith(collapsePrefix))localStorage.removeItem(key);
      }
    }catch{}
  }

  function loadOrderScope(){
    if(document.getElementById('a4-dashboard-order-scope'))return;
    const script=document.createElement('script');
    script.id='a4-dashboard-order-scope';
    script.type='module';
    script.src=new URL('dashboard-order-scope.js?v=20260913-1',scriptBase).href;
    document.head.appendChild(script);
  }

  function cardByTitle(title){
    return [...document.querySelectorAll('.dash-card')].find(card=>card.querySelector(':scope > .dash-card-head h2')?.textContent?.trim()===title)||null;
  }

  function ensureColumns(rates){
    let board=document.getElementById('a4DashboardColumns');
    if(!board){
      board=document.createElement('section');
      board.id='a4DashboardColumns';
      board.className='dash-command-columns';
      board.setAttribute('aria-label','Оперативная работа');
      board.innerHTML='<div class="dash-command-column" data-dashboard-column="left"></div><div class="dash-command-column" data-dashboard-column="right"></div>';
      rates.insertAdjacentElement('afterend',board);
    }
    return {
      board,
      left:board.querySelector('[data-dashboard-column="left"]'),
      right:board.querySelector('[data-dashboard-column="right"]')
    };
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

    const {board,left,right}=ensureColumns(rates);
    const orders=cardByTitle('Последние заказы');
    const attention=cardByTitle('Требует внимания');
    const cash=cardByTitle('Касса и синхронизация');
    const production=cardByTitle('Производство');

    if(orders&&orders.parentElement!==left)left.appendChild(orders);
    if(cash&&cash.parentElement!==left)left.appendChild(cash);
    if(attention&&attention.parentElement!==right)right.appendChild(attention);
    if(production&&production.parentElement!==right)right.appendChild(production);

    const units=shell.querySelector('.dash-units');
    if(units&&units.previousElementSibling!==board)board.insertAdjacentElement('afterend',units);

    ['a4DashboardPrimary','a4DashboardSecondary','a4DashboardPanelColumns'].forEach(id=>{
      const node=document.getElementById(id);
      if(node&&!node.querySelector('.dash-card'))node.remove();
    });
    [...shell.querySelectorAll(':scope > .dash-grid')].forEach(grid=>{if(!grid.querySelector('.dash-card'))grid.remove()});
  }

  function init(){
    clearLegacyCollapse();
    loadOrderScope();
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
