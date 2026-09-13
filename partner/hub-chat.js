import { installHubChatDrawer } from '../shared/hub-chat-drawer.js?v=20260913-drawer1';

async function client(){
  if(window.__A4_PARTNER_CHAT_CLIENT__)return window.__A4_PARTNER_CHAT_CLIENT__;
  if(!window.supabase?.createClient){
    await new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-a4-supabase-chat]');
      if(existing){
        if(window.supabase?.createClient)return resolve();
        existing.addEventListener('load',resolve,{once:true});
        existing.addEventListener('error',reject,{once:true});
        return;
      }
      const s=document.createElement('script');
      s.src='/admin/vendor/supabase.js?v=20260905-1';
      s.dataset.a4SupabaseChat='1';
      s.onload=resolve;
      s.onerror=()=>reject(new Error('Не удалось загрузить модуль сообщений'));
      document.head.appendChild(s);
    });
  }
  const cfg=window.A4PRINT_PARTNER_CONFIG||{};
  if(!window.supabase?.createClient||!cfg.supabaseUrl||!cfg.supabasePublishableKey)throw new Error('Сообщения партнёра не настроены');
  window.__A4_PARTNER_CHAT_CLIENT__=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  return window.__A4_PARTNER_CHAT_CLIENT__;
}

async function start(){
  try{
    const supabase=await client();
    await installHubChatDrawer({supabase,context:'partner',loginUrl:'./login.html'});
  }catch(error){
    console.error('Partner HUB chat failed',error);
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
else start();
