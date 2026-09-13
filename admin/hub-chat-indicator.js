import { supabase } from './guard.js?v=20260913-hubchat2';

if(!window.__A4_HUB_CHAT_INDICATOR__){
  window.__A4_HUB_CHAT_INDICATOR__=true;
  let channel=null;
  let timer=null;
  let lastTotal=0;

  const badge=()=>document.getElementById('messageCount');
  const apply=total=>{
    total=Math.max(0,Number(total||0));
    const el=badge();
    if(el){
      el.textContent=total>99?'99+':String(total);
      el.style.display=total?'inline-flex':'none';
      el.setAttribute('aria-label',total?`Непрочитанных сообщений: ${total}`:'Нет непрочитанных сообщений');
    }
    lastTotal=total;
  };

  async function refresh(){
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session){apply(0);return}
      const {data,error}=await supabase.rpc('hub_chat_contacts');
      if(error)throw error;
      apply((Array.isArray(data)?data:[]).reduce((sum,row)=>sum+Number(row?.unread_count||0),0));
    }catch(error){
      console.warn('Unified chat indicator',error);
    }
  }

  async function start(){
    await refresh();
    try{
      channel=supabase.channel(`hub-chat-indicator-${crypto.randomUUID()}`)
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},()=>setTimeout(refresh,120))
        .on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages'},()=>setTimeout(refresh,120))
        .subscribe();
    }catch(error){console.warn('Unified chat indicator realtime',error)}
    timer=setInterval(refresh,30000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh()});
    window.addEventListener('focus',refresh);
    window.addEventListener('beforeunload',()=>{if(timer)clearInterval(timer);if(channel)supabase.removeChannel(channel)},{once:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
}
