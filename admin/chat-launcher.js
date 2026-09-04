(function(){
  if(window.__A4_CHAT_LAUNCHER__)return;
  window.__A4_CHAT_LAUNCHER__=true;
  const CHAT_URL='/admin/messages.html?app=1&v=pwa3';
  const INSTALL_URL='/chat/?v=20260904-4';
  const style=document.createElement('style');
  style.textContent=`
    .a4-chat-nav-link .a4-nav-icon{display:grid;place-items:center}
    .a4-chat-nav-link .a4-chat-nav-mark{width:22px;height:22px;border-radius:7px;background:linear-gradient(135deg,#2563eb,#0ea5e9);display:grid;place-items:center;color:#fff;font-size:12px;font-weight:900;box-shadow:0 4px 12px rgba(37,99,235,.25)}
    .a4-chat-dashboard{margin:18px 0 20px;background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 58%,#0ea5e9 100%);border-radius:20px;padding:20px 22px;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:20px;box-shadow:0 18px 44px rgba(30,58,138,.18);overflow:hidden;position:relative}
    .a4-chat-dashboard:after{content:'💬';position:absolute;right:30%;top:-28px;font-size:120px;opacity:.08;transform:rotate(-10deg);pointer-events:none}
    .a4-chat-dashboard-copy{min-width:0;position:relative;z-index:1}.a4-chat-dashboard-copy h2{margin:0 0 5px;font-size:22px;color:#fff}.a4-chat-dashboard-copy p{margin:0;color:#dbeafe;font-size:14px}.a4-chat-dashboard-features{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.a4-chat-dashboard-features span{font-size:12px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.16);padding:5px 8px;border-radius:999px}
    .a4-chat-dashboard-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;position:relative;z-index:1}.a4-chat-dashboard-actions a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border-radius:12px;text-decoration:none;font-weight:900;white-space:nowrap}.a4-chat-open{background:#fff;color:#0f172a}.a4-chat-install{background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.35)}
    @media(max-width:760px){.a4-chat-dashboard{align-items:flex-start;flex-direction:column;padding:17px}.a4-chat-dashboard-actions{width:100%}.a4-chat-dashboard-actions a{flex:1}.a4-chat-dashboard-copy h2{font-size:19px}}
  `;
  document.head.appendChild(style);

  function addNav(){
    const nav=document.querySelector('.sidebar nav');
    if(!nav||nav.querySelector('.a4-chat-nav-link'))return false;
    const link=document.createElement('a');
    link.className='a4-chat-nav-link';
    link.href=CHAT_URL;
    link.title='A4PRINT HUB Chat';
    link.innerHTML='<span class="a4-nav-icon"><span class="a4-chat-nav-mark">💬</span></span><span class="a4-nav-label">A4 Chat</span>';
    const messages=[...nav.querySelectorAll('a')].find(a=>/messages\.html/.test(a.getAttribute('href')||''));
    if(messages)messages.insertAdjacentElement('afterend',link);else nav.appendChild(link);
    return true;
  }

  function addDashboard(){
    if(!/\/admin\/(index\.html)?$/.test(location.pathname)||document.querySelector('.a4-chat-dashboard'))return;
    const stats=document.querySelector('.main .stats');
    if(!stats)return;
    const card=document.createElement('section');
    card.className='a4-chat-dashboard';
    card.innerHTML=`<div class="a4-chat-dashboard-copy"><h2>💬 A4PRINT HUB Chat</h2><p>Отдельный рабочий мессенджер для ПК и телефона.</p><div class="a4-chat-dashboard-features"><span>🔔 уведомления</span><span>🔊 звук</span><span>📎 файлы</span><span>👥 личные чаты</span></div></div><div class="a4-chat-dashboard-actions"><a class="a4-chat-open" href="${CHAT_URL}">💬 Открыть чат</a><a class="a4-chat-install" href="${INSTALL_URL}">⬇ Установить приложение</a></div>`;
    stats.insertAdjacentElement('afterend',card);
  }

  function init(){addNav();addDashboard()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  let tries=0;const timer=setInterval(()=>{init();if(++tries>20||(document.querySelector('.a4-chat-nav-link')&&(!/\/admin\/(index\.html)?$/.test(location.pathname)||document.querySelector('.a4-chat-dashboard'))))clearInterval(timer)},250);
})();