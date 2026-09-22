import express from 'express';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const installed=Symbol.for('a4print.partner.admin.installed');
const originalListen=express.application.listen;

const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const num=(v,min=0,max=1e9,fallback=0)=>{const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback};

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
  const [usersRes,ordersRes,crmOrdersRes,servicesRes,metricsRes]=await Promise.all([
    service.from('partner_users').select('id,partner_id,auth_user_id,full_name,email,phone,is_admin,is_active,created_at,updated_at').eq('partner_id',id).order('created_at',{ascending:true}),
    service.from('orders')
      .select('id,order_number,status,total,source,created_at,updated_at,partner_id,partner_user_id,fulfillment_partner_id,partner_direction,customer_comment')
      .or(`partner_id.eq.${id},fulfillment_partner_id.eq.${id}`)
      .order('created_at',{ascending:false})
      .limit(100),
    service.from('partner_crm_orders')
      .select('id,order_number,title,status,sale_total,production_cost,prepaid,due_date,a4print_order_id,created_at,updated_at')
      .eq('partner_id',id)
      .order('created_at',{ascending:false})
      .limit(100),
    service.from('partner_supplier_services')
      .select('id,category,name,description,unit,price,is_active,created_at,updated_at')
      .eq('partner_id',id)
      .order('category')
      .order('name')
      .limit(80),
    service.rpc('get_partner_profile_metrics',{p_partner_id:id})
  ]);
  for(const r of [usersRes,ordersRes,crmOrdersRes,servicesRes,metricsRes])if(r.error)throw r.error;
  const users=usersRes.data||[],orders=ordersRes.data||[],crmOrders=crmOrdersRes.data||[],supplierServices=servicesRes.data||[];
  const metrics=Array.isArray(metricsRes.data)?(metricsRes.data[0]||{}):(metricsRes.data||{});
  return{partner,users,orders,crm_orders:crmOrders,supplier_services:supplierServices,stats:{
    users_count:users.length,
    active_users:users.filter(x=>x.is_active).length,
    orders_from_partner:Number(metrics.orders_from_partner||0),
    orders_to_partner:Number(metrics.orders_to_partner||0),
    turnover_from_partner:Number(metrics.turnover_from_partner||0),
    turnover_to_partner:Number(metrics.turnover_to_partner||0),
    crm_orders_count:Number(metrics.crm_orders_count||0),
    crm_sales:Number(metrics.crm_sales||0),
    crm_prepaid:Number(metrics.crm_prepaid||0),
    crm_receivable:Number(metrics.crm_receivable||0),
    crm_customers_count:Number(metrics.crm_customers_count||0),
    supplier_services_count:Number(metrics.supplier_services_count||0),
    active_supplier_services:Number(metrics.active_supplier_services||0)
  }};
}

express.application.listen=function patchedPartnerAdminListen(...args){
  if(!this[installed]){
    this[installed]=true;

    this.get('/api/v1/partner-admin/:id',(req,res)=>admin(req,res,async()=>{
      const details=await loadDetails(clean(req.params.id,80));
      if(!details)return res.status(404).json({success:false,error:'PARTNER_NOT_FOUND',message:'Партнёр не найден.'});
      return res.json({success:true,...details});
    }));

    this.patch('/api/v1/partner-admin/:id',express.json(),(req,res)=>admin(req,res,async()=>{
      const id=clean(req.params.id,80);
      if(!await getPartner(id))return res.status(404).json({success:false,error:'PARTNER_NOT_FOUND',message:'Партнёр не найден.'});
      const b=req.body||{},updates={updated_at:new Date().toISOString()};
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

    this.post('/api/v1/partner-admin/:id/users',express.json(),(req,res)=>admin(req,res,async()=>{
      const partnerId=clean(req.params.id,80),partner=await getPartner(partnerId);
      if(!partner)return res.status(404).json({success:false,error:'PARTNER_NOT_FOUND',message:'Партнёр не найден.'});
      const b=req.body||{},fullName=clean(b.full_name,200),email=clean(b.email,240).toLowerCase(),phone=clean(b.phone,80)||null,password=String(b.password||''),isAdmin=b.is_admin!==false;
      if(!fullName||!email||password.length<8)return res.status(400).json({success:false,error:'INVALID_USER_DATA',message:'Укажите имя, email и пароль не короче 8 символов.'});
      const {data:dup,error:dErr}=await service.from('partner_users').select('id').eq('email',email).maybeSingle();
      if(dErr)throw dErr;
      if(dup)return res.status(409).json({success:false,error:'EMAIL_ALREADY_REGISTERED',message:'Этот email уже используется в Partner CRM.'});
      let authUserId=null;
      try{
        const {data:authData,error:authError}=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:fullName,partner_portal:true,partner_id:partnerId}});
        if(authError){const duplicate=/already|registered|exists|duplicate/i.test(String(authError.message||''));return res.status(duplicate?409:400).json({success:false,error:duplicate?'EMAIL_ALREADY_REGISTERED':'AUTH_CREATE_FAILED',message:duplicate?'Этот email уже зарегистрирован в системе.':authError.message})}
        authUserId=authData.user.id;
        const {data:user,error:userError}=await service.from('partner_users').insert({partner_id:partnerId,auth_user_id:authUserId,full_name:fullName,email,phone,is_admin:isAdmin,is_active:true}).select('id,partner_id,auth_user_id,full_name,email,phone,is_admin,is_active,created_at,updated_at').single();
        if(userError)throw userError;
        return res.status(201).json({success:true,user});
      }catch(error){if(authUserId){try{await service.auth.admin.deleteUser(authUserId)}catch{}}throw error}
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
