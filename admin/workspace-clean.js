(function(){
  if(window.__A4_WORKSPACE_CLEAN__)return;
  window.__A4_WORKSPACE_CLEAN__=true;
  document.documentElement.classList.add('a4-workspace-clean');

  // Visual rules live in admin/ui/*.css. This module handles behavior only.


  const sectionFor=(href)=>{
    const p=(href||'').split('?')[0].split('/').pop();
    if(['index.html','manager.html','orders.html','customers.html'].includes(p))return'Работа';
    if(['cuim-delivery.html','partners.html','requests.html','warehouse.html','production.html','messages.html'].includes(p))return'Операции';
    if(['employees.html','staff-structure.html'].includes(p))return'Команда';
    if(['documents.html','payments.html','reports.html','settings.html','help.html'].includes(p)||href?.startsWith('../'))return'Система';
    return'';
  };

  function groupNavigation(){
    const nav=document.querySelector('.sidebar nav');if(!nav||nav.dataset.a4Grouped==='1')return;
    const links=[...nav.querySelectorAll(':scope > a')].filter(a=>!a.classList.contains('a4-chat-nav-link'));
    let last='';
    for(const a of links){
      const sec=sectionFor(a.getAttribute('href')||'');
      if(sec&&sec!==last){const h=document.createElement('div');h.className='a4-nav-section';h.textContent=sec;nav.insertBefore(h,a);last=sec}
    }
    nav.dataset.a4Grouped='1';
  }

  function removeClutter(){
    document.querySelectorAll('.a4-chat-dashboard,.a4-chat-nav-link,.a4-layout-toolbar,.a4-help-btn,.a4-help-pop,#a4NotificationWrap').forEach(x=>x.remove());
  }

  function wireProfileTrigger(top){
    if(!top)return;
    const user=top.querySelector('.user');if(!user)return;
    const target=user.querySelector('#userEmail')||[...user.children].find(el=>el.tagName!=='BUTTON'&&el.tagName!=='A');
    if(!target||target.dataset.a4ProfileTrigger==='1')return;
    target.dataset.a4ProfileTrigger='1';
    target.classList.add('a4-profile-trigger');
    target.setAttribute('role','link');
    target.setAttribute('tabindex','0');
    target.title='Открыть мой профиль';
    const openProfile=()=>{location.href='./profile.html'};
    target.addEventListener('click',openProfile);
    target.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openProfile()}});
  }

  function placeNotification(){
    const top=document.querySelector('.topbar');if(!top)return false;
    const actions=ensureTopActions(top);
    const center=document.getElementById('hubChatNotifyCenter');
    if(!center)return false;
    if(center.parentElement!==actions){center.classList.add('a4-top-notify');actions.insertBefore(center,actions.querySelector('.a4-more-btn'))}
    return true;
  }

  function ensureTopActions(top){
    let actions=top.querySelector('.a4-workspace-actions');
    if(actions){wireProfileTrigger(top);return actions}
    actions=document.createElement('div');actions.className='a4-workspace-actions';
    const user=top.querySelector(':scope > .user');if(user)actions.appendChild(user);
    const more=document.createElement('button');more.type='button';more.className='a4-more-btn';more.title='Ещё';more.setAttribute('aria-label','Ещё');more.textContent='⋯';
    const menu=document.createElement('div');menu.className='a4-more-menu';
    menu.innerHTML=`
      <a href="./profile.html">👤 <span>Мой профиль</span></a>
      <a href="./messages.html">💬 <span>Сообщения</span></a>
      <a href="/chat/start.html">📲 <span>Установить A4 Chat</span></a>
      <div class="a4-more-sep"></div>
      <button type="button" data-a4-theme-open>🎨 <span>Оформление</span></button>
      <a href="./settings.html">⚙️ <span>Настройки</span></a>
      <a href="./help.html">❓ <span>Инструкция</span></a>
      <div class="a4-more-sep"></div>
      <a href="../index.html">▦ <span>Выбор системы</span></a>`;
    more.onclick=e=>{e.stopPropagation();menu.classList.toggle('open')};
    menu.onclick=e=>e.stopPropagation();
    const themeButton=menu.querySelector('[data-a4-theme-open]');
    if(themeButton)themeButton.onclick=()=>{menu.classList.remove('open');document.querySelector('.a4-theme-fab')?.click()};
    document.addEventListener('click',()=>menu.classList.remove('open'));
    actions.append(more,menu);top.appendChild(actions);wireProfileTrigger(top);return actions;
  }

  let mobileWired=false;
  function mobileMenu(){
    const top=document.querySelector('.topbar'),sidebar=document.querySelector('.sidebar');if(!top||!sidebar)return;
    const isMobile=window.matchMedia?.('(max-width:900px)').matches;
    const existing=top.querySelector('.a4-mobile-menu');
    const shade=document.querySelector('.a4-mobile-nav-shade');

    if(!isMobile){
      existing?.remove();
      shade?.remove();
      document.body.classList.remove('a4-mobile-nav-open');
      return;
    }

    document.body.classList.remove('a4-sidebar-collapsed');
    let b=existing;
    if(!b){
      b=document.createElement('button');
      b.type='button';
      b.className='a4-mobile-menu';
      b.title='Меню';
      b.setAttribute('aria-label','Открыть меню');
      b.textContent='☰';
      top.prepend(b);
    }
    let sh=document.querySelector('.a4-mobile-nav-shade');
    if(!sh){sh=document.createElement('div');sh.className='a4-mobile-nav-shade';document.body.appendChild(sh)}
    const close=()=>document.body.classList.remove('a4-mobile-nav-open');
    b.onclick=()=>document.body.classList.toggle('a4-mobile-nav-open');
    sh.onclick=close;
    if(!mobileWired){
      mobileWired=true;
      sidebar.addEventListener('click',e=>{if(e.target.closest('a'))close()});
      window.addEventListener('resize',mobileMenu,{passive:true});
    }
  }

  function init(){
    removeClutter();groupNavigation();
    const top=document.querySelector('.topbar');if(top)ensureTopActions(top);
    mobileMenu();placeNotification();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  // Runtime layout is now bootstrapped once instead of observing the entire DOM forever.
  // A short post-load refresh catches late notification/profile mounts without creating a repaint loop.
  window.addEventListener('load',()=>setTimeout(()=>{removeClutter();groupNavigation();const top=document.querySelector('.topbar');if(top)wireProfileTrigger(top);placeNotification();mobileMenu()},250),{once:true});
})();