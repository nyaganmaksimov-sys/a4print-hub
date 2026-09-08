(function(){
  if(window.__A4_CHAT_WATCHDOG__)return;
  window.__A4_CHAT_WATCHDOG__=true;
  const q=new URLSearchParams(location.search);
  const standalone=window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
  const embed=q.get('embed')==='1';

  if(embed){
    document.documentElement.classList.add('a4-chat-embed-watchdog');
    const style=document.createElement('style');
    style.id='a4-chat-embed-watchdog-style';
    style.textContent=`
      html.a4-chat-embed-watchdog .a4-mobile-nav,
      html.a4-chat-embed-watchdog .a4-mobile-nav-shade,
      html.a4-chat-embed-watchdog .a4qm-panel,
      html.a4-chat-embed-watchdog .a4qm-backdrop{display:none!important}
      html.a4-chat-embed-watchdog,
      html.a4-chat-embed-watchdog body{height:100%!important;min-height:100%!important;overflow:hidden!important}
      html.a4-chat-embed-watchdog .main{height:100%!important;min-height:100%!important;margin:0!important;padding:0!important}
      html.a4-chat-embed-watchdog .chat-shell{height:100dvh!important;min-height:0!important;overflow:hidden!important}
      html.a4-chat-embed-watchdog .chat{height:100%!important;min-height:0!important;display:grid!important;grid-template-rows:auto minmax(0,1fr) auto!important;overflow:hidden!important}
      html.a4-chat-embed-watchdog .messages{min-height:0!important;overflow:auto!important}
      html.a4-chat-embed-watchdog .composer{display:grid!important;visibility:visible!important;opacity:1!important;position:relative!important;z-index:30!important;background:#fff!important;flex:none!important}
      html.a4-chat-embed-watchdog .composer textarea,
      html.a4-chat-embed-watchdog .composer .attach-btn,
      html.a4-chat-embed-watchdog .composer .send{visibility:visible!important;opacity:1!important}
    `;
    document.head.appendChild(style);
    const cleanup=()=>document.querySelectorAll('.a4-mobile-nav,.a4-mobile-nav-shade,.a4qm-panel,.a4qm-backdrop').forEach(x=>x.remove());
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',cleanup,{once:true});else cleanup();
    setTimeout(cleanup,250);
    setTimeout(cleanup,900);
  }

  if(!embed&&(q.get('app')==='1'||standalone)){
    const shell=document.createElement('script');shell.src='/admin/mobile-shell.js?v=20260908-3';shell.async=false;document.head.appendChild(shell);
  }

  function addSupportEntry(){
    const general=document.getElementById('generalRoom');
    if(!general||document.getElementById('supportRoomEntry'))return false;
    const btn=document.createElement('button');
    btn.id='supportRoomEntry';
    btn.type='button';
    btn.className='room-btn';
    btn.style.marginTop='8px';
    btn.innerHTML='<span style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span>🛟 Поддержка</span><small style="font-size:9px;padding:3px 6px;border-radius:999px;background:#dcfce7;color:#166534">оператор</small></span>';
    btn.title='База знаний, чат-бот и личный чат с оператором поддержки';
    btn.onclick=()=>{location.href='/admin/support.html'+(q.get('app')==='1'?'?mobile=1':'')};
    general.insertAdjacentElement('afterend',btn);
    return true;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addSupportEntry,{once:true});else addSupportEntry();
  let supportTries=0;const supportTimer=setInterval(()=>{supportTries++;if(addSupportEntry()||supportTries>30)clearInterval(supportTimer)},150);

  let done=false;
  const $=id=>document.getElementById(id);
  function ready(){
    const staff=$('staffList');
    const msg=$('messages');
    if(!staff||!msg)return false;
    const staffStarted=!/Загрузка/i.test(staff.textContent||'');
    const msgStarted=!/Подключение к чату|Загрузка сообщений/i.test(msg.textContent||'');
    if(staffStarted&&msgStarted){done=true;return true}
    return false;
  }
  function show(message){
    if(done||ready())return;
    const msg=$('messages');
    const staff=$('staffList');
    const html=`<div class="empty-chat" style="max-width:420px;padding:18px;color:#991b1b"><b style="display:block;margin-bottom:7px">Не удалось запустить чат</b><span style="display:block;color:#64748b;font-size:13px;line-height:1.45">${String(message||'Сервер не ответил вовремя.').replace(/[<>]/g,'')}</span><button id="a4ChatRetry" type="button" style="margin-top:12px;border:0;border-radius:10px;background:#2563eb;color:white;padding:10px 14px;font:inherit;font-weight:800">Повторить</button></div>`;
    if(msg)msg.innerHTML=html;
    if(staff&&/Загрузка/i.test(staff.textContent||''))staff.innerHTML='<div class="staff-empty">Нет соединения · нажмите «Повторить»</div>';
    document.getElementById('a4ChatRetry')?.addEventListener('click',()=>{
      const u=new URL(location.href);u.searchParams.set('_retry',Date.now().toString());location.replace(u.href);
    });
  }
  const timer=setInterval(()=>{if(ready())clearInterval(timer)},500);
  setTimeout(()=>{clearInterval(timer);show('Проверка соединения заняла слишком много времени. Перезапустите чат одним нажатием.')},10000);
  window.addEventListener('unhandledrejection',e=>{
    const text=String(e.reason?.message||e.reason||'');
    if(/supabase|fetch|network|timeout|Failed to fetch|JWT|permission|profile|chat/i.test(text))show(text);
  });
  window.addEventListener('error',e=>{
    const text=String(e.message||'');
    if(/module|script|supabase|fetch/i.test(text))show(text);
  });
})();