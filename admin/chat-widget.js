(function(){
  if(window.__A4_CHAT_WIDGET__)return;
  if(!/\/admin\//.test(location.pathname))return;
  if(/\/(login|register|pending|invite|messages)\.html$/.test(location.pathname))return;
  window.__A4_CHAT_WIDGET__=true;

  const OPEN_KEY='a4_chat_widget_open_v1';
  let frameLoadTimer=0;

  const style=document.createElement('style');
  style.id='a4-chat-widget-style';
  style.textContent=`
    #a4ChatWidget{position:fixed;right:18px;bottom:18px;z-index:25000;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #a4ChatWidgetButton{position:relative;width:54px;height:54px;border:0;border-radius:17px;background:#2563eb;color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 12px 30px rgba(37,99,235,.28);font-size:24px}
    #a4ChatWidgetButton:disabled{opacity:.78;cursor:wait}
    #a4ChatWidgetCount{display:none;position:absolute;right:-5px;top:-5px;min-width:21px;height:21px;padding:0 5px;border-radius:999px;background:#ef4444;color:#fff;font:800 11px/21px Arial;text-align:center;border:2px solid #fff}
    #a4ChatWidgetPanel{display:none;position:absolute;right:0;bottom:66px;width:min(390px,calc(100vw - 28px));height:min(560px,calc(100vh - 106px));background:#fff;border:1px solid #dbe2ea;border-radius:17px;overflow:hidden;box-shadow:0 22px 64px rgba(15,23,42,.22)}
    #a4ChatWidget.open #a4ChatWidgetPanel{display:flex;flex-direction:column}
    .a4-chat-widget-head{height:48px;flex:0 0 48px;display:flex;align-items:center;gap:9px;padding:0 9px 0 13px;background:#0f172a;color:#fff;border-bottom:1px solid rgba(255,255,255,.08)}
    .a4-chat-widget-title{min-width:0;flex:1}.a4-chat-widget-title b{display:block;font-size:14px;line-height:1.1}.a4-chat-widget-title span{display:block;margin-top:3px;color:#94a3b8;font-size:10px}
    .a4-chat-widget-head button,.a4-chat-widget-head a{width:32px;height:32px;border:0;border-radius:8px;background:rgba(255,255,255,.09);color:#fff;display:grid;place-items:center;cursor:pointer;text-decoration:none;font:800 16px/1 system-ui}
    #a4ChatWidgetFrame{width:100%;height:100%;flex:1;min-height:0;border:0;background:#fff}
    .a4-chat-widget-loading{display:grid;place-items:center;flex:1;color:#64748b;font-size:13px;text-align:center;padding:18px;line-height:1.45}
    @media(max-width:900px){
      #a4ChatWidget{right:10px;bottom:max(10px,env(safe-area-inset-bottom))}
      #a4ChatWidgetButton{width:50px;height:50px;border-radius:15px}
      #a4ChatWidgetPanel{position:fixed;left:6px;right:6px;top:6px;bottom:66px;width:auto;height:auto;max-height:none;border-radius:14px}
      .a4-chat-widget-head{height:48px;flex-basis:48px}
    }
  `;
  document.head.appendChild(style);

  const root=document.createElement('div');root.id='a4ChatWidget';
  root.innerHTML=`<div id="a4ChatWidgetPanel" aria-hidden="true"><div class="a4-chat-widget-head"><div class="a4-chat-widget-title"><b>A4 Chat</b><span id="a4ChatWidgetSubtitle">Рабочие сообщения</span></div><a id="a4ChatWidgetFull" href="./messages.html?app=1" title="Открыть полный чат">↗</a><button type="button" id="a4ChatWidgetClose" title="Свернуть">−</button></div><div class="a4-chat-widget-loading" id="a4ChatWidgetLoading">Открываем чат…</div></div><button type="button" id="a4ChatWidgetButton" title="Открыть чат" aria-label="Открыть чат">💬<b id="a4ChatWidgetCount">0</b></button>`;
  document.body.appendChild(root);

  const panel=root.querySelector('#a4ChatWidgetPanel'),button=root.querySelector('#a4ChatWidgetButton'),close=root.querySelector('#a4ChatWidgetClose'),full=root.querySelector('#a4ChatWidgetFull'),subtitle=root.querySelector('#a4ChatWidgetSubtitle');

  function withMode(url,embed=true){
    const u=new URL(url||'./messages.html',location.href);
    u.searchParams.set('app','1');
    if(embed)u.searchParams.set('embed','1');else u.searchParams.delete('embed');
    u.searchParams.set('v',embed?'widget6':'notify6');
    return u.pathname+`?${u.searchParams.toString()}`;
  }

  // Opening the compact widget must never wait for another database query.
  // If there is an unread notification, opening its room is enough; exact
  // message resolution remains available in the full notifications workflow.
  async function latestTarget(){
    const rows=window.__A4_CHAT_UNREAD_NOTIFICATIONS__||[];
    const latest=rows[0];
    if(!latest)return{embed:withMode('./messages.html',true),full:withMode('./messages.html',false),unread:false};
    const roomId=String(latest.entity_id||'').trim();
    const base=roomId?`./messages.html?room=${encodeURIComponent(roomId)}`:'./messages.html';
    return{embed:withMode(base,true),full:withMode(base,false),unread:!!roomId};
  }

  function ensureLoading(text='Открываем чат…'){
    let loading=document.getElementById('a4ChatWidgetLoading');
    if(!loading){loading=document.createElement('div');loading.id='a4ChatWidgetLoading';loading.className='a4-chat-widget-loading';panel.appendChild(loading)}
    loading.textContent=text;
    return loading;
  }

  function ensureFrame(targetUrl,forceNavigate=false){
    let frame=document.getElementById('a4ChatWidgetFrame');
    if(frame){
      if(forceNavigate&&targetUrl&&frame.dataset.target!==targetUrl){frame.dataset.target=targetUrl;ensureLoading();frame.src=targetUrl}
      return frame;
    }
    ensureLoading();
    frame=document.createElement('iframe');
    frame.id='a4ChatWidgetFrame';
    frame.title='A4PRINT HUB Chat';
    frame.loading='eager';
    frame.setAttribute('allow','clipboard-read; clipboard-write');
    frame.dataset.target=targetUrl||withMode('./messages.html',true);
    frame.onload=()=>{
      clearTimeout(frameLoadTimer);
      document.getElementById('a4ChatWidgetLoading')?.remove();
    };
    frame.src=frame.dataset.target;
    panel.appendChild(frame);
    clearTimeout(frameLoadTimer);
    frameLoadTimer=setTimeout(()=>{
      const loading=document.getElementById('a4ChatWidgetLoading');
      if(loading)loading.textContent='Чат отвечает дольше обычного. Основная система продолжает работать — можно открыть полный чат кнопкой ↗.';
    },7000);
    return frame;
  }

  function releaseFrame(){
    clearTimeout(frameLoadTimer);
    const frame=document.getElementById('a4ChatWidgetFrame');
    if(frame){
      try{frame.src='about:blank'}catch{}
      frame.remove();
    }
    document.getElementById('a4ChatWidgetLoading')?.remove();
  }

  async function setOpen(open){
    root.classList.toggle('open',open);
    panel.setAttribute('aria-hidden',open?'false':'true');
    button.title=open?'Свернуть чат':'Открыть чат';
    button.firstChild.textContent=open?'×':'💬';
    if(open){
      button.disabled=true;
      try{
        const target=await latestTarget();
        full.href=target.full;
        subtitle.textContent=target.unread?'Непрочитанные сообщения':'Рабочие сообщения';
        requestAnimationFrame(()=>ensureFrame(target.embed,target.unread));
      }finally{button.disabled=false}
    }else{
      subtitle.textContent='Рабочие сообщения';
      // Never keep the full chat runtime/realtime subscriptions alive behind a
      // closed floating window. Reopening creates a clean lightweight frame.
      setTimeout(releaseFrame,80);
    }
    try{localStorage.setItem(OPEN_KEY,open?'1':'0')}catch{}
  }

  button.onclick=()=>setOpen(!root.classList.contains('open'));
  close.onclick=()=>setOpen(false);

  function syncBadge(){const source=document.getElementById('hubChatNotifyCount'),target=document.getElementById('a4ChatWidgetCount');if(!target)return;const n=Number(source?.textContent||0)||0;target.textContent=n>99?'99+':String(n);target.style.display=n?'block':'none'}
  const observeBadge=()=>{const source=document.getElementById('hubChatNotifyCount');if(source){syncBadge();new MutationObserver(syncBadge).observe(source,{childList:true,subtree:true,characterData:true});return true}return false};
  if(!observeBadge()){const obs=new MutationObserver(()=>{if(observeBadge())obs.disconnect()});obs.observe(document.body,{childList:true,subtree:true});setTimeout(()=>obs.disconnect(),10000)}
  window.addEventListener('a4:chat-unread',syncBadge);

  // Deliberately do not restore an open floating chat on every admin page load.
  // The widget stays idle until the operator explicitly opens it.
})();