import express from 'express';

const supabaseUrl=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const publishableKey=process.env.SUPABASE_PUBLISHABLE_KEY||'';
const installed=Symbol.for('a4print.supabase.storage.proxy');
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
    const path=String(req.originalUrl||'').replace(/^\/api\/v1\/supabase/,'');
    if(!/^\/storage\/v1(?:\/|\?|$)/.test(path))return res.status(400).json({success:false,error:'SUPABASE_STORAGE_PATH_DENIED'});

    const upstream=new URL(path,supabaseUrl);
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

express.application.use=function patchedSupabaseStorageUse(...args){
  const route=typeof args[0]==='string'?args[0]:'';
  if(route==='/api/v1/supabase'&&!this[installed]){
    this[installed]=true;
    originalUse.call(this,
      '/api/v1/supabase/storage/v1',
      express.raw({type:'*/*',limit:'52mb'}),
      storageProxy
    );
  }
  return originalUse.apply(this,args);
};
