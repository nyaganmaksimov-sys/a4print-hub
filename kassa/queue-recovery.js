(()=>{
  'use strict';
  if(window.__A4_KASSA_QUEUE_RECOVERY__)return;
  window.__A4_KASSA_QUEUE_RECOVERY__=true;

  const DB=window.A4KassaDB;
  const cfg=window.A4PRINT_CONFIG||{};
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const createClient=window.supabase?.createClient;
  if(!DB||!createClient||!cfg.supabaseUrl||!cfg.supabasePublishableKey)return;

  const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
    global:{fetch:window.A4SupabaseFetch||fetch},
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });

  let running=false;

  // Never allow a later error handler to move a sale backwards from
  // backend_done to queued. That used to make already-created MoySklad sales
  // appear stuck forever in the local queue.
  if(DB.put&&!DB.put.__a4QueueStageGuard){
    const previousPut=DB.put.bind(DB);
    const rank={queued:0,backend_done:1,done:2};
    const guarded=async function(name,value){
      let next=value;
      if(name==='queue'&&value?.id){
        try{
          const existing=await DB.get('queue',value.id);
          const existingRank=rank[existing?.stage]??-1;
          const nextRank=rank[value?.stage]??-1;
          if(existing&&existingRank>nextRank){
            next={
              ...value,
              stage:existing.stage,
              backend_result:existing.backend_result||value.backend_result||null,
              tries:Math.max(Number(existing.tries||0),Number(value.tries||0)),
              last_error:value.last_error||existing.last_error||null
            };
          }
        }catch{}
      }
      return previousPut(name,next);
    };
    guarded.__a4QueueStageGuard=true;
    DB.put=guarded;
  }

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

  async function session(){
    let current=(await supabase.auth.getSession()).data?.session||null;
    if(current)return current;
    const refreshed=await supabase.auth.refreshSession();
    return refreshed.data?.session||null;
  }

  async function sendToBackend(sale,accessToken){
    if(!API||!sale?.id)return null;
    const response=await fetch(`${API}/api/v1/pos/sale`,{
      method:'POST',
      cache:'no-store',
      headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({
        items:sale.items,
        payment_method:sale.payment_method,
        customer_id:sale.customer_id,
        operator_id:sale.operator_id,
        client_operation_id:sale.id
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||data.error||`HTTP ${response.status}`);
    if(!data?.moysklad?.id)throw new Error('MOYSKLAD_SALE_ID_MISSING');
    return data;
  }

  async function isHubSynced(moyskladId){
    if(!moyskladId)return false;
    const {data,error}=await supabase.rpc('get_pos_sale_sync_state',{p_moysklad_sale_id:moyskladId});
    if(error)return false;
    return Boolean(data?.synced);
  }

  async function writeHubSale(sale){
    const d=sale.backend_result||{};
    if(!d?.moysklad?.id)return false;
    const r=await supabase.rpc('record_pos_sale',{
      p_moysklad_sale_id:d.moysklad.id,
      p_moysklad_sale_name:d.moysklad.name||null,
      p_moysklad_shift_id:sale.shift?.id||null,
      p_operator_id:sale.operator_id||null,
      p_customer_id:sale.customer_id||null,
      p_cash_account_id:sale.cash_account_id||null,
      p_payment_method:sale.payment_method,
      p_total:Number(d.sum??sale.total),
      p_items:sale.items||[]
    });
    if(!r.error)return true;
    return /duplicate|unique/i.test(String(r.error.message||''));
  }

  async function finalizeSale(sale){
    const receipt={...sale,stage:'done',last_error:null,synced_at:new Date().toISOString()};
    await DB.put('receipts',receipt);
    await DB.del('queue',sale.id);
    await DB.trimReceipts(100);
    window.dispatchEvent(new CustomEvent('a4:kassa-queue-recovered',{detail:{id:sale.id,moyskladId:sale.backend_result?.moysklad?.id||null}}));
  }

  async function recoverOnce(){
    if(running||!navigator.onLine)return;
    running=true;
    try{
      const currentSession=await session();
      if(!currentSession)return;

      const queue=await DB.getAll('queue');
      for(const original of queue){
        let sale=original;
        try{
          if(sale?.stage==='queued'){
            const backend=await sendToBackend(sale,currentSession.access_token);
            sale={...sale,stage:'backend_done',backend_result:backend,last_error:null,tries:Number(sale.tries||0)+1};
            await DB.put('queue',sale);
          }

          if(sale?.stage!=='backend_done')continue;
          const moyskladId=sale?.backend_result?.moysklad?.id;
          if(!moyskladId)continue;

          if(await isHubSynced(moyskladId)){
            await finalizeSale(sale);
            continue;
          }

          if(await writeHubSale(sale)){
            await finalizeSale(sale);
            continue;
          }
        }catch(error){
          const failed={...sale,tries:Number(sale.tries||0)+1,last_error:String(error?.message||error||'SYNC_ERROR')};
          await DB.put('queue',failed).catch(()=>{});
        }
      }
      await updateQueueBadge();
    }catch(error){
      console.warn('A4PRINT KASSA queue recovery:',error);
    }finally{
      running=false;
    }
  }

  setTimeout(recoverOnce,500);
  setInterval(()=>{if(!document.hidden)recoverOnce()},5000);
  window.addEventListener('online',recoverOnce);
  window.addEventListener('focus',recoverOnce);
  window.addEventListener('a4:kassa-shift',()=>setTimeout(recoverOnce,300));
})();
