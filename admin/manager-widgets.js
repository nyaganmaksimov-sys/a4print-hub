(()=>{
  if(window.__A4_MANAGER_WIDGETS_V3__)return;
  window.__A4_MANAGER_WIDGETS_V3__=true;

  const SIDE_KEY='a4hub.manager.side.order.v3';
  const KPI_KEY='a4hub.manager.kpi.order.v3';
  const RATES_REFRESH=10*60*1000;
  let ratesTimer=null;
  let clockTimer=null;
  let ratesStarted=false;
  let sortActive=false;

  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmt=value=>Number(value||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:4});
  const directChildren=(container,selector)=>[...container.children].filter(el=>el.matches?.(selector));

  function installStyles(){
    if(document.getElementById('a4-manager-widgets-v3-style'))return;
    const s=document.createElement('style');
    s.id='a4-manager-widgets-v3-style';
    s.textContent=`
      .manager-side-stack{align-content:start!important;grid-auto-rows:max-content!important}
      .manager-side-stack>.mgr-card{align-self:start!important;min-height:0!important}
      .manager-side-stack .mgr-notifications{max-height:158px!important;overflow:auto!important}
      .manager-side-stack .nearest-orders{max-height:98px!important;overflow:auto!important}

      .manager-info-widget{overflow:hidden!important;padding:11px 12px!important}
      .manager-info-widget>.mgr-head{margin-bottom:6px!important;min-height:28px!important}
      .manager-info-widget>.mgr-head h3{font-size:14px!important}
      .manager-info-top{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;padding:0 0 7px;border-bottom:1px solid #edf2f7}
      .manager-info-clock{font-size:23px;line-height:1;font-weight:900;color:#0f172a;font-variant-numeric:tabular-nums;letter-spacing:.02em}
      .manager-info-date{margin-top:3px;color:#64748b;font-size:9px;font-weight:800;text-transform:capitalize;white-space:nowrap}
      .manager-info-zone{display:flex;align-items:center;gap:5px;color:#64748b;font-size:9px;font-weight:800;white-space:nowrap;padding-bottom:2px}
      .manager-info-zone::before{content:'';width:6px;height:6px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.10)}
      .manager-rates-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:7px 0 5px}
      .manager-rates-title b{font-size:10px;color:#475569}
      .manager-rates-meta{font-size:8.5px;color:#94a3b8;white-space:nowrap}
      .manager-rates-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
      .manager-rate{border:1px solid #e7edf5;background:#f8fafc;border-radius:9px;padding:5px 6px;min-width:0}
      .manager-rate-code{display:block;color:#64748b;font-size:8px;font-weight:900;letter-spacing:.04em}
      .manager-rate-value{display:block;margin-top:1px;color:#0f172a;font-size:11px;font-weight:900;white-space:nowrap}
      .manager-rate-error{grid-column:1/-1;padding:7px 8px;border-radius:8px;background:#fff7f7;border:1px dashed #fecaca;color:#b91c1c;font-size:9px}

      .manager-drag-handle{margin-left:auto;display:inline-grid!important;place-items:center!important;width:30px!important;height:30px!important;min-width:30px!important;min-height:30px!important;padding:0!important;border:1px solid #dbe4f0!important;background:#fff!important;color:#64748b!important;border-radius:9px!important;cursor:grab!important;font:900 16px/1 system-ui!important;box-shadow:0 1px 2px rgba(15,23,42,.04)!important;user-select:none!important;touch-action:none!important}
      .manager-drag-handle:hover{background:#eff6ff!important;border-color:#93c5fd!important;color:#2563eb!important}
      .manager-drag-handle:active{cursor:grabbing!important;background:#dbeafe!important}
      .mgr-card.manager-dragging,.manager-kpi.manager-dragging{opacity:.66!important;transform:scale(.99)!important;box-shadow:0 14px 32px rgba(15,23,42,.16)!important;z-index:20!important}
      .mgr-card.manager-drag-over,.manager-kpi.manager-drag-over{outline:2px dashed #3b82f6!important;outline-offset:3px!important}
      .manager-kpi{position:relative!important}
      .manager-kpi>.manager-drag-handle{position:absolute!important;right:7px!important;top:6px!important;width:24px!important;height:24px!important;min-width:24px!important;min-height:24px!important;font-size:12px!important;border:0!important;background:transparent!important;box-shadow:none!important}
      .manager-kpi>.manager-drag-handle:hover{background:#eef2ff!important}
      .manager-kpi small{padding-right:22px!important}
      body.manager-sort-active{cursor:grabbing!important;user-select:none!important}
      body.manager-sort-active *{user-select:none!important}

      @media(max-width:1220px){.manager-info-widget{min-height:0!important}}
      @media(max-width:650px){.manager-info-clock{font-size:21px}}
    `;
    document.head.appendChild(s);
  }

  function widgetKey(card){
    if(card.id==='managerInfoWidget')return'info';
    if(card.querySelector('#managerNotifications'))return'notifications';
    if(card.querySelector('#managerNearestOrders'))return'nearest';
    return card.dataset.managerWidget||'';
  }

  function createInfoWidget(){
    const stack=document.querySelector('.manager-side-stack');
    if(!stack)return null;
    let card=document.getElementById('managerInfoWidget');
    if(card)return card;
    card=document.createElement('article');
    card.id='managerInfoWidget';
    card.className='mgr-card manager-info-widget';
    card.dataset.managerWidget='info';
    card.innerHTML=`
      <div class="mgr-head"><h3>Время и курсы</h3></div>
      <div class="manager-info-top">
        <div><div id="managerDigitalClock" class="manager-info-clock">--:--:--</div><div id="managerDigitalDate" class="manager-info-date">—</div></div>
        <div class="manager-info-zone">Москва · МСК</div>
      </div>
      <div class="manager-rates-title"><b>Курсы ЦБ РФ</b><span id="managerRatesMeta" class="manager-rates-meta">обновление…</span></div>
      <div id="managerRatesGrid" class="manager-rates-grid">
        <div class="manager-rate"><span class="manager-rate-code">USD</span><strong class="manager-rate-value">— ₽</strong></div>
        <div class="manager-rate"><span class="manager-rate-code">EUR</span><strong class="manager-rate-value">— ₽</strong></div>
        <div class="manager-rate"><span class="manager-rate-code">CNY</span><strong class="manager-rate-value">— ₽</strong></div>
      </div>`;
    stack.appendChild(card);
    return card;
  }

  function renderClock(){
    const time=document.getElementById('managerDigitalClock');
    const date=document.getElementById('managerDigitalDate');
    if(!time||!date)return;
    const now=new Date();
    time.textContent=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now);
    date.textContent=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',weekday:'short',day:'2-digit',month:'long'}).format(now).replace(/^./,x=>x.toUpperCase());
  }

  async function loadRates(){
    const grid=document.getElementById('managerRatesGrid');
    const meta=document.getElementById('managerRatesMeta');
    if(!grid)return;
    try{
      const base=String(window.A4PRINT_CONFIG?.apiBaseUrl||'').replace(/\/$/,'');
      if(!base)throw new Error('API HUB не настроен');
      const r=await fetch(`${base}/api/v1/cbr/rates`,{cache:'no-store'});
      const data=await r.json().catch(()=>({}));
      if(!r.ok||!data?.success)throw new Error(data?.message||data?.error||`HTTP ${r.status}`);
      const map=new Map((data.rates||[]).map(x=>[x.code,x]));
      grid.innerHTML=['USD','EUR','CNY'].map(code=>{
        const item=map.get(code);
        return item?`<div class="manager-rate"><span class="manager-rate-code">${esc(code)}</span><strong class="manager-rate-value">${fmt(item.per_unit)} ₽</strong></div>`:'';
      }).join('');
      if(meta){
        const d=String(data.effective_date||'').replace(/^(\d{2})\.(\d{2})\.(\d{4})$/,'$1.$2');
        meta.textContent=d?`на ${d}`:'актуальные';
      }
    }catch(error){
      grid.innerHTML='<div class="manager-rate-error">Курс временно недоступен. HUB повторит автоматически.</div>';
      if(meta)meta.textContent='нет связи';
      console.warn('Manager rates',error);
    }
  }

  function identity(el){return el.dataset.managerWidget||el.dataset.kpiKey||''}

  function saveOrder(container,selector,key){
    const ids=directChildren(container,selector).map(identity).filter(Boolean);
    try{localStorage.setItem(key,JSON.stringify(ids))}catch{}
  }

  function restoreOrderOnce(container,selector,key,flag){
    if(container.dataset[flag]==='1')return;
    container.dataset[flag]='1';
    try{
      const order=JSON.parse(localStorage.getItem(key)||'[]');
      if(!Array.isArray(order)||!order.length)return;
      const items=directChildren(container,selector);
      const map=new Map(items.map(el=>[identity(el),el]));
      order.forEach(id=>{const el=map.get(id);if(el)container.appendChild(el)});
    }catch{}
  }

  function clearTargets(container,selector){
    directChildren(container,selector).forEach(x=>x.classList.remove('manager-drag-over'));
  }

  function moveSide(active,e){
    const {card,container,selector}=active;
    const siblings=directChildren(container,selector).filter(el=>el!==card);
    if(!siblings.length)return;
    let before=null;
    for(const sibling of siblings){
      const rect=sibling.getBoundingClientRect();
      if(e.clientY<rect.top+rect.height/2){before=sibling;break}
    }
    const oldPrev=card.previousElementSibling;
    const oldNext=card.nextElementSibling;
    if(before)container.insertBefore(card,before);else container.appendChild(card);
    if(card.previousElementSibling!==oldPrev||card.nextElementSibling!==oldNext)active.changed=true;
    clearTargets(container,selector);
    const marker=before||siblings[siblings.length-1];
    if(marker&&marker!==card)marker.classList.add('manager-drag-over');
  }

  function moveGrid(active,e){
    const {card,container,selector}=active;
    const siblings=directChildren(container,selector).filter(el=>el!==card);
    if(!siblings.length)return;
    const hit=document.elementFromPoint(e.clientX,e.clientY);
    let target=hit?.closest?.(selector);
    if(!target||target===card||target.parentElement!==container){
      target=siblings.map(el=>{
        const r=el.getBoundingClientRect();
        const dx=e.clientX-(r.left+r.width/2);
        const dy=e.clientY-(r.top+r.height/2);
        return {el,d:dx*dx+dy*dy};
      }).sort((a,b)=>a.d-b.d)[0]?.el;
    }
    if(!target||target===card)return;
    const rect=target.getBoundingClientRect();
    const after=e.clientY>rect.top+rect.height*.65||(
      e.clientY>=rect.top+rect.height*.35&&e.clientY<=rect.top+rect.height*.65&&e.clientX>rect.left+rect.width/2
    );
    const oldPrev=card.previousElementSibling;
    const oldNext=card.nextElementSibling;
    container.insertBefore(card,after?target.nextSibling:target);
    if(card.previousElementSibling!==oldPrev||card.nextElementSibling!==oldNext)active.changed=true;
    clearTargets(container,selector);
    target.classList.add('manager-drag-over');
  }

  function addHandle(card,key,kind,container,selector,storageKey){
    if(!card||!container)return;
    let handle=card.querySelector('.manager-drag-handle');
    if(!handle){
      handle=document.createElement('button');
      handle.type='button';
      handle.className='manager-drag-handle';
      handle.textContent='⠿';
      handle.title='Зажмите и перетащите блок';
      handle.setAttribute('aria-label','Перетащить блок');
      if(kind==='side'){
        const head=[...card.children].find(el=>el.classList?.contains('mgr-head'));
        if(head)head.appendChild(handle);else card.prepend(handle);
      }else card.appendChild(handle);
    }
    handle.dataset.dragKey=key;
    handle.dataset.dragKind=kind;
    if(handle.dataset.sortV3Bound==='1')return;
    handle.dataset.sortV3Bound='1';

    handle.addEventListener('pointerdown',downEvent=>{
      if(sortActive)return;
      if(downEvent.pointerType==='mouse'&&downEvent.button!==0)return;
      sortActive=true;
      const active={
        card,container,selector,storageKey,kind,
        pointerId:downEvent.pointerId,
        startX:downEvent.clientX,startY:downEvent.clientY,
        moved:false,changed:false
      };
      card.classList.add('manager-dragging');
      document.body.classList.add('manager-sort-active');

      const onMove=e=>{
        if(e.pointerId!==active.pointerId)return;
        const distance=Math.hypot(e.clientX-active.startX,e.clientY-active.startY);
        if(!active.moved&&distance<4)return;
        active.moved=true;
        if(active.kind==='side')moveSide(active,e);else moveGrid(active,e);
        if(e.cancelable)e.preventDefault();
        e.stopPropagation();
      };

      const finish=e=>{
        if(e&&e.pointerId!=null&&e.pointerId!==active.pointerId)return;
        window.removeEventListener('pointermove',onMove,true);
        window.removeEventListener('pointerup',finish,true);
        window.removeEventListener('pointercancel',finish,true);
        card.classList.remove('manager-dragging');
        clearTargets(container,selector);
        document.body.classList.remove('manager-sort-active');
        if(active.changed)saveOrder(container,selector,storageKey);
        sortActive=false;
        if(e?.cancelable)e.preventDefault();
      };

      window.addEventListener('pointermove',onMove,true);
      window.addEventListener('pointerup',finish,true);
      window.addEventListener('pointercancel',finish,true);
      if(downEvent.cancelable)downEvent.preventDefault();
      downEvent.stopPropagation();
    },true);
  }

  function initSide(){
    const stack=document.querySelector('.manager-side-stack');
    if(!stack)return false;
    createInfoWidget();
    directChildren(stack,'.mgr-card').forEach(card=>{
      const key=widgetKey(card);
      if(key)card.dataset.managerWidget=key;
    });
    restoreOrderOnce(stack,'.mgr-card',SIDE_KEY,'sideOrderRestoredV3');
    directChildren(stack,'.mgr-card').forEach(card=>{
      const key=card.dataset.managerWidget;
      if(key)addHandle(card,key,'side',stack,'.mgr-card',SIDE_KEY);
    });
    renderClock();
    if(!clockTimer)clockTimer=setInterval(renderClock,1000);
    if(!ratesStarted){
      ratesStarted=true;
      loadRates();
      ratesTimer=setInterval(loadRates,RATES_REFRESH);
    }
    return true;
  }

  function kpiKey(card,index){
    const label=(card.querySelector('small')?.textContent||'').trim().toLowerCase();
    const map={'активные':'active','в работе':'work','готовы':'ready','просрочены':'overdue','срок сегодня':'today','активная сумма':'value'};
    return map[label]||`kpi-${index}`;
  }

  function initKpis(){
    const host=document.getElementById('managerBriefingCards');
    if(!host)return false;
    const cards=directChildren(host,'.manager-kpi');
    if(!cards.length)return false;
    cards.forEach((card,index)=>{if(!card.dataset.kpiKey)card.dataset.kpiKey=kpiKey(card,index)});
    restoreOrderOnce(host,'.manager-kpi',KPI_KEY,'kpiOrderRestoredV3');
    directChildren(host,'.manager-kpi').forEach(card=>addHandle(card,card.dataset.kpiKey,'kpi',host,'.manager-kpi',KPI_KEY));
    return true;
  }

  function init(){
    installStyles();
    initSide();
    initKpis();
    let queued=false;
    const obs=new MutationObserver(()=>{
      if(sortActive||queued)return;
      queued=true;
      requestAnimationFrame(()=>{
        queued=false;
        if(sortActive)return;
        initSide();
        initKpis();
      });
    });
    obs.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderClock();loadRates()}});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();