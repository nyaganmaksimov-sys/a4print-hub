import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = Number(process.env.PORT || 3000);
const innerPort = Number(process.env.USER_GATEWAY_INNER_PORT || 3001);
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken:false, persistSession:false } }) : null;

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map(v=>v.trim()).filter(Boolean) || true }));
app.use(express.json({ limit:'2mb' }));

const child = spawn(process.execPath, ['src/gateway.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT:String(innerPort), INTERNAL_API_PORT:String(innerPort + 1) },
  stdio:'inherit'
});
child.on('exit', code => { console.error('Inner gateway exited', code); process.exit(code || 1); });
process.on('SIGTERM',()=>child.kill('SIGTERM'));
process.on('SIGINT',()=>child.kill('SIGINT'));

async function requireAdmin(req,res,next){
  try{
    if(!supabase || !publishableKey) return res.status(503).json({success:false,error:'DATABASE_NOT_CONFIGURED'});
    const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!token) return res.status(401).json({success:false,error:'AUTH_REQUIRED'});
    const client=createClient(supabaseUrl,publishableKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{autoRefreshToken:false,persistSession:false}});
    const {data:{user},error}=await client.auth.getUser(token);
    if(error||!user) return res.status(401).json({success:false,error:'INVALID_SESSION'});
    const {data:isAdmin,error:rErr}=await client.rpc('has_role',{required_role:'ADMIN'});
    if(rErr) throw rErr;
    if(!isAdmin) return res.status(403).json({success:false,error:'ADMIN_REQUIRED'});
    req.authUser=user;
    next();
  }catch(e){next(e)}
}

async function ensureSystemRoles(){
  const {error}=await supabase.from('roles').upsert([
    {name:'POS_OPERATOR',description:'Кассир / оператор кассы A4-Принт'}
  ],{onConflict:'name'});
  if(error) throw error;
}

app.get('/api/v1/users/roles',requireAdmin,async(_req,res,next)=>{
  try{
    await ensureSystemRoles();
    const {data,error}=await supabase.from('roles').select('id,name,description').order('name');
    if(error) throw error;
    res.json({success:true,roles:data||[]});
  }catch(e){next(e)}
});

app.get('/api/v1/users',requireAdmin,async(_req,res,next)=>{
  try{
    const {data,error}=await supabase.from('users').select('id,auth_user_id,full_name,email,phone,is_active,created_at,user_roles(role_id,roles(id,name,description))').order('created_at',{ascending:false});
    if(error) throw error;
    const users=(data||[]).map(u=>({...u,roles:(u.user_roles||[]).map(x=>x.roles).filter(Boolean),user_roles:undefined}));
    res.json({success:true,users});
  }catch(e){next(e)}
});

app.post('/api/v1/users',requireAdmin,async(req,res,next)=>{
  try{
    const fullName=String(req.body?.full_name||'').trim();
    const email=String(req.body?.email||'').trim().toLowerCase();
    const phone=String(req.body?.phone||'').trim();
    const password=String(req.body?.password||'');
    const roleIds=Array.isArray(req.body?.role_ids)?[...new Set(req.body.role_ids.map(String))]:[];
    if(!fullName||!email||password.length<6||!roleIds.length) return res.status(400).json({success:false,error:'INVALID_USER_DATA',message:'Укажите имя, email, пароль от 6 символов и хотя бы одну роль.'});
    const {data:validRoles,error:roleErr}=await supabase.from('roles').select('id').in('id',roleIds);
    if(roleErr) throw roleErr;
    if((validRoles||[]).length!==roleIds.length) return res.status(400).json({success:false,error:'INVALID_ROLE'});
    const {data:authData,error:authErr}=await supabase.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:fullName}});
    if(authErr) throw authErr;
    const authUser=authData.user;
    try{
      const {data:profile,error:pErr}=await supabase.from('users').upsert({auth_user_id:authUser.id,full_name:fullName,email,phone:phone||null,is_active:true},{onConflict:'auth_user_id'}).select('id,auth_user_id,full_name,email,phone,is_active').single();
      if(pErr) throw pErr;
      const {error:urErr}=await supabase.from('user_roles').insert(roleIds.map(role_id=>({user_id:profile.id,role_id})));
      if(urErr) throw urErr;
      res.status(201).json({success:true,user:profile});
    }catch(e){await supabase.auth.admin.deleteUser(authUser.id).catch(()=>{});throw e}
  }catch(e){next(e)}
});

app.patch('/api/v1/users/:id',requireAdmin,async(req,res,next)=>{
  try{
    const {data:user,error:findErr}=await supabase.from('users').select('id,auth_user_id').eq('id',req.params.id).single();
    if(findErr) throw findErr;
    const updates={};
    if(typeof req.body?.full_name==='string'&&req.body.full_name.trim()) updates.full_name=req.body.full_name.trim();
    if(typeof req.body?.phone==='string') updates.phone=req.body.phone.trim()||null;
    if(typeof req.body?.is_active==='boolean') updates.is_active=req.body.is_active;
    if(Object.keys(updates).length){const {error}=await supabase.from('users').update({...updates,updated_at:new Date().toISOString()}).eq('id',user.id);if(error)throw error;}
    if(Array.isArray(req.body?.role_ids)){
      const roleIds=[...new Set(req.body.role_ids.map(String))];
      if(!roleIds.length) return res.status(400).json({success:false,error:'ROLE_REQUIRED',message:'У пользователя должна остаться хотя бы одна роль.'});
      const {data:validRoles,error:rErr}=await supabase.from('roles').select('id').in('id',roleIds);if(rErr)throw rErr;
      if((validRoles||[]).length!==roleIds.length) return res.status(400).json({success:false,error:'INVALID_ROLE'});
      const {error:dErr}=await supabase.from('user_roles').delete().eq('user_id',user.id);if(dErr)throw dErr;
      const {error:iErr}=await supabase.from('user_roles').insert(roleIds.map(role_id=>({user_id:user.id,role_id})));if(iErr)throw iErr;
    }
    const authUpdates={};
    if(typeof req.body?.password==='string'&&req.body.password){if(req.body.password.length<6)return res.status(400).json({success:false,error:'PASSWORD_TOO_SHORT'});authUpdates.password=req.body.password;}
    if(typeof req.body?.is_active==='boolean') authUpdates.ban_duration=req.body.is_active?'none':'876000h';
    if(Object.keys(authUpdates).length&&user.auth_user_id){const {error}=await supabase.auth.admin.updateUserById(user.auth_user_id,authUpdates);if(error)throw error;}
    res.json({success:true});
  }catch(e){next(e)}
});

app.use(async(req,res,next)=>{
  try{
    const url=`http://127.0.0.1:${innerPort}${req.originalUrl}`;
    const headers={...req.headers};delete headers.host;delete headers['content-length'];
    const method=req.method.toUpperCase();
    const response=await fetch(url,{method,headers,body:['GET','HEAD'].includes(method)?undefined:JSON.stringify(req.body??{})});
    res.status(response.status);response.headers.forEach((v,k)=>{if(!['content-encoding','transfer-encoding','content-length','connection'].includes(k.toLowerCase()))res.setHeader(k,v)});
    res.send(Buffer.from(await response.arrayBuffer()));
  }catch(e){next(e)}
});

app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({success:false,error:'INTERNAL_SERVER_ERROR',message:err.message})});
app.listen(port,()=>console.log(`A4PRINT HUB user gateway on ${port}; inner ${innerPort}`));
