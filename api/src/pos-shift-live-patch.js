import express from 'express';
import { createClient } from '@supabase/supabase-js';

const BASE='https://api.moysklad.ru/api/remap/1.2';
const BUILD='20260912-mslive-fast1';
const token=process.env.MOYSKLAD_TOKEN;
const supabase=process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY
  ?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}})
  :null;

async function ms(path){
  if(!token)throw new Error('MOYSKLAD_TOKEN is not configured');
  const url=path.startsWith('http')?path:BASE+path;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(url,{signal:controller.signal,headers:{Authorization:`Bearer ${token}`,Accept:'application/json;charset=utf-8','Accept-Encoding':'gzip'}});
    if(!r.ok)throw new Error(`MoySklad HTTP ${r.status}: ${await r.text()}`);
    return r.status===204?null:r.json();
  }finally{clearTimeout(timer)}
}

const cents=v=>Number(v||0)/100;
const idOf=e=>e?.id||e?.meta?.href?.split('/').pop()||null;
const typeOf=e=>String(e?.meta?.type||'').toLowerCase();
const timeOf=e=>{
  const raw=e?.openDate||e?.moment||e?.created||e?.updated||'';
  const d=new Date(String(raw).replace(' ','T'));
  return Number.isFinite(d.getTime())?d.getTime():0;
};
const firstFinite=(...values)=>{
  for(const value of values){
    const n=Number(value);
    if(Number.isFinite(n))return n;
  }
  return null;
};

async function currentCashBalance(shift,store){
  const direct=firstFinite(store?.cash,store?.state?.cash,shift?.cash);
  if(direct!==null)return cents(direct);
  try{
    const report=await ms('/report/money/bymoment');
    const orgId=idOf(shift?.organization);
    const rows=Array.isArray(report?.rows)?report.rows:[];
    const exact=rows.find(row=>!row.account&&(!orgId||idOf(row.organization)===orgId));
    const fallback=rows.find(row=>!row.account);
    const balance=firstFinite((exact||fallback)?.balance);
    if(balance!==null)return cents(balance);
  }catch{}
  return cents(firstFinite(shift?.receivedCash,0)||0);
}

async function shiftOperations(shift){
  const href=shift?.meta?.href;
  if(!href)return[];
  const types=['retaildemand','retailsalesreturn','retaildrawercashin','retaildrawercashout'];
  const out=[];
  for(const type of types){
    try{
      const data=await ms(`/entity/${type}?limit=1000&filter=${encodeURIComponent(`retailShift=${href}`)}`);
      out.push(...(data?.rows||[]));
    }catch(error){
      console.warn(`[POS shift live] ${type} summary unavailable:`,error?.message||error);
    }
  }
  return out;
}

async function liveShift(){
  const list=await ms('/entity/retailshift?limit=100&order=created,desc');
  const openRows=(list?.rows||[]).filter(x=>!x.closeDate).sort((a,b)=>timeOf(b)-timeOf(a));
  const open=openRows[0]||null;
  if(!open)return{shift:null,summary:null,store:null,build:BUILD};

  const shift=await ms(`/entity/retailshift/${encodeURIComponent(idOf(open))}`);
  const storeHref=shift?.retailStore?.meta?.href||open?.retailStore?.meta?.href||null;
  let store=null;
  if(storeHref){try{store=await ms(storeHref)}catch{}}

  const operations=await shiftOperations(shift);
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

  d.revenue_cash=Number.isFinite(Number(shift?.proceedsCash))?cents(shift.proceedsCash):Math.max(0,d.sales_cash-d.returns_cash);
  d.revenue_cashless=Number.isFinite(Number(shift?.proceedsNoCash))?cents(shift.proceedsNoCash):Math.max(0,d.sales_cashless-d.returns_cashless);
  d.revenue_total=d.revenue_cash+d.revenue_cashless;
  d.received_cash=cents(shift?.receivedCash);
  d.received_cashless=cents(shift?.receivedNoCash);
  d.cash_in_register=await currentCashBalance(shift,store);
  d.source='MOYSKLAD_LIVE';

  const storeId=idOf(shift?.retailStore)||idOf(store);
  return{
    build:BUILD,
    shift:{id:shift.id,name:shift.name,openDate:shift.openDate||shift.moment||shift.created,closeDate:shift.closeDate||null,updated:shift.updated||null},
    store:{id:storeId,name:store?.name||shift?.retailStore?.name||null},
    summary:d
  };
}

