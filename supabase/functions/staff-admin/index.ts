import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const U=Deno.env.get('SUPABASE_URL')!;
const K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(U,K,{auth:{autoRefreshToken:false,persistSession:false}});
const origins=new Set(['https://a4print-hub.ru','https://www.a4print-hub.ru']);
const cors=(r:Request)=>({
  'Access-Control-Allow-Origin':origins.has(r.headers.get('origin')||'')?(r.headers.get('origin')||''):'https://a4print-hub.ru',
  'Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Vary':'Origin','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'
});
const json=(r:Request,b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:cors(r)});
const clean=(v:any,n=300)=>String(v??'').trim().slice(0,n);

async function guard(r:Request){
  const token=(r.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!token)return{e:'AUTH_REQUIRED',s:401} as const;
  const {data,error}=await db.auth.getUser(token);
  if(error||!data.user)return{e:'INVALID_SESSION',s:401} as const;

  const {data:profile,error:pErr}=await db.from('users')
    .select('id,is_active,organization_unit_id')
    .eq('auth_user_id',data.user.id)
    .maybeSingle();
  if(pErr)throw pErr;
  if(!profile||profile.is_active===false||!profile.organization_unit_id)return{e:'STAFF_PROFILE_REQUIRED',s:403} as const;

  const {data:unit,error:uErr}=await db.from('organization_units')
    .select('organization_id')
    .eq('id',profile.organization_unit_id)
    .maybeSingle();
  if(uErr)throw uErr;
  if(!unit?.organization_id)return{e:'STAFF_ORGANIZATION_REQUIRED',s:403} as const;

  const {data:org,error:oErr}=await db.from('organizations')
    .select('id,is_active')
    .eq('id',unit.organization_id)
    .maybeSingle();
  if(oErr)throw oErr;
  if(!org?.is_active)return{e:'ORGANIZATION_DISABLED',s:403} as const;

  const {data:role}=await db.from('roles').select('id').eq('name','ADMIN').maybeSingle();
  if(!role)return{e:'ADMIN_ROLE_NOT_CONFIGURED',s:500} as const;
  const {data:membership}=await db.from('user_roles')
    .select('user_id')
    .eq('user_id',profile.id)
    .eq('role_id',role.id)
    .maybeSingle();
  if(!membership)return{e:'ADMIN_REQUIRED',s:403} as const;
  return{user:data.user,profile,organizationId:unit.organization_id,s:200} as const;
}

