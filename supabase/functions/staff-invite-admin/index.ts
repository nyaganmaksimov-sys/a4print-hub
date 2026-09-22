import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const URL=Deno.env.get('SUPABASE_URL')!;
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(URL,KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const allowed=new Set(['https://a4print-hub.ru','https://www.a4print-hub.ru']);
const cors=(req:Request)=>({
  'Access-Control-Allow-Origin':allowed.has(req.headers.get('origin')||'')?(req.headers.get('origin')||''):'https://a4print-hub.ru',
  'Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'
});
const json=(req:Request,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors(req)});
const b64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function sha256(s:string){
  const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function guard(req:Request){
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!token)throw Object.assign(new Error('AUTH_REQUIRED'),{status:401});
  const {data:user,error}=await db.auth.getUser(token);
  if(error||!user.user)throw Object.assign(new Error('AUTH_REQUIRED'),{status:401});
  const {data:profile,error:pErr}=await db.from('users')
    .select('id,is_active,organization_unit_id')
    .eq('auth_user_id',user.user.id)
    .maybeSingle();
  if(pErr)throw pErr;
  if(!profile?.is_active||!profile.organization_unit_id)throw Object.assign(new Error('ADMIN_REQUIRED'),{status:403});

  const {data:unit,error:uErr}=await db.from('organization_units')
    .select('organization_id')
    .eq('id',profile.organization_unit_id)
    .maybeSingle();
  if(uErr)throw uErr;
  if(!unit?.organization_id)throw Object.assign(new Error('ADMIN_REQUIRED'),{status:403});

  const {data:adminRole}=await db.from('roles').select('id').eq('name','ADMIN').maybeSingle();
  if(!adminRole)throw Object.assign(new Error('ADMIN_REQUIRED'),{status:403});
  const {data:membership}=await db.from('user_roles')
    .select('user_id').eq('user_id',profile.id).eq('role_id',adminRole.id).maybeSingle();
  if(!membership)throw Object.assign(new Error('ADMIN_REQUIRED'),{status:403});
  return{actorId:profile.id,organizationId:unit.organization_id};
}
async function meta(organizationId:string){
  const [roles,org,units]=await Promise.all([
    db.from('roles').select('id,name,description').order('name'),
    db.from('organizations').select('id,name,code,is_active').eq('id',organizationId).eq('is_active',true).maybeSingle(),
    db.from('organization_units').select('id,organization_id,name,code,is_active').eq('organization_id',organizationId).eq('is_active',true).order('name')
  ]);
  if(roles.error)throw roles.error;if(org.error)throw org.error;if(units.error)throw units.error;
  const unitIds=(units.data||[]).map((x:any)=>x.id);
  const positions=unitIds.length
    ? await db.from('staff_positions').select('id,organization_unit_id,name,code,is_active,sort_order').in('organization_unit_id',unitIds).eq('is_active',true).order('sort_order').order('name')
    : {data:[],error:null};
  if(positions.error)throw positions.error;
  return{
    roles:roles.data||[],
    organizations:org.data?[org.data]:[],
    organization_units:units.data||[],
    staff_positions:positions.data||[]
  };
}
async function listInvites(organizationId:string){
  const m=await meta(organizationId);
  const {data,error}=await db.from('staff_invites')
    .select('id,token_hint,organization_id,organization_unit_id,position_id,role_ids,created_at,expires_at,used_at,used_by,revoked_at')
    .eq('organization_id',organizationId)
    .order('created_at',{ascending:false})
    .limit(100);
  if(error)throw error;
  const dm=new Map(m.organization_units.map((x:any)=>[x.id,x]));
  const om=new Map(m.organizations.map((x:any)=>[x.id,x]));
  const pm=new Map(m.staff_positions.map((x:any)=>[x.id,x]));
  const rm=new Map(m.roles.map((x:any)=>[x.id,x]));
  const userIds=[...new Set((data||[]).map((x:any)=>x.used_by).filter(Boolean))];
  let users:any[]=[];
  if(userIds.length){
    const q=await db.from('users').select('id,full_name,email').in('id',userIds);
    if(q.error)throw q.error;
    users=q.data||[];
  }
  const um=new Map(users.map((x:any)=>[x.id,x]));
  return{
    meta:m,
    invites:(data||[]).map((x:any)=>({
      ...x,
      organization:om.get(x.organization_id)||null,
      department:dm.get(x.organization_unit_id)||null,
      position:pm.get(x.position_id)||null,
      roles:(x.role_ids||[]).map((id:string)=>rm.get(id)).filter(Boolean),
      used_user:um.get(x.used_by)||null
    }))
  };
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors(req)});
  if(req.method!=='POST')return json(req,{error:'METHOD_NOT_ALLOWED'},405);
  try{
    const actor=await guard(req);
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||'list');

    if(action==='bootstrap'||action==='list'){
      return json(req,{success:true,...await listInvites(actor.organizationId)});
    }

    if(action==='create'){
      const payload=body.payload||{};
      const departmentId=String(payload.department_id||'');
      const positionId=String(payload.position_id||'');
      const requestedOrg=payload.organization_id?String(payload.organization_id):actor.organizationId;
      const roleIds=Array.isArray(payload.role_ids)?payload.role_ids.map(String):[];
      const days=Math.max(1,Math.min(30,Number(payload.expires_days)||7));
      if(requestedOrg!==actor.organizationId)return json(req,{error:'TENANT_MISMATCH'},404);
      if(!departmentId||!positionId||!roleIds.length){
        return json(req,{error:'VALIDATION_ERROR',message:'Выберите отдел, должность и хотя бы одну роль.'},400);
      }
      const [department,position,roles]=await Promise.all([
        db.from('organization_units').select('id,organization_id,is_active').eq('id',departmentId).maybeSingle(),
        db.from('staff_positions').select('id,organization_unit_id,is_active').eq('id',positionId).maybeSingle(),
        db.from('roles').select('id').in('id',roleIds)
      ]);
      if(department.error)throw department.error;if(position.error)throw position.error;if(roles.error)throw roles.error;
      if(!department.data?.is_active||department.data.organization_id!==actor.organizationId){
        return json(req,{error:'DEPARTMENT_INVALID'},400);
      }
      if(!position.data?.is_active||position.data.organization_unit_id!==departmentId){
        return json(req,{error:'POSITION_INVALID'},400);
      }
      if((roles.data||[]).length!==roleIds.length)return json(req,{error:'ROLE_INVALID'},400);

      const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
      const token=b64url(bytes),tokenHash=await sha256(token);
      const expiresAt=new Date(Date.now()+days*86400000).toISOString();
      const {data,error}=await db.from('staff_invites').insert({
        token_hash:tokenHash,token_hint:token.slice(0,6),
        organization_id:actor.organizationId,organization_unit_id:departmentId,position_id:positionId,
        role_ids:roleIds,created_by:actor.actorId,expires_at:expiresAt
      }).select('id,created_at,expires_at,token_hint').single();
      if(error)throw error;
      return json(req,{success:true,invite:data,invite_url:`https://a4print-hub.ru/admin/invite.html?token=${encodeURIComponent(token)}`});
    }

    if(action==='revoke'){
      const id=String(body.invite_id||'');
      if(!id)return json(req,{error:'INVITE_REQUIRED'},400);
      const {data,error}=await db.from('staff_invites')
        .update({revoked_at:new Date().toISOString()})
        .eq('id',id)
        .eq('organization_id',actor.organizationId)
        .is('used_at',null)
        .select('id')
        .maybeSingle();
      if(error)throw error;
      if(!data)return json(req,{error:'INVITE_NOT_FOUND'},404);
      return json(req,{success:true});
    }
    return json(req,{error:'UNKNOWN_ACTION'},400);
  }catch(error:any){
    console.error(error);
    return json(req,{error:error?.message||'SERVER_ERROR',message:error?.message||'Ошибка сервера'},error?.status||500);
  }
});
