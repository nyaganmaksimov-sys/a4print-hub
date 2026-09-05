import express from 'express';

const BASE='https://api.moysklad.ru/api/remap/1.2';
const token=process.env.MOYSKLAD_TOKEN;

async function ms(path){
  if(!token)throw new Error('MOYSKLAD_TOKEN is not configured');
  const url=path.startsWith('http')?path:BASE+path;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(url,{signal:controller.signal,headers:{Authorization:`Bearer ${token}`,Accept:'application/json;charset=utf-8'}});
    if(!r.ok)throw new Error(`MoySklad HTTP ${r.status}: ${await r.text()}`);
    return r.status===204?null:r.json();
  }finally{clearTimeout(timer)}
}

const cents=v=>Number(v||0)/100;
const idOf=e=>e?.id||e?.meta?.href?.split('/').pop()||null;
const typeOf=e=>String(e?.meta?.type||'').toLowerCase();
const finite=(...values)=>{for(const value of values){const n=Number(value);if(Number.isFinite(n))return n}return 0};

async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let cursor=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(true){const i=cursor++;if(i>=items.length)return;out[i]=await fn(items[i],i)}
  });
  await Promise.all(workers);return out;
}

async function liveShift(){
  const list=await ms('/entity/retailshift?limit=100&order=created,desc');
  const open=(list?.rows||[]).find(x=>!x.closeDate)||null;
  if(!open)return{shift:null,summary:null,store:null};

  const shift=await ms(`/entity/retailshift/${encodeURIComponent(idOf(open))}`);
  const storeHref=shift?.retailStore?.meta?.href||open?.retailStore?.meta?.href||null;
  let store=null;
  if(storeHref){try{store=await ms(storeHref)}catch{}}

  const refs=Array.isArray(shift?.operations)?shift.operations:[];
  const operations=(await mapLimit(refs,8,async ref=>{
    const href=ref?.meta?.href;
    if(!href)return ref;
    try{return await ms(href)}catch{return ref}
  })).filter(Boolean);

  const d={
    sales_count:0,sales_total:0,sales_cash:0,sales_cashless:0,
    returns_count:0,returns_total:0,returns_cash:0,returns_cashless:0,
    deposits_count:0,deposits_total:0,payouts_count:0,payouts_total:0
  };

  for(const op of operations){
    const type=typeOf(op);
    if(type==='retaildemand'){
      d.sales_count++;
      d.sales_total+=cents(op.sum);
      d.sales_cash+=cents(op.cashSum);
      d.sales_cashless+=cents(Number(op.noCashSum||0)+Number(op.qrSum||0));
    }else if(type==='retailsalesreturn'){
      d.returns_count++;
      d.returns_total+=cents(op.sum);
      d.returns_cash+=cents(op.cashSum);
      d.returns_cashless+=cents(Number(op.noCashSum||0)+Number(op.qrSum||0));
    }else if(type==='retaildrawercashin'){
      d.deposits_count++;
      d.deposits_total+=cents(op.sum);
    }else if(type==='retaildrawercashout'){
      d.payouts_count++;
      d.payouts_total+=cents(op.sum);
    }
  }

  d.revenue_cash=cents(shift?.proceedsCash);
  d.revenue_cashless=cents(shift?.proceedsNoCash);
  d.revenue_total=d.revenue_cash+d.revenue_cashless;

  // MoySklad exposes the current cash-box amount differently across retail-store/shift API versions.
  // Prefer the retail-store cash value when present, then the shift's receivedCash value.
  d.cash_in_register=cents(finite(store?.cash,store?.state?.cash,shift?.cash,shift?.receivedCash));
  d.received_cash=cents(shift?.receivedCash);
  d.received_cashless=cents(shift?.receivedNoCash);
  d.source='MOYSKLAD_LIVE';

  const storeId=idOf(shift?.retailStore)||idOf(store);
  return{
    shift:{id:shift.id,name:shift.name,openDate:shift.moment||shift.openDate||shift.created,closeDate:shift.closeDate||null,updated:shift.updated||null},
    store:{id:storeId,name:store?.name||shift?.retailStore?.name||null},
    summary:d
  };
}

const originalGet=express.application.get;
express.application.get=function patchedGet(path,...handlers){
  if(path==='/api/v1/pos/shift'&&handlers.length){
    const index=handlers.length-1;
    handlers[index]=async function liveMoySkladShift(_req,res,next){
      try{
        const data=await liveShift();
        return res.json({success:true,...data});
      }catch(error){return next(error)}
    };
  }
  return originalGet.call(this,path,...handlers);
};
