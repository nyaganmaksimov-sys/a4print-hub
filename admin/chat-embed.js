(function(){
  if(new URLSearchParams(location.search).get('embed')!=='1')return;
  document.documentElement.classList.add('a4-chat-embed');
  const style=document.createElement('style');
  style.id='a4-chat-embed-style';
  style.textContent=`
    html.a4-chat-embed,html.a4-chat-embed body{width:100%!important;height:100%!important;min-height:100%!important;overflow:hidden!important;background:#fff!important}
    html.a4-chat-embed .sidebar,html.a4-chat-embed .topbar,html.a4-chat-embed .rooms,html.a4-chat-embed .a4-theme-fab,html.a4-chat-embed .a4-theme-panel,html.a4-chat-embed .a4-help-btn,html.a4-chat-embed .a4-help-pop,html.a4-chat-embed .a4-layout-toolbar,html.a4-chat-embed #hubChatNotifyCenter,html.a4-chat-embed #a4NotificationWrap{display:none!important}
    html.a4-chat-embed .main{margin:0!important;padding:0!important;width:100%!important;height:100%!important;min-height:100%!important}
    html.a4-chat-embed .chat-shell{display:block!important;width:100%!important;height:100dvh!important;min-height:100dvh!important;border:0!important;border-radius:0!important;overflow:hidden!important;background:#fff!important}
    html.a4-chat-embed .chat{display:grid!important;grid-template-rows:auto minmax(0,1fr) auto!important;height:100dvh!important;min-height:0!important}
    html.a4-chat-embed .chat-head{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:6px!important;padding:9px 10px!important;background:#fff!important;border-bottom:1px solid #e5e7eb!important}
    html.a4-chat-embed .chat-title{min-width:0!important}
    html.a4-chat-embed .chat-title h2{font-size:15px!important;line-height:1.2!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;margin:0!important}
    html.a4-chat-embed .chat-title>span{font-size:10px!important;margin-top:2px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
    html.a4-chat-embed .head-actions{display:block!important;width:100%!important}
    html.a4-chat-embed .recipient-picker{display:flex!important;width:100%!important;align-items:center!important;gap:6px!important}
    html.a4-chat-embed .recipient-picker>span{display:none!important}
    html.a4-chat-embed .recipient-picker select{width:100%!important;max-width:none!important;height:38px!important;padding:6px 32px 6px 10px!important;border-radius:10px!important;font-size:13px!important}
    html.a4-chat-embed #notifBtn,html.a4-chat-embed #refresh,html.a4-chat-embed .drive-state,html.a4-chat-embed .a4-chat-hub-link,html.a4-chat-embed .a4-chat-install-link{display:none!important}
    html.a4-chat-embed .messages{min-height:0!important;padding:10px!important;gap:8px!important;background:#fbfdff!important}
    html.a4-chat-embed .msg{max-width:88%!important;padding:8px 10px!important;border-radius:13px!important}
    html.a4-chat-embed .msg .meta{font-size:9px!important;margin-bottom:3px!important}
    html.a4-chat-embed .msg .body{font-size:14px!important;line-height:1.35!important}
    html.a4-chat-embed .attachment{padding:7px 8px!important;gap:7px!important}
    html.a4-chat-embed .attachment-name{font-size:11px!important}
    html.a4-chat-embed .attachment-size{font-size:9px!important}
    html.a4-chat-embed .composer{grid-template-columns:40px minmax(0,1fr) 42px!important;gap:6px!important;padding:8px!important;border-top:1px solid #e5e7eb!important;background:#fff!important;align-items:end!important}
    html.a4-chat-embed .attach-btn{width:40px!important;height:42px!important;border-radius:11px!important;font-size:17px!important}
    html.a4-chat-embed .composer textarea{width:100%!important;min-width:0!important;min-height:42px!important;max-height:92px!important;padding:9px 10px!important;border-radius:11px!important;font-size:14px!important;line-height:1.3!important}
    html.a4-chat-embed .send{width:42px!important;height:42px!important;min-height:42px!important;padding:0!important;border-radius:11px!important;font-size:0!important}
    html.a4-chat-embed .send:before{content:'➤';font-size:17px;color:#fff}
    html.a4-chat-embed .upload-note{display:none!important}
    html.a4-chat-embed .pending{grid-column:1/-1!important}
  `;
  document.head.appendChild(style);
})();
