const DEFAULT_MOYSKLAD_ORGANIZATION_CODE='A4PRINT';

function normalizeOrganizationCode(value){
  return String(value||'').trim().toUpperCase();
}

function tokenEnvSegment(value){
  return normalizeOrganizationCode(value).replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}

export function configuredMoySkladOrganizationCode(){
  return normalizeOrganizationCode(process.env.MOYSKLAD_ORGANIZATION_CODE||DEFAULT_MOYSKLAD_ORGANIZATION_CODE);
}

export function moySkladTokenEnvName(organizationOrCode){
  const code=typeof organizationOrCode==='string'?organizationOrCode:organizationOrCode?.code;
  const segment=tokenEnvSegment(code);
  return segment?'MOYSKLAD_TOKEN_'+segment:null;
}

export function moySkladTokenForOrganization(organizationOrCode){
  const code=normalizeOrganizationCode(typeof organizationOrCode==='string'?organizationOrCode:organizationOrCode?.code);
  if(!code)return null;

  const envName=moySkladTokenEnvName(code);
  const dedicated=envName?String(process.env[envName]||'').trim():'';
  if(dedicated)return dedicated;

  // Backward compatibility: the existing single MOYSKLAD_TOKEN belongs only to
  // MOYSKLAD_ORGANIZATION_CODE (A4PRINT by default). It is never shared with
  // another organization.
  if(code===configuredMoySkladOrganizationCode()){
    const legacy=String(process.env.MOYSKLAD_TOKEN||'').trim();
    if(legacy)return legacy;
  }
  return null;
}

export function configuredMoySkladOrganizationCodes(){
  const codes=new Set();
  for(const [name,value] of Object.entries(process.env)){
    if(!name.startsWith('MOYSKLAD_TOKEN_')||!String(value||'').trim())continue;
    const suffix=name.slice('MOYSKLAD_TOKEN_'.length).trim().toUpperCase();
    if(suffix)codes.add(suffix);
  }
  if(String(process.env.MOYSKLAD_TOKEN||'').trim())codes.add(configuredMoySkladOrganizationCode());
  return [...codes].sort();
}

export function hasAnyMoySkladConfiguration(){
  return configuredMoySkladOrganizationCodes().length>0;
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
  return Boolean(moySkladTokenForOrganization(organization));
}

export async function requireMoySkladOrganization({service,authUserId=null,organizationId=null}={}){
  const organization=organizationId
    ?await organizationById(service,organizationId)
    :await organizationForAuthUser(service,authUserId);
  if(!organization){
    return{ok:false,error:'POS_ORGANIZATION_REQUIRED',status:403,organization:null};
  }

  const token=moySkladTokenForOrganization(organization);
  if(!token){
    return{
      ok:false,
      error:'MOYSKLAD_ORGANIZATION_NOT_CONFIGURED',
      status:409,
      organization,
      configured_code:configuredMoySkladOrganizationCode(),
      configured_codes:configuredMoySkladOrganizationCodes()
    };
  }

  return{
    ok:true,
    organization,
    token,
    token_env:moySkladTokenEnvName(organization),
    configured_code:configuredMoySkladOrganizationCode(),
    configured_codes:configuredMoySkladOrganizationCodes()
  };
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
