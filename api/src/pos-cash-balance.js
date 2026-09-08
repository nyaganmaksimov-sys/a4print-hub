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
let balanceCache=null;
let balanceInFlight=null;

function clean(value,max=3000){return String(value||'').trim().slice(0,max)}
function isRateLimit(error){return /MoySklad HTTP 429|"code"\s*:\s*(1049|1073)|code\D+(1049|1073)/i.test(String(error?.message||error||''))}

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
          result=await getCashBalance();
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
