import express from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@supabase/supabase-js';
import { calculateCashBalance } from './pos-cash-ledger.js';

const token=process.env.MOYSKLAD_TOKEN;
const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const MS_BASE='https://api.moysklad.ru/api/remap/1.2';
const installed=Symbol.for('a4print.pos.cash.operation.idempotency.installed');
const context=new AsyncLocalStorage();
let orgPromise=null;

function clean(value,max=500){return String(value||'').trim().slice(0,max)}
function validKey(value){const key=clean(value,120);return /^[A-Za-z0-9._:-]{8,120}$/.test(key)?key:''}
function entityId(entity){return entity?.id||entity?.meta?.href?.split('/').pop()||null}
function markerFor(key){return `A4CASH:${key}`}
function operationEntity(type){return type==='CASH_IN'?'retaildrawercashin':'retaildrawercashout'}

async function organizationId(){
  if(!service)return null;
  if(!orgPromise)orgPromise=service.from('organizations').select('id').eq('code','A4PRINT').single()
    .then(({data,error})=>{if(error)throw error;return data?.id||null});
  return orgPromise;
}

async function msGet(path){
  if(!token)throw new Error('MOYSKLAD_NOT_CONFIGURED');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const r=await fetch(path.startsWith('http')?path:MS_BASE+path,{
      signal:controller.signal,
      headers:{Authorization:`Bearer ${token}`,Accept:'application/json;charset=utf-8'}
    });
    const text=await r.text();
    if(!r.ok)throw new Error(`MoySklad HTTP ${r.status}: ${text}`);
    return text?JSON.parse(text):null;
  }finally{clearTimeout(timer)}
}

async function findMoySkladOperation(type,key){
  const entity=operationEntity(type);
  const marker=markerFor(key);
  const data=await msGet(`/entity/${entity}?limit=200&order=created,desc`);
  return (data?.rows||[]).find(row=>String(row?.description||'').includes(marker))||null;
}

async function authProfile(req){
  if(!service)return null;
  const bearer=clean(req.headers.authorization,3000).replace(/^Bearer\s+/i,'');
  if(!bearer)return null;
  const {data,error}=await service.auth.getUser(bearer);
  if(error||!data?.user)return null;
  const profile=await service.from('users').select('id,is_active').eq('auth_user_id',data.user.id).maybeSingle();
  if(profile.error)throw profile.error;
  return profile.data?.is_active===false?null:profile.data||null;
}

async function ensureHubOperation({req,type,operation}){
  if(!service)throw new Error('DATABASE_NOT_CONFIGURED');
  const opId=entityId(operation);
  const shiftId=entityId(operation?.retailShift);
  if(!opId||!shiftId)throw new Error('MOYSKLAD_CASH_OPERATION_ID_MISSING');

  const existing=await service.from('pos_cash_operations')
    .select('id,moysklad_operation_id,amount')
    .eq('moysklad_operation_id',opId).maybeSingle();
  if(existing.error)throw existing.error;
  if(existing.data)return existing.data;

  const profile=await authProfile(req);
  const amount=Number(operation?.sum||0)/100;
  const typeName=type==='CASH_IN'?'CASH_IN':'CASH_OUT';
  const created=await service.from('pos_cash_operations').insert({
    operator_id:profile?.id||null,
    moysklad_shift_id:String(shiftId),
    moysklad_operation_id:String(opId),
    moysklad_operation_name:operation?.name||null,
    operation_type:typeName,
    amount,
    reason:clean(req.body?.reason,500)||null
  }).select('id,moysklad_operation_id,amount').single();

  if(!created.error)return created.data;
  if(String(created.error.code||'')!=='23505'&&!/duplicate|unique/i.test(String(created.error.message||'')))throw created.error;
  const raced=await service.from('pos_cash_operations').select('id,moysklad_operation_id,amount')
    .eq('moysklad_operation_id',opId).maybeSingle();
  if(raced.error)throw raced.error;
  if(!raced.data)throw created.error;
  return raced.data;
}

async function replayBody({req,type,operation}){
  await ensureHubOperation({req,type,operation});
  let cashAfter=null;
  try{
    const balance=await calculateCashBalance({token,service});
    if(balance?.available&&Number.isFinite(Number(balance.cash)))cashAfter=Number(balance.cash);
  }catch{}
  const amount=Number(operation?.sum||0)/100;
  return{
    success:true,
    idempotent_replay:true,
    operation:{
      id:entityId(operation),
      name:operation?.name||null,
      type,
      amount,
      reason:clean(req.body?.reason,500)||null
    },
    shift:{id:entityId(operation?.retailShift),name:operation?.retailShift?.name||null},
    cash_before:null,
    cash_after:cashAfter
  };
}

async function saveSynced(orgId,key,body){
  if(!service||!orgId||!key)return;
  await service.from('pos_cash_operation_requests').update({
    status:'SYNCED',
    moysklad_operation_id:body?.operation?.id||null,
    moysklad_operation_name:body?.operation?.name||null,
    response_json:body,
    last_error:null,
    updated_at:new Date().toISOString()
  }).eq('organization_id',orgId).eq('client_operation_id',key);
}

