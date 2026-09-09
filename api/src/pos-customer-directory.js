import express from 'express';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const installed=Symbol.for('a4print.pos.customer.directory.installed');
const clean=(v,max=200)=>String(v??'').trim().slice(0,max);

async function authorize(req){
  if(!service)return{error:'DATABASE_NOT_CONFIGURED'};
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!token)return{error:'AUTH_REQUIRED'};
  const {data,error}=await service.auth.getUser(token);
  if(error||!data?.user)return{error:'INVALID_SESSION'};
  const {data:profile,error:pErr}=await service.from('users').select('id,is_active').eq('auth_user_id',data.user.id).maybeSingle();
  if(pErr)throw pErr;
  if(!profile||profile.is_active===false)return{error:'POS_ACCESS_REQUIRED'};
  const {data:rows,error:rErr}=await service.from('user_roles').select('roles(name)').eq('user_id',profile.id);
  if(rErr)throw rErr;
  const roles=(rows||[]).map(x=>x.roles?.name).filter(Boolean);
  if(!roles.some(r=>['ADMIN','MANAGER','POS_OPERATOR'].includes(r)))return{error:'POS_ACCESS_REQUIRED'};
  return{user:data.user,profile};
}

const originalListen=express.application.listen;
express.application.listen=function patchedCustomerDirectoryListen(...args){
  if(!this[installed]){
    this[installed]=true;
    this.get('/api/v1/pos/customer-directory',async(req,res,next)=>{
      try{
        const auth=await authorize(req);
        if(auth.error){
          const status=auth.error==='DATABASE_NOT_CONFIGURED'?503:/AUTH|INVALID_SESSION/.test(auth.error)?401:403;
          return res.status(status).json({success:false,error:auth.error});
        }
        const q=clean(req.query.q,100).replace(/[,%()]/g,' ');
        let query=service.from('customers').select('id,full_name,company_name,email,phone,notes,created_at,updated_at');
        if(q.length>=1)query=query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,company_name.ilike.%${q}%`);
        const {data,error}=await query.order('updated_at',{ascending:false}).limit(q?50:100);
        if(error)throw error;
        return res.json({success:true,customers:(data||[]).map(c=>({id:c.id,full_name:c.full_name||'',company_name:c.company_name||'',email:c.email||'',phone:c.phone||'',notes:c.notes||''}))});
      }catch(error){next(error)}
    });
  }
  return originalListen.apply(this,args);
};
