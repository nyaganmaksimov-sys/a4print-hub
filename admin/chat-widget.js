(function(){
  if(window.__A4_CHAT_WIDGET__)return;
  if(!/\/admin\//.test(location.pathname))return;
  if(/\/(login|register|pending|messages)\.html$/.test(location.pathname))return;
  window.__A4_CHAT_WIDGET__=true;

  const OPEN_KEY='a4_chat_widget_open_v1';
  let iframeLoaded=false;

  const style=document.createElement('style');
  style.id='a4-chat-widget-style';
  style.textContent=`
    #a4ChatWidget{position:fixed;right:18px;bottom:18px;z-index:25000;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #a4ChatWidgetButton{position:relative;width:56px;height:56px;border:0;border-radius:18px;background:#2563eb;color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 14px 34px rgba(37,99,235,.30);font-size:25px;transition:transform .16s ease,box-shadow .16s ease}
    #a4ChatWidgetButton:hover{transform:translateY(-1px);box-shadow:0 18px 38px rgba(37,99,235,.34)}
    #a4ChatWidgetCount{display:none;position:absolute;right:-5px;top:-5px;min-width:21px;height:21px;padding:0 5px;border-radius:999px;background:#ef4444;color:#fff;font:800 11px/21px Arial;text-align:center;border:2px solid #fff}
    #a4ChatWidgetPanel{display:none;position:absolute;right:0;bottom:68px;width:min(440px,calc(100vw - 28px));height:min(700px,calc(100vh - 110px));background:#fff;border:1px solid #dbe2ea;border-radius:18px;overflow:hidden;box-shadow:0 24px 70px rgba(15,23,42,.24)}
    #a4ChatWidget.open #a4ChatWidgetPanel{display:flex;flex-direction:column}
    .a4-chat-widget-head{height:52px;flex:0 0 52px;display:flex;align-items:center;gap:10px;padding:0 10px 0 14px;background:#0f172a;color:#fff;border-bottom:1px solid rgba(255,255,255,.08)}
    .a4-chat-widget-title{min-width:0;flex:1}.a4-chat-widget-title b{display:block;font-size:14px;line-height:1.1}.a4-chat-widget-title span{display:block;margin-top:3px;color:#94a3b8;font-size:10px}
    .a4-chat-widget-head button,.a4-chat-widget-head a{width:34px;height:34px;border:0;border-radius:9px;background:rgba(255,255,255,.09);color:#fff;display:grid;place-items:center;cursor:pointer;text-decoration:none;font:800 17px/1 system-ui}
    .a4-chat-widget-head button:hover,.a4-chat-widget-head a:hover{background:rgba(255,255,255,.16)}
    #a4ChatWidgetFrame{width:100%;height:100%;flex:1;min-height:0;border:0;background:#fff}
    .a4-chat-widget-loading{display:grid;place-items:center;flex:1;color:#64748b;font-size:13px}
    @media(max-width:760px){
      #a4ChatWidget{right:12px;bottom:max(12px,env(safe-area-inset-bottom))}
      #a4ChatWidgetButton{width:54px;height:54px;border-radius:17px}
      #a4ChatWidgetPanel{position:fixed;left:8px;right:8px;top:8px;bottom:74px;width:auto;height:auto;max-height:none;border-radius:16px}
      .a4-chat-widget-head{height:50px;flex-basis:50px}
    }
  `;
  document.head.appendChild(style);

  const root=document.createElement('div');
  root.id='a4ChatWidget';
  root.innerHTML=`
    <div id="a4ChatWidgetPanel" aria-hidden="true">
      <div class="a4-chat-widget-head">
        <div class="a4-chat-widget-title"><b>A4 Chat</b><span>Рабочие сообщения</span></div>
        <a href="./messages.html" title="Открыть полный чат">↗</a>
        <button type="button" id="a4ChatWidgetClose" title="Свернуть">−</button>
      </div>
      <div class="a4-chat-widget-loading" id="a4ChatWidgetLoading">Открываем чат…</div>
    </div>
    <button type="button" id="a4ChatWidgetButton" title="Открыть чат" aria-label="Открыть чат">💬<b id="a4ChatWidgetCount">0</b></button>`;
  document.body.appendChild(root);

  const panel=root.querySelector('#a4ChatWidgetPanel');
  const button=root.querySelector('#a4ChatWidgetButton');
  const close=root.querySelector('#a4ChatWidgetClose');

  function ensureFrame(){
    if(iframeLoaded)return;
    iframeLoaded=true;
    const frame=document.createElement('iframe');
    frame.id='a4ChatWidgetFrame';
    frame.title='A4PRINT HUB Chat';
    frame.setAttribute('allow','clipboard-read; clipboard-write; notifications');
    frame.src='./messages.html?app=1&embed=1&v=widget1';
    frame.onload=()=>root.querySelector('#a4ChatWidgetLoading')?.remove();
    panel.appendChild(frame);
  }
  function setOpen(open){
    root.classList.toggle('open',open);
    panel.setAttribute('aria-hidden',open?'false':'true');
    button.title=open?'Свернуть чат':'Открыть чат';
    button.textContent=open?'×':'💬';
    let count=document.getElementById('a4ChatWidgetCount');
    if(!count){count=document.createElement('b');count.id='a4ChatWidgetCount';count.textContent='0';button.appendChild(count)}
    if(open)ensureFrame();
    localStorage.setItem(OPEN_KEY,open?'1':'0');
  }
  button.onclick=()=>setOpen(!root.classList.contains('open'));
  close.onclick=()=>setOpen(false);

  function syncBadge(){
    const source=document.getElementById('hubChatNotifyCount');
    const target=document.getElementById('a4ChatWidgetCount');
    if(!target)return;
    const n=Number(source?.textContent||0)||0;
    target.textContent=n>99?'99+':String(n);
    target.style.display=n?'block':'none';
  }
  const observeBadge=()=>{
    const source=document.getElementById('hubChatNotifyCount');
    if(source){syncBadge();new MutationObserver(syncBadge).observe(source,{childList:true,subtree:true,characterData:true,attributes:true});return true}
    return false;
  };
  if(!observeBadge()){
    const obs=new MutationObserver(()=>{if(observeBadge())obs.disconnect()});
    obs.observe(document.body,{childList:true,subtree:true});
  }

  // Не разворачиваем чат автоматически на телефоне, чтобы он не закрывал рабочую страницу.
  if(innerWidth>760&&localStorage.getItem(OPEN_KEY)==='1')setOpen(true);
})();
