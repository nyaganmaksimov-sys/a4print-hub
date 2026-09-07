const MS_BASE='https://api.moysklad.ru/api/remap/1.2';

export function idOf(entity){return entity?.id||entity?.meta?.href?.split('/').pop()||null}

function parseMsTime(value){
  const raw=String(value||'').trim();
  if(!raw)return 0;
  const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if(m)return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00`);
  const n=Date.parse(raw);
  return Number.isFinite(n)?n:0;
}

function entityTime(entity){return parseMsTime(entity?.moment||entity?.openDate||entity?.created||entity?.updated)}

export async function msRequest(token,path,options={}){
  if(!token)throw new Error('MOYSKLAD_NOT_CONFIGURED');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const r=await fetch(path.startsWith('http')?path:MS_BASE+path,{
      ...options,
      signal:controller.signal,
      headers:{Authorization:`Bearer ${token}`,Accept:'application/json;charset=utf-8','Content-Type':'application/json',...(options.headers||{})}
    });
    const text=await r.text();
    if(!r.ok)throw new Error(`MoySklad HTTP ${r.status}: ${text}`);
    return text?JSON.parse(text):null;
  }finally{clearTimeout(timer)}
}

async function allRows(token,path,maxPages=20){
  const rows=[];let url=path;let pages=0;
  while(url&&pages<maxPages){
    const data=await msRequest(token,url);rows.push(...(data?.rows||[]));url=data?.meta?.nextHref||null;pages++;
  }
  return rows;
}

export async function retailStoreContext(token){
  const [shiftList,storeList]=await Promise.all([
    msRequest(token,'/entity/retailshift?limit=1000&order=created,desc'),
    msRequest(token,'/entity/retailstore?limit=100')
  ]);
  const shifts=shiftList?.rows||[];
  const opens=shifts.filter(x=>!x.closeDate).sort((a,b)=>entityTime(b)-entityTime(a));
  const anchor=opens[0]||shifts[0]||null;
  const anchorStoreId=idOf(anchor?.retailStore);
  const stores=storeList?.rows||[];
  let storeRow=(anchorStoreId?stores.find(x=>idOf(x)===anchorStoreId):null)||stores.find(x=>x.archived!==true)||stores[0]||null;
  const storeHref=anchor?.retailStore?.meta?.href||storeRow?.meta?.href||null;
  let store=storeRow;
  if(storeHref){try{store=await msRequest(token,storeHref)}catch{}}
  const storeId=idOf(store)||idOf(storeRow)||anchorStoreId||null;
  if(!storeId)throw new Error('RETAIL_STORE_NOT_FOUND');
  return{
    store,
    storeInfo:{id:storeId,name:store?.name||storeRow?.name||anchor?.retailStore?.name||null},
    shifts,
    openShift:opens[0]||null
  };
}

function shiftIntersectsBaseline(shift,storeId,baselineMs){
  if(idOf(shift?.retailStore)!==storeId)return false;
  const opened=parseMsTime(shift?.openDate||shift?.moment||shift?.created);
  const closed=parseMsTime(shift?.closeDate);
  if(!closed)return true;
  return closed>=baselineMs||opened>=baselineMs;
}

async function operationsForShift(token,type,shift){
  const href=shift?.meta?.href;
  if(!href)return[];
  const filter=encodeURIComponent(`retailShift=${href}`);
  try{return await allRows(token,`/entity/${type}?limit=1000&filter=${filter}`)}catch{
    const rows=await msRequest(token,`/entity/${type}?limit=1000&order=moment,desc`).then(x=>x?.rows||[]);
    const shiftId=idOf(shift);
    return rows.filter(row=>idOf(row?.retailShift)===shiftId);
  }
}

export async function calculateCashBalance({token,service}){
  if(!service)throw new Error('DATABASE_NOT_CONFIGURED');
  const ctx=await retailStoreContext(token);
  const {data:baseline,error}=await service.from('pos_cash_balance_state').select('store_id,store_name,baseline_amount,baseline_at,updated_at').eq('store_id',ctx.storeInfo.id).maybeSingle();
  if(error)throw error;
  if(!baseline){
    return{available:false,requires_baseline:true,source:'BASELINE_REQUIRED',store:ctx.storeInfo,shift:ctx.openShift?{id:idOf(ctx.openShift),name:ctx.openShift.name||null}:null,cash:null};
  }

  const baselineMs=Date.parse(baseline.baseline_at);
  if(!Number.isFinite(baselineMs))throw new Error('INVALID_CASH_BASELINE');
  const shifts=ctx.shifts.filter(shift=>shiftIntersectsBaseline(shift,ctx.storeInfo.id,baselineMs));
  const totals={cash_sales:0,cash_returns:0,cash_in:0,cash_out:0,sales_count:0,returns_count:0,cashin_count:0,cashout_count:0};

  for(const shift of shifts){
    const [sales,returns,cashins,cashouts]=await Promise.all([
      operationsForShift(token,'retaildemand',shift),
      operationsForShift(token,'retailsalesreturn',shift),
      operationsForShift(token,'retaildrawercashin',shift),
      operationsForShift(token,'retaildrawercashout',shift)
    ]);
    for(const row of sales){if(entityTime(row)>baselineMs){totals.cash_sales+=Number(row.cashSum||0)/100;totals.sales_count++}}
    for(const row of returns){if(entityTime(row)>baselineMs){totals.cash_returns+=Number(row.cashSum||0)/100;totals.returns_count++}}
    for(const row of cashins){if(entityTime(row)>baselineMs){totals.cash_in+=Number(row.sum||0)/100;totals.cashin_count++}}
    for(const row of cashouts){if(entityTime(row)>baselineMs){totals.cash_out+=Number(row.sum||0)/100;totals.cashout_count++}}
  }

  const delta=totals.cash_sales+totals.cash_in-totals.cash_returns-totals.cash_out;
  const cash=Number(baseline.baseline_amount)+delta;
  return{
    available:true,
    requires_baseline:false,
    source:'MOYSKLAD_LEDGER',
    store:ctx.storeInfo,
    shift:ctx.openShift?{id:idOf(ctx.openShift),name:ctx.openShift.name||null}:null,
    cash:Math.round((cash+Number.EPSILON)*100)/100,
    baseline:{amount:Number(baseline.baseline_amount),at:baseline.baseline_at},
    delta:Math.round((delta+Number.EPSILON)*100)/100,
    totals
  };
}

export async function setCashBaseline({token,service,amount,userId}){
  if(!service)throw new Error('DATABASE_NOT_CONFIGURED');
  const ctx=await retailStoreContext(token);
  const now=new Date().toISOString();
  const payload={store_id:ctx.storeInfo.id,store_name:ctx.storeInfo.name||null,baseline_amount:Number(amount),baseline_at:now,baseline_set_by:userId||null,updated_at:now};
  const {error}=await service.from('pos_cash_balance_state').upsert(payload,{onConflict:'store_id'});
  if(error)throw error;
  return{available:true,requires_baseline:false,source:'MANUAL_BASELINE',store:ctx.storeInfo,shift:ctx.openShift?{id:idOf(ctx.openShift),name:ctx.openShift.name||null}:null,cash:Number(amount),baseline:{amount:Number(amount),at:now},delta:0};
}
