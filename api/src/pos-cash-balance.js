import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { calculateCashBalance, setCashBaseline } from './pos-cash-ledger.js';

const token=process.env.MOYSKLAD_TOKEN;
const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const installed=Symbol.for('a4print.pos.cash.balance.installed');
const CACHE_TTL_MS=15000;
const STALE_TTL_MS=5*60*1000;
const LIVE_BUDGET_MS=3500;
let balanceCache=null;
let balanceInFlight=null;

function clean(value,max=3000){return String(value||'').trim().slice(0,max)}
function isRateLimit(error){return /MoySklad HTTP 429|"code"\s*:\s*(1049|1073)|code\D+(1049|1073)/i.test(String(error?.message||error||''))}
function isCash(method){return /налич|cash/i.test(String(method||''))}

async function auth(req){
  if(!service)return{error:'DATABASE_NOT_CONFIGURED'};
  const bearer=clean(req.headers.authorization).replace(/^Bearer\s+/i,'');
  if(!bearer)return{error:'AUTH_REQUIRED'};
  const {data,error}=await service.auth.getUser(bearer);
  if(error||!data?.user)return{error:'INVALID_SESSION'};
  const {data:profile,error:pErr}=await service.from('users').select('id,is_active').eq('auth_user_id',data.user.id).maybeSingle();
  if(pErr)throw pErr;
  if(!profile||profile.is_active===false)return{error:'POS_ACCESS_REQUIRED'};
  const {data:roles,error:rErr}=await service.from('user_roles').select('roles(name)').eq('user_id',profile.id);
  if(rErr)throw rErr;
  const names=(roles||[]).map(x=>x.roles?.name).filter(Boolean);
  if(!names.some(x=>x==='ADMIN'||x==='POS_OPERATOR'))return{error:'POS_ACCESS_REQUIRED'};
  return{user:data.user,profile,isAdmin:names.includes('ADMIN')};
}

async function getCashBalance(){
  const now=Date.now();
  if(balanceCache&&now-balanceCache.at<CACHE_TTL_MS){
    return{...balanceCache.result,cached:true,calculated_at:new Date(balanceCache.at).toISOString()};
  }
  if(balanceInFlight)return balanceInFlight;

  balanceInFlight=(async()=>{
    const result=await calculateCashBalance({token,service});
    const at=Date.now();
    balanceCache={at,result};
    return{...result,cached:false,calculated_at:new Date(at).toISOString()};
  })();

  try{return await balanceInFlight}
  finally{balanceInFlight=null}
}

function sum(rows,field){return (rows||[]).reduce((total,row)=>total+Number(row?.[field]||0),0)}

async function databaseCashBalance(){
  if(!service)throw new Error('DATABASE_NOT_CONFIGURED');
  const {data:baseline,error:bErr}=await service
    .from('pos_cash_balance_state')
    .select('store_id,store_name,baseline_amount,baseline_at,updated_at')
    .order('updated_at',{ascending:false})
    .limit(1)
    .maybeSingle();
  if(bErr)throw bErr;
  if(!baseline){
    return{available:false,requires_baseline:true,source:'BASELINE_REQUIRED',store:null,shift:null,cash:null,cached:false,provisional:true};
  }

  const after=baseline.baseline_at;
  const fields='total,payment_method,sold_at,created_at';
  const returnFields='amount,payment_method,returned_at,created_at';
  const [salesTimed,salesUntimed,returnsTimed,returnsUntimed,ops,shiftResult]=await Promise.all([
    service.from('pos_sales').select(fields).gte('sold_at',after),
    service.from('pos_sales').select(fields).is('sold_at',null).gte('created_at',after),
    service.from('pos_returns').select(returnFields).gte('returned_at',after),
    service.from('pos_returns').select(returnFields).is('returned_at',null).gte('created_at',after),
    service.from('pos_cash_operations').select('operation_type,amount,created_at').gte('created_at',after),
    service.from('pos_shift_sessions').select('moysklad_shift_id,moysklad_shift_name,store_id,store_name,opened_at').eq('status','OPEN').order('opened_at',{ascending:false}).limit(1).maybeSingle()
  ]);

  for(const result of [salesTimed,salesUntimed,returnsTimed,returnsUntimed,ops,shiftResult]){
    if(result.error)throw result.error;
  }

  const sales=[...(salesTimed.data||[]),...(salesUntimed.data||[])].filter(x=>isCash(x.payment_method));
  const returns=[...(returnsTimed.data||[]),...(returnsUntimed.data||[])].filter(x=>isCash(x.payment_method));
  const operations=ops.data||[];
  const cashIn=sum(operations.filter(x=>x.operation_type==='CASH_IN'),'amount');
  const cashOut=sum(operations.filter(x=>x.operation_type==='CASH_OUT'),'amount');
  const cashSales=sum(sales,'total');
  const cashReturns=sum(returns,'amount');
  const delta=cashSales+cashIn-cashReturns-cashOut;
  const cash=Number(baseline.baseline_amount)+delta;
  const shift=shiftResult.data||null;

  return{
    available:true,
    requires_baseline:false,
    source:'HUB_LEDGER_FALLBACK',
    provisional:true,
    warning:'MOYSKLAD_LIVE_CALCULATION_CONTINUES',
    store:{id:shift?.store_id||baseline.store_id,name:shift?.store_name||baseline.store_name||null},
    shift:shift?.moysklad_shift_id?{id:shift.moysklad_shift_id,name:shift.moysklad_shift_name||null}:null,
    cash:Math.round((cash+Number.EPSILON)*100)/100,
    baseline:{amount:Number(baseline.baseline_amount),at:baseline.baseline_at},
    delta:Math.round((delta+Number.EPSILON)*100)/100,
    totals:{cash_sales:cashSales,cash_returns:cashReturns,cash_in:cashIn,cash_out:cashOut,sales_count:sales.length,returns_count:returns.length,cashin_count:operations.filter(x=>x.operation_type==='CASH_IN').length,cashout_count:operations.filter(x=>x.operation_type==='CASH_OUT').length},
    cached:false,
    calculated_at:new Date().toISOString()
  };
}

