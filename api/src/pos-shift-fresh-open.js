import express from 'express';

const token=process.env.MOYSKLAD_TOKEN;
const BASE='https://api.moysklad.ru/api/remap/1.2';

function moscowNow(){
  return new Intl.DateTimeFormat('sv-SE',{
    timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }).format(new Date()).replace('T',' ');
}

function timeOf(value){
  const d=new Date(String(value||'').replace(' ','T'));
  return Number.isFinite(d.getTime())?d.getTime():0;
}

async function ms(path,options={}){
  if(!token)return null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(path.startsWith('http')?path:BASE+path,{
      ...options,
      signal:controller.signal,
      headers:{Authorization:`Bearer ${token}`,Accept:'application/json;charset=utf-8','Content-Type':'application/json',...(options.headers||{})}
    });
    if(!r.ok)throw new Error(`MoySklad HTTP ${r.status}: ${await r.text()}`);
    return r.status===204?null:r.json();
  }finally{clearTimeout(timer)}
}

async function closeStaleOpenShifts(operatorName){
  const list=await ms('/entity/retailshift?limit=100&order=created,desc');
  const open=(list?.rows||[]).filter(x=>!x.closeDate).sort((a,b)=>timeOf(b.openDate||b.created)-timeOf(a.openDate||a.created));
  if(!open.length)return;

  // A repeated click/request immediately after creating a shift must not close
  // the shift that the first request has just created. In that case there is
  // already a valid current A4PRINT shift, so the original open handler can
  // safely attach to it instead of cleaning anything up.
  const current=open[0];
  const age=Date.now()-timeOf(current.openDate||current.created);
  const own=String(current.description||'').includes('A4PRINT HUB');
  if(own&&age>=0&&age<30000)return;

  // More than one historical OPEN shift can remain in MoySklad after network
  // failures or legacy versions of KASSA. Closing only the newest stale row
  // leaves older rows OPEN forever and makes the active shift ambiguous. Before
  // creating a fresh shift, close every stale OPEN shift returned by MoySklad.
  const closeDate=moscowNow();
  const description=`Закрыто перед новой сменой A4PRINT KASSA${operatorName?` · ${operatorName}`:''}`;
  for(const shift of open){
    const id=shift.id||shift.meta?.href?.split('/').pop();
    if(!id)continue;
    await ms(`/entity/retailshift/${encodeURIComponent(id)}`,{
      method:'PUT',
      body:JSON.stringify({closeDate,description})
    });
  }
}

const originalPost=express.application.post;
express.application.post=function patchedFreshShiftPost(path,...handlers){
  if(path==='/api/v1/pos/shift/open'&&handlers.length){
    const index=handlers.length-1;
    const originalHandler=handlers[index];
    handlers[index]=async function freshShiftHandler(req,res,next){
      try{
        const operatorName=String(req.body?.operator_name||req.authUser?.email||'').trim();
        await closeStaleOpenShifts(operatorName);
        return originalHandler(req,res,next);
      }catch(error){return next(error)}
    };
  }
  return originalPost.call(this,path,...handlers);
};