async function roles(){
  const {data,error}=await db.from('roles').select('id,name,description,created_at').order('name');
  if(error)throw error;
  return data||[];
}
async function unitIds(organizationId:string){
  const {data,error}=await db.from('organization_units').select('id').eq('organization_id',organizationId);
  if(error)throw error;
  return (data||[]).map((x:any)=>x.id);
}
async function users(organizationId:string){
  const units=await unitIds(organizationId);
  if(!units.length)return[];
  const {data:staff,error}=await db.from('users')
    .select('id,auth_user_id,full_name,email,phone,is_active,position,position_id,organization_unit_id,created_at,updated_at')
    .in('organization_unit_id',units)
    .order('created_at');
  if(error)throw error;
  const ids=(staff||[]).map((x:any)=>x.id);
  if(!ids.length)return[];
  const [roleRows,links]=await Promise.all([
    db.from('roles').select('id,name,description'),
    db.from('user_roles').select('user_id,role_id').in('user_id',ids)
  ]);
  if(roleRows.error)throw roleRows.error;
  if(links.error)throw links.error;
  const rb=new Map((roleRows.data||[]).map((r:any)=>[r.id,r]));
  const um=new Map<string,any[]>();
  for(const link of links.data||[]){
    const role=rb.get(link.role_id);if(!role)continue;
    if(!um.has(link.user_id))um.set(link.user_id,[]);
    um.get(link.user_id)!.push(role);
  }
  return(staff||[]).map((u:any)=>({...u,roles:um.get(u.id)||[]}));
}
async function bootstrap(organizationId:string){
  const {data:org,error:oErr}=await db.from('organizations')
    .select('id,name,code,is_active')
    .eq('id',organizationId)
    .eq('is_active',true)
    .maybeSingle();
  if(oErr)throw oErr;

  const {data:units,error:uErr}=await db.from('organization_units')
    .select('id,organization_id,name,code,is_active')
    .eq('organization_id',organizationId)
    .eq('is_active',true)
    .order('name');
  if(uErr)throw uErr;
  const ids=(units||[]).map((x:any)=>x.id);

  const [rs,us,qs,pos]=await Promise.all([
    roles(),
    users(organizationId),
    db.from('staff_registration_requests')
      .select('id,organization_id,full_name,email,phone,provider,status,rejection_reason,requested_at,reviewed_at')
      .eq('organization_id',organizationId)
      .order('requested_at',{ascending:false}),
    ids.length
      ? db.from('staff_positions').select('id,organization_unit_id,name,code,is_active,sort_order').in('organization_unit_id',ids).eq('is_active',true).order('sort_order').order('name')
      : Promise.resolve({data:[],error:null})
  ]);
  if(qs.error)throw qs.error;
  if(pos.error)throw pos.error;
  return{
    roles:rs,users:us,requests:qs.data||[],
    organizations:org?[org]:[],
    organization_units:units||[],
    staff_positions:pos.data||[]
  };
}
async function roleIds(v:any){
  const ids=Array.isArray(v)?[...new Set(v.map((x:any)=>clean(x,80)).filter(Boolean))]:[];
  if(!ids.length)throw new Error('Выберите хотя бы одну роль.');
  const {data,error}=await db.from('roles').select('id').in('id',ids);
  if(error)throw error;
  if((data||[]).length!==ids.length)throw new Error('Одна или несколько ролей не найдены.');
  return ids;
}
async function setRoles(uid:string,ids:string[]){
  const {error:e1}=await db.from('user_roles').delete().eq('user_id',uid);
  if(e1)throw e1;
  const {error:e2}=await db.from('user_roles').insert(ids.map(role_id=>({user_id:uid,role_id})));
  if(e2)throw e2;
}
async function assignment(organizationId:string,departmentId:any,positionId:any){
  const department=clean(departmentId,80),position=clean(positionId,80);
  if(!department||!position)throw new Error('Выберите отдел и должность.');
  const [d,p]=await Promise.all([
    db.from('organization_units').select('id,organization_id,is_active').eq('id',department).maybeSingle(),
    db.from('staff_positions').select('id,organization_unit_id,name,is_active').eq('id',position).maybeSingle()
  ]);
  if(d.error)throw d.error;if(p.error)throw p.error;
  if(!d.data?.is_active||d.data.organization_id!==organizationId)throw new Error('TENANT_MISMATCH');
  if(!p.data?.is_active||p.data.organization_unit_id!==department)throw new Error('POSITION_DEPARTMENT_MISMATCH');
  return{departmentId:department,positionId:position,positionName:p.data.name};
}
async function staffInOrg(id:string,organizationId:string){
  const uid=clean(id,80);
  const {data:user,error}=await db.from('users')
    .select('id,auth_user_id,full_name,email,phone,is_active,organization_unit_id,position_id,position')
    .eq('id',uid)
    .maybeSingle();
  if(error)throw error;
  if(!user)throw new Error('Сотрудник не найден.');
  if(!user.organization_unit_id)throw new Error('TENANT_MISMATCH');
  const {data:unit,error:uErr}=await db.from('organization_units').select('organization_id').eq('id',user.organization_unit_id).maybeSingle();
  if(uErr)throw uErr;
  if(unit?.organization_id!==organizationId)throw new Error('TENANT_MISMATCH');
  return user;
}
function isMissingAuthUser(error:any){
  const m=String(error?.message||error||'');
  return error?.status===404||/user\s+not\s+found|not\s+found/i.test(m);
}
async function authById(id:any){
  const uid=clean(id,80);if(!uid)return null;
  const {data,error}=await db.auth.admin.getUserById(uid);
  if(error){if(isMissingAuthUser(error))return null;throw error}
  return data?.user||null;
}
async function createStaff(actorOrg:string,p:any){
  const name=clean(p?.full_name,200),email=clean(p?.email,240).toLowerCase(),phone=clean(p?.phone,80)||null;
  const pass=String(p?.password||''),ids=await roleIds(p?.role_ids);
  if(!name||!email||pass.length<6)throw new Error('Укажите ФИО, email и пароль не короче 6 символов.');
  const a=await assignment(actorOrg,p?.department_id,p?.position_id);
  const {data:existing,error:existingError}=await db.from('users').select('id').eq('email',email).maybeSingle();
  if(existingError)throw existingError;
  if(existing)throw new Error('Сотрудник с таким email уже существует.');

  const {data:authData,error:authErr}=await db.auth.admin.createUser({
    email,password:pass,email_confirm:true,user_metadata:{full_name:name}
  });
  if(authErr||!authData.user)throw authErr||new Error('Не удалось создать учётную запись.');

  let profileId:string|null=null;
  try{
    const {data:user,error:userErr}=await db.from('users').insert({
      auth_user_id:authData.user.id,full_name:name,email,phone,is_active:true,
      organization_unit_id:a.departmentId,position_id:a.positionId,position:a.positionName,
      updated_at:new Date().toISOString()
    }).select('id').single();
    if(userErr||!user)throw userErr||new Error('Не удалось создать профиль сотрудника.');
    profileId=user.id;
    await setRoles(profileId,ids);
    return(await users(actorOrg)).find((x:any)=>x.id===profileId)||{id:profileId};
  }catch(error){
    if(profileId)await db.from('users').delete().eq('id',profileId).catch(()=>{});
    await db.auth.admin.deleteUser(authData.user.id).catch(()=>{});
    throw error;
  }
}
async function updateStaff(actorOrg:string,id:string,p:any){
  const user=await staffInOrg(id,actorOrg);
  const a=await assignment(actorOrg,p?.department_id,p?.position_id);
  const name=clean(p?.full_name,200)||user.full_name,phone=clean(p?.phone,80)||null;
  const ids=await roleIds(p?.role_ids),active=typeof p?.is_active==='boolean'?p.is_active:user.is_active;
  const pass=String(p?.password||'');
  if(pass&&pass.length<6)throw new Error('Пароль должен содержать минимум 6 символов.');

  let authUser=await authById(user.auth_user_id);
  if(!authUser&&pass){
    const email=clean(user.email,240).toLowerCase();
    if(!email)throw new Error('У сотрудника не указан email для создания учётной записи.');
    const {data:created,error:createErr}=await db.auth.admin.createUser({
      email,password:pass,email_confirm:true,user_metadata:{full_name:name}
    });
    if(createErr||!created.user)throw createErr||new Error('Не удалось восстановить учётную запись входа.');
    authUser=created.user;
  }
  if(authUser){
    const patch:any={user_metadata:{...(authUser.user_metadata||{}),full_name:name}};
    if(pass)patch.password=pass;
    const {error:updateErr}=await db.auth.admin.updateUserById(authUser.id,patch);
    if(updateErr)throw updateErr;
  }

  const {error:updateProfile}=await db.from('users').update({
    auth_user_id:authUser?.id||null,full_name:name,phone,is_active:active,
    organization_unit_id:a.departmentId,position_id:a.positionId,position:a.positionName,
    updated_at:new Date().toISOString()
  }).eq('id',user.id);
  if(updateProfile)throw updateProfile;
  await setRoles(user.id,ids);
  return(await users(actorOrg)).find((x:any)=>x.id===user.id)||{id:user.id};
}
async function deleteStaff(actorId:string,actorOrg:string,id:string){
  const user=await staffInOrg(id,actorOrg);
  if(user.id===actorId)throw new Error('Нельзя удалить свою текущую учётную запись.');
  const authUser=await authById(user.auth_user_id);
  const {error:deleteErr}=await db.from('users').delete().eq('id',user.id);
  if(deleteErr)throw deleteErr;
  if(authUser){
    const {error:authDelete}=await db.auth.admin.deleteUser(authUser.id);
    if(authDelete)throw new Error('Профиль удалён, но не удалось удалить учётную запись входа: '+authDelete.message);
  }
  return{id:user.id,full_name:user.full_name,email:user.email};
}
async function approve(actorId:string,p:any){
  const ids=await roleIds(p?.role_ids);
  const requestId=clean(p?.request_id,80),department=clean(p?.department_id,80),position=clean(p?.position_id,80);
  if(!requestId||!department||!position)throw new Error('Заполните отдел и должность.');
  const {data,error}=await db.rpc('staff_admin_approve_registration_system',{
    p_actor_user_id:actorId,p_request_id:requestId,p_role_ids:ids,p_department_id:department,p_position_id:position
  });
  if(error)throw error;
  return data;
}
async function reject(actorId:string,p:any){
  const requestId=clean(p?.request_id,80);
  if(!requestId)throw new Error('Заявка не указана.');
  const {data,error}=await db.rpc('staff_admin_reject_registration_system',{
    p_actor_user_id:actorId,p_request_id:requestId,p_reason:clean(p?.reason,1000)||null
  });
  if(error)throw error;
  return data;
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors(req)});
  if(req.method!=='POST')return json(req,{success:false,error:'METHOD_NOT_ALLOWED'},405);
  try{
    const g=await guard(req);
    if('e' in g)return json(req,{success:false,error:g.e},g.s);
    const body=await req.json().catch(()=>({}));
    const action=clean(body?.action,40);
    const actorId=g.profile.id,orgId=g.organizationId;
    if(action==='bootstrap')return json(req,{success:true,...await bootstrap(orgId)});
    if(action==='roles')return json(req,{success:true,roles:await roles()});
    if(action==='list')return json(req,{success:true,users:await users(orgId)});
    if(action==='create')return json(req,{success:true,user:await createStaff(orgId,body?.payload||{})},201);
    if(action==='update')return json(req,{success:true,user:await updateStaff(orgId,body?.user_id,body?.payload||{})});
    if(action==='delete')return json(req,{success:true,user:await deleteStaff(actorId,orgId,body?.user_id)});
    if(action==='approve')return json(req,{success:true,result:await approve(actorId,body?.payload||{})});
    if(action==='reject')return json(req,{success:true,result:await reject(actorId,body?.payload||{})});
    return json(req,{success:false,error:'UNKNOWN_ACTION'},400);
  }catch(error:any){
    console.error(error);
    const message=String(error?.message||'Ошибка управления сотрудниками.');
    const status=/TENANT_MISMATCH/.test(message)?404:500;
    return json(req,{success:false,error:'STAFF_ADMIN_ERROR',message},status);
  }
});
