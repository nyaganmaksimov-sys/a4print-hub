(function(){
  if(window.__A4_CHAT_MODERN__)return;
  window.__A4_CHAT_MODERN__=true;
  const style=document.createElement('style');
  style.id='a4-chat-modern-style';
  style.textContent=`
    :root{--chat-bg:#f4f7fb;--chat-line:#e2e8f0;--chat-text:#0f172a;--chat-muted:#64748b;--chat-blue:#2563eb}
    body{background:var(--chat-bg)!important;color:var(--chat-text)!important}
    .chat-shell{border:1px solid var(--chat-line)!important;border-radius:20px!important;box-shadow:0 14px 42px rgba(15,23,42,.07)!important;background:#fff!important}
    .rooms{background:#f8fafc!important;border-right:1px solid var(--chat-line)!important;padding:16px!important}
    .room-title{font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px!important}
    .room-btn,.person-btn{border-radius:12px!important;transition:background .14s ease,border-color .14s ease,transform .14s ease}
    .room-btn:hover,.person-btn:hover{transform:translateX(1px)}
    .room-btn.active,.person-btn.active{background:#eff6ff!important;border-color:#bfdbfe!important;color:#1d4ed8!important}
    .person-avatar{border-radius:12px!important;background:linear-gradient(180deg,#fff,#f8fafc)!important}
    .staff-search{min-height:42px!important;border-radius:11px!important;border-color:#d8e0ea!important}
    .chat-head{background:rgba(255,255,255,.94)!important;backdrop-filter:blur(12px);border-bottom:1px solid var(--chat-line)!important;padding:13px 16px!important}
    .chat-title h2{font-size:17px!important;letter-spacing:-.02em}
    .messages{background:linear-gradient(180deg,#fbfdff 0%,#f8fbff 100%)!important;padding:18px!important;gap:8px!important}
    .msg{border:1px solid #e7edf4!important;background:#fff!important;border-radius:16px 16px 16px 5px!important;box-shadow:0 2px 9px rgba(15,23,42,.035)!important;padding:10px 12px!important}
    .msg.mine{background:#eaf2ff!important;border-color:#c7ddff!important;border-radius:16px 16px 5px 16px!important}
    .msg .meta{font-size:10.5px!important;color:#7b8798!important}
    .msg .body{line-height:1.45!important;color:#1e293b!important}
    .attachment{border-radius:12px!important;border-color:#dbe4ef!important;background:rgba(255,255,255,.86)!important}
    .composer{background:#fff!important;border-top:1px solid var(--chat-line)!important;padding:11px!important;gap:8px!important}
    .composer textarea{border-radius:13px!important;border:1px solid #cbd5e1!important;background:#f8fafc!important;box-shadow:none!important;padding:11px 12px!important}
    .composer textarea:focus{background:#fff!important;border-color:#60a5fa!important;box-shadow:0 0 0 3px rgba(37,99,235,.10)!important;outline:0!important}
    .send{background:var(--chat-blue)!important;border-radius:13px!important;box-shadow:0 6px 16px rgba(37,99,235,.18)!important}
    .attach-btn{border-radius:13px!important;background:#f1f5f9!important;color:#475569!important}
    #refresh,#notifBtn{border-radius:10px!important;border-color:#dbe2ea!important;background:#fff!important;min-height:38px}
    .recipient-picker select{border-radius:10px!important;border-color:#dbe2ea!important;min-height:38px}

    @media(max-width:900px){
      body{background:#fff!important}
      .sidebar,.topbar{display:none!important}
      .main{margin:0!important;padding:0!important;width:100%!important;max-width:none!important}
      .chat-shell{height:100dvh!important;min-height:100dvh!important;border:0!important;border-radius:0!important;box-shadow:none!important;grid-template-columns:1fr!important}
      .rooms{display:none!important}
      .chat-head{position:sticky;top:0;z-index:20;padding:8px!important;background:rgba(255,255,255,.96)!important;box-shadow:0 2px 10px rgba(15,23,42,.04)}
      .chat-title{display:none!important}
      .head-actions{width:100%!important;display:grid!important;grid-template-columns:minmax(0,1fr) auto auto!important;gap:6px!important;align-items:center!important}
      .recipient-picker{grid-column:1/2!important;width:100%!important}
      .recipient-picker span{display:none!important}
      .recipient-picker select{width:100%!important;max-width:none!important;min-height:42px!important;font-size:14px!important}
      .drive-state{display:none!important}
      #notifBtn,#refresh{width:42px!important;height:42px!important;min-height:42px!important;padding:0!important;font-size:0!important}
      #notifBtn::before{content:'🔔';font-size:18px}#refresh::before{content:'↻';font-size:21px}
      .messages{padding:10px 8px!important;gap:7px!important}
      .msg{max-width:88%!important;padding:9px 11px!important}
      .composer{position:sticky;bottom:0;grid-template-columns:auto minmax(0,1fr) auto!important;padding:7px 8px calc(7px + env(safe-area-inset-bottom))!important;background:rgba(255,255,255,.97)!important;backdrop-filter:blur(14px)}
      .composer textarea{min-height:44px!important;max-height:116px!important;font-size:16px!important}
      .attach-btn,.send{width:44px!important;height:44px!important;min-height:44px!important;padding:0!important}
      .send{font-size:0!important}.send::before{content:'➤';font-size:19px}
      .upload-note{display:none!important}
      .pending-name{max-width:160px!important}
    }
  `;
  document.head.appendChild(style);
})();