import express from 'express';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const installed=Symbol.for('a4print.partner.admin.installed');
const originalListen=express.application.listen;

const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const num=(v,min=0,max=1e9,fallback=0)=>{const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback};
const sum=(rows,key)=>Number((rows||[]).reduce((a,x)=>a+Number(x?.[key]||0),0).toFixed(2));

async function staffContext(req){
  if(!service)return{error:'DATABASE_NOT_CONFIGURED',status:503};
  const bearer=clean(req.headers.authorization,5000).replace(/^Bearer\s+/i,'');
  if(!bearer)return{error:'AUTH_REQUIRED',status:401};
  const {data,error}=await service.auth.getUser(bearer);
  if(error||!data?.user)return{error:'INVALID_SESSION',status:401};
  const {data:profile,error:pErr}=await service.from('users').select('id,is_active').eq('auth_user_id',data.user.id).maybeSingle();
  if(pErr)throw pErr;
  if(!profile||profile.is_active===false)return{error:'STAFF_ACCESS_REQUIRED',status:403};
  const {data:roles,error:rErr}=await service.from('user_roles').select('roles(name)').eq('user_id',profile.id);
  if(rErr)throw rErr;
  const names=(roles||[]).map(x=>x.roles?.name).filter(Boolean);
  if(!names.some(x=>x==='ADMIN'||x==='MANAGER'))return{error:'MANAGER_REQUIRED',status:403};
  return{user:data.user,profile,roles:names};
}

async function admin(req,res,handler){
  try{
    const ctx=await staffContext(req);
    if(ctx.error)return res.status(ctx.status||403).json({success:false,error:ctx.error});
    return await handler(ctx);
  }catch(error){console.error('[partner admin]',error);return res.status(500).json({success:false,error:'INTERNAL_SERVER_ERROR',message:error.message})}
}

async function getPartner(id){
  const {data,error}=await service.from('partners').select('id,name,legal_name,tax_id,contact_name,email,phone,address,discount_percent,credit_limit,payment_terms_days,notes,is_active,created_at,updated_at,marketplace_public,marketplace_city,marketplace_address').eq('id',id).maybeSingle();
  if(error)throw error;
  return data||null;
}

async function loadDetails(id){
  const partner=await getPartner(id);
  if(!partner)return null;
  const [usersRes,ordersRes,crmOrdersRes,servicesRes,servicesCountRes,activeServicesCountRes,customersRes]=await Promise.all([
    service.from('partner_users').select('id,partner_id,auth_user_id,full_name,email,phone,is_admin,is_active,created_at,updated_at').eq('partner_id',id).order('created_at',{ascending:true}),
    service.from('orders').select('id,order_number,status,total,source,created_at,updated_at,partner_id,partner_user_id,fulfillment_partner_id,partner_direction,customer_comment').or(`partner_id.eq.${id},fulfillment_partner_id.eq.${id}`).order('created_at',{ascending:false}).limit(500),
    service.from('partner_crm_orders').select('id,order_number,title,status,sale_total,production_cost,prepaid,due_date,a4print_order_id,created_at,updated_at').eq('partner_id',id).order('created_at',{ascending:false}).limit(500),
    service.from('partner_supplier_services').select('id,category,name,description,unit,price,is_active,created_at,updated_at').eq('partner_id',id).order('category').order('name').limit(80),
    service.from('partner_supplier_services').select('id',{count:'exact',head:true}).eq('partner_id',id),
    service.from('partner_supplier_services').select('id',{count:'exact',head:true}).eq('partner_id',id).eq('is_active',true),
    service.from('partner_crm_customers').select('id',{count:'exact',head:true}).eq('partner_id',id)
  ]);
  for(const r of [usersRes,ordersRes,crmOrdersRes,servicesRes,servicesCountRes,activeServicesCountRes])if(r.error)throw r.error;
  if(customersRes.error)throw customersRes.error;
  const users=usersRes.data||[];
  const orders=ordersRes.data||[];
  const crmOrders=crmOrdersRes.data||[];
  const supplierServices=servicesRes.data||[];
  const fromPartner=orders.filter(x=>x.partner_id===id);
  const toPartner=orders.filter(x=>x.fulfillment_partner_id===id);
  const crmSales=sum(crmOrders,'sale_total');
  const crmPrepaid=sum(crmOrders,'prepaid');
  const crmReceivable=Number(crmOrders.reduce((a,x)=>a+Math.max(0,Number(x.sale_total||0)-Number(x.prepaid||0)),0).toFixed(2));
  return{
    partner,users,orders,crm_orders:crmOrders,supplier_services:supplierServices,
    stats:{
      users_count:users.length,active_users:users.filter(x=>x.is_active).length,
      orders_from_partner:fromPartner.length,orders_to_partner:toPartner.length,
      turnover_from_partner:sum(fromPartner,'total'),turnover_to_partner:sum(toPartner,'total'),
      crm_orders_count:crmOrders.length,crm_sales:crmSales,crm_prepaid:crmPrepaid,crm_receivable:crmReceivable,
      crm_customers_count:Number(customersRes.count||0),supplier_services_count:Number(servicesCountRes.count||0),
      active_supplier_services:Number(activeServicesCountRes.count||0)
    }
  };
}

