(()=>{
  if(window.__A4_QUICK_MENU__)return;
  window.__A4_QUICK_MENU__=true;

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

  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  let backdrop=null;

  function link(item){
    return `<a class="a4qm-menu-link" href="${item.href}"><span class="a4qm-menu-icon">${esc(item.icon)}</span><span>${esc(item.label)}</span><span class="a4qm-chevron">›</span></a>`;
  }

  function ensureSheet(){
    if(backdrop)return backdrop;
    backdrop=document.createElement('div');
    backdrop.className='a4qm-backdrop';
    backdrop.innerHTML=`
      <section class="a4qm-sheet" role="dialog" aria-modal="true" aria-label="Меню A4PRINT HUB">
        <div class="a4qm-handle"></div>
        <div class="a4qm-head">
          <div><h2>Меню</h2><p>Все разделы A4PRINT HUB</p></div>
          <button class="a4qm-close" type="button" aria-label="Закрыть">×</button>
        </div>
        <div class="a4qm-sections"></div>
      </section>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click',e=>{
      if(e.target===backdrop||e.target.closest('.a4qm-close'))close();
    });
    return backdrop;
  }

  function renderSheet(){
    const root=ensureSheet();
    root.querySelector('.a4qm-sections').innerHTML=sections.map(section=>`
      <section class="a4qm-section">
        <div class="a4qm-section-title"><b>${esc(section.title)}</b></div>
        <div class="a4qm-menu-list">${section.items.map(link).join('')}</div>
      </section>`).join('');
  }

  function removeLegacyHome(){
    document.querySelectorAll('[data-quick-menu-home]').forEach(host=>host.remove());
  }

  function open(){
    renderSheet();
    ensureSheet().classList.add('open');
    document.documentElement.style.overflow='hidden';
  }

  function close(){
    backdrop?.classList.remove('open');
    document.documentElement.style.overflow='';
  }

  document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-a4-quick-menu]');
    if(!btn)return;
    e.preventDefault();
    open();
  },true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',removeLegacyHome,{once:true});
  else removeLegacyHome();

  window.A4QuickMenu={open,close};
})();
