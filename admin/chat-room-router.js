(async function(){
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room');
  const messageId = params.get('message') || '';
  if(!roomId) return;

  const waitFor = async (fn, timeout=10000) => {
    const started = Date.now();
    while(Date.now()-started < timeout){
      const value = fn();
      if(value) return value;
      await new Promise(r=>setTimeout(r,120));
    }
    return null;
  };

  const focusMessage = async () => {
    if(!messageId) return;
    const node = await waitFor(()=>document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`),10000);
    if(!node) return;
    try{node.scrollIntoView({behavior:'smooth',block:'center'});}catch{node.scrollIntoView();}
    const oldOutline=node.style.outline,oldShadow=node.style.boxShadow,oldTransition=node.style.transition;
    node.style.transition='outline-color .2s ease, box-shadow .2s ease';
    node.style.outline='3px solid rgba(37,99,235,.42)';
    node.style.boxShadow='0 0 0 7px rgba(37,99,235,.10)';
    setTimeout(()=>{node.style.outline=oldOutline;node.style.boxShadow=oldShadow;node.style.transition=oldTransition;},2600);
  };

  const cleanUrl = () => {
    const next = new URL(location.href);
    next.searchParams.delete('room');
    next.searchParams.delete('message');
    next.searchParams.delete('v');
    history.replaceState(null,'',next.pathname + (next.searchParams.toString()?`?${next.searchParams.toString()}`:''));
  };

  try{
    const { supabase } = await import('./guard.js');
    const { data:{session} } = await supabase.auth.getSession();
    if(!session) return;

    const { data:me, error:meErr } = await supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle();
    if(meErr || !me) return;

    const { data:targetRoom, error:roomErr } = await supabase.from('chat_rooms').select('id,name,is_group').eq('id',roomId).maybeSingle();
    if(roomErr || !targetRoom) return;

    if(targetRoom.is_group){
      const btn = await waitFor(()=>document.getElementById('generalRoom'));
      if(btn) btn.click();
      await waitFor(()=>document.body.dataset.chatRoomId===roomId);
      await focusMessage();
      cleanUrl();
      return;
    }

    const { data:members, error:membersErr } = await supabase.from('chat_members').select('user_id').eq('room_id',roomId);
    if(membersErr) return;
    const otherId = (members||[]).map(x=>x.user_id).find(id=>id && id!==me.id);
    if(!otherId) return;

    const select = await waitFor(()=>{
      const el = document.getElementById('recipientSelect');
      return el && [...el.options].some(o=>o.value===otherId) ? el : null;
    });
    if(!select) return;

    select.value = otherId;
    select.dispatchEvent(new Event('change',{bubbles:true}));
    await waitFor(()=>document.body.dataset.chatRoomId===roomId);
    await focusMessage();
    cleanUrl();
  }catch(e){
    console.warn('Chat room router failed',e);
  }
})();
