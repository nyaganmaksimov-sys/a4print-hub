document.addEventListener('DOMContentLoaded',async()=>{
  const sidebar=document.querySelector('.sidebar');if(!sidebar)return;
  const COLLAPSE_KEY='a4print_sidebar_collapsed_v1';
  const collapsed=localStorage.getItem(COLLAPSE_KEY)==='1';
  document.body.classList.toggle('a4-sidebar-collapsed',collapsed);

  let head=sidebar.querySelector('.a4-sidebar-head');
  if(!head){head=document.createElement('div');head.className='a4-sidebar-head';sidebar.prepend(head)}
  const toggle=document.createElement('button');toggle.type='button';toggle.className='a4-sidebar-toggle';toggle.title='Свернуть/развернуть меню';toggle.innerHTML='<span>☰</span><small>Меню</small>';head.appendChild(toggle);
  toggle.onclick=()=>{const next=!document.body.classList.contains('a4-sidebar-collapsed');document.body.classList.toggle('a4-sidebar-collapsed',next);localStorage.setItem(COLLAPSE_KEY,next?'1':'0')};

  const brand=sidebar.querySelector('.brand');
  if(brand){
    brand.innerHTML=`<img id="globalHubLogo" src="./assets/logo_bd_transparent.svg?v=20260830-4" alt="A4PRINT HUB"><div id="globalHubLogoFallback" style="display:none;color:#fff;font-weight:900;font-size:20px;text-align:center">A4PRINT <span style="color:#38bdf8">HUB</span></div>`;
    const img=document.getElementById('globalHubLogo'),fallback=document.getElementById('globalHubLogoFallback');
    img.onerror=()=>{img.style.display='none';fallback.style.display='block'};
    let normalLogo=localStorage.getItem('a4print_hub_logo')||'./assets/logo_bd_transparent.svg?v=20260830-4';
    const syncSidebarLogo=()=>{img.style.display='block';fallback.style.display='none';img.src=document.body.classList.contains('a4-side-light')?'./assets/logo_bd1.png?v=20260831-1':normalLogo};
    syncSidebarLogo();
    new MutationObserver(syncSidebarLogo).observe(document.body,{attributes:true,attributeFilter:['class']});
    try{
      const cfg=window.A4PRINT_CONFIG||{};
      if(cfg.supabaseUrl&&cfg.supabasePublishableKey){
        const{createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
        const{data:{session}}=await supabase.auth.getSession();
        if(session){
          const{data}=await supabase.from('settings').select('value').eq('key','hub_branding').maybeSingle();
          const saved=data?.value?.logo||'';
          if(saved){normalLogo=saved;localStorage.setItem('a4print_hub_logo',saved)}else{localStorage.removeItem('a4print_hub_logo');normalLogo='./assets/logo_bd_transparent.svg?v=20260830-4'}
          syncSidebarLogo();
        }
      }
    }catch(e){console.warn('Не удалось загрузить логотип HUB из настроек',e)}
  }

  const nav=sidebar.querySelector('nav');if(!nav)return;
  const path=location.pathname.split('/').pop()||'index.html';
  const items=[['index.html','🏠','Главная'],['manager.html','🧑‍💼','Рабочий стол менеджера'],['orders.html','🛒','Заказы'],['customers.html','👥','Клиенты'],['partners.html','🤝','Партнёры'],['users.html','🔐','Пользователи'],['warehouse.html','📦','Склад и номенклатура'],['production.html','🏭','Производство'],['messages.html','💬','Сообщения'],['documents.html','📁','Документы'],['payments.html','💰','Оплаты'],['reports.html','📊','Отчёты'],['settings.html','⚙️','Настройки'],['help.html','📖','Инструкция'],['../index.html','🧭','Выбор системы']];
  nav.innerHTML=items.map(([href,icon,label])=>`<a href="${href.startsWith('..')?href:'./'+href}" class="${path===href?'active':''}" title="${label}"><span class="a4-nav-icon">${icon}</span><span class="a4-nav-label">${label}</span>${href==='orders.html'?'<b id="orderCount">0</b>':''}</a>`).join('');
});
