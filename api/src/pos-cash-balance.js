import express from 'express';
import { createClient } from '@supabase/supabase-js';

const MS_BASE='https://api.moysklad.ru/api/remap/1.2';
const token=process.env.MOYSKLAD_TOKEN;
const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const installed=Symbol.for('a4print.pos.cash.balance.installed');

function clean(value,max=3000){return String(value||'').trim().slice(0,max)}
function idOf(entity){return entity?.id||entity?.meta?.href?.split('/').pop()||null}
function firstFinite(...values){
  for(const value of values){
    if(value===null||value===undefined||value==='')continue;
    const n=Number(value);
    if(Number.isFinite(n))return n;
  }
  return null;
}
async function ms(path){
  if(!token)throw new Error('MOYSKLAD_NOT_CONFIGURED');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(path.startsWith('http')?path:MS_BASE+path,{
      signal:controller.signal,
      headers:{Authorization:`Bearer ${token}`,Accept:'application/json;charset=utf-8','Accept-Encoding':'gzip'}
    });
    const text=await r.text();
    if(!r.ok)throw new Error(`MoySklad HTTP ${r.status}: ${text}`);
    return text?JSON.parse(text):null;
  }finally{clearTimeout(timer)}
}
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
  return{user:data.user,profile};
}
async function exactCashBalance(){
  const list=await ms('/entity/retailshift?limit=100&order=created,desc');
  const open=(list?.rows||[]).find(x=>!x.closeDate)||null;
  if(!open)return{shift:null,store:null,cash:0,available:true,source:'NO_OPEN_SHIFT'};
  const shiftId=idOf(open);
  const shift=shiftId?await ms(`/entity/retailshift/${encodeURIComponent(shiftId)}`):open;
  const storeHref=shift?.retailStore?.meta?.href||open?.retailStore?.meta?.href||null;
  if(!storeHref)return{shift:{id:shiftId,name:shift?.name||open?.name||null},store:null,cash:null,available:false,source:'RETAIL_STORE_NOT_FOUND'};
  const store=await ms(storeHref);
  const raw=firstFinite(store?.cash,store?.state?.cash,shift?.cash);
  if(raw===null){
    return{
      shift:{id:shiftId,name:shift?.name||open?.name||null},
      store:{id:idOf(store)||idOf(shift?.retailStore),name:store?.name||shift?.retailStore?.name||null},
      cash:null,available:false,source:'MOYSKLAD_CASH_UNAVAILABLE'
    };
  }
  return{
    shift:{id:shiftId,name:shift?.name||open?.name||null},
    store:{id:idOf(store)||idOf(shift?.retailStore),name:store?.name||shift?.retailStore?.name||null},
    cash:raw/100,available:true,source:'MOYSKLAD_RETAILSTORE_CASH'
  };
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
        const result=await exactCashBalance();
        return res.status(result.available?200:503).json({success:result.available,...result,updated_at:new Date().toISOString()});
      }catch(error){return next(error)}
    });
  }
  return originalListen.apply(this,args);
};
