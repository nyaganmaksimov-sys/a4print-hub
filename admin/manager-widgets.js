(()=>{
  if(window.__A4_MANAGER_WIDGETS__)return;
  window.__A4_MANAGER_WIDGETS__=true;

  const SIDE_KEY='a4hub.manager.side.order.v1';
  const KPI_KEY='a4hub.manager.kpi.order.v1';
  const RATES_REFRESH=10*60*1000;
  let ratesTimer=null;
  let clockTimer=null;

  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmt=value=>Number(value||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:4});

  function installStyles(){
    if(document.getElementById('a4-manager-widgets-style'))return;
    const s=document.createElement('style');
    s.id='a4-manager-widgets-style';
    s.textContent=`
      .manager-info-widget{overflow:hidden}
      .manager-info-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 0 10px;border-bottom:1px solid #edf2f7}
      .manager-info-clock{font-size:27px;line-height:1;font-weight:900;color:#0f172a;font-variant-numeric:tabular-nums;letter-spacing:.025em}
      .manager-info-date{margin-top:4px;color:#64748b;font-size:10px;font-weight:800;text-transform:capitalize}
      .manager-info-zone{display:flex;align-items:center;gap:6px;color:#64748b;font-size:10px;font-weight:800;white-space:nowrap}
      .manager-info-zone::before{content:'';width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 4px rgba(34,197,94,.10)}
      .manager-rates-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0 7px}
      .manager-rates-title b{font-size:11px;color:#475569}
      .manager-rates-meta{font-size:9px;color:#94a3b8;white-space:nowrap}
      .manager-rates-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
      .manager-rate{border:1px solid #e7edf5;background:#f8fafc;border-radius:10px;padding:7px 8px;min-width:0}
      .manager-rate-code{display:block;color:#64748b;font-size:9px;font-weight:900;letter-spacing:.04em}
      .manager-rate-value{display:block;margin-top:2px;color:#0f172a;font-size:13px;font-weight:900;white-space:nowrap}
      .manager-rate-error{grid-column:1/-1;padding:8px 9px;border-radius:9px;background:#fff7f7;border:1px dashed #fecaca;color:#b91c1c;font-size:10px}

      .manager-drag-handle{margin-left:auto;display:inline-grid;place-items:center;width:28px;height:28px;border:0!important;background:transparent!important;color:#94a3b8!important;border-radius:8px;cursor:grab!important;font:900 16px/1 system-ui!important;box-shadow:none!important;user-select:none;touch-action:none}
      .manager-drag-handle:hover{background:#f1f5f9!important;color:#2563eb!important}
      .manager-drag-handle:active{cursor:grabbing!important}
      .mgr-card.manager-dragging,.manager-kpi.manager-dragging{opacity:.52;transform:scale(.985)}
      .mgr-card.manager-drag-over,.manager-kpi.manager-drag-over{outline:2px dashed #60a5fa;outline-offset:3px}
      .manager-kpi{position:relative}
      .manager-kpi>.manager-drag-handle{position:absolute;right:7px;top:6px;width:23px;height:23px;font-size:14px}
      .manager-kpi small{padding-right:20px}
      @media(max-width:650px){.manager-rates-grid{grid-template-columns:1fr 1fr 1fr}.manager-info-clock{font-size:23px}}
    `;
    document.head.appendChild(s);
  }

  function widgetKey(card){
    if(card.id==='managerInfoWidget')return'info';
    if(card.querySelector('#managerNotifications'))return'notifications';
    if(card.querySelector('#managerNearestOrders'))return'nearest';
    return card.dataset.managerWidget||'';
  }

  function addHandle(card,key,kind='side'){
    if(!card||card.querySelector(':scope > .manager-drag-handle, :scope > .mgr-head .manager-drag-handle'))return;
    const handle=document.createElement('button');
    handle.type='button';
    handle.className='manager-drag-handle';
    handle.textContent='⠿';
    handle.title='Перетащить блок';
    handle.setAttribute('aria-label','Перетащить блок');
    handle.draggable=true;
    handle.dataset.dragKey=key;
    handle.dataset.dragKind=kind;
    if(kind==='side'){
      const head=card.querySelector(':scope > .mgr-head');
      if(head)head.appendChild(handle);else card.prepend(handle);
    }else card.appendChild(handle);
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
    date.textContent=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',weekday:'short',day:'2-digit',month:'long',year:'numeric'}).format(now).replace(/^./,x=>x.toUpperCase());
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
      grid.innerHTML=['USD','EUR','CNY'].map(code=>{const item=map.get(code);return item?`<div class="manager-rate"><span class="manager-rate-code">${esc(code)}</span><strong class="manager-rate-value">${fmt(item.per_unit)} ₽</strong></div>`:''}).join('');
      if(meta){
        const d=String(data.effective_date||'').replace(/^(\d{2})\.(\d{2})\.(\d{4})$/,'$1.$2.$3');
        meta.textContent=d?`на ${d}`:'актуальные';
      }
    }catch(error){
      grid.innerHTML='<div class="manager-rate-error">Курс временно недоступен — HUB повторит автоматически.</div>';
      if(meta)meta.textContent='нет связи';
      console.warn('Manager rates',error);
    }
  }

  function saveOrder(container,selector,key){
    const ids=[...container.querySelectorAll(selector)].map(el=>el.dataset.managerWidget||el.dataset.kpiKey).filter(Boolean);
    localStorage.setItem(key,JSON.stringify(ids));
  }

  function restoreOrder(container,selector,key){
    try{
      const order=JSON.parse(localStorage.getItem(key)||'[]');
      if(!Array.isArray(order)||!order.length)return;
      const map=new Map([...container.querySelectorAll(selector)].map(el=>[el.dataset.managerWidget||el.dataset.kpiKey,el]));
      order.forEach(id=>{const el=map.get(id);if(el)container.appendChild(el)});
    }catch{}
  }

  function bindSortable(container,selector,key,kind){
    if(!container||container.dataset.sortBound===key)return;
    container.dataset.sortBound=key;
    let dragging=null;
    container.addEventListener('dragstart',e=>{
      const handle=e.target.closest('.manager-drag-handle');
      if(!handle||handle.dataset.dragKind!==kind)return;
      const card=handle.closest(selector);
      if(!card)return;
      dragging=card;
      card.classList.add('manager-dragging');
      e.dataTransfer.effectAllowed='move';
      try{e.dataTransfer.setData('text/plain',handle.dataset.dragKey||'widget')}catch{}
    });
    container.addEventListener('dragover',e=>{
      if(!dragging)return;
      e.preventDefault();
      const target=e.target.closest(selector);
      [...container.querySelectorAll(selector)].forEach(x=>x.classList.remove('manager-drag-over'));
      if(target&&target!==dragging)target.classList.add('manager-drag-over');
    });
    container.addEventListener('drop',e=>{
      if(!dragging)return;
      e.preventDefault();
      const target=e.target.closest(selector);
      if(target&&target!==dragging){
        const rect=target.getBoundingClientRect();
        const after=kind==='side'?e.clientY>rect.top+rect.height/2:e.clientX>rect.left+rect.width/2;
        target.parentNode.insertBefore(dragging,after?target.nextSibling:target);
      }
      saveOrder(container,selector,key);
    });
    container.addEventListener('dragend',()=>{
      if(dragging)dragging.classList.remove('manager-dragging');
      [...container.querySelectorAll(selector)].forEach(x=>x.classList.remove('manager-drag-over'));
      dragging=null;
      saveOrder(container,selector,key);
    });
  }

  function initSide(){
    const stack=document.querySelector('.manager-side-stack');
    if(!stack)return false;
    createInfoWidget();
    [...stack.querySelectorAll(':scope > .mgr-card')].forEach(card=>{
      const key=widgetKey(card);
      if(!key)return;
      card.dataset.managerWidget=key;
      addHandle(card,key,'side');
    });
    restoreOrder(stack,':scope > .mgr-card',SIDE_KEY);
    bindSortable(stack,':scope > .mgr-card',SIDE_KEY,'side');
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
    cards.forEach((card,index)=>{
      const key=kpiKey(card,index);
      card.dataset.kpiKey=key;
      addHandle(card,key,'kpi');
    });
    restoreOrder(host,':scope > .manager-kpi',KPI_KEY);
    bindSortable(host,':scope > .manager-kpi',KPI_KEY,'kpi');
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
      requestAnimationFrame(()=>{queued=false;initSide();initKpis()});
    });
    obs.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderClock();loadRates()}});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
