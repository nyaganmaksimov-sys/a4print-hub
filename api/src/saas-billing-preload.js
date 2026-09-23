import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { registerSaasBillingRoutes } from './saas-billing.js';

const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const installed=Symbol.for('a4print.saas.billing.installed');

const controlOrganizationCode=String(process.env.SAAS_CONTROL_ORGANIZATION_CODE||'A4PRINT').trim().toUpperCase();

async function authorizeAdmin(req,res,next){
  try{
    if(!service)return res.status(503).json({success:false,error:'DATABASE_NOT_CONFIGURED'});
    const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return res.status(401).json({success:false,error:'AUTH_REQUIRED'});
    const {data,error}=await service.auth.getUser(token);
    if(error||!data?.user)return res.status(401).json({success:false,error:'INVALID_SESSION'});
    const {data:profile,error:pErr}=await service.from('users').select('id,is_active,organization_unit_id').eq('auth_user_id',data.user.id).maybeSingle();
    if(pErr)throw pErr;
    if(!profile||profile.is_active===false)return res.status(403).json({success:false,error:'ADMIN_REQUIRED'});
    const {data:rows,error:rErr}=await service.from('user_roles').select('roles(name)').eq('user_id',profile.id);
    if(rErr)throw rErr;
    if(!(rows||[]).some(x=>x.roles?.name==='ADMIN'))return res.status(403).json({success:false,error:'ADMIN_REQUIRED'});
    if(!profile.organization_unit_id)return res.status(403).json({success:false,error:'PLATFORM_ADMIN_REQUIRED',message:'Администратор не привязан к управляющей организации.'});
    const {data:unit,error:uErr}=await service.from('organization_units').select('organization_id,is_active').eq('id',profile.organization_unit_id).maybeSingle();
    if(uErr)throw uErr;
    if(!unit||unit.is_active===false||!unit.organization_id)return res.status(403).json({success:false,error:'PLATFORM_ADMIN_REQUIRED',message:'Подразделение администратора недоступно.'});
    const {data:organization,error:oErr}=await service.from('organizations').select('id,code,is_active').eq('id',unit.organization_id).maybeSingle();
    if(oErr)throw oErr;
    if(!organization||organization.is_active===false||String(organization.code||'').trim().toUpperCase()!==controlOrganizationCode){
      return res.status(403).json({success:false,error:'PLATFORM_ADMIN_REQUIRED',message:'Глобальная коммерция доступна только управляющей организации A4PRINT HUB.'});
    }
    req.authUser=data.user;req.staffProfile=profile;req.staffOrganizationId=organization.id;next();
  }catch(e){next(e)}
}

const originalListen=express.application.listen;
express.application.listen=function patchedSaasBillingListen(...args){
  if(!this[installed]&&service){
    this[installed]=true;
    registerSaasBillingRoutes({app:this,supabase:service,requireAdmin:authorizeAdmin,encryptionSecret:process.env.BILLING_ENCRYPTION_KEY||serviceKey});
  }
  return originalListen.apply(this,args);
};
