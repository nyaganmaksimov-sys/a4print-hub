const DEFAULT_MOYSKLAD_ORGANIZATION_CODE='A4PRINT';

export function configuredMoySkladOrganizationCode(){
  return String(process.env.MOYSKLAD_ORGANIZATION_CODE||DEFAULT_MOYSKLAD_ORGANIZATION_CODE).trim().toUpperCase();
}

export async function organizationForAuthUser(service,authUserId){
  if(!service||!authUserId)return null;
  const profile=await service.from('users').select('id,is_active,organization_unit_id').eq('auth_user_id',authUserId).maybeSingle();
  if(profile.error)throw profile.error;
  if(!profile.data||profile.data.is_active===false||!profile.data.organization_unit_id)return null;

  const unit=await service.from('organization_units').select('organization_id,is_active').eq('id',profile.data.organization_unit_id).maybeSingle();
  if(unit.error)throw unit.error;
  if(!unit.data||unit.data.is_active===false||!unit.data.organization_id)return null;

  const org=await service.from('organizations').select('id,code,name,is_active').eq('id',unit.data.organization_id).maybeSingle();
  if(org.error)throw org.error;
  if(!org.data||org.data.is_active===false)return null;
  return org.data;
}

export async function organizationById(service,organizationId){
  if(!service||!organizationId)return null;
  const org=await service.from('organizations').select('id,code,name,is_active').eq('id',organizationId).maybeSingle();
  if(org.error)throw org.error;
  if(!org.data||org.data.is_active===false)return null;
  return org.data;
}

export function isMoySkladOrganizationAllowed(organization){
  const configured=configuredMoySkladOrganizationCode();
  return Boolean(organization?.code)&&String(organization.code).trim().toUpperCase()===configured;
}

export async function requireMoySkladOrganization({service,authUserId=null,organizationId=null}={}){
  const organization=organizationId
    ?await organizationById(service,organizationId)
    :await organizationForAuthUser(service,authUserId);
  if(!organization){
    return{ok:false,error:'POS_ORGANIZATION_REQUIRED',status:403,organization:null};
  }
  if(!isMoySkladOrganizationAllowed(organization)){
    return{
      ok:false,
      error:'MOYSKLAD_ORGANIZATION_NOT_CONFIGURED',
      status:409,
      organization,
      configured_code:configuredMoySkladOrganizationCode()
    };
  }
  return{ok:true,organization,configured_code:configuredMoySkladOrganizationCode()};
}

export function moySkladTenantError(res,result){
  return res.status(result?.status||409).json({
    success:false,
    error:result?.error||'MOYSKLAD_ORGANIZATION_NOT_CONFIGURED',
    message:result?.error==='POS_ORGANIZATION_REQUIRED'
      ?'Сотрудник не привязан к компании.'
      :'Для этой компании отдельная интеграция МойСклад ещё не настроена.'
  });
}
