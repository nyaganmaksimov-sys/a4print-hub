import express from 'express';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const publicBase=String(process.env.PUBLIC_APP_URL||'https://a4print-hub.ru').replace(/\/$/,'');
const installed=Symbol.for('a4print.partner.invites.installed');
const registerAttempts=new Map();

function clean(value,max=500){return String(value??'').trim().slice(0,max)}
function emailOf(value){return clean(value,240).toLowerCase()}
function clampNumber(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback}
function tokenValue(){return crypto.randomBytes(24).toString('base64url')}
function inviteUrl(token){return `${publicBase}/partner/register.html?invite=${encodeURIComponent(token)}`}
function inviteState(row){
  if(!row)return{valid:false,reason:'INVITE_NOT_FOUND'};
  if(row.is_active!==true)return{valid:false,reason:'INVITE_DISABLED'};
  if(row.expires_at&&Date.parse(row.expires_at)<=Date.now())return{valid:false,reason:'INVITE_EXPIRED'};
  if(Number(row.used_count||0)>=Number(row.max_uses||1))return{valid:false,reason:'INVITE_LIMIT_REACHED'};
  return{valid:true,reason:null};
}
function publicMessage(reason){
  return({
    INVITE_NOT_FOUND:'Ссылка регистрации не найдена.',
    INVITE_DISABLED:'Эта ссылка отключена.',
    INVITE_EXPIRED:'Срок действия ссылки истёк.',
    INVITE_LIMIT_REACHED:'Лимит регистраций по этой ссылке исчерпан.'
  })[reason]||'Ссылка регистрации недоступна.';
}
function dbErrorCode(error){
  const msg=String(error?.message||'');
  for(const code of ['INVITE_NOT_FOUND','INVITE_DISABLED','INVITE_EXPIRED','INVITE_LIMIT_REACHED'])if(msg.includes(code))return code;
  return null;
}
function jsonError(res,status,error,message){return res.status(status).json({success:false,error,message:message||error})}

