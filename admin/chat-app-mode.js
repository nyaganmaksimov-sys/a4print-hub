(function(){
  const q=new URLSearchParams(location.search);
  const appMode=q.get('app')==='1'||window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
  if(!appMode||!/\/admin\/messages\.html$/.test(location.pathname))return;
  document.documentElement.classList.add('a4-chat-app-mode');
  const style=document.createElement('style');
  style.textContent=`
    html.a4-chat-app-mode,html.a4-chat-app-mode body{height:100%;overflow:hidden;background:#f8fafc}
    html.a4-chat-app-mode .sidebar,html.a4-chat-app-mode .topbar{display:none!important}
    html.a4-chat-app-mode .main{margin:0!important;padding:0!important;width:100%!important;max-width:none!important;height:100dvh!important;min-height:100vh!important}
    html.a4-chat-app-mode .chat-shell{height:100dvh!important;min-height:100vh!important;border:0!important;border-radius:0!important;box-shadow:none!important}
    html.a4-chat-app-mode .chat{height:100dvh!important;min-height:0!important}
    html.a4-chat-app-mode .rooms{padding-top:max(14px,env(safe-area-inset-top))}
    html.a4-chat-app-mode .chat-head{padding-top:max(14px,env(safe-area-inset-top))!important}
    html.a4-chat-app-mode .composer{padding-bottom:max(14px,env(safe-area-inset-bottom))!important}
    html.a4-chat-app-mode #hubChatNotifyCenter{top:max(74px,calc(env(safe-area-inset-top) + 58px))!important}
    .a4-chat-hub-link{display:inline-flex;align-items:center;justify-content:center;border:1px solid #dbe2ea;background:#fff;color:#334155;border-radius:9px;padding:7px 10px;text-decoration:none;font:inherit;font-size:12px;font-weight:800;white-space:nowrap}
    @media(max-width:760px){html.a4-chat-app-mode .chat-shell{height:100dvh!important;min-height:100dvh!important}.a4-chat-hub-link{display:none}}
  `;
  document.head.appendChild(style);
  const addHubLink=()=>{
    const actions=document.querySelector('.chat-head .head-actions');
    if(!actions||document.querySelector('.a4-chat-hub-link'))return;
    const a=document.createElement('a');a.className='a4-chat-hub-link';a.href='/admin/index.html';a.textContent='↗ HUB';a.title='Открыть полную систему A4PRINT HUB';actions.appendChild(a);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addHubLink,{once:true});else addHubLink();
})();
