(()=>{
  if(window.__A4_QUICK_MENU__)return;
  window.__A4_QUICK_MENU__=true;
  const KEY='a4print_mobile_quick_v1';
  const LIMIT=6;
  const items=[
    {id:'manager',icon:'＋',label:'Создать заказ',href:'/admin/manager.html?mobile=1'},
    {id:'orders',icon:'▣',label:'Все заказы',href:'/admin/orders.html?mobile=1'},
    {id:'new',icon:'●',label:'Новые заказы',href:'/admin/orders.html?status=NEW&mobile=1'},
    {id:'chat',icon:'✉',label:'Чат',href:'/admin/messages.html?app=1'},
    {id:'customers',icon:'◉',label:'Клиенты',href:'/admin/customers.html?mobile=1'},
    {id:'warehouse',icon:'□',label:'Склад',href:'/admin/warehouse.html?mobile=1'},
    {id:'production',icon:'⚙',label:'Производство',href:'/admin/production.html?mobile=1'},
    {id:'delivery',icon:'↗',label:'Доставка',href:'/admin/cuim-delivery.html?mobile=1'},
    {id:'partners',icon:'◇',label:'Партнёры',href:'/admin/partners.html?mobile=1'},
    {id:'requests',icon:'☷',label:'Заявки',href:'/admin/requests.html?mobile=1'},
    {id:'documents',icon:'▤',label:'Документы',href:'/admin/documents.html?mobile=1'},
    {id:'payments',icon:'₽',label:'Оплаты',href:'/admin/payments.html?mobile=1'},
    {id:'reports',icon:'⌁',label:'Отчёты',href:'/admin/reports.html?mobile=1'},
    {id:'employees',icon:'♙',label:'Сотрудники',href:'/admin/employees.html?mobile=1'},
    {id:'settings',icon:'⚙',label:'Настройки',href:'/admin/settings.html?mobile=1'},
    {id:'account',icon:'☻',label:'Аккаунт',href:'/mobile/account.html'}
  ];
  const byId=new Map(items.map(x=>[x.id,x]));
  const defaults=['manager','orders','chat','customers','warehouse','account'];
  const safeIds=value=>Array.from(new Set((Array.isArray(value)?value:[]).filter(id=>byId.has(id)))).slice(0,LIMIT);
  function load(){try{const ids=safeIds(JSON.parse(localStorage.getItem(KEY)||'null'));return ids.length?ids:defaults.slice()}catch{return defaults.slice()}}
  function save(ids){const clean=safeIds(ids);try{localStorage.setItem(KEY,JSON.stringify(clean))}catch{};favorites=clean.length?clean:defaults.slice();renderAll()}
  let favorites=load();
  let backdrop=null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function itemLink(item,klass=''){return `<a class="${klass}" href="${item.href}"><span class="a4qm-link-icon">${esc(item.icon)}</span><span>${esc(item.label)}</span></a>`}
  function ensureSheet(){
    if(backdrop)return backdrop;
    backdrop=document.createElement('div');
    backdrop.className='a4qm-backdrop';
    backdrop.innerHTML=`<section class="a4qm-sheet" role="dialog" aria-modal="true" aria-label="Быстрое меню"><div class="a4qm-handle"></div><div class="a4qm-head"><h2>Быстрое меню</h2><button class="a4qm-close" type="button" aria-label="Закрыть">×</button></div><div class="a4qm-section"><div class="a4qm-section-title"><b>Мои быстрые кнопки</b><small>до ${LIMIT}</small></div><div class="a4qm-editor"></div><div class="a4qm-limit">Можно выбрать не больше ${LIMIT} пунктов.</div></div><div class="a4qm-section"><div class="a4qm-section-title"><b>Все разделы</b><small>быстрый переход</small></div><div class="a4qm-all"></div></div></section>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click',e=>{if(e.target===backdrop||e.target.closest('.a4qm-close'))close()});
    backdrop.addEventListener('click',e=>{
      const toggle=e.target.closest('[data-a4qm-toggle]');
      if(toggle){const id=toggle.dataset.a4qmToggle;const next=favorites.slice();const at=next.indexOf(id);if(at>=0)next.splice(at,1);else if(next.length<LIMIT)next.push(id);else{backdrop.querySelector('.a4qm-limit')?.classList.add('show');setTimeout(()=>backdrop?.querySelector('.a4qm-limit')?.classList.remove('show'),1800);return}save(next);return}
      const move=e.target.closest('[data-a4qm-move]');
      if(move){const id=move.dataset.id,dir=Number(move.dataset.a4qmMove||0),next=favorites.slice(),at=next.indexOf(id),to=at+dir;if(at<0||to<0||to>=next.length)return;[next[at],next[to]]=[next[to],next[at]];save(next)}
    });
    return backdrop;
  }
  function renderHome(){
    document.querySelectorAll('[data-quick-menu-home]').forEach(host=>{
      host.classList.add('a4qm-home');
      host.innerHTML=`<div class="a4qm-home-head"><h2>Быстрый доступ</h2><button class="a4qm-config-btn" type="button" data-a4-quick-menu>Настроить</button></div><div class="a4qm-grid">${favorites.map(id=>byId.get(id)).filter(Boolean).map(x=>itemLink(x,'a4qm-link')).join('')}</div>`;
    });
  }
  function renderSheet(){
    const root=ensureSheet();
    const editor=root.querySelector('.a4qm-editor');
    editor.innerHTML=items.map(item=>{
      const at=favorites.indexOf(item.id),selected=at>=0;
      return `<div class="a4qm-row ${selected?'selected':''}"><button class="a4qm-toggle" type="button" data-a4qm-toggle="${item.id}" aria-label="${selected?'Убрать':'Добавить'} ${esc(item.label)}">${selected?'✓':'＋'}</button><div class="a4qm-row-label">${esc(item.icon)}&nbsp;&nbsp;${esc(item.label)}</div><div class="a4qm-move">${selected?`<button type="button" data-a4qm-move="-1" data-id="${item.id}" aria-label="Выше">↑</button><button type="button" data-a4qm-move="1" data-id="${item.id}" aria-label="Ниже">↓</button>`:''}</div></div>`;
    }).join('');
    root.querySelector('.a4qm-all').innerHTML=items.map(x=>`<a href="${x.href}"><span>${esc(x.icon)}</span><span>${esc(x.label)}</span></a>`).join('');
  }
  function renderAll(){renderHome();if(backdrop)renderSheet()}
  function open(){renderSheet();ensureSheet().classList.add('open');document.documentElement.style.overflow='hidden'}
  function close(){backdrop?.classList.remove('open');document.documentElement.style.overflow=''}
  document.addEventListener('click',e=>{const btn=e.target.closest('[data-a4-quick-menu]');if(!btn)return;e.preventDefault();open()},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',renderAll,{once:true});else renderAll();
  window.A4QuickMenu={open,close,getFavorites:()=>favorites.slice(),reset:()=>save(defaults.slice())};
})();
