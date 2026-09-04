(async function(){
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room');
  if(!roomId) return;

  try{
    const { supabase } = await import('./guard.js');
    const { data:{session} } = await supabase.auth.getSession();
    if(!session) return;

    const { data:me, error:meErr } = await supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle();
    if(meErr || !me) return;

    const { data:targetRoom, error:roomErr } = await supabase.from('chat_rooms').select('id,name,is_group').eq('id',roomId).maybeSingle();
    if(roomErr || !targetRoom) return;

    const waitFor = async (fn, timeout=8000) => {
      const started = Date.now();
      while(Date.now()-started < timeout){
        const value = fn();
        if(value) return value;
        await new Promise(r=>setTimeout(r,120));
      }
      return null;
    };

    if(targetRoom.is_group){
      const btn = await waitFor(()=>document.getElementById('generalRoom'));
      if(btn) btn.click();
      history.replaceState(null,'',location.pathname);
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
    history.replaceState(null,'',location.pathname);
  }catch(e){
    console.warn('Chat room router failed',e);
  }
})();
