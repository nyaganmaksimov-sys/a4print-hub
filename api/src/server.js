import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { syncMoySkladCatalog } from './moysklad.js';

const app=express();const port=Number(process.env.PORT||3000);
app.use(cors({origin:process.env.CORS_ORIGIN?.split(',').map(v=>v.trim()).filter(Boolean)||true}));app.use(express.json({limit:'1mb'}));
const supabaseUrl=process.env.SUPABASE_URL,supabaseKey=process.env.SUPABASE_SERVICE_ROLE_KEY,publishableKey=process.env.SUPABASE_PUBLISHABLE_KEY;
const supabase=supabaseUrl&&supabaseKey?createClient(supabaseUrl,supabaseKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
app.get('/api/v1/health',(_req,res)=>res.json({success:true,service:'a4print-hub-api',status:'ok',databaseConfigured:Boolean(supabase),moyskladConfigured:Boolean(process.env.MOYSKLAD_TOKEN)}));

async function requireAdmin(req,res,next){
  try{
    if(!supabaseUrl||!publishableKey)return res.status(503).json({success:false,error:'AUTH_NOT_CONFIGURED'});
    const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!token)return res.status(401).json({success:false,error:'AUTH_REQUIRED'});
    const authClient=createClient(supabaseUrl,publishableKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{autoRefreshToken:false,persistSession:false}});
    const {data:{user},error:userError}=await authClient.auth.getUser(token);
    if(userError||!user)return res.status(401).json({success:false,error:'INVALID_SESSION'});
    const {data:isAdmin,error:roleError}=await authClient.rpc('has_role',{required_role:'ADMIN'});
    if(roleError){console.error('Admin role RPC error:',roleError);return res.status(500).json({success:false,error:'ROLE_CHECK_FAILED',message:roleError.message});}
    if(!isAdmin)return res.status(403).json({success:false,error:'ADMIN_REQUIRED'});
    req.authUser=user;
    next();
  }catch(e){next(e)}
}

app.post('/api/v1/integrations/moysklad/sync',requireAdmin,async(req,res,next)=>{try{if(!supabase)return res.status(503).json({success:false,error:'DATABASE_NOT_CONFIGURED'});if(!process.env.MOYSKLAD_TOKEN)return res.status(503).json({success:false,error:'MOYSKLAD_NOT_CONFIGURED'});const {data:org,error}=await supabase.from('organizations').select('id').eq('code','A4PRINT').single();if(error)throw error;const {data:log}=await supabase.from('moysklad_sync_log').insert({organization_id:org.id,status:'RUNNING'}).select('id').single();try{const result=await syncMoySkladCatalog({supabase,token:process.env.MOYSKLAD_TOKEN,organizationId:org.id});if(log?.id)await supabase.from('moysklad_sync_log').update({status:'SUCCESS',finished_at:new Date().toISOString(),received_count:result.received,created_count:result.created,updated_count:result.updated}).eq('id',log.id);return res.json({success:true,...result})}catch(e){if(log?.id)await supabase.from('moysklad_sync_log').update({status:'ERROR',finished_at:new Date().toISOString(),error_message:String(e.message||e)}).eq('id',log.id);throw e}}catch(e){next(e)}});
app.get('/api/v1/integrations/moysklad/status',requireAdmin,async(_req,res,next)=>{try{const {data:org}=await supabase.from('organizations').select('id').eq('code','A4PRINT').single();const {data,error}=await supabase.from('moysklad_sync_log').select('*').eq('organization_id',org.id).order('started_at',{ascending:false}).limit(1).maybeSingle();if(error)throw error;res.json({success:true,configured:Boolean(process.env.MOYSKLAD_TOKEN),lastSync:data||null})}catch(e){next(e)}});
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({success:false,error:'INTERNAL_SERVER_ERROR',message:err.message})});
app.listen(port,()=>console.log(`A4PRINT HUB API listening on port ${port}`));