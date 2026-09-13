import { mountHubChat } from './hub-chat-core.js?v=20260913-hubchat2';

const VERSION='20260913-drawer1';

function ensureStyle(id,href){
  if(document.getElementById(id))return;
  const link=document.createElement('link');link.id=id;link.rel='stylesheet';link.href=href;document.head.appendChild(link);
}

function stripChatRoutingParams(){
  try{
    const url=new URL(location.href);let changed=false;
    for(const key of ['staff','partner'])if(url.searchParams.has(key)){url.searchParams.delete(key);changed=true}
    if(changed)history.replaceState(history.state,'',url);
  }catch{}
}

export async function installHubChatDrawer({supabase,context='staff',loginUrl='./login.html'}={}){
  if(!supabase)throw new Error('Supabase client is required');
  if(window.__A4_HUB_CHAT_DRAWER_API__)return window.__A4_HUB_CHAT_DRAWER_API__;

  ensureStyle('a4HubChatCoreCss',`/shared/hub-chat.css?v=${VERSION}`);
  ensureStyle('a4HubChatEnhanceCss',`/shared/hub-chat-enhance.css?v=${VERSION}`);
  ensureStyle('a4HubChatDrawerCss',`/shared/hub-chat-drawer.css?v=${VERSION}`);

  const originalTitle=document.title;
  const titleNode=document.querySelector('title');
  if(titleNode){
    let restoring=false;
    new MutationObserver(()=>{
      if(restoring||document.title===originalTitle)return;
      restoring=true;document.title=originalTitle;queueMicrotask(()=>{restoring=false});
    }).observe(titleNode,{childList:true,subtree:true,characterData:true});
  }

  const drawer=document.createElement('div');
  drawer.className='a4-chat-drawer';drawer.id='a4HubChatDrawer';drawer.hidden=true;
  drawer.innerHTML=`<section class="a4-chat-drawer-panel" role="dialog" aria-modal="true" aria-label="Сообщения A4PRINT HUB">
    <header class="a4-chat-drawer-head">
      <div class="a4-chat-drawer-title"><span class="a4-chat-drawer-mark">HUB</span><span class="a4-chat-drawer-copy"><b>${context==='partner'?'Связь с A4PRINT HUB':'Сообщения'}</b><small>${context==='partner'?'Поддержка и рабочая переписка без выхода из CRM':'Персонал и партнёры в одном встроенном чате'}</small></span></div>
      <button class="a4-chat-drawer-close" type="button" aria-label="Закрыть чат">×</button>
    </header>
    <div class="a4-chat-drawer-body"><div id="hubChatApp" aria-live="polite"></div></div>
  </section>`;
  document.body.appendChild(drawer);

  let mountPromise=null,chatApi=null,badgeChannel=null,badgeTimer=null;
  const closeBtn=drawer.querySelector('.a4-chat-drawer-close');

  function ensurePartnerNav(){
    if(context!=='partner')return;
    const nav=document.querySelector('.crm-nav');if(!nav)return;
    let link=[...nav.querySelectorAll('a')].find(a=>/crm-messages\.html/i.test(a.getAttribute('href')||'')||a.dataset.hubChatOpen!==undefined);
    if(!link){
      link=document.createElement('a');
      link.innerHTML='<svg viewBox="0 0 24 24"><path d="M4 4h16v12H8l-4 4Z"/><path d="M8 8h8M8 12h5"/></svg><span>Сообщения HUB</span><b class="a4-chat-nav-badge" data-hub-chat-badge>0</b>';
      const exit=[...nav.querySelectorAll('a')].find(a=>/\.\/index\.html/.test(a.getAttribute('href')||''));
      if(exit)nav.insertBefore(link,exit);else nav.appendChild(link);
    }
    link.href='#hub-chat';link.dataset.hubChatOpen='';
    const text=link.querySelector('span');if(text)text.textContent='Сообщения HUB';
    if(!link.querySelector('[data-hub-chat-badge]')){const b=document.createElement('b');b.className='a4-chat-nav-badge';b.dataset.hubChatBadge='';b.textContent='0';link.appendChild(b)}
  }

  function normalizeLegacyUi(){
    document.querySelectorAll('a[href]').forEach(link=>{
      const href=String(link.getAttribute('href')||'');
      if(/(?:^|\/)messages\.html(?:[?#].*)?$/i.test(href)||/(?:^|\/)crm-messages\.html(?:[?#].*)?$/i.test(href)){
        link.setAttribute('href','#hub-chat');link.dataset.hubChatOpen='';
      }
    });
    const dash=document.querySelector('.dash-app-btn.chat');
    if(dash){dash.href='#hub-chat';dash.dataset.hubChatOpen='';const icon=dash.querySelector('.dash-app-icon');if(icon)icon.textContent='MSG';const title=dash.querySelector('b');if(title)title.textContent='Сообщения';const small=dash.querySelector('small');if(small)small.textContent='Персонал и партнёры';}
    ensurePartnerNav();
  }

  function badgeElements(){return [...document.querySelectorAll('#messageCount,[data-hub-chat-badge]')]}
  function applyUnread(total){
    total=Math.max(0,Number(total||0));
    for(const el of badgeElements()){
      el.textContent=total>99?'99+':String(total);
      el.classList.toggle('is-visible',Boolean(total));
      if(el.id==='messageCount')el.style.display=total?'inline-flex':'none';
      el.setAttribute('aria-label',total?`Непрочитанных сообщений: ${total}`:'Нет непрочитанных сообщений');
    }
  }
  async function refreshUnread(){
    try{
      const {data:{session}}=await supabase.auth.getSession();if(!session){applyUnread(0);return 0}
      const {data,error}=await supabase.rpc('hub_chat_contacts');if(error)throw error;
      const total=(Array.isArray(data)?data:[]).reduce((sum,row)=>sum+Number(row?.unread_count||0),0);applyUnread(total);return total;
    }catch(error){console.warn('HUB chat unread counter',error);return 0}
  }

  async function ensureMounted(){
    if(mountPromise)return mountPromise;
    mountPromise=(async()=>{
      chatApi=await mountHubChat({supabase,context,loginUrl});
      if(context==='staff')import('./hub-chat-enhance.js?v=20260913-hubchat2').catch(()=>{});
      stripChatRoutingParams();document.title=originalTitle;
      drawer.querySelector('#hubChatApp')?.addEventListener('click',event=>{if(event.target.closest?.('.hc-contact'))setTimeout(stripChatRoutingParams,350)});
      return chatApi;
    })().catch(error=>{mountPromise=null;throw error});
    return mountPromise;
  }

  async function open(){
    normalizeLegacyUi();drawer.hidden=false;document.body.classList.add('a4-chat-drawer-open');
    try{const api=await ensureMounted();await api?.refresh?.();await refreshUnread()}catch(error){console.error('HUB chat drawer failed',error)}
  }
  function close(){
    drawer.hidden=true;document.body.classList.remove('a4-chat-drawer-open');stripChatRoutingParams();document.title=originalTitle;
    if(location.hash==='#hub-chat'){const url=new URL(location.href);url.hash='';history.replaceState(history.state,'',url)}
  }

  closeBtn.addEventListener('click',close);
  drawer.addEventListener('click',event=>{if(event.target===drawer)close()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!drawer.hidden)close()});
  document.addEventListener('click',event=>{
    const trigger=event.target.closest?.('[data-hub-chat-open],a[href="#hub-chat"]');
    if(!trigger)return;event.preventDefault();open();
  });
  window.addEventListener('a4-hub-chat-open',open);
  window.addEventListener('focus',refreshUnread);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshUnread()});

  normalizeLegacyUi();
  const uiObserver=new MutationObserver(normalizeLegacyUi);uiObserver.observe(document.body,{childList:true,subtree:true});
  await refreshUnread();
  try{
    badgeChannel=supabase.channel(`hub-chat-drawer-badge-${crypto.randomUUID()}`)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},()=>setTimeout(refreshUnread,120))
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages'},()=>setTimeout(refreshUnread,120))
      .subscribe();
  }catch(error){console.warn('HUB chat badge realtime',error)}
  badgeTimer=setInterval(refreshUnread,30000);
  window.addEventListener('beforeunload',()=>{if(badgeTimer)clearInterval(badgeTimer);if(badgeChannel)supabase.removeChannel(badgeChannel);uiObserver.disconnect()},{once:true});

  const api={open,close,refresh:async()=>{await refreshUnread();return chatApi?.refresh?.()},get mounted(){return Boolean(chatApi)}};
  window.__A4_HUB_CHAT_DRAWER_API__=api;window.A4HubChat=api;
  if(location.hash==='#hub-chat')queueMicrotask(open);
  return api;
}
