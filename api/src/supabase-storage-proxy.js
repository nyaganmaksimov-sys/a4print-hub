import express from 'express';
import path from 'node:path';

const supabaseUrl=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const publishableKey=process.env.SUPABASE_PUBLISHABLE_KEY||'';
const installed=Symbol.for('a4print.supabase.storage.proxy');
const sawSupabaseRoute=Symbol.for('a4print.saw.supabase.route');
const staticInstalled=Symbol.for('a4print.render.static.installed');
const originalUse=express.application.use;

const requestHeaders=new Set([
  'authorization','apikey','content-type','accept','prefer','range','range-unit',
  'x-client-info','x-supabase-api-version','x-upsert','cache-control',
  'if-match','if-none-match','if-modified-since','if-unmodified-since'
]);
const responseHeaders=new Set([
  'content-type','content-range','content-length','etag','last-modified','location',
  'cache-control','www-authenticate','x-supabase-api-version'
]);

async function storageProxy(req,res){
  try{
    if(!supabaseUrl)return res.status(503).json({success:false,error:'SUPABASE_PROXY_NOT_CONFIGURED'});
    const requestPath=String(req.originalUrl||'').replace(/^\/api\/v1\/supabase/,'');
    if(!/^\/storage\/v1(?:\/|\?|$)/.test(requestPath))return res.status(400).json({success:false,error:'SUPABASE_STORAGE_PATH_DENIED'});

    const upstream=new URL(requestPath,supabaseUrl);
    if(upstream.origin!==new URL(supabaseUrl).origin)return res.status(400).json({success:false,error:'SUPABASE_STORAGE_PATH_DENIED'});

    const headers={};
    for(const [name,value] of Object.entries(req.headers)){
      if(value!=null&&requestHeaders.has(name.toLowerCase()))headers[name]=value;
    }
    if(!headers.apikey&&publishableKey)headers.apikey=publishableKey;

    const method=req.method.toUpperCase();
    const body=['GET','HEAD'].includes(method)?undefined:req.body;
    const response=await fetch(upstream,{method,headers,body,redirect:'manual',signal:AbortSignal.timeout(70000)});
    res.status(response.status);
    response.headers.forEach((value,key)=>{if(responseHeaders.has(key.toLowerCase()))res.setHeader(key,value)});
    res.setHeader('Cache-Control','no-store');
    const payload=Buffer.from(await response.arrayBuffer());
    return res.send(payload);
  }catch(error){
    console.error('[supabase storage proxy]',error);
    return res.status(502).json({success:false,error:'SUPABASE_STORAGE_PROXY_FAILED',message:error.message});
  }
}

function installStaticFrontend(app){
  if(app[staticInstalled])return;
  app[staticInstalled]=true;
  const root=path.resolve(process.cwd(),'..');
  const blocked=/^\/(?:api|database|supabase|\.git|\.github)(?:\/|$)|^\/(?:\.env(?:\.|$)|README\.md$|CNAME$)/i;
  const deny=(req,res,next)=>blocked.test(req.path||'')?next():next();
  originalUse.call(app,(req,res,next)=>{
    if(blocked.test(req.path||''))return next();
    return express.static(root,{index:['index.html'],fallthrough:true,etag:true,maxAge:'5m'})(req,res,next);
  });
  console.log(`A4PRINT HUB static frontend enabled from ${root}`);
}

express.application.use=function patchedSupabaseStorageUse(...args){
  const route=typeof args[0]==='string'?args[0]:'';
  if(route==='/api/v1/supabase'&&!this[installed]){
    this[installed]=true;
    this[sawSupabaseRoute]=true;
    originalUse.call(this,
      '/api/v1/supabase/storage/v1',
      express.raw({type:'*/*',limit:'52mb'}),
      storageProxy
    );
  }else if(this[sawSupabaseRoute]&&!this[staticInstalled]&&typeof args[0]==='function'){
    installStaticFrontend(this);
  }
  return originalUse.apply(this,args);
};
