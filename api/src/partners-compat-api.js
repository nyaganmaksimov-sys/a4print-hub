import express from 'express';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const installed=Symbol.for('a4print.partners.compat.api.installed');
const originalListen=express.application.listen;

const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const clamp=(value,min,max,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback};

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
  if(!names.some(name=>name==='ADMIN'||name==='MANAGER'))return{error:'MANAGER_REQUIRED',status:403};
  return{user:data.user,profile,roles:names};
}

async function staff(req,res,handler){
  try{
    const ctx=await staffContext(req);
    if(ctx.error)return res.status(ctx.status||403).json({success:false,error:ctx.error});
    return await handler(ctx);
  }catch(error){
    console.error('[partners compat api]',error);
    return res.status(500).json({success:false,error:'INTERNAL_SERVER_ERROR',message:error.message});
  }
}

async function partnerById(id){
  const {data,error}=await service.from('partners')
    .select('id,name,legal_name,tax_id,contact_name,email,phone,address,discount_percent,credit_limit,payment_terms_days,notes,is_active,created_at,updated_at')
    .eq('id',id).maybeSingle();
  if(error)throw error;
  return data||null;
}

express.application.listen=function patchedPartnersCompatListen(...args){
  if(!this[installed]){
    this[installed]=true;

    this.get('/api/v1/partners',(req,res)=>staff(req,res,async()=>{
      const {data,error}=await service.from('partners')
        .select('id,name,legal_name,tax_id,contact_name,email,phone,address,discount_percent,credit_limit,payment_terms_days,notes,is_active,created_at,updated_at,partner_users(id,full_name,email,phone,is_admin,is_active,created_at)')
        .order('created_at',{ascending:false});
      if(error)throw error;
      const rows=data||[];
      const ids=rows.map(x=>x.id);
      const counts={};
      if(ids.length){
        const {data:orders,error:oErr}=await service.from('orders').select('partner_id,fulfillment_partner_id').or(`partner_id.in.(${ids.join(',')}),fulfillment_partner_id.in.(${ids.join(',')})`);
        if(oErr)throw oErr;
        for(const order of orders||[]){
          if(order.partner_id)counts[order.partner_id]=(counts[order.partner_id]||0)+1;
          if(order.fulfillment_partner_id&&order.fulfillment_partner_id!==order.partner_id)counts[order.fulfillment_partner_id]=(counts[order.fulfillment_partner_id]||0)+1;
        }
      }
      return res.json({success:true,partners:rows.map(p=>({...p,orders_count:counts[p.id]||0}))});
    }));

    this.post('/api/v1/partners',express.json(),(req,res)=>staff(req,res,async()=>{
      const b=req.body||{};
      const name=clean(b.name,220),contactName=clean(b.contact_name,200),email=clean(b.email,240).toLowerCase(),phone=clean(b.phone,80),password=String(b.password||'');
      if(!name)return res.status(400).json({success:false,error:'PARTNER_NAME_REQUIRED',message:'Укажите название партнёра.'});
      const wantsAccess=Boolean(email||password);
      if(wantsAccess&&(!email||!contactName||password.length<6))return res.status(400).json({success:false,error:'INVALID_PARTNER_USER',message:'Для входа партнёра укажите контактное лицо, email и пароль от 6 символов.'});

      const payload={
        name,
        legal_name:clean(b.legal_name,240)||null,
        tax_id:clean(b.tax_id,30)||null,
        contact_name:contactName||null,
        email:email||null,
        phone:phone||null,
        address:clean(b.address,500)||null,
        discount_percent:clamp(b.discount_percent,0,100,0),
        credit_limit:clamp(b.credit_limit,0,1e9,0),
        payment_terms_days:Math.round(clamp(b.payment_terms_days,0,3650,0)),
        notes:clean(b.notes,3000)||null,
        is_active:true
      };
      const {data:partner,error:pErr}=await service.from('partners').insert(payload).select().single();
      if(pErr)throw pErr;
      let authUserId=null;
      try{
        if(wantsAccess){
          const {data:authData,error:aErr}=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:contactName,partner_portal:true,partner_id:partner.id}});
          if(aErr)throw aErr;
          authUserId=authData.user.id;
          const {error:uErr}=await service.from('partner_users').insert({partner_id:partner.id,auth_user_id:authUserId,full_name:contactName,email,phone:phone||null,is_admin:true,is_active:true});
          if(uErr)throw uErr;
        }
        return res.status(201).json({success:true,partner});
      }catch(error){
        if(authUserId){try{await service.auth.admin.deleteUser(authUserId)}catch{}}
        try{await service.from('partners').delete().eq('id',partner.id)}catch{}
        throw error;
      }
    }));

    this.patch('/api/v1/partners/:id',express.json(),(req,res)=>staff(req,res,async()=>{
      const id=clean(req.params.id,80);
      if(!await partnerById(id))return res.status(404).json({success:false,error:'PARTNER_NOT_FOUND',message:'Партнёр не найден.'});
      const b=req.body||{},updates={updated_at:new Date().toISOString()};
      for(const key of ['name','legal_name','tax_id','contact_name','email','phone','address','notes']){
        if(b[key]!==undefined)updates[key]=clean(b[key],key==='notes'?3000:500)||null;
      }
      if(b.discount_percent!==undefined)updates.discount_percent=clamp(b.discount_percent,0,100,0);
      if(b.credit_limit!==undefined)updates.credit_limit=clamp(b.credit_limit,0,1e9,0);
      if(b.payment_terms_days!==undefined)updates.payment_terms_days=Math.round(clamp(b.payment_terms_days,0,3650,0));
      if(typeof b.is_active==='boolean')updates.is_active=b.is_active;
      const {data,error}=await service.from('partners').update(updates).eq('id',id).select().single();
      if(error)throw error;
      if(typeof b.is_active==='boolean'){
        const {data:users,error:uErr}=await service.from('partner_users').select('auth_user_id').eq('partner_id',id);
        if(uErr)throw uErr;
        for(const user of users||[]){
          if(!user.auth_user_id)continue;
          try{await service.auth.admin.updateUserById(user.auth_user_id,{ban_duration:b.is_active?'none':'876000h'})}catch(error){console.warn('[partners compat api] auth state',error.message)}
        }
        const {error:stateErr}=await service.from('partner_users').update({is_active:b.is_active,updated_at:new Date().toISOString()}).eq('partner_id',id);
        if(stateErr)throw stateErr;
      }
      return res.json({success:true,partner:data});
    }));
  }
  return originalListen.apply(this,args);
};
