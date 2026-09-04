(function(){
  if(window.__A4_CHAT_WIDGET__)return;
  if(!/\/admin\//.test(location.pathname))return;
  if(/\/(login|register|pending|invite|messages)\.html$/.test(location.pathname))return;
  window.__A4_CHAT_WIDGET__=true;

  const OPEN_KEY='a4_chat_widget_open_v1';
  const isMobile=window.matchMedia?.('(max-width:760px)').matches||/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent||'');
  let iframeLoaded=false;

  const style=document.createElement('style');
  style.id='a4-chat-widget-style';
  style.textContent=`
    #a4ChatWidget{position:fixed;right:18px;bottom:18px;z-index:25000;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #a4ChatWidgetButton{position:relative;width:54px;height:54px;border:0;border-radius:17px;background:#2563eb;color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 12px 30px rgba(37,99,235,.28);font-size:24px}
    #a4ChatWidgetCount{display:none;position:absolute;right:-5px;top:-5px;min-width:21px;height:21px;padding:0 5px;border-radius:999px;background:#ef4444;color:#fff;font:800 11px/21px Arial;text-align:center;border:2px solid #fff}
    #a4ChatWidgetPanel{display:none;position:absolute;right:0;bottom:66px;width:min(430px,calc(100vw - 28px));height:min(680px,calc(100vh - 106px));background:#fff;border:1px solid #dbe2ea;border-radius:17px;overflow:hidden;box-shadow:0 22px 64px rgba(15,23,42,.22)}
    #a4ChatWidget.open #a4ChatWidgetPanel{display:flex;flex-direction:column}
    .a4-chat-widget-head{height:50px;flex:0 0 50px;display:flex;align-items:center;gap:9px;padding:0 9px 0 13px;background:#0f172a;color:#fff;border-bottom:1px solid rgba(255,255,255,.08)}
    .a4-chat-widget-title{min-width:0;flex:1}.a4-chat-widget-title b{display:block;font-size:14px;line-height:1.1}.a4-chat-widget-title span{display:block;margin-top:3px;color:#94a3b8;font-size:10px}
    .a4-chat-widget-head button,.a4-chat-widget-head a{width:32px;height:32px;border:0;border-radius:8px;background:rgba(255,255,255,.09);color:#fff;display:grid;place-items:center;cursor:pointer;text-decoration:none;font:800 16px/1 system-ui}
    #a4ChatWidgetFrame{width:100%;height:100%;flex:1;min-height:0;border:0;background:#fff}
    .a4-chat-widget-loading{display:grid;place-items:center;flex:1;color:#64748b;font-size:13px}
    @media(max-width:760px){
      #a4ChatWidget{right:10px;bottom:max(10px,env(safe-area-inset-bottom))}
      #a4ChatWidgetButton{width:50px;height:50px;border-radius:15px}
      #a4ChatWidgetPanel{position:fixed;left:6px;right:6px;top:6px;bottom:66px;width:auto;height:auto;max-height:none;border-radius:14px}
      .a4-chat-widget-head{height:48px;flex-basis:48px}
    }
  `;
  document.head.appendChild(style);

  const root=document.createElement('div');root.id='a4ChatWidget';
  root.innerHTML=`<div id="a4ChatWidgetPanel" aria-hidden="true"><div class="a4-chat-widget-head"><div class="a4-chat-widget-title"><b>A4 Chat</b><span>Рабочие сообщения</span></div><a href="./messages.html?app=1" title="Открыть полный чат">↗</a><button type="button" id="a4ChatWidgetClose" title="Свернуть">−</button></div><div class="a4-chat-widget-loading" id="a4ChatWidgetLoading">Открываем чат…</div></div><button type="button" id="a4ChatWidgetButton" title="Открыть чат" aria-label="Открыть чат">💬<b id="a4ChatWidgetCount">0</b></button>`;
  document.body.appendChild(root);

  const panel=root.querySelector('#a4ChatWidgetPanel'),button=root.querySelector('#a4ChatWidgetButton'),close=root.querySelector('#a4ChatWidgetClose');

  function ensureFrame(){
    if(iframeLoaded)return;iframeLoaded=true;
    if(!document.getElementById('a4ChatWidgetLoading')){const l=document.createElement('div');l.id='a4ChatWidgetLoading';l.className='a4-chat-widget-loading';l.textContent='Открываем чат…';panel.appendChild(l)}
    const frame=document.createElement('iframe');frame.id='a4ChatWidgetFrame';frame.title='A4PRINT HUB Chat';frame.loading='lazy';frame.setAttribute('allow','clipboard-read; clipboard-write');frame.src='./messages.html?app=1&embed=1&v=widget2';frame.onload=()=>document.getElementById('a4ChatWidgetLoading')?.remove();panel.appendChild(frame);
  }
  function releaseFrame(){
    if(!isMobile)return;
    const frame=document.getElementById('a4ChatWidgetFrame');if(frame)frame.remove();iframeLoaded=false;
  }
  function setOpen(open){
    root.classList.toggle('open',open);panel.setAttribute('aria-hidden',open?'false':'true');button.title=open?'Свернуть чат':'Открыть чат';button.firstChild.textContent=open?'×':'💬';if(open)ensureFrame();else setTimeout(releaseFrame,180);try{localStorage.setItem(OPEN_KEY,open?'1':'0')}catch{}
  }
  button.onclick=()=>setOpen(!root.classList.contains('open'));close.onclick=()=>setOpen(false);

  function syncBadge(){const source=document.getElementById('hubChatNotifyCount'),target=document.getElementById('a4ChatWidgetCount');if(!target)return;const n=Number(source?.textContent||0)||0;target.textContent=n>99?'99+':String(n);target.style.display=n?'block':'none'}
  const observeBadge=()=>{const source=document.getElementById('hubChatNotifyCount');if(source){syncBadge();new MutationObserver(syncBadge).observe(source,{childList:true,subtree:true,characterData:true});return true}return false};
  if(!observeBadge()){const obs=new MutationObserver(()=>{if(observeBadge())obs.disconnect()});obs.observe(document.body,{childList:true,subtree:true});setTimeout(()=>obs.disconnect(),10000)}

  if(!isMobile&&localStorage.getItem(OPEN_KEY)==='1')setOpen(true);
})();