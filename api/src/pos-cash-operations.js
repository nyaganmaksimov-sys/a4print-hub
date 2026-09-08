import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { calculateCashBalance, idOf, msRequest } from './pos-cash-ledger.js';

const token=process.env.MOYSKLAD_TOKEN;
const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const installed=Symbol.for('a4print.pos.cash.operations.installed');

function clean(value,max=500){return String(value||'').trim().slice(0,max)}
function msDate(){
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace('T',' ');
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
  const list=await msRequest(token,'/entity/retailshift?limit=100&order=created,desc');
  const rows=(list?.rows||[]).filter(x=>!x.closeDate);
  if(!rows.length)throw new Error('SHIFT_NOT_OPEN');
  const row=rows[0];
  const id=idOf(row);
  return id?await msRequest(token,`/entity/retailshift/${encodeURIComponent(id)}`):row;
}
async function currentBalance(){
  const before=await calculateCashBalance({token,service});
  if(before.requires_baseline)throw new Error('CASH_BASELINE_REQUIRED');
  if(!before.available||!Number.isFinite(Number(before.cash)))throw new Error('CASH_BALANCE_UNAVAILABLE');
  return before;
}
async function refreshBalance(fallback){
  try{
    const refreshed=await calculateCashBalance({token,service});
    if(refreshed.available&&Number.isFinite(Number(refreshed.cash)))return Number(refreshed.cash);
  }catch{}
  return Number(fallback);
}
async function createCashDocument({type,amount,reason,operatorName}){
  const isOut=type==='CASH_OUT';
  const shift=await openShift();
  const shiftId=idOf(shift);
  if(!shiftId)throw new Error('SHIFT_NOT_OPEN');
  const before=await currentBalance();
  if(isOut&&amount>Number(before.cash)+0.0001){
    const error=new Error('CASH_OUT_EXCEEDS_BALANCE');
    error.cashBalance=Number(before.cash);
    throw error;
  }

  const entity=isOut?'retaildrawercashout':'retaildrawercashin';
  const template=await msRequest(token,`/entity/${entity}/new`,{
    method:'PUT',
    body:JSON.stringify({retailShift:{meta:shift.meta}})
  }).catch(()=>null);
  const actionText=isOut?'Изъятие денег':'Внесение денег';
  const payload={
    retailShift:{meta:shift.meta},
    organization:{meta:template?.organization?.meta||shift.organization?.meta},
    sum:Math.round(amount*100),
    moment:msDate(),
    applicable:true,
    description:`A4PRINT KASSA · ${actionText} · Оператор: ${operatorName||'не указан'}${reason?` · Причина: ${reason}`:''}`
  };
  if(!payload.organization?.meta)delete payload.organization;
  if(template?.agent?.meta)payload.agent={meta:template.agent.meta};
  if(template?.owner?.meta)payload.owner={meta:template.owner.meta};
  const operation=await msRequest(token,`/entity/${entity}`,{method:'POST',body:JSON.stringify(payload)});
  const fallback=Number(before.cash)+(isOut?-amount:amount);
  const after=await refreshBalance(fallback);
  return{shift,operation,cashBefore:Number(before.cash),cashAfter:after};
}
async function logOperation({operator,shift,operation,type,amount,reason}){
  if(!service)return;
  const shiftId=idOf(shift);
  const opId=idOf(operation);
  if(!opId||!shiftId)return;
  const {error}=await service.from('pos_cash_operations').upsert({
    operator_id:operator?.id||null,
    moysklad_shift_id:String(shiftId),
    moysklad_operation_id:String(opId),
    moysklad_operation_name:operation?.name||null,
    operation_type:type,
    amount,
    reason:reason||null
  },{onConflict:'moysklad_operation_id'});
  if(error)console.warn('pos_cash_operations log failed',error.message);
}
function authError(res,code){
  const status=code.includes('AUTH')||code==='INVALID_SESSION'?401:403;
  return res.status(status).json({success:false,error:code});
}
function cashError(res,next,error){
  const message=String(error?.message||error);
  if(message==='SHIFT_NOT_OPEN')return res.status(409).json({success:false,error:'SHIFT_NOT_OPEN',message:'Смена не открыта.'});
  if(message==='CASH_BASELINE_REQUIRED')return res.status(409).json({success:false,error:'CASH_BASELINE_REQUIRED',message:'Сначала укажите фактический остаток наличных в Настройках кассы.'});
  if(message==='CASH_BALANCE_UNAVAILABLE')return res.status(503).json({success:false,error:'CASH_BALANCE_UNAVAILABLE',message:'Не удалось проверить текущий остаток наличных. Операция отменена для защиты кассы.'});
  if(message==='CASH_OUT_EXCEEDS_BALANCE')return res.status(409).json({success:false,error:'CASH_OUT_EXCEEDS_BALANCE',cash_balance:Number(error.cashBalance||0),message:`В кассе сейчас ${Number(error.cashBalance||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} ₽. Нельзя изъять больше.`});
  return next(error);
}
async function handleCashOperation(req,res,next,type){
  try{
    const ctx=await auth(req);
    if(ctx.error)return authError(res,ctx.error);
    if(!token)return res.status(503).json({success:false,error:'MOYSKLAD_NOT_CONFIGURED'});
    const amount=Number(req.body?.amount||0);
    const reason=clean(req.body?.reason,500);
    const title=type==='CASH_OUT'?'изъятия':'внесения';
    if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({success:false,error:'AMOUNT_REQUIRED',message:`Укажите сумму ${title} больше нуля.`});
    if(amount>10000000)return res.status(400).json({success:false,error:'AMOUNT_TOO_LARGE',message:`Слишком большая сумма ${title}.`});
    const operator=await selectedOperator(req,ctx);
    const result=await createCashDocument({type,amount,reason,operatorName:operator?.full_name||operator?.email||ctx.user.email});
    await logOperation({operator,shift:result.shift,operation:result.operation,type,amount,reason});
    return res.json({
      success:true,
      operation:{id:idOf(result.operation),name:result.operation?.name||null,type,amount,reason:reason||null},
      shift:{id:idOf(result.shift),name:result.shift?.name||null},
      cash_before:result.cashBefore,
      cash_after:result.cashAfter
    });
  }catch(error){return cashError(res,next,error)}
}

