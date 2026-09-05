(()=>{
  if(window.__A4_SUPPORT_NOTIFICATIONS__)return;
  window.__A4_SUPPORT_NOTIFICATIONS__=true;
  let supabase=null,profile=null,seen=new Set(),channel=null,timer=null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function supportUrl(){const p=new URLSearchParams(location.search);return `/admin/support.html${p.get('mobile')==='1'?'?mobile=1':''}`}
  async function markRead(id){try{await supabase.from('notifications').update({is_read:true}).eq('id',id)}catch{}}
  function badge(n){document.querySelectorAll('.sidebar nav a[href$="support.html"]').forEach(a=>{let b=a.querySelector('.a4-support-count');if(!b){b=document.createElement('b');b.className='a4-support-count';b.style.cssText='margin-left:auto;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#ef4444;color:#fff;display:none;align-items:center;justify-content:center;font-size:11px';a.appendChild(b)}b.textContent=n>99?'99+':String(n);b.style.display=n?'inline-flex':'none'})}
  function toast(n){
    if(!n||seen.has(n.id))return;seen.add(n.id);
    let host=document.getElementById('a4SupportToastHost');if(!host){host=document.createElement('div');host.id='a4SupportToastHost';host.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483002;display:grid;gap:8px;max-width:min(390px,calc(100vw - 36px))';document.body.appendChild(host)}
    const el=document.createElement('button');el.type='button';el.style.cssText='border:1px solid #86efac;background:#fff;border-radius:14px;padding:13px 15px;box-shadow:0 18px 48px rgba(15,23,42,.22);text-align:left;cursor:pointer;color:#0f172a;font:inherit';el.innerHTML=`<strong style="display:block;margin-bottom:5px">🛟 ${esc(n.title||'Поддержка')}</strong><span style="font-size:13px;color:#475569;line-height:1.4">${esc(n.body||'Новое сообщение поддержки')}</span>`;el.onclick=async()=>{await markRead(n.id);location.href=supportUrl()};host.appendChild(el);setTimeout(()=>el.remove(),10000);
    if('Notification'in window&&Notification.permission==='granted'){try{const x=new Notification(n.title||'A4PRINT HUB · Поддержка',{body:n.body||'Новое сообщение поддержки',tag:`a4-support-${n.id}`});x.onclick=()=>{window.focus();location.href=supportUrl();x.close()}}catch{}}
  }
  async function sync(announce=false){
    if(!supabase||!profile)return;
    const{data,error}=await supabase.from('notifications').select('id,title,body,type,entity_id,is_read,created_at').eq('type','SUPPORT_MESSAGE').eq('is_read',false).order('created_at',{ascending:false}).limit(50);if(error)throw error;
    const rows=data||[];badge(rows.length);if(announce)rows.slice().reverse().forEach(toast);else rows.forEach(x=>seen.add(x.id));
  }
  async function init(){
    try{
      const mod=await import('./guard.js');supabase=mod.supabase;
      const{data:{session}}=await supabase.auth.getSession();if(!session)return;
      const{data:p}=await supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle();if(!p)return;profile=p;
      await sync(false);
      channel=supabase.channel(`a4-support-notify-${p.id}-${Date.now()}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${p.id}`},payload=>{const n=payload.new;if(n?.type==='SUPPORT_MESSAGE'&&!n.is_read){toast(n);sync(false).catch(()=>{})}}).subscribe();
      timer=setInterval(()=>{if(!document.hidden)sync(true).catch(()=>{})},30000);
    }catch(e){console.warn('Support notifications unavailable',e)}
  }
  window.addEventListener('beforeunload',()=>{if(timer)clearInterval(timer);if(channel&&supabase)supabase.removeChannel(channel).catch(()=>{})});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