async function saveUnknown(orgId,key,error){
  if(!service||!orgId||!key)return;
  await service.from('pos_cash_operation_requests').update({
    status:'UNKNOWN',
    last_error:String(error?.message||error||'UNKNOWN').slice(0,1500),
    updated_at:new Date().toISOString()
  }).eq('organization_id',orgId).eq('client_operation_id',key);
}

async function reserve(req,key,type){
  const orgId=await organizationId();
  if(!orgId)return{orgId:null,proceed:true};
  const read=await service.from('pos_cash_operation_requests').select('*')
    .eq('organization_id',orgId).eq('client_operation_id',key).maybeSingle();
  if(read.error)throw read.error;
  const existing=read.data;

  if(existing){
    if(existing.operation_type!==type)throw new Error('CASH_OPERATION_ID_CONFLICT');
    if(existing.status==='SYNCED'&&existing.response_json)return{orgId,proceed:false,cached:existing.response_json};

    const found=await findMoySkladOperation(type,key).catch(()=>null);
    if(found){
      const body=await replayBody({req,type,operation:found});
      await saveSynced(orgId,key,body);
      return{orgId,proceed:false,cached:body};
    }

    const age=Date.now()-new Date(existing.updated_at||existing.created_at||0).getTime();
    if((existing.status==='PROCESSING'||existing.status==='UNKNOWN')&&age<45000)return{orgId,proceed:false,busy:true};

    const update=await service.from('pos_cash_operation_requests').update({
      status:'PROCESSING',last_error:null,updated_at:new Date().toISOString()
    }).eq('organization_id',orgId).eq('client_operation_id',key);
    if(update.error)throw update.error;
    return{orgId,proceed:true};
  }

  const inserted=await service.from('pos_cash_operation_requests').insert({
    organization_id:orgId,
    client_operation_id:key,
    operation_type:type,
    status:'PROCESSING'
  });
  if(inserted.error?.code==='23505')return reserve(req,key,type);
  if(inserted.error)throw inserted.error;
  return{orgId,proceed:true};
}

if(!globalThis.fetch.__a4CashOperationIdempotencyFetch){
  const previousFetch=globalThis.fetch.bind(globalThis);
  const wrapped=async function(input,init={}){
    const store=context.getStore();
    const url=String(typeof input==='string'?input:input?.url||'');
    const method=String(init?.method||'GET').toUpperCase();
    if(store?.key&&method==='POST'&&/\/entity\/(retaildrawercashin|retaildrawercashout)(?:\?|$)/.test(url)){
      try{
        const body=JSON.parse(String(init.body||'{}'));
        const marker=markerFor(store.key);
        if(!String(body.description||'').includes(marker)){
          body.description=`${String(body.description||'').trim()} · ${marker}`.trim();
          init={...init,body:JSON.stringify(body)};
        }
      }catch{}
    }
    return previousFetch(input,init);
  };
  wrapped.__a4CashOperationIdempotencyFetch=true;
  globalThis.fetch=wrapped;
}

const originalPost=express.application.post;
express.application.post=function patchedCashOperationPost(path,...handlers){
  const type=path==='/api/v1/pos/cashin'?'CASH_IN':path==='/api/v1/pos/cashout'?'CASH_OUT':null;
  if(type&&handlers.length){
    const index=handlers.length-1;
    const originalHandler=handlers[index];
    handlers[index]=async function idempotentCashOperationHandler(req,res,next){
      const key=validKey(req.body?.client_operation_id);
      if(!key||!service)return originalHandler(req,res,next);

      let orgId=null;
      try{
        const reservation=await reserve(req,key,type);
        orgId=reservation.orgId;
        if(reservation.cached)return res.status(200).json({...reservation.cached,idempotent_replay:true});
        if(reservation.busy)return res.status(409).json({
          success:false,error:'CASH_OPERATION_IN_PROGRESS',
          message:'Денежная операция уже синхронизируется. Повторите через несколько секунд.'
        });

        const originalJson=res.json.bind(res);
        let sent=false;
        res.json=function captureCashOperationResponse(body){
          if(sent)return res;
          sent=true;
          if(body?.success&&body?.operation?.id){
            saveSynced(orgId,key,body).then(()=>originalJson(body)).catch(()=>originalJson(body));
            return res;
          }
          return originalJson(body);
        };

        const wrappedNext=async error=>{
          if(!error)return next();
          try{
            const found=await findMoySkladOperation(type,key);
            if(found){
              const body=await replayBody({req,type,operation:found});
              await saveSynced(orgId,key,body);
              if(!sent){sent=true;return originalJson(body)}
            }
            await saveUnknown(orgId,key,error);
          }catch(recoveryError){
            await saveUnknown(orgId,key,recoveryError).catch(()=>{});
          }
          return next(error);
        };

        return context.run({key,type},()=>originalHandler(req,res,wrappedNext));
      }catch(error){
        await saveUnknown(orgId,key,error).catch(()=>{});
        return next(error);
      }
    };
  }
  if(!this[installed]&&type)this[installed]=true;
  return originalPost.call(this,path,...handlers);
};
