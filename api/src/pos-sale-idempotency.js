import express from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=supabaseUrl&&serviceKey
  ? createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}})
  : null;
const token=process.env.MOYSKLAD_TOKEN;
const als=new AsyncLocalStorage();
const marker=id=>`A4OP:${id}`;
let orgPromise=null;

async function organizationId(){
  if(!service)return null;
  if(!orgPromise)orgPromise=service.from('organizations').select('id').eq('code','A4PRINT').single().then(({data,error})=>{if(error)throw error;return data?.id||null});
  return orgPromise;
}

function isRetailDemandPost(input,init={}){
  try{
    const raw=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
    const u=new URL(raw);
    const method=String(init?.method||input?.method||'GET').toUpperCase();
    return u.hostname==='api.moysklad.ru'&&u.pathname.endsWith('/entity/retaildemand')&&method==='POST';
  }catch{return false}
}

// Add a recoverable operation marker to the MoySklad document. This lets us
// find a sale if the document was created but the HTTP response was lost.
const previousFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=function a4IdempotentMoySkladFetch(input,init={}){
  const ctx=als.getStore();
  if(ctx?.clientOperationId&&isRetailDemandPost(input,init)&&typeof init?.body==='string'){
    try{
      const body=JSON.parse(init.body);
      const tag=marker(ctx.clientOperationId);
      const description=String(body.description||'');
      if(!description.includes(tag))body.description=`${description}${description?' · ':''}${tag}`;
      return previousFetch(input,{...init,body:JSON.stringify(body)});
    }catch{}
  }
  return previousFetch(input,init);
};

async function findMoySkladSale(clientOperationId){
  if(!token||!clientOperationId)return null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const r=await previousFetch('https://api.moysklad.ru/api/remap/1.2/entity/retaildemand?limit=1000&order=created,desc',{
      signal:controller.signal,
      headers:{Authorization:`Bearer ${token}`,Accept:'application/json;charset=utf-8','Accept-Encoding':'gzip'}
    });
    if(!r.ok)return null;
    const data=await r.json();
    const tag=marker(clientOperationId);
    return (data?.rows||[]).find(row=>String(row?.description||'').includes(tag))||null;
  }catch{return null}finally{clearTimeout(timer)}
}

function recoveredResponse(sale){
  return {
    success:true,
    idempotent:true,
    recovered:true,
    moysklad:{id:sale.id,name:sale.name,href:sale.meta?.href},
    sum:Number(sale.sum||0)/100
  };
}

async function saveSynced(orgId,clientOperationId,body){
  if(!service||!orgId)return;
  await service.from('pos_sale_operations').update({
    status:'SYNCED',
    moysklad_sale_id:body?.moysklad?.id||null,
    moysklad_sale_name:body?.moysklad?.name||null,
    moysklad_sale_href:body?.moysklad?.href||null,
    response_json:body,
    last_error:null,
    updated_at:new Date().toISOString()
  }).eq('organization_id',orgId).eq('client_operation_id',clientOperationId);
}

async function reconcile(orgId,clientOperationId){
  const sale=await findMoySkladSale(clientOperationId);
  if(!sale)return null;
  const body=recoveredResponse(sale);
  await saveSynced(orgId,clientOperationId,body);
  return body;
}

async function reserve(req,clientOperationId){
  if(!service||!clientOperationId)return{proceed:true,orgId:null};
  const orgId=await organizationId();
  if(!orgId)return{proceed:true,orgId:null};

  const {data:existing,error:readError}=await service.from('pos_sale_operations').select('*').eq('organization_id',orgId).eq('client_operation_id',clientOperationId).maybeSingle();
  if(readError)throw readError;
  if(existing){
    if(existing.status==='SYNCED'&&existing.response_json)return{proceed:false,orgId,cached:existing.response_json};
    const recovered=await reconcile(orgId,clientOperationId);
    if(recovered)return{proceed:false,orgId,cached:recovered};
    const age=Date.now()-new Date(existing.updated_at||existing.created_at||0).getTime();
    if((existing.status==='PROCESSING'||existing.status==='UNKNOWN')&&age<45000)return{proceed:false,orgId,busy:true};
    const {error}=await service.from('pos_sale_operations').update({status:'PROCESSING',last_error:null,updated_at:new Date().toISOString()}).eq('organization_id',orgId).eq('client_operation_id',clientOperationId);
    if(error)throw error;
    return{proceed:true,orgId};
  }

  const {error}=await service.from('pos_sale_operations').insert({
    organization_id:orgId,
    client_operation_id:clientOperationId,
    status:'PROCESSING',
    requested_by_auth_user_id:req.authUser?.id||null
  });
  if(error?.code==='23505')return reserve(req,clientOperationId);
  if(error)throw error;
  return{proceed:true,orgId};
}

async function saveUnknown(orgId,clientOperationId,error){
  if(!service||!orgId)return;
  await service.from('pos_sale_operations').update({
    status:'UNKNOWN',last_error:String(error?.message||error||'UNKNOWN').slice(0,1500),updated_at:new Date().toISOString()
  }).eq('organization_id',orgId).eq('client_operation_id',clientOperationId);
}

const originalPost=express.application.post;
express.application.post=function patchedSalePost(path,...handlers){
  if(path==='/api/v1/pos/sale'&&handlers.length){
    const index=handlers.length-1;
    const originalHandler=handlers[index];
    handlers[index]=async function idempotentSaleHandler(req,res,next){
      const clientOperationId=String(req.body?.client_operation_id||'').trim().slice(0,180);
      if(!clientOperationId||!service)return originalHandler(req,res,next);
      let orgId=null;
      try{
        const reservation=await reserve(req,clientOperationId);
        orgId=reservation.orgId;
        if(reservation.cached)return res.json({...reservation.cached,idempotent:true});
        if(reservation.busy)return res.status(409).json({success:false,error:'SALE_SYNC_IN_PROGRESS',message:'Чек уже синхронизируется. Повтор будет выполнен автоматически.'});

        const originalJson=res.json.bind(res);
        let sent=false;
        res.json=function captureSaleResponse(body){
          if(sent)return res;
          sent=true;
          if(body?.success&&body?.moysklad?.id){
            saveSynced(orgId,clientOperationId,body)
              .then(()=>originalJson(body))
              .catch(()=>originalJson(body));
            return res;
          }
          return originalJson(body);
        };

        const wrappedNext=async error=>{
          if(!error)return next();
          try{
            const recovered=await reconcile(orgId,clientOperationId);
            if(recovered&&!sent){sent=true;return originalJson(recovered)}
            await saveUnknown(orgId,clientOperationId,error);
          }catch{}
          return next(error);
        };

        return als.run({clientOperationId},()=>originalHandler(req,res,wrappedNext));
      }catch(error){
        try{await saveUnknown(orgId,clientOperationId,error)}catch{}
        return next(error);
      }
    };
  }
  return originalPost.call(this,path,...handlers);
};
