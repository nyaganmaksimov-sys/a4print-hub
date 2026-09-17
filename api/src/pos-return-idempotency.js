import express from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@supabase/supabase-js';

const token=process.env.MOYSKLAD_TOKEN;
const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const MS_BASE='https://api.moysklad.ru/api/remap/1.2';
const installed=Symbol.for('a4print.pos.return.idempotency.installed');
const context=new AsyncLocalStorage();
const inflight=new Map();

function clean(value,max=500){return String(value||'').trim().slice(0,max)}
function entityId(entity){return entity?.id||entity?.meta?.href?.split('/').pop()||null}
function markerFor(key){return `A4RET:${key}`}
function validKey(value){
  const key=clean(value,120);
  return /^[A-Za-z0-9._:-]{8,120}$/.test(key)?key:'';
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

async function saleRow(saleId){
  if(!service||!saleId)return null;
  const {data,error}=await service.from('pos_sales')
    .select('id,organization_id,moysklad_sale_id,moysklad_sale_name,items')
    .eq('id',saleId).maybeSingle();
  if(error)throw error;
  return data||null;
}

async function findMoySkladReturn(sale,key){
  if(!sale?.moysklad_sale_id||!key)return null;
  const marker=markerFor(key);
  const demandHref=`${MS_BASE}/entity/retaildemand/${sale.moysklad_sale_id}`;
  try{
    const filter=encodeURIComponent(`demand=${demandHref}`);
    const data=await msGet(`/entity/retailsalesreturn?limit=100&order=created,desc&filter=${filter}`);
    const found=(data?.rows||[]).find(row=>String(row?.description||'').includes(marker));
    if(found)return found;
  }catch(error){
    console.warn('A4PRINT return idempotency filtered lookup:',String(error?.message||error));
  }
  const data=await msGet('/entity/retailsalesreturn?limit=200&order=created,desc');
  return (data?.rows||[]).find(row=>
    String(row?.description||'').includes(marker)&&
    entityId(row?.demand)===sale.moysklad_sale_id
  )||null;
}

function normalizeItems(items){
  return (Array.isArray(items)?items:[]).map((x,index)=>({
    id:clean(x?.key,160)||`${x?.id||'item'}:${index}`,
    catalog_id:x?.id||null,
    name:clean(x?.name,300)||'Позиция',
    quantity:Math.max(0,Number(x?.qty||0)),
    price:Math.max(0,Number(x?.price||0)),
    discount:Math.max(0,Number(x?.discount||0))
  }));
}

async function ensureHubReturn({req,sale,msReturn}){
  if(!service)throw new Error('DATABASE_NOT_CONFIGURED');
  const returnId=entityId(msReturn);
  if(!returnId)throw new Error('MOYSKLAD_RETURN_ID_MISSING');

  const existing=await service.from('pos_returns')
    .select('id,amount,moysklad_return_name')
    .eq('organization_id',sale.organization_id)
    .eq('moysklad_return_id',returnId).maybeSingle();
  if(existing.error)throw existing.error;
  if(existing.data)return existing.data;

  const requested=new Map((Array.isArray(req.body?.positions)?req.body.positions:[])
    .map(x=>[clean(x?.id,160),Number(x?.quantity||0)]));
  const selected=normalizeItems(sale.items).filter(item=>(requested.get(item.id)||0)>0).map(item=>({
    ...item,qty:Math.min(item.quantity,Math.max(0,requested.get(item.id)||0))
  }));
  if(!selected.length)throw new Error('RETURN_RECOVERY_ITEMS_NOT_FOUND');

  const authId=req.authUser?.id||null;
  let operatorId=null;
  if(authId){
    const profile=await service.from('users').select('id').eq('auth_user_id',authId).maybeSingle();
    if(profile.error)throw profile.error;
    operatorId=profile.data?.id||null;
  }

  const shiftId=entityId(msReturn?.retailShift);
  let shiftSessionId=null;
  if(shiftId){
    const shift=await service.from('pos_shift_sessions').select('id')
      .eq('organization_id',sale.organization_id).eq('moysklad_shift_id',shiftId)
      .order('opened_at',{ascending:false}).limit(1).maybeSingle();
    if(shift.error)throw shift.error;
    shiftSessionId=shift.data?.id||null;
  }

  const fallbackAmount=selected.reduce((sum,x)=>sum+Number(x.price||0)*Number(x.qty||0)*(1-Number(x.discount||0)/100),0);
  const msAmount=Number(msReturn?.sum);
  const amount=Number.isFinite(msAmount)?msAmount/100:fallbackAmount;
  const payload={
    organization_id:sale.organization_id,
    shift_session_id:shiftSessionId,
    pos_sale_id:sale.id,
    moysklad_return_id:returnId,
    moysklad_return_name:msReturn?.name||null,
    operator_id:operatorId,
    cash_account_id:clean(req.body?.account_id,80)||null,
    payment_method:clean(req.body?.payment_method,80)||'Наличные',
    amount,
    items:selected.map(x=>({position_id:x.id,catalog_id:x.catalog_id,name:x.name,qty:x.qty,price:x.price})),
    reason:clean(req.body?.reason,1200)||null,
    sync_status:'SYNCED',
    sync_error:null
  };
  const created=await service.from('pos_returns').insert(payload).select('id,amount,moysklad_return_name').single();
  if(!created.error)return created.data;
  if(String(created.error.code||'')!=='23505'&&!/duplicate|unique/i.test(String(created.error.message||'')))throw created.error;
  const raced=await service.from('pos_returns').select('id,amount,moysklad_return_name')
    .eq('organization_id',sale.organization_id).eq('moysklad_return_id',returnId).maybeSingle();
  if(raced.error)throw raced.error;
  if(!raced.data)throw created.error;
  return raced.data;
}

// Attach the idempotency marker only to the outbound MoySklad return document.
// The operator-facing reason stored in HUB remains clean.
if(!globalThis.fetch.__a4ReturnIdempotencyFetch){
  const previousFetch=globalThis.fetch.bind(globalThis);
  const wrapped=async function(input,init={}){
    const store=context.getStore();
    const url=String(typeof input==='string'?input:input?.url||'');
    const method=String(init?.method||'GET').toUpperCase();
    if(store?.key&&method==='POST'&&/\/entity\/retailsalesreturn(?:\?|$)/.test(url)){
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
  wrapped.__a4ReturnIdempotencyFetch=true;
  globalThis.fetch=wrapped;
}

const originalPost=express.application.post;
express.application.post=function patchedReturnPost(path,...handlers){
  if(path==='/api/v1/pos/returns'&&handlers.length&&!this[installed]){
    this[installed]=true;
    const index=handlers.length-1;
    const originalHandler=handlers[index];
    handlers[index]=async function idempotentReturnHandler(req,res,next){
      const key=validKey(req.body?.client_operation_id);
      if(!key)return originalHandler(req,res,next);

      const wait=inflight.get(key);
      if(wait){
        try{await wait}catch{}
      }

      try{
        const sale=await saleRow(clean(req.body?.sale_id,80));
        if(sale){
          const existing=await findMoySkladReturn(sale,key);
          if(existing){
            const hub=await ensureHubReturn({req,sale,msReturn:existing});
            return res.status(200).json({
              success:true,
              idempotent_replay:true,
              return:{id:entityId(existing),name:existing.name||hub?.moysklad_return_name||null},
              amount:Number(hub?.amount??Number(existing.sum||0)/100),
              hub_return_id:hub?.id||null
            });
          }
        }
      }catch(error){
        // Fail closed when the dedupe lookup itself is unavailable. Creating a
        // second financial document is worse than asking the cashier to retry.
        console.warn('A4PRINT return idempotency lookup:',String(error?.message||error));
        return res.status(503).json({success:false,error:'RETURN_IDEMPOTENCY_CHECK_FAILED',message:'Не удалось безопасно проверить повтор возврата. Повторите операцию через несколько секунд.'});
      }

      let release;
      const gate=new Promise(resolve=>{release=resolve});
      inflight.set(key,gate);
      try{
        return await context.run({key},()=>originalHandler(req,res,next));
      }finally{
        inflight.delete(key);
        release?.();
      }
    };
  }
  return originalPost.call(this,path,...handlers);
};
