(()=>{
  if(window.__A4_BLOCK_LAYOUT__)return;
  const params=new URLSearchParams(location.search);
  const path=location.pathname||'';
  const isAdmin=/\/admin\//.test(path);
  const isAuth=/\/(login|register|pending|invite|reset-password)\.html$/.test(path);
  const isChatEmbed=/\/admin\/messages\.html$/.test(path)&&(params.get('embed')==='1'||params.get('app')==='1');
  if(!isAdmin||isAuth||isChatEmbed)return;
  window.__A4_BLOCK_LAYOUT__=true;

  const PAGE_KEY=path.replace(/\/+$/,'')||'/';
  const STORE_KEY=`a4print:block-layout:v2:${PAGE_KEY}`;
  const BLOCK_SELECTOR=[
    '.dash-app-launcher','.dash-kpis','.dash-card','.dash-unit-card',
    '.manager-panel','.quick>a','.panel','.stats>article',
    '.card','.box','.section-card'
  ].join(',');
  const EXCLUDE_SELECTOR=[
    '.sidebar','.topbar','.a4-workspace-actions','.a4-block-layout-toolbar',
    '.a4-block-hidden-panel','#hubChatWidget','#hubChatNotifyCenter',
    'dialog','[role="dialog"]','.modal','.dialog','.overlay',
    '.toolbar','.actions','.filters','.form-actions','.dashboard-actions',
    'table','form','nav'
  ].join(',');

  let editMode=false;
  let dragged=null;
  let scanTimer=null;
  let applying=false;
  const known=new Map();

  const readState=()=>{
    try{
      const raw=JSON.parse(localStorage.getItem(STORE_KEY)||'{}');
      return {
        blocks:raw&&typeof raw.blocks==='object'?raw.blocks:{},
        orders:raw&&typeof raw.orders==='object'?raw.orders:{}
      };
    }catch{return {blocks:{},orders:{}}}
  };
  let state=readState();
  const save=()=>{try{localStorage.setItem(STORE_KEY,JSON.stringify(state))}catch{}};

  const css=document.createElement('style');
  css.id='a4-block-layout-style';
  css.textContent=`
    .a4-layout-block{position:relative!important;transition:outline-color .14s ease,box-shadow .14s ease,opacity .14s ease}
    .a4-layout-hidden{display:none!important}
    .a4-block-controls{display:none;position:absolute;z-index:80;right:8px;top:8px;align-items:center;gap:4px;padding:4px;border:1px solid #dbe3ee;border-radius:10px;background:rgba(255,255,255,.96);box-shadow:0 7px 22px rgba(15,23,42,.12);backdrop-filter:blur(8px)}
    body.a4-layout-edit .a4-layout-block:not(.a4-layout-hidden){outline:1px dashed rgba(37,99,235,.32);outline-offset:3px}
    body.a4-layout-edit .a4-layout-block:not(.a4-layout-hidden):hover{outline-color:rgba(37,99,235,.78)}
    body.a4-layout-edit .a4-block-controls{display:flex}
    .a4-block-controls button{display:grid!important;place-items:center!important;width:28px!important;height:28px!important;min-width:28px!important;min-height:28px!important;padding:0!important;border:0!important;border-radius:7px!important;background:#f8fafc!important;color:#475569!important;font:800 14px/1 system-ui!important;box-shadow:none!important}
    .a4-block-controls button:hover{background:#eef4ff!important;color:#1d4ed8!important;transform:none!important}
    .a4-block-controls button[data-a4-hide]:hover{background:#fff1f2!important;color:#be123c!important}
    .a4-block-drag{cursor:grab!important;touch-action:none}
    .a4-block-drag:active{cursor:grabbing!important}
    .a4-layout-dragging{opacity:.42!important}
    .a4-layout-drop-target{outline:2px solid #60a5fa!important;outline-offset:4px!important}

    .a4-block-collapsed-bar{display:none;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:10px 12px;color:#334155}
    .a4-block-collapsed-bar strong{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .a4-block-collapsed-bar button{flex:0 0 auto;min-height:30px!important;padding:0 10px!important;border:1px solid #dbe3ee!important;border-radius:8px!important;background:#fff!important;color:#2563eb!important;font-size:11px!important;font-weight:800!important}
    .a4-layout-block.a4-layout-collapsed>.a4-block-collapsed-bar{display:flex!important}
    .a4-layout-block.a4-layout-collapsed>:not(.a4-block-controls):not(.a4-block-collapsed-bar){display:none!important}
    .a4-layout-block.a4-layout-collapsed{min-height:50px!important;height:auto!important;overflow:visible!important}

    .a4-block-layout-toolbar{display:flex;align-items:center;gap:6px;position:relative;flex:0 0 auto}
    .a4-block-layout-toolbar button{min-height:34px!important;height:34px!important;padding:0 10px!important;border:1px solid #dbe3ee!important;border-radius:9px!important;background:#fff!important;color:#475569!important;font-size:11px!important;font-weight:800!important;box-shadow:none!important;white-space:nowrap}
    .a4-block-layout-toolbar button:hover{border-color:#bfd0e5!important;background:#f8fbff!important;color:#1d4ed8!important}
    .a4-block-layout-toolbar .a4-layout-done{background:#2563eb!important;border-color:#2563eb!important;color:#fff!important}
    .a4-block-layout-toolbar [data-a4-hidden-open],.a4-block-layout-toolbar [data-a4-reset]{display:none}
    body.a4-layout-edit .a4-block-layout-toolbar [data-a4-hidden-open],body.a4-layout-edit .a4-block-layout-toolbar [data-a4-reset]{display:inline-flex;align-items:center}

    .a4-block-hidden-panel{display:none;position:fixed;z-index:35000;right:18px;top:76px;width:min(360px,calc(100vw - 28px));max-height:min(72vh,620px);overflow:auto;border:1px solid #dbe3ee;border-radius:16px;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.20);padding:10px}
    .a4-block-hidden-panel.open{display:block}
    .a4-block-hidden-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 4px 9px}
    .a4-block-hidden-head strong{font-size:14px;color:#172033}
    .a4-block-hidden-head button{width:30px!important;height:30px!important;min-width:30px!important;min-height:30px!important;padding:0!important;border:0!important;background:#f8fafc!important;border-radius:8px!important;color:#64748b!important}
    .a4-block-hidden-list{display:grid;gap:6px}
    .a4-block-hidden-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border:1px solid #edf2f7;border-radius:10px;background:#fbfdff}
    .a4-block-hidden-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#475569;font-size:12px;font-weight:700}
    .a4-block-hidden-row button{min-height:30px!important;padding:0 9px!important;border:1px solid #bfdbfe!important;border-radius:8px!important;background:#eff6ff!important;color:#1d4ed8!important;font-size:10px!important;font-weight:850!important}
    .a4-block-hidden-empty{padding:18px 8px;text-align:center;color:#94a3b8;font-size:12px}

    @media(max-width:900px){
      .a4-block-layout-toolbar{gap:4px}
      .a4-block-layout-toolbar button{height:32px!important;min-height:32px!important;padding:0 8px!important;font-size:10px!important}
      .a4-block-controls{right:5px;top:5px;gap:3px;padding:3px}
      .a4-block-controls button{width:30px!important;height:30px!important;min-width:30px!important}
      .a4-block-hidden-panel{left:10px;right:10px;top:64px;width:auto;max-height:76dvh}
    }
    @media(max-width:560px){
      .a4-block-layout-toolbar [data-a4-reset]{display:none!important}
      .a4-block-layout-toolbar button{padding:0 7px!important}
      .a4-block-layout-toolbar .a4-layout-label{display:none}
    }
  `;
  document.head.appendChild(css);

  function slug(value){
    return String(value||'').trim().toLowerCase().replace(/[^a-zа-яё0-9]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,54)||'block';
  }

  function titleFor(el){
    const own=el.getAttribute('data-layout-title')||el.getAttribute('aria-label');
    if(own)return own.trim();
    const heading=el.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > header h1,:scope > header h2,:scope > header h3,:scope > .panel-head h2,:scope > .panel-head2 h2,:scope > .dash-card-head h2');
    if(heading?.textContent?.trim())return heading.textContent.trim();
    if(el.matches('a')&&el.textContent?.trim())return el.textContent.trim().replace(/\s+/g,' ').slice(0,60);
    const first=el.querySelector('h1,h2,h3,strong,b');
    if(first?.textContent?.trim())return first.textContent.trim().replace(/\s+/g,' ').slice(0,60);
    return 'Блок';
  }

  function parentKey(parent){
    if(parent.dataset.a4LayoutParent)return parent.dataset.a4LayoutParent;
    let key='';
    if(parent.id)key=`id:${parent.id}`;
    else{
      const cls=[...parent.classList].filter(x=>!x.startsWith('a4-')).slice(0,3).join('.');
      const tag=parent.tagName.toLowerCase();
      const siblings=parent.parentElement?[...parent.parentElement.children].filter(x=>x.tagName===parent.tagName&&[...x.classList].filter(c=>!c.startsWith('a4-')).slice(0,3).join('.')===cls):[parent];
      key=`${tag}.${cls||'plain'}:${Math.max(0,siblings.indexOf(parent))}`;
    }
    parent.dataset.a4LayoutParent=key;
    return key;
  }

  function blockKey(el){
    if(el.dataset.a4LayoutId)return el.dataset.a4LayoutId;
    const parent=el.parentElement;
    const pkey=parentKey(parent);
    let id='';
    if(el.id)id=`${pkey}::id:${el.id}`;
    else{
      const kind=[...el.classList].filter(x=>!x.startsWith('a4-')).slice(0,2).join('.')||el.tagName.toLowerCase();
      const label=slug(titleFor(el));
      const peers=[...parent.children].filter(x=>x.matches?.(BLOCK_SELECTOR));
      const similar=peers.filter(x=>slug(titleFor(x))===label&&(([...x.classList].filter(c=>!c.startsWith('a4-')).slice(0,2).join('.')||x.tagName.toLowerCase())===kind));
      id=`${pkey}::${kind}:${label}:${Math.max(0,similar.indexOf(el))}`;
    }
    el.dataset.a4LayoutId=id;
    return id;
  }

  function looksLikeBlock(el){
    if(!(el instanceof HTMLElement)||el.closest(EXCLUDE_SELECTOR))return false;
    if(el.matches(BLOCK_SELECTOR))return true;
    const rect=el.getBoundingClientRect();
    if(rect.width<160||rect.height<58)return false;
    const s=getComputedStyle(el);
    const hasSurface=s.backgroundColor!=='rgba(0, 0, 0, 0)'&&s.backgroundColor!=='transparent';
    const hasBorder=parseFloat(s.borderTopWidth||'0')>0&&s.borderTopStyle!=='none';
    const rounded=parseFloat(s.borderTopLeftRadius||'0')>=8;
    return (hasSurface||hasBorder)&&rounded;
  }

  function collectBlocks(){
    const main=document.querySelector('.main');
    if(!main)return [];
    const set=new Set();
    main.querySelectorAll(BLOCK_SELECTOR).forEach(el=>{
      if(looksLikeBlock(el))set.add(el);
    });
    [...main.children].forEach(el=>{
      if(el.matches('header,.topbar,script,style')||el.closest(EXCLUDE_SELECTOR))return;
      if(el.querySelector(BLOCK_SELECTOR))return;
      if(looksLikeBlock(el))set.add(el);
    });
    return [...set].filter(el=>!el.closest('.a4-layout-block .a4-layout-block'));
  }

  function ensureControls(el){
    if(el.querySelector(':scope > .a4-block-controls'))return;
    const id=blockKey(el);
    const label=titleFor(el);
    el.classList.add('a4-layout-block');
    el.dataset.a4LayoutTitle=label;
    known.set(id,el);

    const controls=document.createElement('div');
    controls.className='a4-block-controls';
    controls.innerHTML=`
      <button type="button" class="a4-block-drag" draggable="true" title="Перетащить блок" aria-label="Перетащить блок">⠿</button>
      <button type="button" data-a4-up title="Переместить выше" aria-label="Переместить выше">↑</button>
      <button type="button" data-a4-down title="Переместить ниже" aria-label="Переместить ниже">↓</button>
      <button type="button" data-a4-collapse title="Свернуть блок" aria-label="Свернуть блок">−</button>
      <button type="button" data-a4-hide title="Скрыть блок" aria-label="Скрыть блок">×</button>`;

    const bar=document.createElement('div');
    bar.className='a4-block-collapsed-bar';
    bar.innerHTML=`<strong></strong><button type="button">Развернуть</button>`;
    bar.querySelector('strong').textContent=label;
    bar.querySelector('button').addEventListener('click',e=>{e.stopPropagation();setCollapsed(el,false)});

    controls.querySelector('[data-a4-up]').onclick=e=>{e.stopPropagation();move(el,-1)};
    controls.querySelector('[data-a4-down]').onclick=e=>{e.stopPropagation();move(el,1)};
    controls.querySelector('[data-a4-collapse]').onclick=e=>{e.stopPropagation();setCollapsed(el,!el.classList.contains('a4-layout-collapsed'))};
    controls.querySelector('[data-a4-hide]').onclick=e=>{e.stopPropagation();setHidden(el,true)};

    const handle=controls.querySelector('.a4-block-drag');
    handle.addEventListener('dragstart',e=>{
      dragged=el;
      el.classList.add('a4-layout-dragging');
      try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',id)}catch{}
    });
    handle.addEventListener('dragend',()=>{
      document.querySelectorAll('.a4-layout-drop-target').forEach(x=>x.classList.remove('a4-layout-drop-target'));
      el.classList.remove('a4-layout-dragging');
      if(el.parentElement)saveOrder(el.parentElement);
      dragged=null;
    });
    el.addEventListener('dragover',e=>{
      if(!editMode||!dragged||dragged===el||dragged.parentElement!==el.parentElement)return;
      e.preventDefault();
      el.classList.add('a4-layout-drop-target');
      const parent=el.parentElement;
      const ps=getComputedStyle(parent);
      const columns=(ps.gridTemplateColumns||'').split(' ').filter(Boolean).length;
      const horizontal=(ps.display.includes('grid')&&columns>1)||(ps.display==='flex'&&!ps.flexDirection.startsWith('column'));
      const r=el.getBoundingClientRect();
      const before=horizontal?e.clientX<r.left+r.width/2:e.clientY<r.top+r.height/2;
      parent.insertBefore(dragged,before?el:el.nextSibling);
    });
    el.addEventListener('dragleave',()=>el.classList.remove('a4-layout-drop-target'));
    el.addEventListener('drop',e=>{
      if(!dragged)return;
      e.preventDefault();
      el.classList.remove('a4-layout-drop-target');
      saveOrder(el.parentElement);
    });

    el.prepend(bar);
    el.appendChild(controls);
    applyBlockState(el);
  }

  function applyBlockState(el){
    const id=blockKey(el);
    const cfg=state.blocks[id]||{};
    el.classList.toggle('a4-layout-hidden',cfg.hidden===true);
    el.classList.toggle('a4-layout-collapsed',cfg.collapsed===true);
    const c=el.querySelector(':scope > .a4-block-controls [data-a4-collapse]');
    if(c)c.textContent=cfg.collapsed===true?'+':'−';
  }

  function setHidden(el,value){
    const id=blockKey(el);
    state.blocks[id]={...(state.blocks[id]||{}),hidden:!!value};
    el.classList.toggle('a4-layout-hidden',!!value);
    save();
    updateHiddenPanel();
    updateToolbarCount();
  }

  function setCollapsed(el,value){
    const id=blockKey(el);
    state.blocks[id]={...(state.blocks[id]||{}),collapsed:!!value};
    el.classList.toggle('a4-layout-collapsed',!!value);
    const c=el.querySelector(':scope > .a4-block-controls [data-a4-collapse]');
    if(c)c.textContent=value?'+':'−';
    save();
  }

  function move(el,delta){
    const parent=el.parentElement;
    if(!parent)return;
    const siblings=[...parent.children].filter(x=>x.classList?.contains('a4-layout-block'));
    const i=siblings.indexOf(el);
    const next=i+delta;
    if(i<0||next<0||next>=siblings.length)return;
    if(delta<0)parent.insertBefore(el,siblings[next]);
    else parent.insertBefore(el,siblings[next].nextSibling);
    saveOrder(parent);
  }

  function saveOrder(parent){
    const pkey=parentKey(parent);
    state.orders[pkey]=[...parent.children].filter(x=>x.classList?.contains('a4-layout-block')).map(blockKey);
    save();
  }

  function applyOrders(){
    if(applying)return;
    applying=true;
    try{
      const parents=new Set([...known.values()].map(x=>x.parentElement).filter(Boolean));
      for(const parent of parents){
        const order=state.orders[parentKey(parent)];
        if(!Array.isArray(order)||!order.length)continue;
        const items=[...parent.children].filter(x=>x.classList?.contains('a4-layout-block'));
        const map=new Map(items.map(x=>[blockKey(x),x]));
        for(const id of order){const el=map.get(id);if(el)parent.appendChild(el)}
      }
    }finally{applying=false}
  }

  function hiddenBlocks(){
    return [...known.values()].filter(el=>state.blocks[blockKey(el)]?.hidden===true);
  }

  function ensureHiddenPanel(){
    let panel=document.querySelector('.a4-block-hidden-panel');
    if(panel)return panel;
    panel=document.createElement('div');
    panel.className='a4-block-hidden-panel';
    panel.innerHTML=`<div class="a4-block-hidden-head"><strong>Скрытые блоки</strong><button type="button" aria-label="Закрыть">×</button></div><div class="a4-block-hidden-list"></div>`;
    panel.querySelector('.a4-block-hidden-head button').onclick=()=>panel.classList.remove('open');
    document.body.appendChild(panel);
    return panel;
  }

  function updateHiddenPanel(){
    const panel=ensureHiddenPanel();
    const list=panel.querySelector('.a4-block-hidden-list');
    const hidden=hiddenBlocks();
    list.innerHTML='';
    if(!hidden.length){
      const empty=document.createElement('div');empty.className='a4-block-hidden-empty';empty.textContent='Скрытых блоков нет';list.appendChild(empty);return;
    }
    hidden.forEach(el=>{
      const row=document.createElement('div');row.className='a4-block-hidden-row';
      const title=document.createElement('span');title.textContent=el.dataset.a4LayoutTitle||titleFor(el);
      const restore=document.createElement('button');restore.type='button';restore.textContent='Вернуть';restore.onclick=()=>setHidden(el,false);
      row.append(title,restore);list.appendChild(row);
    });
  }

  function ensureToolbar(){
    const top=document.querySelector('.topbar');
    if(!top)return false;
    let toolbar=top.querySelector('.a4-block-layout-toolbar');
    if(toolbar)return true;
    toolbar=document.createElement('div');
    toolbar.className='a4-block-layout-toolbar';
    toolbar.innerHTML=`
      <button type="button" data-a4-layout-toggle title="Настроить расположение блоков"><span class="a4-layout-label">Настроить</span><span class="a4-layout-mobile">⌘</span></button>
      <button type="button" data-a4-hidden-open>Скрытые <b>0</b></button>
      <button type="button" data-a4-reset>Сбросить</button>`;
    toolbar.querySelector('[data-a4-layout-toggle]').onclick=()=>setEditMode(!editMode);
    toolbar.querySelector('[data-a4-hidden-open]').onclick=e=>{e.stopPropagation();const p=ensureHiddenPanel();updateHiddenPanel();p.classList.toggle('open')};
    toolbar.querySelector('[data-a4-reset]').onclick=()=>{
      if(!confirm('Сбросить расположение, скрытие и сворачивание блоков на этой странице?'))return;
      try{localStorage.removeItem(STORE_KEY)}catch{}
      location.reload();
    };
    const actions=top.querySelector('.a4-workspace-actions');
    if(actions)actions.insertBefore(toolbar,actions.firstChild);
    else top.appendChild(toolbar);
    updateToolbarCount();
    return true;
  }

  function updateToolbarCount(){
    const b=document.querySelector('.a4-block-layout-toolbar [data-a4-hidden-open] b');
    if(b)b.textContent=String(hiddenBlocks().length);
  }

  function setEditMode(value){
    editMode=!!value;
    document.body.classList.toggle('a4-layout-edit',editMode);
    const btn=document.querySelector('.a4-block-layout-toolbar [data-a4-layout-toggle]');
    if(btn){
      btn.classList.toggle('a4-layout-done',editMode);
      btn.querySelector('.a4-layout-label').textContent=editMode?'Готово':'Настроить';
      btn.title=editMode?'Завершить настройку':'Настроить расположение блоков';
    }
    if(!editMode)ensureHiddenPanel().classList.remove('open');
  }

  function scan(){
    if(applying)return;
    const blocks=collectBlocks();
    blocks.forEach(ensureControls);
    applyOrders();
    blocks.forEach(applyBlockState);
    ensureToolbar();
    updateToolbarCount();
  }

  function scheduleScan(){
    clearTimeout(scanTimer);
    scanTimer=setTimeout(scan,180);
  }

  document.addEventListener('click',e=>{
    if(!editMode)return;
    const a=e.target.closest('a');
    if(a&&a.closest('.a4-layout-block')&&!a.closest('.a4-block-controls'))e.preventDefault();
  },true);

  const init=()=>{
    ensureHiddenPanel();
    scan();
    setTimeout(scan,450);
    setTimeout(scan,1100);
    const main=document.querySelector('.main');
    if(main)new MutationObserver(scheduleScan).observe(main,{childList:true,subtree:true});
    new MutationObserver(()=>{ensureToolbar()}).observe(document.documentElement,{childList:true,subtree:true});
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();