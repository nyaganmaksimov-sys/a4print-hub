(()=>{
  'use strict';
  if(window.__A4_KASSA_QUEUE_RECOVERY__)return;
  window.__A4_KASSA_QUEUE_RECOVERY__=true;

  const DB=window.A4KassaDB;
  const cfg=window.A4PRINT_CONFIG||{};
  const createClient=window.supabase?.createClient;
  if(!DB||!createClient||!cfg.supabaseUrl||!cfg.supabasePublishableKey)return;

  const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
    global:{fetch:window.A4SupabaseFetch||fetch},
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });

  let running=false;

  async function updateQueueBadge(){
    try{
      const rows=await DB.getAll('queue');
      const chip=document.getElementById('queueChip');
      if(chip){
        const span=chip.querySelector('span');
        if(span)span.textContent=`Очередь ${rows.length}`;
        chip.className='status-chip '+(rows.length?'warn':'ok');
      }
    }catch{}
  }

  async function recoverOnce(){
    if(running||!navigator.onLine)return;
    running=true;
    try{
      const session=(await supabase.auth.getSession()).data?.session;
      if(!session)return;

      const queue=await DB.getAll('queue');
      for(const sale of queue){
        if(sale?.stage!=='backend_done')continue;
        const moyskladId=sale?.backend_result?.moysklad?.id;
        if(!moyskladId)continue;

        const {data,error}=await supabase.rpc('get_pos_sale_sync_state',{p_moysklad_sale_id:moyskladId});
        if(error||!data?.synced)continue;

        const receipt={
          ...sale,
          stage:'done',
          last_error:null,
          synced_at:new Date().toISOString(),
          backend_result:{
            ...(sale.backend_result||{}),
            moysklad:{
              ...(sale.backend_result?.moysklad||{}),
              id:data.moysklad_sale_id||moyskladId,
              name:data.moysklad_sale_name||sale.backend_result?.moysklad?.name||null
            }
          }
        };

        await DB.put('receipts',receipt);
        await DB.del('queue',sale.id);
        await DB.trimReceipts(100);
        window.dispatchEvent(new CustomEvent('a4:kassa-queue-recovered',{detail:{id:sale.id,moyskladId}}));
      }
      await updateQueueBadge();
    }catch(error){
      console.warn('A4PRINT KASSA queue recovery:',error);
    }finally{
      running=false;
    }
  }

  setTimeout(recoverOnce,700);
  setInterval(()=>{if(!document.hidden)recoverOnce()},10000);
  window.addEventListener('online',recoverOnce);
  window.addEventListener('focus',recoverOnce);
})();
