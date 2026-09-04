(function(){
  if(!/\/admin\/messages\.html$/.test(location.pathname))return;
  if(window.__A4_CHAT_UI_FIXES__)return;
  window.__A4_CHAT_UI_FIXES__=true;
  document.documentElement.classList.add('a4-chat-page');

  const css=document.createElement('style');
  css.id='a4-chat-ui-fixes-style';
  css.textContent=`
    html.a4-chat-page .a4-layout-toolbar{display:none!important}
    html.a4-chat-page .chat-head{overflow:visible}
    html.a4-chat-page .head-actions{overflow:visible}
    html.a4-chat-page #hubChatNotifyCenter.a4-notify-inline{position:relative!important;right:auto!important;top:auto!important;z-index:120!important;flex:0 0 auto;font-family:inherit!important}
    html.a4-chat-page #hubChatNotifyCenter.a4-notify-inline #hubChatNotifyBell{width:40px!important;height:40px!important;border-radius:11px!important;font-size:19px!important;box-shadow:none!important}
    html.a4-chat-page #hubChatNotifyCenter.a4-notify-inline #hubChatNotifyPanel{right:0!important;top:48px!important}
    html.a4-chat-page #notifBtn{min-height:40px;white-space:nowrap}
    html.a4-chat-page #refresh{min-height:40px}
    html.a4-chat-page .composer{background:#fff;position:relative;z-index:15}

    html.a4-chat-app-mode .a4-theme-fab,
    html.a4-chat-app-mode .a4-theme-panel,
    html.a4-chat-app-mode .a4-help-btn,
    html.a4-chat-app-mode .a4-help-pop,
    html.a4-chat-app-mode .a4-layout-toolbar{display:none!important}

    @media(max-width:760px){
      html.a4-chat-page .a4-theme-fab,
      html.a4-chat-page .a4-theme-panel,
      html.a4-chat-page .a4-help-btn,
      html.a4-chat-page .a4-help-pop,
      html.a4-chat-page .a4-layout-toolbar{display:none!important}

      html.a4-chat-page,html.a4-chat-page body{overflow:hidden!important}
      html.a4-chat-page .main{padding:0!important}
      html.a4-chat-page .chat-shell{height:100dvh!important;min-height:100dvh!important;border-radius:0!important;border-left:0!important;border-right:0!important}
      html.a4-chat-page .chat{min-height:0!important;height:100dvh!important;grid-template-rows:auto minmax(0,1fr) auto!important}
      html.a4-chat-page .chat-head{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:7px!important;padding:8px 9px!important;padding-top:max(8px,env(safe-area-inset-top))!important;background:#fff!important;position:relative!important;z-index:40!important}
      html.a4-chat-page .chat-title{min-width:0!important;display:grid!important;grid-template-columns:minmax(0,1fr)!important}
      html.a4-chat-page .chat-title h2{font-size:15px!important;line-height:1.15!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;margin:0!important}
      html.a4-chat-page .chat-title>span{font-size:11px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;margin-top:2px!important}
      html.a4-chat-page .head-actions{width:100%!important;display:grid!important;grid-template-columns:minmax(0,1fr) 40px 40px!important;gap:6px!important;align-items:center!important;justify-content:stretch!important}
      html.a4-chat-page .recipient-picker{grid-column:1/-1!important;width:100%!important;display:flex!important;gap:6px!important;align-items:center!important;font-size:11px!important}
      html.a4-chat-page .recipient-picker>span{display:none!important}
      html.a4-chat-page .recipient-picker select{width:100%!important;max-width:none!important;min-width:0!important;height:40px!important;padding:7px 34px 7px 10px!important;border-radius:11px!important;font-size:14px!important}
      html.a4-chat-page #notifBtn{grid-column:1/2!important;width:100%!important;min-width:0!important;height:40px!important;min-height:40px!important;padding:0 10px!important;border-radius:11px!important;font-size:12px!important;line-height:1!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
      html.a4-chat-page #hubChatNotifyCenter.a4-notify-inline{grid-column:2/3!important;width:40px!important;height:40px!important}
      html.a4-chat-page #hubChatNotifyCenter.a4-notify-inline #hubChatNotifyBell{width:40px!important;height:40px!important;border-radius:11px!important;font-size:18px!important;padding:0!important}
      html.a4-chat-page #hubChatNotifyCenter.a4-notify-inline #hubChatNotifyPanel{position:fixed!important;left:9px!important;right:9px!important;top:max(112px,calc(env(safe-area-inset-top) + 104px))!important;width:auto!important;max-height:min(62dvh,520px)!important;border-radius:14px!important}
      html.a4-chat-page #refresh{grid-column:3/4!important;width:40px!important;height:40px!important;min-height:40px!important;padding:0!important;border-radius:11px!important;font-size:0!important}
      html.a4-chat-page #refresh:before{content:'↻';font-size:21px;line-height:1}
      html.a4-chat-page .drive-state,.a4-chat-hub-link,.a4-chat-install-link{display:none!important}

      html.a4-chat-page .messages{padding:10px 9px 12px!important;gap:8px!important;overscroll-behavior:contain!important}
      html.a4-chat-page .msg{max-width:88%!important;padding:9px 10px!important;border-radius:14px!important}
      html.a4-chat-page .msg .meta{font-size:10px!important;margin-bottom:3px!important}
      html.a4-chat-page .msg .body{font-size:15px!important;line-height:1.35!important}
      html.a4-chat-page .attachment{padding:8px!important;gap:8px!important}
      html.a4-chat-page .attachment-icon{font-size:18px!important}
      html.a4-chat-page .attachment-name{font-size:12px!important}

      html.a4-chat-page .composer{grid-template-columns:42px minmax(0,1fr) 44px!important;gap:6px!important;padding:8px!important;padding-bottom:max(8px,env(safe-area-inset-bottom))!important;align-items:end!important;border-top:1px solid #e5e7eb!important;box-shadow:0 -8px 24px rgba(15,23,42,.04)!important}
      html.a4-chat-page .attach-btn{width:42px!important;height:44px!important;border-radius:12px!important;font-size:18px!important}
      html.a4-chat-page .composer textarea{min-width:0!important;width:100%!important;min-height:44px!important;max-height:96px!important;padding:10px 11px!important;border-radius:12px!important;font-size:16px!important;line-height:1.3!important}
      html.a4-chat-page .send{width:44px!important;height:44px!important;min-height:44px!important;padding:0!important;border-radius:12px!important;font-size:0!important;overflow:hidden!important}
      html.a4-chat-page .send:before{content:'➤';font-size:19px;line-height:1;color:#fff}
      html.a4-chat-page .pending{grid-column:1/-1!important}
      html.a4-chat-page .upload-note{display:none!important}

      html.a4-chat-page #hubChatNotifyToastHost,
      html.a4-chat-page #chatIncomingToastHost{left:9px!important;right:9px!important;top:max(8px,env(safe-area-inset-top))!important;max-width:none!important;width:auto!important}
    }

    @media(min-width:761px){
      html.a4-chat-app-mode .chat-head{padding:12px 14px!important}
      html.a4-chat-app-mode .head-actions{gap:7px!important}
      html.a4-chat-app-mode #hubChatNotifyCenter.a4-notify-inline #hubChatNotifyPanel{right:0!important}
    }
  `;
  document.head.appendChild(css);

  function compactNotifButton(){
    const b=document.getElementById('notifBtn');
    if(!b)return;
    const raw=(b.textContent||'').toLowerCase();
    if(raw.includes('не поддерж')){b.textContent='🔕 Нет уведомлений';b.title='Браузер не поддерживает уведомления'}
    else if(raw.includes('запрещ')){b.textContent='🔕 Уведомления';b.title='Уведомления запрещены в настройках браузера'}
    else if(raw.includes('включены')){b.textContent='🔔 Уведомления';b.title='Уведомления включены'}
    else if(raw.includes('включить')){b.textContent='🔔 Включить';b.title='Включить уведомления'}
  }

  function placeNotificationCenter(){
    const center=document.getElementById('hubChatNotifyCenter');
    const actions=document.querySelector('.chat-head .head-actions');
    if(!center||!actions)return false;
    if(!center.classList.contains('a4-notify-inline')){
      center.classList.add('a4-notify-inline');
      const refresh=document.getElementById('refresh');
      if(refresh)actions.insertBefore(center,refresh);else actions.appendChild(center);
    }
    return true;
  }

  function init(){
    compactNotifButton();
    placeNotificationCenter();
    const b=document.getElementById('notifBtn');
    if(b){new MutationObserver(compactNotifButton).observe(b,{childList:true,subtree:true,characterData:true})}
    const obs=new MutationObserver(()=>{placeNotificationCenter();compactNotifButton()});
    obs.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();