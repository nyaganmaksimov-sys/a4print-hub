import express from 'express';
import { createClient } from '@supabase/supabase-js';

const MS_BASE='https://api.moysklad.ru/api/remap/1.2';
const token=process.env.MOYSKLAD_TOKEN;
const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const installed=Symbol.for('a4print.pos.cash.operations.installed');

function clean(value,max=500){return String(value||'').trim().slice(0,max)}
function idOf(entity){return entity?.id||entity?.meta?.href?.split('/').pop()||null}
function msDate(){
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace('T',' ');
}
async function ms(path,options={}){
  if(!token)throw new Error('MOYSKLAD_NOT_CONFIGURED');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const r=await fetch(path.startsWith('http')?path:MS_BASE+path,{
      ...options,
      signal:controller.signal,
      headers:{Authorization:`Bearer ${token}`,Accept:'application/json;charset=utf-8','Content-Type':'application/json',...(options.headers||{})}
    });
    const text=await r.text();
    if(!r.ok)throw new Error(`MoySklad HTTP ${r.status}: ${text}`);
    return text?JSON.parse(text):null;
  }finally{clearTimeout(timer)}
}
async function auth(req){
  if(!service)return{error:'DATABASE_NOT_CONFIGURED'};
  const bearer=clean(req.headers.authorization,3000).replace(/^Bearer\s+/i,'');
  if(!bearer)return{error:'AUTH_REQUIRED'};
  const {data,error}=await service.auth.getUser(bearer);
  if(error||!data?.user)return{error:'INVALID_SESSION'};
  const {data:profile,error:pErr}=await service.from('users').select('id,full_name,email,is_active').eq('auth_user_id',data.user.id).maybeSingle();
  if(pErr)throw pErr;
  if(!profile||profile.is_active===false)return{error:'POS_ACCESS_REQUIRED'};
  const {data:roles,error:rErr}=await service.from('user_roles').select('roles(name)').eq('user_id',profile.id);
  if(rErr)throw rErr;
  const names=(roles||[]).map(x=>x.roles?.name).filter(Boolean);
  if(!names.some(x=>x==='ADMIN'||x==='POS_OPERATOR'))return{error:'POS_ACCESS_REQUIRED'};
  return{user:data.user,profile,isAdmin:names.includes('ADMIN')};
}
async function selectedOperator(req,ctx){
  const requested=clean(req.body?.operator_id,80);
  if(!ctx.isAdmin||!requested)return ctx.profile;
  const {data,error}=await service.from('users').select('id,full_name,email,is_active').eq('id',requested).maybeSingle();
  if(error)throw error;
  return data?.is_active===false?ctx.profile:(data||ctx.profile);
}
async function openShift(){
  const list=await ms('/entity/retailshift?limit=100&order=created,desc');
  const rows=(list?.rows||[]).filter(x=>!x.closeDate);
  if(!rows.length)throw new Error('SHIFT_NOT_OPEN');
  const row=rows[0];
  const id=idOf(row);
  return id?await ms(`/entity/retailshift/${encodeURIComponent(id)}`):row;
}
async function createCashOut({amount,reason,operatorName}){
  const shift=await openShift();
  const shiftId=idOf(shift);
  if(!shiftId)throw new Error('SHIFT_NOT_OPEN');
  const template=await ms('/entity/retaildrawercashout/new',{
    method:'PUT',
    body:JSON.stringify({retailShift:{meta:shift.meta}})
  }).catch(()=>null);
  const payload={
    retailShift:{meta:shift.meta},
    organization:{meta:template?.organization?.meta||shift.organization?.meta},
    sum:Math.round(amount*100),
    moment:msDate(),
    applicable:true,
    description:`A4PRINT KASSA · Изъятие денег · Оператор: ${operatorName||'не указан'}${reason?` · Причина: ${reason}`:''}`
  };
  if(!payload.organization?.meta)delete payload.organization;
  if(template?.agent?.meta)payload.agent={meta:template.agent.meta};
  if(template?.owner?.meta)payload.owner={meta:template.owner.meta};
  const operation=await ms('/entity/retaildrawercashout',{method:'POST',body:JSON.stringify(payload)});
  return{shift,operation};
}

const originalListen=express.application.listen;
express.application.listen=function patchedCashOperationsListen(...args){
  if(!this[installed]){
    this[installed]=true;
    this.post('/api/v1/pos/cashout',async(req,res,next)=>{
      try{
        const ctx=await auth(req);
        if(ctx.error)return res.status(ctx.error.includes('AUTH')||ctx.error==='INVALID_SESSION'?401:403).json({success:false,error:ctx.error});
        if(!token)return res.status(503).json({success:false,error:'MOYSKLAD_NOT_CONFIGURED'});
        const amount=Number(req.body?.amount||0);
        const reason=clean(req.body?.reason,500);
        if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({success:false,error:'AMOUNT_REQUIRED',message:'Укажите сумму изъятия больше нуля.'});
        if(amount>10000000)return res.status(400).json({success:false,error:'AMOUNT_TOO_LARGE',message:'Слишком большая сумма изъятия.'});
        const operator=await selectedOperator(req,ctx);
        const result=await createCashOut({amount,reason,operatorName:operator?.full_name||operator?.email||ctx.user.email});
        const shiftId=idOf(result.shift);
        const opId=idOf(result.operation);
        if(service&&opId){
          await service.from('pos_cash_operations').upsert({
            operator_id:operator?.id||null,
            moysklad_shift_id:String(shiftId),
            moysklad_operation_id:String(opId),
            moysklad_operation_name:result.operation?.name||null,
            operation_type:'CASH_OUT',
            amount,
            reason:reason||null
          },{onConflict:'moysklad_operation_id'});
        }
        return res.json({success:true,operation:{id:opId,name:result.operation?.name||null,amount,reason:reason||null},shift:{id:shiftId,name:result.shift?.name||null}});
      }catch(error){
        const message=String(error?.message||error);
        if(message==='SHIFT_NOT_OPEN')return res.status(409).json({success:false,error:'SHIFT_NOT_OPEN',message:'Смена не открыта.'});
        return next(error);
      }
    });
  }
  return originalListen.apply(this,args);
};
