const BASE='https://api.moysklad.ru/api/remap/1.2';
const token=process.env.MOYSKLAD_TOKEN;
const headers={Authorization:`Bearer ${token}`,Accept:'application/json;charset=utf-8'};
const idOf=x=>x?.id||x?.meta?.href?.split('/').pop()||null;

async function get(path){
  const r=await fetch(BASE+path,{headers,cache:'no-store'});
  if(!r.ok)throw new Error(`MoySklad ${r.status}: ${await r.text()}`);
  return r.json();
}

async function run(){
  if(!token)return;
  try{
    const [shiftData,storeData]=await Promise.all([
      get('/entity/retailshift?limit=1000&order=created,desc'),
      get('/entity/retailstore?limit=100')
    ]);
    const stores=new Map((storeData?.rows||[]).map(s=>[idOf(s),s?.name||null]));
    const open=(shiftData?.rows||[]).filter(s=>!s?.closeDate).map(s=>({
      id:idOf(s),
      name:s?.name||null,
      openDate:s?.openDate||s?.moment||s?.created||null,
      created:s?.created||null,
      updated:s?.updated||null,
      storeId:idOf(s?.retailStore),
      storeName:stores.get(idOf(s?.retailStore))||s?.retailStore?.name||null
    }));
    console.log('[A4_SHIFT_DEBUG]',JSON.stringify({count:open.length,open}));
  }catch(error){
    console.error('[A4_SHIFT_DEBUG_ERROR]',String(error?.message||error));
  }
}

setTimeout(run,2500);
