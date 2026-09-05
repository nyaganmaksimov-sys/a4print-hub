(function(){
  if(window.__A4_MOBILE_SHELL__)return;
  const params=new URLSearchParams(location.search);
  const standalone=window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
  const small=window.matchMedia?.('(max-width:900px)').matches||/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent||'');
  const mobile=params.get('mobile')==='1'||params.get('app')==='1'||(standalone&&small);
  if(!mobile||!/\/admin\//.test(location.pathname))return;
  const page=location.pathname.split('/').pop()||'';
  window.__A4_MOBILE_SHELL__=true;
  document.documentElement.classList.add('a4-mobile-shell');
  if(page==='messages.html')document.documentElement.classList.add('a4-chat-app-mode');

  const css=document.createElement('link');
  css.rel='stylesheet';css.href='/admin/mobile-shell.css?v=20260905-3';document.head.appendChild(css);
  const qcss=document.createElement('link');
  qcss.rel='stylesheet';qcss.href='/mobile/quick-menu.css?v=1';document.head.appendChild(qcss);

  const active=page==='messages.html'?'chat':page==='customers.html'||page==='customer.html'?'customers':page==='orders.html'||page==='order.html'||page==='manager.html'?'orders':'more';

  function mobileUrl(raw){
    try{
      const u=new URL(raw,location.href);
      if(u.origin!==location.origin)return raw;
      if(u.pathname.startsWith('/mobile/'))return u.pathname+u.search+u.hash;
      if(!u.pathname.startsWith('/admin/'))return raw;
      const name=u.pathname.split('/').pop();
      if(['login.html','register.html','pending.html','invite.html','reset-password.html'].includes(name))return raw;
      if(name==='messages.html'){
        u.searchParams.delete('mobile');
        u.searchParams.set('app','1');
      }else{
        u.searchParams.set('mobile','1');
      }
      return u.pathname+u.search+u.hash;
    }catch{return raw}
  }

  function rewriteAnchor(a){
    if(!a||a.dataset.a4MobileLink==='1')return;
    const href=a.getAttribute('href');
    if(!href||href.startsWith('#')||href.startsWith('mailto:')||href.startsWith('tel:')||href.startsWith('javascript:'))return;
    const next=mobileUrl(href);
    if(next!==href)a.setAttribute('href',next);
    a.dataset.a4MobileLink='1';
  }
  function rewriteLinks(root=document){
    if(root?.matches?.('a[href]'))rewriteAnchor(root);
    root.querySelectorAll?.('a[href]').forEach(rewriteAnchor);
  }

  function installQuickMenu(){
    if(window.A4QuickMenu)return;
    if(document.querySelector('script[data-a4-quick-menu-script]'))return;
    const s=document.createElement('script');
    s.src='/mobile/quick-menu.js?v=1';
    s.defer=true;
    s.dataset.a4QuickMenuScript='1';
    document.head.appendChild(s);
  }

  function installNav(){
    if(document.querySelector('.a4-mobile-nav'))return;
    const nav=document.createElement('nav');
    nav.className='a4-mobile-nav';
    nav.setAttribute('aria-label','Навигация A4PRINT HUB');
    nav.innerHTML=`
      <a href="/mobile/"><span class="a4m-icon">⌂</span><small>Главная</small></a>
      <a href="/admin/orders.html?mobile=1" class="${active==='orders'?'active':''}"><span class="a4m-icon">▣</span><small>Заказы</small></a>
      <a href="/admin/messages.html?app=1" class="${active==='chat'?'active':''}"><span class="a4m-icon">●</span><small>Чат</small></a>
      <a href="/admin/customers.html?mobile=1" class="${active==='customers'?'active':''}"><span class="a4m-icon">◉</span><small>Клиенты</small></a>
      <button type="button" class="a4qm-nav-button ${active==='more'?'active':''}" data-a4-quick-menu><span class="a4m-icon">☰</span><small>Меню</small></button>`;
    document.body.appendChild(nav);
  }

  function cleanDesktopArtifacts(){
    document.querySelectorAll('.sidebar').forEach(x=>x.setAttribute('aria-hidden','true'));
    if(page==='messages.html')return;
    const top=document.querySelector('.topbar');
    if(top&&!top.querySelector('.a4-mobile-home')){
      const a=document.createElement('a');
      a.className='a4-mobile-home';a.href='/mobile/';a.textContent='A4';a.title='Главная A4PRINT HUB';
      a.style.cssText='display:grid;place-items:center;width:38px;height:38px;flex:0 0 38px;border-radius:12px;background:#fff;color:#0f172a;border:1px solid #dbe3ee;text-decoration:none;font-weight:900;font-size:12px';
      top.insertBefore(a,top.firstChild);
    }
    if(top&&!top.querySelector('[data-a4-quick-menu]')){
      const b=document.createElement('button');
      b.type='button';b.dataset.a4QuickMenu='';b.textContent='☰';b.title='Быстрое меню';
      b.style.cssText='display:grid;place-items:center;width:38px;height:38px;flex:0 0 38px;border-radius:12px;background:#fff;color:#0f172a;border:1px solid #dbe3ee;font-weight:900;font-size:18px';
      top.appendChild(b);
    }
  }

  function init(){
    rewriteLinks();cleanDesktopArtifacts();installQuickMenu();installNav();
    document.addEventListener('click',e=>{
      const a=e.target?.closest?.('a[href]');
      if(!a||a.hasAttribute('download')||a.target==='_blank')return;
      const href=a.getAttribute('href');if(!href)return;
      const next=mobileUrl(href);if(next!==href)a.setAttribute('href',next);
    },true);
    const observer=new MutationObserver(muts=>{for(const m of muts){for(const n of m.addedNodes){if(n.nodeType===1)rewriteLinks(n)}}});
    observer.observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();