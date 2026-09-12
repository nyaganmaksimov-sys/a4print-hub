(()=>{
  if(window.__A4_COMPACT_POPUP_WORKSPACE__)return;
  window.__A4_COMPACT_POPUP_WORKSPACE__=true;

  const path=location.pathname||'';
  const params=new URLSearchParams(location.search);
  const isAdmin=/\/admin\//.test(path);
  const isAuth=/\/admin\/(?:login|register|pending|invite|reset-password)\.html$/.test(path);
  const isChat=/\/admin\/messages\.html$/.test(path);
  const isPrint=/\/admin\/invoice\.html$/.test(path);
  const isPosWrapper=/\/admin\/pos\.html$/.test(path);
  const isPartners=/\/admin\/partners\.html$/.test(path);
  const embedded=params.get('embed')==='1'||params.get('app')==='1';
  if(!isAdmin||isAuth||isChat||isPrint||isPosWrapper||isPartners||embedded)return;

  const CANDIDATE='.main .card,.main .panel,.main .box,.main .section-card';
  const HARD_EXCLUDE=[
    'dialog','[role="dialog"]','.modal','.dialog','.overlay','.drawer',
    '.a4-pop-card','.partners-popup-card','.a4-block-hidden-panel',
    '#hubChatWidget','#hubChatNotifyCenter','.a4-more-menu',
    '[data-a4-popup="off"]'
  ].join(',');

  const pageLabels={
    'orders.html':'Список заказов',
    'customers.html':'Клиенты',
    'customer.html':'Карточка клиента',
    'requests.html':'Заявки',
    'employees.html':'Сотрудники',
    'staff-structure.html':'Структура сотрудников',
    'users.html':'Пользователи',
    'operators.html':'Операторы кассы',
    'equipment.html':'Оборудование и расходники',
    'documents.html':'Документы',
    'production.html':'Производство',
    'payments.html':'Платежи',
    'reports.html':'Отчёты',
    'warehouse.html':'Склад',
    'settings.html':'Настройки',
    'support.html':'Центр поддержки',
    'telegram.html':'Telegram',
    'commerce.html':'Коммерция',
    'apps.html':'Приложения',
    'help.html':'Помощь',
    'profile.html':'Профиль',
    'order.html':'Карточка заказа',
    'partner.html':'Карточка партнёра',
    'item.html':'Карточка позиции',
    'drive-connect.html':'Подключение диска',
    'executor-requests.html':'Заявки исполнителей',
    'cuim-delivery.html':'Доставка ЦУИМ'
  };

  let current=null;
  let observer=null;
  let scanTimer=0;
  let uid=0;
  const enhanced=new Set();

  const style=document.createElement('style');
  style.id='a4-compact-popup-workspace-style';
  style.textContent=`
    html.a4-compact-popup-html{background:#f5f8fc}
    body.a4-compact-popup-workspace .main{min-width:0!important}
    body.a4-compact-popup-workspace .main>.topbar{margin-bottom:9px!important;padding-bottom:7px!important}
    body.a4-compact-popup-workspace .main>.topbar h1{margin-bottom:2px!important}
    body.a4-compact-popup-workspace .main>.topbar p{line-height:1.35!important}
    body.a4-compact-popup-workspace.a4-popup-open{overflow:hidden!important}

    .a4-pop-card{position:relative!important;min-width:0!important;box-sizing:border-box!important}
    .a4-pop-card:not(.a4-pop-open){height:96px!important;min-height:96px!important;max-height:96px!important;padding:0!important;overflow:hidden!important;border:1px solid #dfe7f1!important;border-radius:16px!important;background:#fff!important;box-shadow:0 5px 17px rgba(31,52,79,.04)!important;transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease!important}
    .a4-pop-card:not(.a4-pop-open):hover{transform:translateY(-1px)!important;border-color:#cbd8e8!important;box-shadow:0 8px 22px rgba(31,52,79,.07)!important}
    .a4-pop-card:not(.a4-pop-open)>:not(.a4-pop-summary):not(.a4-pop-close){display:none!important}

    body.a4-compact-popup-workspace .a4-pop-card>.a4-pop-summary{
      position:relative!important;inset:auto!important;float:none!important;display:grid!important;
      grid-template-columns:44px minmax(0,1fr) auto!important;
      grid-template-rows:auto auto!important;align-items:center!important;column-gap:11px!important;row-gap:3px!important;
      width:100%!important;height:100%!important;min-height:100%!important;max-height:none!important;
      margin:0!important;padding:12px 14px!important;box-sizing:border-box!important;
      border:0!important;border-radius:0!important;background:transparent!important;color:inherit!important;
      box-shadow:none!important;text-align:left!important;cursor:pointer!important;white-space:normal!important;
      transform:none!important;font-family:inherit!important;line-height:1.2!important;
    }
    body.a4-compact-popup-workspace .a4-pop-card>.a4-pop-summary:hover{background:#fbfdff!important;transform:none!important}
    .a4-pop-icon{grid-row:1/3;width:42px;height:42px;display:grid;place-items:center;border-radius:12px;background:#eef5ff;color:#2563eb;font-size:19px;font-weight:900;line-height:1}
    .a4-pop-title{align-self:end;min-width:0;color:#172033;font-size:14px;font-weight:900;line-height:1.2;letter-spacing:-.015em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .a4-pop-desc{align-self:start;min-width:0;color:#7b8ba1;font-size:10.5px;font-weight:650;line-height:1.32;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .a4-pop-open-label{grid-column:3;grid-row:1/3;align-self:center;display:inline-flex;align-items:center;gap:5px;color:#2563eb;font-size:10.5px;font-weight:850;white-space:nowrap}
    .a4-pop-open-label:after{content:'›';font-size:18px;line-height:.8}

    .a4-pop-backdrop{position:fixed;inset:0;z-index:39000;background:rgba(15,23,42,.42);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .14s ease}
    .a4-pop-backdrop.a4-pop-backdrop-active{opacity:1;pointer-events:auto}
    .a4-pop-card.a4-pop-open{position:fixed!important;z-index:39001!important;top:3vh!important;right:3vw!important;bottom:3vh!important;left:3vw!important;width:auto!important;height:auto!important;min-height:0!important;max-width:none!important;max-height:none!important;margin:0!important;padding:18px!important;overflow:auto!important;overscroll-behavior:contain;background:#fff!important;border:1px solid #dbe4ef!important;border-radius:20px!important;box-shadow:0 28px 90px rgba(15,23,42,.28)!important;transform:none!important;isolation:isolate}
    .a4-pop-card.a4-pop-open>.a4-pop-summary{display:none!important}
    body.a4-compact-popup-workspace .a4-pop-card>.a4-pop-close{display:none!important}
    body.a4-compact-popup-workspace .a4-pop-card.a4-pop-open>.a4-pop-close{
      position:sticky!important;z-index:20!important;top:0!important;float:right!important;display:grid!important;place-items:center!important;
      width:38px!important;height:38px!important;min-width:38px!important;min-height:38px!important;max-width:38px!important;
      margin:0 0 8px 12px!important;padding:0!important;border:1px solid #dbe4ef!important;border-radius:11px!important;
      background:rgba(255,255,255,.96)!important;color:#64748b!important;box-shadow:0 4px 15px rgba(15,23,42,.08)!important;
      font:500 23px/1 system-ui!important;cursor:pointer!important;transform:none!important
    }
    body.a4-compact-popup-workspace .a4-pop-card.a4-pop-open>.a4-pop-close:hover{background:#f8fafc!important;color:#0f172a!important;transform:none!important}

    .a4-pop-grid-parent{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))!important;gap:10px!important;align-items:start!important}
    .a4-pop-grid-parent>.a4-pop-card{margin:0!important;width:auto!important;max-width:none!important;grid-column:auto!important;grid-row:auto!important}
    .a4-pop-grid-parent>.a4-pop-card.a4-pop-open{margin:0!important}

    body.a4-compact-popup-workspace .main>.stats{margin-bottom:10px!important;gap:8px!important}
    body.a4-compact-popup-workspace .main>.stats article{padding:10px 12px!important;min-height:68px!important}
    body.a4-compact-popup-workspace .main>.stats strong{line-height:1.05!important}

    @media(max-width:1100px){
      .a4-pop-grid-parent{grid-template-columns:repeat(2,minmax(0,1fr))!important}
      .a4-pop-card.a4-pop-open{top:2vh!important;right:2vw!important;bottom:2vh!important;left:2vw!important}
    }
    @media(max-width:700px){
      .a4-pop-grid-parent{grid-template-columns:1fr!important;gap:8px!important}
      .a4-pop-card:not(.a4-pop-open){height:86px!important;min-height:86px!important;max-height:86px!important;border-radius:14px!important}
      body.a4-compact-popup-workspace .a4-pop-card>.a4-pop-summary{grid-template-columns:38px minmax(0,1fr) auto!important;padding:10px 11px!important;column-gap:9px!important}
      .a4-pop-icon{width:36px;height:36px;border-radius:10px;font-size:16px}
      .a4-pop-title{font-size:13px}.a4-pop-desc{font-size:9.8px}.a4-pop-open-label{font-size:0}.a4-pop-open-label:after{font-size:20px}
      .a4-pop-card.a4-pop-open{top:6px!important;right:6px!important;bottom:6px!important;left:6px!important;padding:13px!important;border-radius:16px!important}
      body.a4-compact-popup-workspace .a4-pop-card.a4-pop-open>.a4-pop-close{width:40px!important;height:40px!important;min-width:40px!important;min-height:40px!important}
    }
    @media(prefers-reduced-motion:reduce){.a4-pop-card,.a4-pop-backdrop{transition:none!important}}
  `;
  document.head.appendChild(style);

  function fileName(){return path.split('/').filter(Boolean).pop()||'index.html'}
  function text(el){return String(el?.textContent||'').replace(/\s+/g,' ').trim()}

  function headingFor(card){
    const explicit=card.getAttribute('data-popup-title')||card.getAttribute('aria-label');
    if(explicit&&explicit.trim())return explicit.trim();
    const direct=card.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > header h1,:scope > header h2,:scope > header h3,:scope > .panel-head h1,:scope > .panel-head h2,:scope > .panel-head h3,:scope > .panel-head2 h2,:scope > .card-head h2,:scope > .section-head h2');
    if(text(direct))return text(direct).slice(0,78);
    const any=card.querySelector('h1,h2,h3');
    if(text(any))return text(any).slice(0,78);
    return pageLabels[fileName()]||text(document.querySelector('.main>.topbar h1'))||'Раздел';
  }

  function descFor(card,title){
    const explicit=card.getAttribute('data-popup-description');
    if(explicit&&explicit.trim())return explicit.trim();
    const candidates=[
      ':scope > .small',':scope > .meta',':scope > p',
      ':scope > header p',':scope > .panel-head p',':scope > .card-head p',
      ':scope > .row .small',':scope > .row .meta'
    ];
    for(const selector of candidates){
      const value=text(card.querySelector(selector));
      if(value&&value!==title&&value.length>3)return value.slice(0,150);
    }
    if(card.querySelector('table'))return 'Таблица и подробные данные';
    if(card.querySelector('form'))return 'Форма и рабочие параметры';
    if(card.querySelector('input,select,textarea'))return 'Фильтры, параметры и данные';
    const rows=card.querySelectorAll('.row,.item,.list-row,.order-row,tr').length;
    if(rows>0)return `${rows} ${rows===1?'элемент':'элементов'} · открыть полностью`;
    return 'Нажмите, чтобы открыть полностью';
  }

  function iconFor(title,card){
    const value=title.toLowerCase();
    if(/заказ|заяв/.test(value))return '▤';
    if(/клиент|контрагент/.test(value))return '👤';
    if(/сотруд|персонал|структур|пользоват|оператор/.test(value))return '♙';
    if(/оборуд|техник|сервис/.test(value))return '⚙';
    if(/склад|расход|остат|товар|материал/.test(value))return '▣';
    if(/плат|финанс|касс|сч[её]т/.test(value))return '₽';
    if(/отч[её]т|аналит/.test(value))return '↗';
    if(/документ|файл|диск/.test(value))return '▧';
    if(/настрой/.test(value))return '⚙';
    if(/telegram|телеграм|сообщ/.test(value))return '✈';
    if(/поддерж|помощ/.test(value))return '?';
    if(/производ/.test(value))return '◆';
    if(/достав/.test(value))return '↗';
    if(card.querySelector('form'))return '＋';
    if(card.querySelector('table'))return '▦';
    return '◇';
  }

  function isVisibleEnough(card){
    if(card.hidden||card.getAttribute('aria-hidden')==='true')return false;
    const css=getComputedStyle(card);
    if(css.display==='none'||css.visibility==='hidden')return false;
    return true;
  }

  function shouldCompact(card){
    if(!(card instanceof HTMLElement)||card.matches(HARD_EXCLUDE)||card.closest(HARD_EXCLUDE))return false;
    if(card.closest('dialog,[role="dialog"],.modal,.dialog,.overlay,.drawer'))return false;
    if(card.classList.contains('dash-card')||card.classList.contains('dash-unit-card')||card.classList.contains('manager-panel'))return false;
    if(card.closest('.dash-card,.dash-unit-card,.manager-panel'))return false;
    if(card.matches('.stats article,.partners-popup-card'))return false;
    if(card.dataset.a4Popup==='off')return false;
    if(!isVisibleEnough(card))return false;
    const parentCandidate=card.parentElement?.closest?.(CANDIDATE);
    if(parentCandidate&&!parentCandidate.matches(HARD_EXCLUDE))return false;
    return true;
  }

  function ensureBackdrop(){
    let backdrop=document.querySelector('.a4-pop-backdrop');
    if(backdrop)return backdrop;
    backdrop=document.createElement('div');
    backdrop.className='a4-pop-backdrop';
    backdrop.setAttribute('aria-hidden','true');
    backdrop.addEventListener('click',()=>close());
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function open(card){
    if(!card||!card.classList.contains('a4-pop-card'))return;
    if(current&&current!==card)close(false);
    current=card;
    ensureBackdrop().classList.add('a4-pop-backdrop-active');
    document.body.classList.add('a4-popup-open');
    card.classList.add('a4-pop-open');
    card.setAttribute('aria-expanded','true');
    card.scrollTop=0;
    requestAnimationFrame(()=>card.querySelector(':scope > .a4-pop-close')?.focus({preventScroll:true}));
  }

  function close(restoreFocus=true){
    const card=current||document.querySelector('.a4-pop-card.a4-pop-open');
    if(!card)return;
    current=null;
    card.classList.remove('a4-pop-open');
    card.setAttribute('aria-expanded','false');
    document.querySelector('.a4-pop-backdrop')?.classList.remove('a4-pop-backdrop-active');
    document.body.classList.remove('a4-popup-open');
    if(restoreFocus)requestAnimationFrame(()=>card.querySelector(':scope > .a4-pop-summary')?.focus({preventScroll:true}));
  }

  function enhance(card){
    if(!shouldCompact(card)||card.dataset.a4PopupReady==='1')return false;
    card.dataset.a4PopupReady='1';
    card.classList.add('a4-pop-card');
    card.setAttribute('aria-expanded','false');
    card.dataset.a4PopupId=card.dataset.a4PopupId||`a4-pop-${++uid}`;

    const title=headingFor(card);
    const desc=descFor(card,title);
    const summary=document.createElement('button');
    summary.type='button';
    summary.className='a4-pop-summary';
    summary.setAttribute('aria-label',`Открыть «${title}»`);
    summary.innerHTML=`<span class="a4-pop-icon" aria-hidden="true">${iconFor(title,card)}</span><span class="a4-pop-title"></span><span class="a4-pop-desc"></span><span class="a4-pop-open-label">Открыть</span>`;
    summary.querySelector('.a4-pop-title').textContent=title;
    summary.querySelector('.a4-pop-desc').textContent=desc;
    summary.addEventListener('click',()=>open(card));

    const closeBtn=document.createElement('button');
    closeBtn.type='button';
    closeBtn.className='a4-pop-close';
    closeBtn.setAttribute('aria-label',`Закрыть «${title}»`);
    closeBtn.title='Закрыть';
    closeBtn.textContent='×';
    closeBtn.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();close()});

    card.append(summary,closeBtn);
    enhanced.add(card);
    return true;
  }

  function compactParent(parent){
    if(!(parent instanceof HTMLElement)||parent.classList.contains('a4-pop-grid-parent'))return;
    const direct=[...parent.children].filter(el=>el.classList?.contains('a4-pop-card'));
    if(direct.length<2)return;
    const meaningful=[...parent.children].filter(el=>el instanceof HTMLElement&&!el.matches('script,style,.a4-pop-backdrop')&&!el.hidden);
    const nonCards=meaningful.filter(el=>!el.classList.contains('a4-pop-card'));
    const parentClass=parent.className||'';
    const layoutLike=/grid|cards|panels|columns|blocks|sections|settings|content|workspace|list|column/i.test(String(parentClass));
    if(nonCards.length===0||layoutLike&&nonCards.length<=1)parent.classList.add('a4-pop-grid-parent');
  }

  function scan(){
    clearTimeout(scanTimer);
    if(!document.body||!document.querySelector('.main'))return;
    document.documentElement.classList.add('a4-compact-popup-html');
    document.body.classList.add('a4-compact-popup-workspace');
    ensureBackdrop();
    const cards=[...document.querySelectorAll(CANDIDATE)].filter(shouldCompact);
    const touched=new Set();
    for(const card of cards){
      if(enhance(card))touched.add(card.parentElement);
      else if(card.classList.contains('a4-pop-card'))touched.add(card.parentElement);
    }
    touched.forEach(compactParent);
  }

  function scheduleScan(delay=60){clearTimeout(scanTimer);scanTimer=setTimeout(scan,delay)}

  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&document.querySelector('.a4-pop-card.a4-pop-open')){event.preventDefault();close()}
  });

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>scheduleScan(140),{once:true});
  }else scheduleScan(80);
  window.addEventListener('load',()=>scheduleScan(260),{once:true});

  const startObserver=()=>{
    if(observer||!document.body)return;
    observer=new MutationObserver(mutations=>{
      if(mutations.some(m=>[...m.addedNodes].some(n=>n instanceof HTMLElement&&!n.matches?.('.a4-pop-summary,.a4-pop-close,.a4-pop-backdrop'))))scheduleScan(90);
    });
    observer.observe(document.body,{childList:true,subtree:true});
  };
  if(document.body)startObserver();else document.addEventListener('DOMContentLoaded',startObserver,{once:true});

  window.A4WorkspacePopup={open,close,refresh:()=>scheduleScan(0)};
})();
