import express from 'express';
import { createClient } from '@supabase/supabase-js';

const BASE='https://api.moysklad.ru/api/remap/1.2';
const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const msToken=process.env.MOYSKLAD_TOKEN;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const installed=Symbol.for('a4print.pos.catalog.create.installed');

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const rubles=value=>Math.max(0,Number(value||0));
const msHeaders=()=>({Authorization:`Bearer ${msToken}`,Accept:'application/json;charset=utf-8','Content-Type':'application/json'});

async function ms(path,options={}){
  if(!msToken)throw new Error('MOYSKLAD_NOT_CONFIGURED');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(path.startsWith('http')?path:BASE+path,{...options,signal:controller.signal,headers:{...msHeaders(),...(options.headers||{})}});
    const text=await response.text();
    let body={};
    try{body=text?JSON.parse(text):{}}catch{body={raw:text}}
    if(!response.ok){
      const detail=body?.errors?.[0]?.error||body?.errors?.[0]?.parameter||body?.message||body?.error||text||`HTTP ${response.status}`;
      throw new Error(`MoySklad HTTP ${response.status}: ${detail}`);
    }
    return body;
  }finally{clearTimeout(timer)}
}

async function auth(req){
  if(!service)return{error:'DATABASE_NOT_CONFIGURED'};
  const bearer=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!bearer)return{error:'AUTH_REQUIRED'};
  const {data,error}=await service.auth.getUser(bearer);
  if(error||!data?.user)return{error:'INVALID_SESSION'};
  const {data:profile,error:pErr}=await service.from('users').select('id,is_active').eq('auth_user_id',data.user.id).maybeSingle();
  if(pErr)throw pErr;
  if(!profile||profile.is_active===false)return{error:'CATALOG_WRITE_REQUIRED'};
  const {data:rows,error:rErr}=await service.from('user_roles').select('roles(name)').eq('user_id',profile.id);
  if(rErr)throw rErr;
  const roles=(rows||[]).map(row=>row.roles?.name).filter(Boolean);
  const allowed=['ADMIN','MANAGER','POS_OPERATOR'].some(role=>roles.includes(role));
  if(!allowed)return{error:'CATALOG_WRITE_REQUIRED'};
  return{user:data.user,profile,roles};
}

async function organizationId(){
  const {data,error}=await service.from('organizations').select('id').eq('code','A4PRINT').single();
  if(error)throw error;
  return data.id;
}

function msType(type){return type==='SERVICE'?'service':'product'}
function localType(type){return String(type||'').toUpperCase()==='SERVICE'?'SERVICE':'PRODUCT'}
function salePrice(row,fallback=0){
  const price=Array.isArray(row?.salePrices)?row.salePrices[0]:null;
  return price&&Number.isFinite(Number(price.value))?Number(price.value)/100:rubles(fallback);
}
function sku(row){return clean(row?.article,160)||clean(row?.code,160)||`MS-${row?.id}`}
function barcode(row){
  const b=Array.isArray(row?.barcodes)?row.barcodes[0]:null;
  return clean(b?.ean13||b?.ean8||b?.code128||b?.gtin||'',160)||null;
}

async function defaultPriceTypeMeta(){
  try{
    const data=await ms('/context/companysettings/pricetype');
    const rows=Array.isArray(data)?data:(data?.rows||[]);
    const row=rows.find(x=>x?.meta?.href)||rows[0];
    if(row?.meta?.href)return row.meta;
  }catch(error){console.warn('MoySklad price type lookup failed',error?.message||error)}
  try{
    const data=await ms('/entity/assortment?limit=10');
    for(const row of data?.rows||[]){
      const meta=row?.salePrices?.[0]?.priceType?.meta;
      if(meta?.href)return meta;
    }
  }catch(error){console.warn('MoySklad price type fallback failed',error?.message||error)}
  return null;
}

async function findExactMoySklad(name,type){
  try{
    const data=await ms(`/entity/assortment?search=${encodeURIComponent(name)}&limit=50`);
    const wanted=msType(type);
    return (data?.rows||[]).find(row=>String(row?.name||'').trim().toLocaleLowerCase('ru-RU')===name.toLocaleLowerCase('ru-RU')&&String(row?.meta?.type||'').toLowerCase()===wanted)||null;
  }catch(error){console.warn('MoySklad exact catalog lookup failed',error?.message||error);return null}
}

async function createInMoySklad({name,type,price,article,description}){
  const entity=msType(type);
  const payload={name};
  if(article)payload.article=article;
  if(description)payload.description=description;
  if(price>0){
    const priceType=await defaultPriceTypeMeta();
    if(priceType)payload.salePrices=[{value:Math.round(price*100),priceType:{meta:priceType}}];
  }
  return ms(`/entity/${entity}`,{method:'POST',body:JSON.stringify(payload)});
}