async function hubShift(){
  if(!supabase)return null;
  try{
    const {data,error}=await supabase.from('pos_shift_sessions')
      .select('moysklad_shift_id,moysklad_shift_name,opened_at,status,updated_at,store_id,store_name')
      .eq('status','OPEN').order('opened_at',{ascending:false}).limit(1).maybeSingle();
    if(error||!data?.moysklad_shift_id)return null;
    const after=data.opened_at;
    const [salesResult,returnsResult,opsResult,baselineResult,balanceSalesTimed,balanceSalesUntimed,balanceReturnsTimed,balanceReturnsUntimed,balanceOps]=await Promise.all([
      supabase.from('pos_sales').select('total,payment_method').gte('sold_at',after),
      supabase.from('pos_returns').select('amount,payment_method').gte('returned_at',after),
      supabase.from('pos_cash_operations').select('operation_type,amount').gte('created_at',after),
      supabase.from('pos_cash_balance_state').select('baseline_amount,baseline_at').order('updated_at',{ascending:false}).limit(1).maybeSingle(),
      supabase.from('pos_sales').select('total,payment_method,sold_at,created_at'),
      supabase.from('pos_sales').select('total,payment_method,sold_at,created_at').is('sold_at',null),
      supabase.from('pos_returns').select('amount,payment_method,returned_at,created_at'),
      supabase.from('pos_returns').select('amount,payment_method,returned_at,created_at').is('returned_at',null),
      supabase.from('pos_cash_operations').select('operation_type,amount,created_at')
    ]);
    for(const result of [salesResult,returnsResult,opsResult,baselineResult,balanceSalesTimed,balanceSalesUntimed,balanceReturnsTimed,balanceReturnsUntimed,balanceOps])if(result.error)throw result.error;
    const sales=salesResult.data||[],returns=returnsResult.data||[],ops=opsResult.data||[];
    const isCash=v=>/налич|cash/i.test(String(v||''));
    const sum=(rows,field)=>rows.reduce((n,row)=>n+Number(row?.[field]||0),0);
    const cashSales=sum(sales.filter(x=>isCash(x.payment_method)),'total');
    const cashReturns=sum(returns.filter(x=>isCash(x.payment_method)),'amount');
    const cashlessSales=sum(sales.filter(x=>!isCash(x.payment_method)),'total');
    const cashlessReturns=sum(returns.filter(x=>!isCash(x.payment_method)),'amount');
    const cashIn=ops.filter(x=>x.operation_type==='CASH_IN');
    const cashOut=ops.filter(x=>x.operation_type==='CASH_OUT');
    const baseline=baselineResult.data||null;
    let cashInRegister=null;
    if(baseline){
      const baselineAt=new Date(baseline.baseline_at).getTime();
      const since=row=>new Date(row.sold_at||row.returned_at||row.created_at||0).getTime()>=baselineAt;
      const bSales=[...(balanceSalesTimed.data||[]),...(balanceSalesUntimed.data||[])].filter(since).filter(x=>isCash(x.payment_method));
      const bReturns=[...(balanceReturnsTimed.data||[]),...(balanceReturnsUntimed.data||[])].filter(since).filter(x=>isCash(x.payment_method));
      const bOps=(balanceOps.data||[]).filter(since);
      cashInRegister=Number(baseline.baseline_amount)+sum(bSales,'total')+sum(bOps.filter(x=>x.operation_type==='CASH_IN'),'amount')-sum(bReturns,'amount')-sum(bOps.filter(x=>x.operation_type==='CASH_OUT'),'amount');
    }
    return{
      build:BUILD,
      shift:{id:data.moysklad_shift_id,name:data.moysklad_shift_name||'—',openDate:data.opened_at,closeDate:null,updated:data.updated_at||null},
      store:data.store_id?{id:data.store_id,name:data.store_name||null}:null,
      summary:{
        source:'HUB_FAST',
        sales_count:sales.length,sales_total:sum(sales,'total'),sales_cash:cashSales,sales_cashless:cashlessSales,
        returns_count:returns.length,returns_total:sum(returns,'amount'),returns_cash:cashReturns,returns_cashless:cashlessReturns,
        deposits_count:cashIn.length,deposits_total:sum(cashIn,'amount'),payouts_count:cashOut.length,payouts_total:sum(cashOut,'amount'),
        revenue_cash:cashSales-cashReturns,revenue_cashless:cashlessSales-cashlessReturns,
        revenue_total:sum(sales,'total')-sum(returns,'amount'),cash_in_register:cashInRegister
      }
    };
  }catch{return null}
}

async function hubFallback(){
  if(!supabase)return null;
  try{
    const {data,error}=await supabase.from('pos_shift_sessions')
      .select('moysklad_shift_id,moysklad_shift_name,opened_at,status,updated_at')
      .eq('status','OPEN')
      .order('opened_at',{ascending:false})
      .limit(1)
      .maybeSingle();
    if(error||!data?.moysklad_shift_id)return null;
    return{
      build:BUILD,
      degraded:true,
      shift:{id:data.moysklad_shift_id,name:data.moysklad_shift_name||'—',openDate:data.opened_at,closeDate:null,updated:data.updated_at||null},
      store:null,
      summary:{source:'HUB_FALLBACK'}
    };
  }catch{return null}
}

const originalGet=express.application.get;
let markerAdded=false;
express.application.get=function patchedGet(path,...handlers){
  if(!markerAdded){
    markerAdded=true;
    originalGet.call(this,'/api/v1/pos/shift-live-build',(_req,res)=>res.json({success:true,shiftLive:BUILD}));
  }
  if(path==='/api/v1/pos/shift'&&handlers.length){
    const index=handlers.length-1;
    handlers[index]=async function liveMoySkladShift(_req,res,next){
      const hub=await hubShift();
      if(hub){
        liveShift().catch(error=>console.warn('[POS shift live] background refresh unavailable:',error?.message||error));
        return res.json({success:true,...hub});
      }
      try{
        const data=await liveShift();
        return res.json({success:true,...data});
      }catch(error){
        const fallback=await hubFallback();
        if(fallback){
          console.warn('[POS shift live] MoySklad unavailable, serving HUB open shift fallback:',error?.message||error);
          return res.json({success:true,...fallback});
        }
        return next(error);
      }
    };
  }
  return originalGet.call(this,path,...handlers);
};