async function responsiveCashBalance(){
  const live=getCashBalance();
  const fallback=new Promise((resolve,reject)=>{
    setTimeout(()=>databaseCashBalance().then(resolve,reject),LIVE_BUDGET_MS);
  });
  try{return await Promise.race([live,fallback])}
  catch(error){
    if(balanceCache&&Date.now()-balanceCache.at<STALE_TTL_MS){
      return{...balanceCache.result,cached:true,stale:true,warning:'MOYSKLAD_LIVE_UNAVAILABLE',calculated_at:new Date(balanceCache.at).toISOString()};
    }
    try{return await databaseCashBalance()}catch{throw error}
  }
}

const originalListen=express.application.listen;
express.application.listen=function patchedCashBalanceListen(...args){
  if(!this[installed]){
    this[installed]=true;

    this.get('/api/v1/pos/cash-balance',async(req,res,next)=>{
      try{
        const ctx=await auth(req);
        if(ctx.error)return res.status(ctx.error.includes('AUTH')||ctx.error==='INVALID_SESSION'?401:403).json({success:false,error:ctx.error});
        if(!token)return res.status(503).json({success:false,error:'MOYSKLAD_NOT_CONFIGURED'});

        let result;
        try{
          result=await responsiveCashBalance();
        }catch(error){
          if(isRateLimit(error)&&balanceCache&&Date.now()-balanceCache.at<STALE_TTL_MS){
            return res.json({
              success:true,
              ...balanceCache.result,
              cached:true,
              stale:true,
              warning:'MOYSKLAD_RATE_LIMIT',
              calculated_at:new Date(balanceCache.at).toISOString(),
              updated_at:new Date().toISOString()
            });
          }
          throw error;
        }

        if(result.requires_baseline){
          return res.status(409).json({success:false,...result,message:'Укажите текущий фактический остаток наличных один раз в Настройках кассы.'});
        }
        return res.json({success:true,...result,updated_at:new Date().toISOString()});
      }catch(error){return next(error)}
    });

    this.post('/api/v1/pos/cash-balance/baseline',express.json(),async(req,res,next)=>{
      try{
        const ctx=await auth(req);
        if(ctx.error)return res.status(ctx.error.includes('AUTH')||ctx.error==='INVALID_SESSION'?401:403).json({success:false,error:ctx.error});
        if(!ctx.isAdmin)return res.status(403).json({success:false,error:'ADMIN_REQUIRED',message:'Контрольный остаток может задавать только администратор.'});
        if(!token)return res.status(503).json({success:false,error:'MOYSKLAD_NOT_CONFIGURED'});
        const amount=Number(req.body?.amount);
        if(!Number.isFinite(amount)||amount<0)return res.status(400).json({success:false,error:'INVALID_AMOUNT',message:'Укажите фактическую сумму наличных в кассе.'});
        if(amount>10000000)return res.status(400).json({success:false,error:'AMOUNT_TOO_LARGE',message:'Слишком большая сумма.'});
        const result=await setCashBaseline({token,service,amount,userId:ctx.profile.id});
        const at=Date.now();
        balanceCache={at,result};
        return res.json({success:true,...result,cached:false,calculated_at:new Date(at).toISOString(),updated_at:new Date().toISOString()});
      }catch(error){return next(error)}
    });
  }
  return originalListen.apply(this,args);
};