async function upsertLocal({row,type,requestedPrice,category,unit,description,existingId,orgId}){
  const payload={
    organization_id:orgId,
    external_source:'MOYSKLAD',
    external_id:row.id,
    external_href:row?.meta?.href||`${BASE}/entity/${msType(type)}/${row.id}`,
    sku:sku(row),
    name:clean(row.name,500),
    item_type:localType(type),
    category:category||null,
    unit:clean(row?.uom?.name||unit||'шт',80)||'шт',
    description:clean(row?.description||description||'',2000)||null,
    sale_price:salePrice(row,requestedPrice),
    article:clean(row?.article||'',160)||null,
    barcode:barcode(row),
    external_updated_at:row?.updated||null,
    last_synced_at:new Date().toISOString(),
    is_active:row?.archived!==true
  };
  let query;
  if(existingId){
    query=service.from('catalog_items').update(payload).eq('id',existingId).select('id,name,sku,article,barcode,item_type,category,unit,sale_price,external_id,external_href,external_source').single();
  }else{
    const {data:external,error:eErr}=await service.from('catalog_items').select('id').eq('external_source','MOYSKLAD').eq('external_id',row.id).maybeSingle();
    if(eErr)throw eErr;
    query=external?.id
      ?service.from('catalog_items').update(payload).eq('id',external.id).select('id,name,sku,article,barcode,item_type,category,unit,sale_price,external_id,external_href,external_source').single()
      :service.from('catalog_items').insert(payload).select('id,name,sku,article,barcode,item_type,category,unit,sale_price,external_id,external_href,external_source').single();
  }
  const {data,error}=await query;
  if(error)throw error;
  return data;
}

const originalListen=express.application.listen;
express.application.listen=function patchedPosCatalogCreateListen(...args){
  if(!this[installed]){
    this[installed]=true;
    this.post('/api/v1/pos/catalog/items',async(req,res,next)=>{
      try{
        const ctx=await auth(req);
        if(ctx.error){
          const status=/AUTH|INVALID_SESSION/.test(ctx.error)?401:ctx.error==='DATABASE_NOT_CONFIGURED'?503:403;
          return res.status(status).json({success:false,error:ctx.error});
        }
        if(!msToken)return res.status(503).json({success:false,error:'MOYSKLAD_NOT_CONFIGURED',message:'Интеграция с МойСклад не настроена.'});
        const name=clean(req.body?.name,500);
        const type=localType(req.body?.item_type);
        const price=rubles(req.body?.sale_price);
        const category=clean(req.body?.category,160)||null;
        const unit=clean(req.body?.unit,80)||'шт';
        const article=clean(req.body?.article,160)||null;
        const description=clean(req.body?.description,2000)||null;
        if(!name)return res.status(400).json({success:false,error:'NAME_REQUIRED',message:'Укажите название позиции.'});
        if(!['PRODUCT','SERVICE'].includes(type))return res.status(400).json({success:false,error:'ITEM_TYPE_INVALID',message:'Допустимы только товар или услуга.'});
        if(!Number.isFinite(price)||price<0)return res.status(400).json({success:false,error:'PRICE_INVALID',message:'Цена должна быть не меньше нуля.'});

        const orgId=await organizationId();
        const {data:localExisting,error:localErr}=await service.from('catalog_items')
          .select('id,name,item_type,external_source,external_id,external_href,sale_price')
          .eq('organization_id',orgId).ilike('name',name).limit(1).maybeSingle();
        if(localErr)throw localErr;
        if(localExisting?.external_source==='MOYSKLAD'&&localExisting?.external_href){
          return res.json({success:true,already_exists:true,created_in_moysklad:false,item:localExisting});
        }

        let row=await findExactMoySklad(name,type);
        const created=!row;
        if(!row)row=await createInMoySklad({name,type,price,article,description});
        if(!row?.id)throw new Error('МойСклад не вернул идентификатор созданной позиции.');
        const item=await upsertLocal({row,type,requestedPrice:price,category,unit,description,existingId:localExisting?.id||null,orgId});
        return res.status(created?201:200).json({success:true,already_exists:!created,created_in_moysklad:created,item,moysklad:{id:row.id,name:row.name,href:row?.meta?.href||null,type:row?.meta?.type||msType(type)}});
      }catch(error){
        console.error('POS catalog create:',error);
        const message=String(error?.message||error);
        const status=/MoySklad HTTP 4\d\d/.test(message)?502:500;
        res.status(status).json({success:false,error:'CATALOG_CREATE_FAILED',message});
      }
    });
  }
  return originalListen.apply(this,args);
};
