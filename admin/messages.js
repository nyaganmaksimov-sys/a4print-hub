import { supabase } from './guard.js?v=20260913-hubchat1';
import { mountHubChat } from '../shared/hub-chat-core.js?v=20260913-hubchat1';

window.__A4PRINT_CHAT_PAGE__=true;

mountHubChat({
  supabase,
  context:'staff',
  loginUrl:'./login.html'
}).catch(error=>{
  console.error('HUB chat failed',error);
  const host=document.getElementById('hubChatApp');
  if(host)host.innerHTML=`<div style="padding:28px;border:1px solid #fecaca;border-radius:16px;background:#fff7f7;color:#991b1b">Не удалось запустить чат: ${String(error?.message||error)}</div>`;
});
