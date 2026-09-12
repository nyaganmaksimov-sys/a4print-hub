(()=>{
  if(window.__A4_POPUP_COVERAGE__)return;
  window.__A4_POPUP_COVERAGE__=true;

  const path=location.pathname||'';
  if(!/\/admin\//.test(path))return;
  if(/\/(?:login|register|pending|invite|reset-password|messages|invoice|pos|partners)\.html$/.test(path))return;
  const params=new URLSearchParams(location.search);
  if(params.get('embed')==='1'||params.get('app')==='1')return;

  const style=document.createElement('style');
  style.id='a4-popup-coverage-style';
  style.textContent=`
    body.a4-compact-popup-workspace .main{overflow-x:hidden!important}
    body.a4-compact-popup-workspace .a4-pop-card:not(.a4-pop-open){height:82px!important;min-height:82px!important;max-height:82px!important}
    body.a4-compact-popup-workspace .a4-pop-card:not(.a4-pop-open)>.a4-pop-summary{display:grid!important;visibility:visible!important}
    body.a4-compact-popup-workspace .a4-pop-card.a4-pop-open.is-collapsed>:not(.a4-pop-summary):not(.a4-pop-close){display:revert!important}
    body.a4-compact-popup-workspace .a4-pop-grid-parent{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))!important;gap:9px!important}

    body.a4-compact-popup-workspace .reports-shell{display:grid!important;gap:10px!important}
    body.a4-compact-popup-workspace .reports-grid{gap:9px!important}
    body.a4-compact-popup-workspace .reports-card.a4-pop-card{margin:0!important}

    body.a4-compact-popup-workspace .eq-shell{display:grid!important;gap:10px!important}
    body.a4-compact-popup-workspace .eq-card.a4-pop-card{margin:0!important}
    body.a4-compact-popup-workspace .eq-tabs{margin:0!important}

    body.a4-compact-popup-workspace #managerCalendarWrap.manager-workspace-v3{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:9px!important;margin-bottom:10px!important}
    body.a4-compact-popup-workspace #managerCalendarWrap.manager-workspace-v3>.manager-event-card{grid-column:auto!important;margin:0!important}
    body.a4-compact-popup-workspace #managerCalendarWrap.manager-workspace-v3>.manager-workspace-columns{display:contents!important}
    body.a4-compact-popup-workspace #managerCalendarWrap.manager-workspace-v3 .manager-left-flow,
    body.a4-compact-popup-workspace #managerCalendarWrap.manager-workspace-v3 .manager-right-flow,
    body.a4-compact-popup-workspace #managerCalendarWrap.manager-workspace-v3 .manager-side-stack{display:contents!important}
    body.a4-compact-popup-workspace #managerCalendarWrap.manager-workspace-v3 .manager-flow-section{display:contents!important}
    body.a4-compact-popup-workspace #managerCalendarWrap.manager-workspace-v3 .manager-grid-absorbed{display:none!important}
    body.a4-compact-popup-workspace .manager-panel.a4-pop-card,
    body.a4-compact-popup-workspace .mgr-card.a4-pop-card{margin:0!important}

    body.a4-compact-popup-workspace .dash-panel-column.a4-pop-grid-parent{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))!important}
    body.a4-compact-popup-workspace .dash-card.a4-pop-card{margin:0!important}

    @media(max-width:1250px){
      body.a4-compact-popup-workspace #managerCalendarWrap.manager-workspace-v3{grid-template-columns:repeat(2,minmax(0,1fr))!important}
    }
    @media(max-width:700px){
      body.a4-compact-popup-workspace .a4-pop-card:not(.a4-pop-open){height:76px!important;min-height:76px!important;max-height:76px!important}
      body.a4-compact-popup-workspace #managerCalendarWrap.manager-workspace-v3{grid-template-columns:1fr!important}
    }
  `;
  document.head.appendChild(style);

  const skipClass=/^(?:a4-pop-card|stats|stat|kpi|reports-kpi|eq-kpi|manager-kpi|dash-kpi|quick|toolbar|actions|tabs?|filter(?:s|bar)?|shell|grid|head|header|footer|row|list|item|badge|chip)$/i;
  const endCard=/(?:^|[-_])(?:card|panel|widget)$/i;
  const explicit='.eq-card,.reports-card,.manager-panel,.mgr-card,.manager-event-card,.manager-calendar-card,.dash-card,.dash-unit-card';
  let scanTimer=0;
  let observer=null;

  const text=el=>String(el?.textContent||'').replace(/\s+/g,' ').trim();
  const visible=el=>{
    if(!(el instanceof HTMLElement)||el.hidden||el.getAttribute('aria-hidden')==='true')return false;
    const s=getComputedStyle(el);
    return s.display!=='none'&&s.visibility!=='hidden';
  };
  const hasCardToken=el=>[...el.classList].some(cls=>endCard.test(cls)&&!skipClass.test(cls));
  const excluded=el=>{
    if(!(el instanceof HTMLElement))return true;
    if(el.classList.contains('a4-pop-card')||el.dataset.a4Popup==='off')return true;
    if(el.closest('dialog,[role="dialog"],.modal,.dialog,.overlay,.drawer,#hubChatWidget,#hubChatNotifyCenter,.a4-more-menu'))return true;
    if(el.matches('.stats article,.reports-kpi,.eq-kpi,.manager-kpi,.dash-kpi,.quick a,.chat-card,.nearest-item,.notify-item,.customer-mini,.order-mini'))return true;
    if(/(?:^|\s)(?:kpi|toolbar|actions|tabs?|filter(?:s|bar)?|shell|grid|head|header|footer|row|list|item)(?:\s|$)/i.test(el.className||''))return true;
    return false;
  };

  function titleFor(card){
    const explicitTitle=card.getAttribute('data-popup-title')||card.getAttribute('aria-label');
    if(explicitTitle?.trim())return explicitTitle.trim();
    const selectors=[
      ':scope > .eq-head h2',':scope > .reports-card-head h2',':scope > .mgr-head h2',':scope > .mgr-head h3',
      ':scope > .dash-card-head h2',':scope > .dash-card-head h3',':scope > .panel-head2 h2',':scope > .panel-head h2',
      ':scope > h1',':scope > h2',':scope > h3'
    ];
    for(const selector of selectors){const t=text(card.querySelector(selector));if(t)return t.slice(0,80)}
    const any=text(card.querySelector('h1,h2,h3,strong'));
    return any.slice(0,80)||'Рабочий блок';
  }

  function descFor(card,title){
    const explicitDesc=card.getAttribute('data-popup-description');
    if(explicitDesc?.trim())return explicitDesc.trim();
    const selectors=[':scope > .eq-head p',':scope > .reports-card-head p',':scope > .mgr-head + p',':scope > .dash-card-head p',':scope > .panel-head2 p',':scope > p'];
    for(const selector of selectors){const t=text(card.querySelector(selector));if(t&&t!==title)return t.slice(0,130)}
    if(card.querySelector('form'))return 'Форма и рабочие параметры';
    if(card.querySelector('table'))return 'Таблица и подробные данные';
    if(card.querySelector('input,select,textarea'))return 'Фильтры, параметры и данные';
    const n=card.querySelectorAll('.row,.item,.list-row,.order-row,tr,.customer-mini,.order-mini,.day-chip').length;
    if(n)return `${n} элементов · открыть полностью`;
    return 'Нажмите, чтобы открыть полностью';
  }

  function iconFor(title,card){
    const v=title.toLowerCase();
    if(/календар|запис|задач/.test(v))return '◫';
    if(/заказ|заяв/.test(v))return '▤';
    if(/клиент/.test(v))return '👤';
    if(/оборуд|сервис|техник/.test(v))return '⚙';
    if(/расход|склад|остат|движен/.test(v))return '▣';
    if(/касс|оплат|финанс|налич/.test(v))return '₽';
    if(/отч[её]т|статус|направлен/.test(v))return '↗';
    if(/уведом/.test(v))return '🔔';
    if(/чат|сообщ/.test(v))return '💬';
    if(/калькулятор/.test(v))return '⌗';
    if(card.querySelector('form'))return '＋';
    if(card.querySelector('table'))return '▦';
    return '◇';
  }

  function closeButton(title){
    const b=document.createElement('button');
    b.type='button';b.className='a4-pop-close';b.title='Закрыть';b.setAttribute('aria-label',`Закрыть «${title}»`);b.textContent='×';
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();window.A4WorkspacePopup?.close?.()});
    return b;
  }

  function enhance(card){
    if(excluded(card)||!visible(card))return false;
    card.classList.add('a4-pop-card');
    card.dataset.a4PopupReady='coverage';
    card.setAttribute('aria-expanded','false');
    const title=titleFor(card),desc=descFor(card,title);
    const summary=document.createElement('button');
    summary.type='button';summary.className='a4-pop-summary';summary.setAttribute('aria-label',`Открыть «${title}»`);
    summary.innerHTML='<span class="a4-pop-icon" aria-hidden="true"></span><span class="a4-pop-title"></span><span class="a4-pop-desc"></span><span class="a4-pop-open-label">Открыть</span>';
    summary.querySelector('.a4-pop-icon').textContent=iconFor(title,card);
    summary.querySelector('.a4-pop-title').textContent=title;
    summary.querySelector('.a4-pop-desc').textContent=desc;
    summary.addEventListener('click',()=>{
      if(card.classList.contains('is-collapsed')){card.dataset.a4WasCollapsed='1';card.classList.remove('is-collapsed')}
      window.A4WorkspacePopup?.open?.(card);
    });
    card.append(summary,closeButton(title));
    return true;
  }

  function compactParents(){
    const parents=new Set([...document.querySelectorAll('.main .a4-pop-card')].map(x=>x.parentElement).filter(Boolean));
    for(const parent of parents){
      const cards=[...parent.children].filter(x=>x.classList?.contains('a4-pop-card')&&!x.hidden);
      if(cards.length>=2)parent.classList.add('a4-pop-grid-parent');
    }
  }

  function collect(){
    const root=document.querySelector('.main');if(!root)return[];
    const set=new Set(root.querySelectorAll(explicit));
    root.querySelectorAll('section,article,div').forEach(el=>{if(hasCardToken(el))set.add(el)});
    return [...set];
  }

  function scan(){
    clearTimeout(scanTimer);
    document.documentElement.classList.add('a4-compact-popup-html');
    document.body?.classList.add('a4-compact-popup-workspace');
    collect().forEach(enhance);
    compactParents();
  }
  function schedule(delay=60){clearTimeout(scanTimer);scanTimer=setTimeout(scan,delay)}

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(170),{once:true});else schedule(100);
  window.addEventListener('load',()=>schedule(350),{once:true});

  const startObserver=()=>{
    if(observer||!document.body)return;
    // Only react to newly inserted layout nodes. Watching every class/style
    // mutation caused repeated full-page scans whenever chat/notifications
    // animated or updated their visibility.
    observer=new MutationObserver(mutations=>{
      const relevant=mutations.some(m=>m.type==='childList'&&[...m.addedNodes].some(n=>n instanceof HTMLElement&&!n.matches?.('.a4-pop-summary,.a4-pop-close,.a4-pop-backdrop,#hubChatWidget,#hubChatNotifyCenter')));
      if(relevant)schedule(90);
    });
    observer.observe(document.body,{childList:true,subtree:true});
  };
  if(document.body)startObserver();else document.addEventListener('DOMContentLoaded',startObserver,{once:true});

  // Tabs can reveal already existing cards without inserting new DOM nodes.
  document.addEventListener('click',e=>{
    if(e.target.closest('.eq-tab,[role="tab"],.tab,.tabs button,.reports-periods button'))schedule(80);
  },true);

  document.addEventListener('click',e=>{
    if(!e.target.closest('.a4-pop-close'))return;
    setTimeout(()=>{
      document.querySelectorAll('.a4-pop-card[data-a4-was-collapsed="1"]').forEach(card=>{card.classList.add('is-collapsed');delete card.dataset.a4WasCollapsed});
    },0);
  });
})();