const originalListen=express.application.listen;
express.application.listen=function patchedCashOperationsListen(...args){
  if(!this[installed]){
    this[installed]=true;

    this.get('/api/v1/pos/cash-operations',async(req,res,next)=>{
      try{
        const ctx=await auth(req);
        if(ctx.error)return authError(res,ctx.error);
        const limit=Math.max(1,Math.min(100,Number(req.query?.limit||20)));
        const {data,error}=await service.from('pos_cash_operations')
          .select('id,operator_id,moysklad_shift_id,moysklad_operation_id,moysklad_operation_name,operation_type,amount,reason,created_at')
          .order('created_at',{ascending:false})
          .limit(limit);
        if(error)throw error;
        const operatorIds=[...new Set((data||[]).map(x=>x.operator_id).filter(Boolean))];
        let users=[];
        if(operatorIds.length){
          const result=await service.from('users').select('id,full_name,email').in('id',operatorIds);
          if(result.error)throw result.error;
          users=result.data||[];
        }
        const byId=new Map(users.map(x=>[x.id,x]));
        return res.json({success:true,operations:(data||[]).map(row=>({...row,operator:row.operator_id?byId.get(row.operator_id)||null:null}))});
      }catch(error){return next(error)}
    });

    this.post('/api/v1/pos/cashin',(req,res,next)=>handleCashOperation(req,res,next,'CASH_IN'));
    this.post('/api/v1/pos/cashout',(req,res,next)=>handleCashOperation(req,res,next,'CASH_OUT'));
  }
  return originalListen.apply(this,args);
};
