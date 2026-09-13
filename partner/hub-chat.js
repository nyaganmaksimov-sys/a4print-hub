import { mountHubChat } from '../shared/hub-chat-core.js?v=20260913-hubchat1';

async function client(){
  if(window.__A4_PARTNER_CHAT_CLIENT__)return window.__A4_PARTNER_CHAT_CLIENT__;
  if(!window.supabase?.createClient){
    await new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-a4-supabase-chat]');
      if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',reject,{once:true});return}
      const s=document.createElement('script');s.src='/admin/vendor/supabase.js?v=20260905-1';s.dataset.a4SupabaseChat='1';s.onload=resolve;s.onerror=()=>reject(new Error('Не удалось загрузить модуль чата'));document.head.appendChild(s);
    });
  }
  const cfg=window.A4PRINT_PARTNER_CONFIG||{};
  if(!window.supabase?.createClient||!cfg.supabaseUrl||!cfg.supabasePublishableKey)throw new Error('Чат партнёра не настроен');
  window.__A4_PARTNER_CHAT_CLIENT__=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  return window.__A4_PARTNER_CHAT_CLIENT__;
}

const supabase=await client();
mountHubChat({supabase,context:'partner',loginUrl:'./login.html'}).catch(error=>{
  console.error('Partner HUB chat failed',error);
  const host=document.getElementById('hubChatApp');
  if(host)host.innerHTML=`<div style="padding:28px;border:1px solid #fecaca;border-radius:16px;background:#fff7f7;color:#991b1b">Не удалось запустить чат: ${String(error?.message||error)}</div>`;
});
