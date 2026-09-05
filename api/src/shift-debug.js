const BASE='https://api.moysklad.ru/api/remap/1.2';
const token=process.env.MOYSKLAD_TOKEN;
const headers={Authorization:`Bearer ${token}`,Accept:'application/json;charset=utf-8'};
const idOf=x=>x?.id||x?.meta?.href?.split('/').pop()||null;

async function get(path){
  const r=await fetch(BASE+path,{headers,cache:'no-store'});
  if(!r.ok)throw new Error(`MoySklad ${r.status}: ${await r.text()}`);
  return r.json();
}

async function optional(path){try{return await get(path)}catch(error){return{_error:String(error?.message||error)}}}

async function run(){
  if(!token)return;
  try{
    const [shiftData,storeData,orgData,employee]=await Promise.all([
      get('/entity/retailshift?limit=1000&order=created,desc'),
      get('/entity/retailstore?limit=100'),
      get('/entity/organization?limit=100'),
      optional('/context/employee')
    ]);
    const stores=new Map((storeData?.rows||[]).map(s=>[idOf(s),s?.name||null]));
    const mapShift=s=>({
      id:idOf(s),
      name:s?.name||null,
      openDate:s?.openDate||s?.moment||s?.created||null,
      closeDate:s?.closeDate||null,
      created:s?.created||null,
      updated:s?.updated||null,
      storeId:idOf(s?.retailStore),
      storeName:stores.get(idOf(s?.retailStore))||s?.retailStore?.name||null
    });
    const rows=shiftData?.rows||[];
    const open=rows.filter(s=>!s?.closeDate).map(mapShift);
    const latest=rows.slice(0,20).map(mapShift);
    console.log('[A4_SHIFT_DEBUG]',JSON.stringify({
      employee:employee?{id:idOf(employee),name:employee?.name||null,uid:employee?.uid||null,error:employee?._error||null}:null,
      organizations:(orgData?.rows||[]).map(o=>({id:idOf(o),name:o?.name||null})),
      stores:(storeData?.rows||[]).map(s=>({id:idOf(s),name:s?.name||null,archived:Boolean(s?.archived)})),
      openCount:open.length,
      open,
      latest
    }));
  }catch(error){
    console.error('[A4_SHIFT_DEBUG_ERROR]',String(error?.message||error));
  }
}

setTimeout(run,2500);
