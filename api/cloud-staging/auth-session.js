import { createRemoteJWKSet, jwtVerify } from 'jose';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createNeonVerifier({baseUrl,jwksUrl}) {
  if (!baseUrl || !jwksUrl) return null;
  const base=new URL(baseUrl),keys=new URL(jwksUrl);
  if (base.protocol!=='https:' || keys.protocol!=='https:' ||
      base.origin!==keys.origin || !keys.pathname.startsWith(base.pathname+'/')) {
    throw new Error('NEON_AUTH_CONFIG_UNSAFE');
  }
  const jwks=createRemoteJWKSet(keys,{timeoutDuration:5000,cooldownDuration:30000});
  return token=>verifyJWT(token,jwks,base.origin);
}

export async function verifyJWT(token,jwks,issuer) {
  const {payload}=await jwtVerify(token,jwks,{
    issuer, algorithms:['EdDSA'],clockTolerance:5
  });
  if (!UUID_RE.test(String(payload.sub||''))) throw new Error('INVALID_SUBJECT');
  return payload.sub;
}

function bearerFrom(header) {
  const match=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(typeof header==='string'?header:'');
  return match && match[1].length<=8192 ? match[1] : null;
}

export async function authorizeSession({authorization,verify,pool}) {
  const bearer=bearerFrom(authorization);
  if (!bearer) return {status:401,result:{error:'AUTH_TOKEN_REQUIRED'}};
  if (!verify || !pool) return {status:503,result:{error:'AUTH_NOT_READY'}};

  let userId;
  try {
    userId=await verify(bearer);
    if (!UUID_RE.test(String(userId||''))) throw new Error('INVALID_SUBJECT');
  } catch {
    return {status:401,result:{error:'INVALID_OR_EXPIRED_TOKEN'}};
  }

  let row;
  try {
    const result=await pool.query(
      'SELECT role, enabled, identity_verified FROM public.cloud_staging_session_grants WHERE neon_auth_user_id=$1::uuid LIMIT 1',
      [userId]
    );
    row=result.rows?.[0]||null;
  } catch {
    return {status:503,result:{error:'ACCESS_POLICY_UNAVAILABLE'}};
  }
  if (!row || !row.enabled || !row.identity_verified || row.role!=='STAGING_VIEWER') {
    return {status:403,result:{error:'ACCOUNT_NOT_ACTIVATED'}};
  }
  return {status:200,result:{
    authenticated:true,environment:'TEST_ONLY',role:'STAGING_VIEWER',
    permissions:['cloud.taxonomy.read'],productionAccess:false,posSalesEnabled:false
  }};
}
