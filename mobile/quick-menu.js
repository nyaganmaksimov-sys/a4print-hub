(()=>{
  if(window.__A4_QUICK_MENU__)return;
  window.__A4_QUICK_MENU__=true;

  const STORAGE_KEY='a4print_quick_menu_v2';
  const LIMIT=6;
  const defaults=['manager','orders','chat','customers','production','warehouse'];
  const sections=[
    {
      title:'Работа',
      items:[
        {id:'manager',icon:'＋',label:'Создать заказ',href:'/admin/manager.html?mobile=1'},
        {id:'orders',icon:'▣',label:'Все заказы',href:'/admin/orders.html?mobile=1'},
        {id:'new',icon:'●',label:'Новые заказы',href:'/admin/orders.html?status=NEW&mobile=1'},
        {id:'chat',icon:'✉',label:'Чат',href:'/admin/messages.html?app=1'},
        {id:'customers',icon:'◉',label:'Клиенты',href:'/admin/customers.html?mobile=1'}
      ]
    },
    {
      title:'Производство и учёт',
      items:[
        {id:'warehouse',icon:'□',label:'Склад',href:'/admin/warehouse.html?mobile=1'},
        {id:'production',icon:'⚙',label:'Производство',href:'/admin/production.html?mobile=1'},
        {id:'delivery',icon:'↗',label:'Доставка',href:'/admin/cuim-delivery.html?mobile=1'},
        {id:'partners',icon:'◇',label:'Партнёры',href:'/admin/partners.html?mobile=1'},
        {id:'requests',icon:'☷',label:'Заявки',href:'/admin/requests.html?mobile=1'},
        {id:'documents',icon:'▤',label:'Документы',href:'/admin/documents.html?mobile=1'},
        {id:'payments',icon:'₽',label:'Оплаты',href:'/admin/payments.html?mobile=1'},
        {id:'reports',icon:'⌁',label:'Отчёты',href:'/admin/reports.html?mobile=1'}
      ]
    },
    {
      title:'Профиль и система',
      items:[
        {id:'employees',icon:'♙',label:'Сотрудники',href:'/admin/employees.html?mobile=1'},
        {id:'settings',icon:'⚙',label:'Настройки',href:'/admin/settings.html?mobile=1'},
        {id:'profile',icon:'☺',label:'Мой профиль',href:'/admin/profile.html?mobile=1'},
        {id:'account',icon:'☻',label:'Аккаунт',href:'/mobile/account.html'}
      ]
    }
  ];

  const allItems=sections.flatMap(section=>section.items);
  const itemById=new Map(allItems.map(item=>[item.id,item]));
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  let backdrop=null;
  let mode='menu';
  let selected=loadSelected();
  let previousOverflow='';

  function normalize(ids){
    const clean=[];
    for(const id of Array.isArray(ids)?ids:[]){
      if(!itemById.has(id)||clean.includes(id))continue;
      clean.push(id);
      if(clean.length>=LIMIT)break;
    }
    return clean.length?clean:[...defaults];
  }

  function loadSelected(){
    try{return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'))}catch{return [...defaults]}
  }

  function saveSelected(){
    selected=normalize(selected);
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(selected))}catch{}
    try{document.dispatchEvent(new CustomEvent('a4quickmenuchange',{detail:{selected:[...selected]}}))}catch{}
    renderHomeShortcuts();
  }

  function selectedItems(){return selected.map(id=>itemById.get(id)).filter(Boolean)}

  function menuLink(item){
    return `<a class="a4qm-menu-link" href="${item.href}"><span class="a4qm-menu-icon">${esc(item.icon)}</span><span>${esc(item.label)}</span><span class="a4qm-chevron">›</span></a>`;
  }

  function favoriteLink(item){
    return `<a class="a4qm-favorite" href="${item.href}"><span>${esc(item.icon)}</span><b>${esc(item.label)}</b></a>`;
  }

  function ensureSheet(){
    if(backdrop)return backdrop;
    backdrop=document.createElement('div');
    backdrop.className='a4qm-backdrop';
    backdrop.innerHTML=`
      <section class="a4qm-sheet" role="dialog" aria-modal="true" aria-label="Меню A4PRINT HUB">
        <div class="a4qm-handle"></div>
        <div class="a4qm-head">
          <div><h2 data-a4qm-title>Меню</h2><p data-a4qm-subtitle>Быстрый доступ к разделам A4PRINT HUB</p></div>
          <div class="a4qm-head-actions"><button class="a4qm-edit-action" type="button" data-a4qm-edit>Настроить</button><button class="a4qm-close" type="button" aria-label="Закрыть">×</button></div>
        </div>
        <div class="a4qm-status" data-a4qm-status></div>
        <div class="a4qm-sections"></div>
      </section>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click',handleSheetClick);
    return backdrop;
  }

  function renderMenu(){
    const favorites=selectedItems();
    return `
      <section class="a4qm-section a4qm-favorites-section">
        <div class="a4qm-section-title"><b>Быстрый доступ</b><span>${favorites.length}/${LIMIT}</span></div>
        <div class="a4qm-favorites">${favorites.map(favoriteLink).join('')}</div>
      </section>
      ${sections.map(section=>`
        <section class="a4qm-section">
          <div class="a4qm-section-title"><b>${esc(section.title)}</b></div>
          <div class="a4qm-menu-list">${section.items.map(menuLink).join('')}</div>
        </section>`).join('')}`;
  }

  function editorSelectedRow(item,index){
    return `<div class="a4qm-selected-row" data-id="${item.id}">
      <span class="a4qm-menu-icon">${esc(item.icon)}</span>
      <b>${esc(item.label)}</b>
      <div class="a4qm-row-actions">
        <button type="button" data-a4qm-move="up" data-id="${item.id}" ${index===0?'disabled':''} aria-label="Выше">↑</button>
        <button type="button" data-a4qm-move="down" data-id="${item.id}" ${index===selected.length-1?'disabled':''} aria-label="Ниже">↓</button>
        <button type="button" class="remove" data-a4qm-toggle="${item.id}" aria-label="Убрать">−</button>
      </div>
    </div>`;
  }

  function editorChoiceRow(item){
    const active=selected.includes(item.id);
    return `<button class="a4qm-choice ${active?'selected':''}" type="button" data-a4qm-toggle="${item.id}" aria-pressed="${active?'true':'false'}">
      <span class="a4qm-menu-icon">${esc(item.icon)}</span><span>${esc(item.label)}</span><strong>${active?'✓':'+'}</strong>
    </button>`;
  }

  function renderEditor(){
    const picked=selectedItems();
    return `
      <section class="a4qm-section">
        <div class="a4qm-section-title"><b>Мои разделы</b><span>${picked.length}/${LIMIT}</span></div>
        <p class="a4qm-hint">Добавьте до ${LIMIT} разделов и стрелками расставьте их в нужном порядке.</p>
        <div class="a4qm-selected-list">${picked.map(editorSelectedRow).join('')}</div>
      </section>
      ${sections.map(section=>`
        <section class="a4qm-section">
          <div class="a4qm-section-title"><b>${esc(section.title)}</b></div>
          <div class="a4qm-choice-list">${section.items.map(editorChoiceRow).join('')}</div>
        </section>`).join('')}
      <div class="a4qm-editor-footer"><button type="button" data-a4qm-reset>По умолчанию</button><button class="primary" type="button" data-a4qm-done>Готово</button></div>`;
  }

  function renderSheet(){
    const root=ensureSheet();
    const editing=mode==='edit';
    root.querySelector('[data-a4qm-title]').textContent=editing?'Настройка меню':'Меню';
    root.querySelector('[data-a4qm-subtitle]').textContent=editing?'Выберите до 6 разделов для быстрого доступа':'Быстрый доступ к разделам A4PRINT HUB';
    const editBtn=root.querySelector('[data-a4qm-edit]');
    editBtn.style.display=editing?'none':'';
    root.querySelector('.a4qm-sections').innerHTML=editing?renderEditor():renderMenu();
    setStatus('');
  }

  function setStatus(text){
    const el=ensureSheet().querySelector('[data-a4qm-status]');
    el.textContent=text||'';
    el.classList.toggle('show',Boolean(text));
  }

  function toggleItem(id){
    if(!itemById.has(id))return;
    const index=selected.indexOf(id);
    if(index>=0){
      if(selected.length===1){setStatus('Оставьте хотя бы один раздел в быстром меню.');return}
      selected.splice(index,1);
    }else{
      if(selected.length>=LIMIT){setStatus(`Можно выбрать не больше ${LIMIT} разделов.`);return}
      selected.push(id);
    }
    saveSelected();
    renderSheet();
  }

  function moveItem(id,direction){
    const index=selected.indexOf(id);
    if(index<0)return;
    const next=direction==='up'?index-1:index+1;
    if(next<0||next>=selected.length)return;
    [selected[index],selected[next]]=[selected[next],selected[index]];
    saveSelected();
    renderSheet();
  }

  function handleSheetClick(e){
    if(e.target===backdrop||e.target.closest('.a4qm-close')){close();return}
    if(e.target.closest('[data-a4qm-edit]')){mode='edit';renderSheet();return}
    if(e.target.closest('[data-a4qm-done]')){mode='menu';renderSheet();return}
    if(e.target.closest('[data-a4qm-reset]')){selected=[...defaults];saveSelected();renderSheet();return}
    const toggle=e.target.closest('[data-a4qm-toggle]');
    if(toggle){toggleItem(toggle.dataset.a4qmToggle);return}
    const move=e.target.closest('[data-a4qm-move]');
    if(move){moveItem(move.dataset.id,move.dataset.a4qmMove);return}
  }

  function renderHomeShortcuts(){
    document.querySelectorAll('[data-quick-menu-home]').forEach(host=>{
      host.innerHTML=selectedItems().map(favoriteLink).join('');
      host.classList.add('a4qm-home-favorites');
    });
  }

  function open(editing=false){
    mode=editing?'edit':'menu';
    renderSheet();
    previousOverflow=document.documentElement.style.overflow;
    ensureSheet().classList.add('open');
    document.documentElement.style.overflow='hidden';
  }

  function close(){
    backdrop?.classList.remove('open');
    document.documentElement.style.overflow=previousOverflow;
  }

  document.addEventListener('click',e=>{
    const config=e.target.closest('[data-a4-quick-menu-config]');
    if(config){e.preventDefault();open(true);return}
    const btn=e.target.closest('[data-a4-quick-menu]');
    if(!btn)return;
    e.preventDefault();
    open(false);
  },true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',renderHomeShortcuts,{once:true});
  else renderHomeShortcuts();

  window.A4QuickMenu={open,close,configure:()=>open(true),getSelected:()=>[...selected]};
})();