async function staffContext(req){
  if(!service)return{error:'DATABASE_NOT_CONFIGURED',status:503};
  const bearer=clean(req.headers.authorization,4000).replace(/^Bearer\s+/i,'');
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

function registrationRateAllowed(req){
  const forwarded=clean(req.headers['x-forwarded-for'],300).split(',')[0].trim();
  const key=forwarded||clean(req.ip,120)||'unknown';
  const now=Date.now();
  const current=registerAttempts.get(key);
  if(!current||current.reset<=now){registerAttempts.set(key,{count:1,reset:now+10*60*1000});return true}
  current.count++;
  if(current.count>12)return false;
  return true;
}

async function listInvites(){
  const {data:invites,error}=await service.from('partner_registration_invites')
    .select('id,token,label,default_discount_percent,default_payment_terms_days,max_uses,used_count,is_active,expires_at,last_used_at,created_at,updated_at,created_by')
    .order('created_at',{ascending:false}).limit(100);
  if(error)throw error;
  const ids=(invites||[]).map(x=>x.id);
  let uses=[];
  if(ids.length){
    const result=await service.from('partner_registration_invite_uses')
      .select('id,invite_id,partner_id,partner_user_id,registered_email,company_name,registered_at')
      .in('invite_id',ids).order('registered_at',{ascending:false});
    if(result.error)throw result.error;
    uses=result.data||[];
  }
  const byInvite=new Map();
  for(const use of uses){const arr=byInvite.get(use.invite_id)||[];arr.push(use);byInvite.set(use.invite_id,arr)}
  return(invites||[]).map(row=>({...row,registration_url:inviteUrl(row.token),state:inviteState(row),registrations:byInvite.get(row.id)||[]}));
}

async function fetchInviteByToken(token){
  const {data,error}=await service.from('partner_registration_invites')
    .select('id,token,label,default_discount_percent,default_payment_terms_days,max_uses,used_count,is_active,expires_at,created_at')
    .eq('token',token).maybeSingle();
  if(error)throw error;
  return data||null;
}

async function handleAdmin(req,res,handler){
  try{
    const ctx=await staffContext(req);
    if(ctx.error)return jsonError(res,ctx.status||403,ctx.error);
    return await handler(ctx);
  }catch(error){console.error('[partner invites]',error);return jsonError(res,500,'INTERNAL_SERVER_ERROR',error.message)}
}

const originalListen=express.application.listen;
express.application.listen=function patchedPartnerInviteListen(...args){
  if(!this[installed]){
    this[installed]=true;

    this.get('/api/v1/partner-invites',(req,res)=>handleAdmin(req,res,async()=>{
      const invites=await listInvites();
      return res.json({success:true,invites});
    }));

    this.post('/api/v1/partner-invites',express.json(),(req,res)=>handleAdmin(req,res,async(ctx)=>{
      const label=clean(req.body?.label,160)||null;
      const expiresDays=Math.round(clampNumber(req.body?.expires_days,1,3650,30));
      const maxUses=Math.round(clampNumber(req.body?.max_uses,1,1000,1));
      const discount=clampNumber(req.body?.discount_percent,0,100,0);
      const paymentTerms=Math.round(clampNumber(req.body?.payment_terms_days,0,3650,0));
      const token=tokenValue();
      const expiresAt=new Date(Date.now()+expiresDays*86400000).toISOString();
      const {data,error}=await service.from('partner_registration_invites').insert({
        token,label,created_by:ctx.profile.id,
        default_discount_percent:discount,
        default_payment_terms_days:paymentTerms,
        max_uses:maxUses,used_count:0,is_active:true,expires_at:expiresAt
      }).select('id,token,label,default_discount_percent,default_payment_terms_days,max_uses,used_count,is_active,expires_at,created_at').single();
      if(error)throw error;
      return res.status(201).json({success:true,invite:{...data,registration_url:inviteUrl(data.token),state:inviteState(data),registrations:[]}});
    }));

    this.patch('/api/v1/partner-invites/:id',express.json(),(req,res)=>handleAdmin(req,res,async()=>{
      const id=clean(req.params.id,80);
      const updates={updated_at:new Date().toISOString()};
      if(typeof req.body?.is_active==='boolean')updates.is_active=req.body.is_active;
      if(req.body?.max_uses!==undefined)updates.max_uses=Math.round(clampNumber(req.body.max_uses,1,1000,1));
      if(req.body?.label!==undefined)updates.label=clean(req.body.label,160)||null;
      const {data,error}=await service.from('partner_registration_invites').update(updates).eq('id',id)
        .select('id,token,label,default_discount_percent,default_payment_terms_days,max_uses,used_count,is_active,expires_at,last_used_at,created_at,updated_at').single();
      if(error)throw error;
      return res.json({success:true,invite:{...data,registration_url:inviteUrl(data.token),state:inviteState(data)}});
    }));

    this.get('/api/v1/partner-registration/:token',async(req,res)=>{
      try{
        if(!service)return jsonError(res,503,'DATABASE_NOT_CONFIGURED');
        res.setHeader('Cache-Control','no-store');
        const token=clean(req.params.token,160);
        if(!token)return jsonError(res,404,'INVITE_NOT_FOUND',publicMessage('INVITE_NOT_FOUND'));
        const invite=await fetchInviteByToken(token);
        const state=inviteState(invite);
        if(!state.valid)return jsonError(res,state.reason==='INVITE_NOT_FOUND'?404:410,state.reason,publicMessage(state.reason));
        return res.json({success:true,invite:{
          label:invite.label||'Регистрация партнёра A4PRINT HUB',
          discount_percent:Number(invite.default_discount_percent||0),
          payment_terms_days:Number(invite.default_payment_terms_days||0),
          expires_at:invite.expires_at,
          remaining_uses:Math.max(0,Number(invite.max_uses||1)-Number(invite.used_count||0))
        }});
      }catch(error){console.error('[partner registration info]',error);return jsonError(res,500,'INTERNAL_SERVER_ERROR','Не удалось проверить ссылку регистрации.')}
    });

    this.post('/api/v1/partner-registration/:token',express.json(),async(req,res)=>{
      let reservedInviteId=null;
      let authUserId=null;
      let partnerId=null;
      try{
        if(!service)return jsonError(res,503,'DATABASE_NOT_CONFIGURED');
        if(!registrationRateAllowed(req))return jsonError(res,429,'RATE_LIMITED','Слишком много попыток регистрации. Попробуйте через несколько минут.');

        const inviteToken=clean(req.params.token,160);
        const company=clean(req.body?.company_name,220);
        const legalName=clean(req.body?.legal_name,240)||null;
        const taxId=clean(req.body?.tax_id,30)||null;
        const contactName=clean(req.body?.contact_name,200);
        const phone=clean(req.body?.phone,80)||null;
        const email=emailOf(req.body?.email);
        const password=String(req.body?.password||'');
        const accepted=Boolean(req.body?.accepted_terms);
        if(!inviteToken)return jsonError(res,404,'INVITE_NOT_FOUND',publicMessage('INVITE_NOT_FOUND'));
        if(!company||!contactName||!email||password.length<8)return jsonError(res,400,'INVALID_REGISTRATION_DATA','Укажите компанию, контактное лицо, email и пароль не короче 8 символов.');
        if(!accepted)return jsonError(res,400,'TERMS_REQUIRED','Для регистрации необходимо принять условия партнёрской программы и политику конфиденциальности.');

        const {data:reservation,error:reserveError}=await service.rpc('reserve_partner_registration_invite',{p_token:inviteToken});
        if(reserveError){
          const code=dbErrorCode(reserveError)||'INVITE_UNAVAILABLE';
          return jsonError(res,code==='INVITE_NOT_FOUND'?404:410,code,publicMessage(code));
        }
        const reserved=Array.isArray(reservation)?reservation[0]:reservation;
        if(!reserved?.invite_id)return jsonError(res,410,'INVITE_UNAVAILABLE',publicMessage('INVITE_UNAVAILABLE'));
        reservedInviteId=reserved.invite_id;

        const {data:authData,error:authError}=await service.auth.admin.createUser({
          email,password,email_confirm:true,
          user_metadata:{full_name:contactName,partner_portal:true,partner_invite_id:reservedInviteId}
        });
        if(authError){
          const duplicate=/already|registered|exists|duplicate/i.test(String(authError.message||''));
          throw Object.assign(new Error(duplicate?'Этот email уже зарегистрирован в системе.':authError.message),{publicStatus:duplicate?409:400,publicCode:duplicate?'EMAIL_ALREADY_REGISTERED':'AUTH_CREATE_FAILED'});
        }
        authUserId=authData.user.id;

        const {data:partner,error:partnerError}=await service.from('partners').insert({
          name:company,legal_name:legalName,tax_id:taxId,contact_name:contactName,email,phone,
          discount_percent:Number(reserved.default_discount_percent||0),
          payment_terms_days:Number(reserved.default_payment_terms_days||0),
          is_active:true,
          notes:`Саморегистрация по партнёрской ссылке ${reservedInviteId}`
        }).select('id,name').single();
        if(partnerError)throw partnerError;
        partnerId=partner.id;

        const {data:partnerUser,error:userError}=await service.from('partner_users').insert({
          partner_id:partner.id,auth_user_id:authUserId,full_name:contactName,email,phone,is_admin:true,is_active:true
        }).select('id').single();
        if(userError)throw userError;

        const {error:usageError}=await service.from('partner_registration_invite_uses').insert({
          invite_id:reservedInviteId,partner_id:partner.id,partner_user_id:partnerUser.id,
          registered_email:email,company_name:company
        });
        if(usageError)console.warn('[partner registration usage]',usageError.message);

        return res.status(201).json({
          success:true,
          partner:{id:partner.id,name:partner.name},
          login_url:`${publicBase}/partner/login.html`,
          message:'Партнёр зарегистрирован. Теперь можно войти в Partner CRM.'
        });
      }catch(error){
        console.error('[partner registration]',error);
        if(partnerId){try{await service.from('partners').delete().eq('id',partnerId)}catch{}}
        if(authUserId){try{await service.auth.admin.deleteUser(authUserId)}catch{}}
        if(reservedInviteId){try{await service.rpc('release_partner_registration_invite',{p_invite_id:reservedInviteId})}catch{}}
        return jsonError(res,error.publicStatus||500,error.publicCode||'REGISTRATION_FAILED',error.publicStatus?error.message:'Не удалось завершить регистрацию. Попробуйте ещё раз.');
      }
    });
  }
  return originalListen.apply(this,args);
};
