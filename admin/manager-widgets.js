(()=>{
  if(window.__A4_MANAGER_WIDGETS_V2__)return;
  window.__A4_MANAGER_WIDGETS_V2__=true;

  const SIDE_KEY='a4hub.manager.side.order.v2';
  const KPI_KEY='a4hub.manager.kpi.order.v2';
  const RATES_REFRESH=10*60*1000;
  let ratesTimer=null;
  let clockTimer=null;

  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmt=value=>Number(value||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:4});

  function installStyles(){
    if(document.getElementById('a4-manager-widgets-v2-style'))return;
    const s=document.createElement('style');
    s.id='a4-manager-widgets-v2-style';
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

      .manager-drag-handle{margin-left:auto;display:inline-grid!important;place-items:center!important;width:28px!important;height:28px!important;min-width:28px!important;min-height:28px!important;padding:0!important;border:1px solid #dbe4f0!important;background:#fff!important;color:#64748b!important;border-radius:9px!important;cursor:grab!important;font:900 15px/1 system-ui!important;box-shadow:0 1px 2px rgba(15,23,42,.04)!important;user-select:none!important;touch-action:none!important}
      .manager-drag-handle:hover{background:#eff6ff!important;border-color:#bfdbfe!important;color:#2563eb!important}
      .manager-drag-handle:active{cursor:grabbing!important;background:#dbeafe!important}
      .mgr-card.manager-dragging,.manager-kpi.manager-dragging{opacity:.60!important;transform:scale(.99)!important;box-shadow:0 12px 28px rgba(15,23,42,.10)!important;z-index:3!important}
      .mgr-card.manager-drag-over,.manager-kpi.manager-drag-over{outline:2px dashed #60a5fa!important;outline-offset:3px!important}
      .manager-kpi{position:relative!important}
      .manager-kpi>.manager-drag-handle{position:absolute!important;right:7px!important;top:6px!important;width:22px!important;height:22px!important;min-width:22px!important;min-height:22px!important;font-size:12px!important;border:0!important;background:transparent!important;box-shadow:none!important}
      .manager-kpi>.manager-drag-handle:hover{background:#eef2ff!important}
      .manager-kpi small{padding-right:20px!important}
      body.manager-sort-active{cursor:grabbing!important;user-select:none!important}

      @media(max-width:1220px){
        .manager-info-widget{min-height:0!important}
      }
      @media(max-width:650px){
        .manager-rates-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
        .manager-info-clock{font-size:21px}
      }
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

  function saveOrder(container,selector,key){
    const ids=[...container.querySelectorAll(`:scope > ${selector}`)]
      .map(el=>el.dataset.managerWidget||el.dataset.kpiKey)
      .filter(Boolean);
    try{localStorage.setItem(key,JSON.stringify(ids))}catch{}
  }

  function restoreOrder(container,selector,key){
    try{
      const order=JSON.parse(localStorage.getItem(key)||'[]');
      if(!Array.isArray(order)||!order.length)return;
      const items=[...container.querySelectorAll(`:scope > ${selector}`)];
      const map=new Map(items.map(el=>[el.dataset.managerWidget||el.dataset.kpiKey,el]));
      order.forEach(id=>{const el=map.get(id);if(el)container.appendChild(el)});
    }catch{}
  }

  function clearTargets(container,selector){
    [...container.querySelectorAll(`:scope > ${selector}`)].forEach(x=>x.classList.remove('manager-drag-over'));
  }

  function addHandle(card,key,kind,container,selector,storageKey){
    if(!card||!container)return;
    let handle=card.querySelector(':scope > .manager-drag-handle, :scope > .mgr-head .manager-drag-handle');
    if(!handle){
      handle=document.createElement('button');
      handle.type='button';
      handle.className='manager-drag-handle';
      handle.textContent='⠿';
      handle.title='Зажмите и перетащите блок';
      handle.setAttribute('aria-label','Перетащить блок');
      handle.dataset.dragKey=key;
      handle.dataset.dragKind=kind;
      if(kind==='side'){
        const head=card.querySelector(':scope > .mgr-head');
        if(head)head.appendChild(handle);else card.prepend(handle);
      }else card.appendChild(handle);
    }
    if(handle.dataset.pointerSortBound==='1')return;
    handle.dataset.pointerSortBound='1';

    let active=null;
    let suppressClickUntil=0;

    const finish=e=>{
      if(!active)return;
      const moved=active.moved;
      card.classList.remove('manager-dragging');
      clearTargets(container,selector);
      document.body.classList.remove('manager-sort-active');
      try{if(handle.hasPointerCapture?.(active.pointerId))handle.releasePointerCapture(active.pointerId)}catch{}
      active=null;
      if(moved){
        suppressClickUntil=Date.now()+350;
        saveOrder(container,selector,storageKey);
      }
      if(e?.cancelable)e.preventDefault();
    };

    handle.addEventListener('pointerdown',e=>{
      if(e.pointerType==='mouse'&&e.button!==0)return;
      active={pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,moved:false};
      card.classList.add('manager-dragging');
      document.body.classList.add('manager-sort-active');
      try{handle.setPointerCapture(e.pointerId)}catch{}
      e.preventDefault();
      e.stopPropagation();
    });

    handle.addEventListener('pointermove',e=>{
      if(!active||e.pointerId!==active.pointerId)return;
      const distance=Math.hypot(e.clientX-active.startX,e.clientY-active.startY);
      if(!active.moved&&distance<5)return;
      active.moved=true;
      const hit=document.elementFromPoint(e.clientX,e.clientY);
      const target=hit?.closest(selector);
      clearTargets(container,selector);
      if(target&&target!==card&&target.parentElement===container){
        target.classList.add('manager-drag-over');
        const rect=target.getBoundingClientRect();
        let after;
        if(kind==='side'){
          after=e.clientY>rect.top+rect.height/2;
        }else{
          const cy=rect.top+rect.height/2;
          const cx=rect.left+rect.width/2;
          const verticalOffset=e.clientY-cy;
          after=Math.abs(verticalOffset)>rect.height*.30?verticalOffset>0:e.clientX>cx;
        }
        container.insertBefore(card,after?target.nextSibling:target);
      }
      e.preventDefault();
      e.stopPropagation();
    });

    handle.addEventListener('pointerup',finish);
    handle.addEventListener('pointercancel',finish);
    handle.addEventListener('lostpointercapture',()=>finish());
    handle.addEventListener('click',e=>{
      if(Date.now()<suppressClickUntil){e.preventDefault();e.stopPropagation()}
    },true);
  }

  function initSide(){
    const stack=document.querySelector('.manager-side-stack');
    if(!stack)return false;
    createInfoWidget();
    const cards=[...stack.querySelectorAll(':scope > .mgr-card')];
    cards.forEach(card=>{
      const key=widgetKey(card);
      if(!key)return;
      card.dataset.managerWidget=key;
    });
    restoreOrder(stack,'.mgr-card',SIDE_KEY);
    [...stack.querySelectorAll(':scope > .mgr-card')].forEach(card=>{
      const key=card.dataset.managerWidget;
      if(key)addHandle(card,key,'side',stack,'.mgr-card',SIDE_KEY);
    });
    renderClock();
    if(!clockTimer)clockTimer=setInterval(renderClock,1000);
    loadRates();
    if(!ratesTimer)ratesTimer=setInterval(loadRates,RATES_REFRESH);
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
    const cards=[...host.querySelectorAll(':scope > .manager-kpi')];
    if(!cards.length)return false;
    cards.forEach((card,index)=>{card.dataset.kpiKey=kpiKey(card,index)});
    restoreOrder(host,'.manager-kpi',KPI_KEY);
    [...host.querySelectorAll(':scope > .manager-kpi')].forEach(card=>{
      addHandle(card,card.dataset.kpiKey,'kpi',host,'.manager-kpi',KPI_KEY);
    });
    return true;
  }

  function init(){
    installStyles();
    initSide();
    initKpis();
    let queued=false;
    const obs=new MutationObserver(()=>{
      if(queued)return;
      queued=true;
      requestAnimationFrame(()=>{
        queued=false;
        initSide();
        initKpis();
      });
    });
    obs.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderClock();loadRates()}});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