express.application.listen=function patchedPartnerAdminListen(...args){
  if(!this[installed]){
    this[installed]=true;

    this.get('/api/v1/partner-admin/:id',(req,res)=>admin(req,res,async()=>{
      const id=clean(req.params.id,80);
      const details=await loadDetails(id);
      if(!details)return res.status(404).json({success:false,error:'PARTNER_NOT_FOUND',message:'Партнёр не найден.'});
      return res.json({success:true,...details});
    }));

    this.patch('/api/v1/partner-admin/:id',express.json(),(req,res)=>admin(req,res,async()=>{
      const id=clean(req.params.id,80);
      if(!await getPartner(id))return res.status(404).json({success:false,error:'PARTNER_NOT_FOUND',message:'Партнёр не найден.'});
      const b=req.body||{};
      const updates={updated_at:new Date().toISOString()};
      if(b.name!==undefined){updates.name=clean(b.name,220);if(!updates.name)return res.status(400).json({success:false,error:'PARTNER_NAME_REQUIRED',message:'Укажите название партнёра.'})}
      if(b.legal_name!==undefined)updates.legal_name=clean(b.legal_name,240)||null;
      if(b.tax_id!==undefined)updates.tax_id=clean(b.tax_id,30)||null;
      if(b.contact_name!==undefined)updates.contact_name=clean(b.contact_name,200)||null;
      if(b.email!==undefined)updates.email=clean(b.email,240).toLowerCase()||null;
      if(b.phone!==undefined)updates.phone=clean(b.phone,80)||null;
      if(b.address!==undefined)updates.address=clean(b.address,500)||null;
      if(b.notes!==undefined)updates.notes=clean(b.notes,3000)||null;
      if(b.discount_percent!==undefined)updates.discount_percent=num(b.discount_percent,0,100,0);
      if(b.payment_terms_days!==undefined)updates.payment_terms_days=Math.round(num(b.payment_terms_days,0,3650,0));
      if(b.credit_limit!==undefined)updates.credit_limit=num(b.credit_limit,0,1e9,0);
      if(typeof b.is_active==='boolean')updates.is_active=b.is_active;
      const {data,error}=await service.from('partners').update(updates).eq('id',id).select('id,name,legal_name,tax_id,contact_name,email,phone,address,discount_percent,credit_limit,payment_terms_days,notes,is_active,created_at,updated_at,marketplace_public,marketplace_city,marketplace_address').single();
      if(error)throw error;
      return res.json({success:true,partner:data});
    }));

    this.patch('/api/v1/partner-admin/:partnerId/users/:userId',express.json(),(req,res)=>admin(req,res,async()=>{
      const partnerId=clean(req.params.partnerId,80),userId=clean(req.params.userId,80);
      const {data:existing,error:eErr}=await service.from('partner_users').select('id,partner_id').eq('id',userId).eq('partner_id',partnerId).maybeSingle();
      if(eErr)throw eErr;
      if(!existing)return res.status(404).json({success:false,error:'PARTNER_USER_NOT_FOUND',message:'Пользователь партнёра не найден.'});
      const b=req.body||{},updates={updated_at:new Date().toISOString()};
      if(typeof b.is_active==='boolean')updates.is_active=b.is_active;
      if(typeof b.is_admin==='boolean')updates.is_admin=b.is_admin;
      if(b.full_name!==undefined){updates.full_name=clean(b.full_name,200);if(!updates.full_name)return res.status(400).json({success:false,error:'USER_NAME_REQUIRED',message:'Укажите имя пользователя.'})}
      if(b.phone!==undefined)updates.phone=clean(b.phone,80)||null;
      const {data,error}=await service.from('partner_users').update(updates).eq('id',userId).eq('partner_id',partnerId).select('id,partner_id,auth_user_id,full_name,email,phone,is_admin,is_active,created_at,updated_at').single();
      if(error)throw error;
      return res.json({success:true,user:data});
    }));
  }
  return originalListen.apply(this,args);
};
