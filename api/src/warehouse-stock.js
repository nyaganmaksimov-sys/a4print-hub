import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { fetchMoySkladStock } from './moysklad.js';

const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const token=process.env.MOYSKLAD_TOKEN;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const installed=Symbol.for('a4print.warehouse.stock.installed');
const CACHE_MS=15000;
const STALE_MS=5*60*1000;
let cache=null;
let inFlight=null;

async function auth(req){
  if(!service)return{error:'DATABASE_NOT_CONFIGURED'};
  const bearer=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!bearer)return{error:'AUTH_REQUIRED'};
  const {data,error}=await service.auth.getUser(bearer);
  if(error||!data?.user)return{error:'INVALID_SESSION'};
  const {data:profile,error:pErr}=await service.from('users').select('id,is_active').eq('auth_user_id',data.user.id).maybeSingle();
  if(pErr)throw pErr;
  if(!profile||profile.is_active===false)return{error:'WAREHOUSE_ACCESS_REQUIRED'};
  const {data:rows,error:rErr}=await service.from('user_roles').select('roles(name)').eq('user_id',profile.id);
  if(rErr)throw rErr;
  const roles=(rows||[]).map(x=>x.roles?.name).filter(Boolean);
  const allowed=['ADMIN','MANAGER','WAREHOUSE','PRODUCTION','POS_OPERATOR'].some(role=>roles.includes(role));
  if(!allowed)return{error:'WAREHOUSE_ACCESS_REQUIRED'};
  return{user:data.user,profile,roles};
}

async function liveStock(){
  const now=Date.now();
  if(cache&&now-cache.at<CACHE_MS)return{...cache.payload,cached:true,calculated_at:new Date(cache.at).toISOString()};
  if(inFlight)return inFlight;
  inFlight=(async()=>{
    const stock=await fetchMoySkladStock(token);
    const payload={success:true,source:'MOYSKLAD_LIVE',stock,count:Object.keys(stock||{}).length};
    cache={at:Date.now(),payload};
    return{...payload,cached:false,calculated_at:new Date(cache.at).toISOString()};
  })();
  try{return await inFlight}finally{inFlight=null}
}

const originalListen=express.application.listen;
express.application.listen=function patchedWarehouseStockListen(...args){
  if(!this[installed]){
    this[installed]=true;
    this.get('/api/v1/warehouse/stock',async(req,res,next)=>{
      try{
        const ctx=await auth(req);
        if(ctx.error){
          const status=/AUTH|INVALID_SESSION/.test(ctx.error)?401:ctx.error==='DATABASE_NOT_CONFIGURED'?503:403;
          return res.status(status).json({success:false,error:ctx.error});
        }
        if(!token)return res.status(503).json({success:false,error:'MOYSKLAD_NOT_CONFIGURED'});
        try{
          return res.json(await liveStock());
        }catch(error){
          if(cache&&Date.now()-cache.at<STALE_MS){
            return res.json({...cache.payload,cached:true,stale:true,warning:String(error?.message||error),calculated_at:new Date(cache.at).toISOString()});
          }
          throw error;
        }
      }catch(error){next(error)}
    });
  }
  return originalListen.apply(this,args);
};
