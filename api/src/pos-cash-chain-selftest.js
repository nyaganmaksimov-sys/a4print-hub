import { createClient } from '@supabase/supabase-js';
import { createRetailSale, createRetailReturn, getRetailShiftStatus } from './moysklad.js';
import { calculateCashBalance, idOf, msRequest } from './pos-cash-ledger.js';
import { syncMoySkladReceipts } from './moysklad-receipt-sync.js';

const KEY='cash_chain_4210_4235_4210_4110_20260908';
const token=process.env.MOYSKLAD_TOKEN;
const url=process.env.SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const service=url&&key?createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const internalPort=Number(process.env.MOBILE_INTERNAL_API_PORT||3001);
const port=Number(process.env.PORT||3000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const r2=v=>Math.round(Number(v||0)*100)/100;

async function state(){const q=await service.from('settings').select('value').eq('key',KEY).maybeSingle();if(q.error)throw q.error;return q.data?.value||null}
async function save(value){const q=await service.from('settings').upsert({key:KEY,value,updated_at:new Date().toISOString()},{onConflict:'key'});if(q.error)throw q.error}
async function balance(){const x=await calculateCashBalance({token,service});if(x.requires_baseline||!x.available)throw new Error('CASH_BALANCE_UNAVAILABLE');return{amount:r2(x.cash),source:x.source||null}}
async function waitBalance(expected){let last=null;for(let i=0;i<12;i++){last=await balance();if(Math.abs(last.amount-expected)<0.005)return last;await sleep(2000)}throw new Error(`BALANCE_MISMATCH expected=${expected} actual=${last?.amount}`)}
async function openShiftEntity(){const list=await msRequest(token,'/entity/retailshift?limit=100&order=created,desc');const row=(list?.rows||[]).find(x=>!x.closeDate);if(!row)throw new Error('SHIFT_NOT_OPEN');const id=idOf(row);return id?msRequest(token,`/entity/retailshift/${encodeURIComponent(id)}`):row}
function msMoment(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace('T',' ')}
async function context(){
  const orgQ=await service.from('organizations').select('id').eq('code','A4PRINT').single();if(orgQ.error)throw orgQ.error;
  const org=orgQ.data;
  const accountQ=await service.from('cash_accounts').select('id,name').eq('organization_id',org.id).eq('account_type','CASH').eq('is_active',true).limit(1).maybeSingle();if(accountQ.error)throw accountQ.error;if(!accountQ.data)throw new Error('CASH_ACCOUNT_NOT_FOUND');
  const itemQ=await service.from('catalog_items').select('id,name,external_href,item_type').eq('organization_id',org.id).eq('is_active',true).eq('name','Печать/Ксерокопия чб. А4 текст').not('external_href','is',null).limit(1).maybeSingle();if(itemQ.error)throw itemQ.error;if(!itemQ.data)throw new Error('TEST_SERVICE_NOT_FOUND');
  const userQ=await service.from('users').select('id,full_name,email').eq('email','3333347@bk.ru').eq('is_active',true).maybeSingle();if(userQ.error)throw userQ.error;if(!userQ.data)throw new Error('OPERATOR_NOT_FOUND');
  return{org,account:accountQ.data,item:itemQ.data,operator:userQ.data};
}
async function waitSale(msId){for(let i=0;i<8;i++){const q=await service.from('pos_sales').select('*').eq('moysklad_sale_id',msId).maybeSingle();if(q.error)throw q.error;if(q.data)return q.data;await syncMoySkladReceipts({days:2,maxSales:300});await sleep(1000)}throw new Error('SALE_NOT_IMPORTED')}
async function recordReturn(ctx,saleRow,ret,amount){
  const shiftId=ret.retailShift?.id||ret.retailShift?.meta?.href?.split('/').pop()||saleRow.moysklad_shift_id||null;
  let shiftSessionId=null;if(shiftId){const q=await service.from('pos_shift_sessions').select('id').eq('organization_id',ctx.org.id).eq('moysklad_shift_id',shiftId).limit(1).maybeSingle();if(q.error)throw q.error;shiftSessionId=q.data?.id||null}
  const items=[{position_id:`selftest:${ctx.item.id}`,catalog_id:ctx.item.id,name:ctx.item.name,qty:1,price:25}];
  const q=await service.from('pos_returns').insert({organization_id:ctx.org.id,shift_session_id:shiftSessionId,pos_sale_id:saleRow.id,moysklad_return_id:idOf(ret),moysklad_return_name:ret.name||null,operator_id:ctx.operator.id,cash_account_id:ctx.account.id,payment_method:'Наличные',amount,items,reason:'Контрольный тест A4PRINT HUB: возврат 25 ₽',returned_at:new Date().toISOString(),sync_status:'SYNCED'}).select('id').single();if(q.error)throw q.error;
  const cat=await service.from('cash_categories').select('id').eq('organization_id',ctx.org.id).eq('direction','EXPENSE').eq('name','Возврат клиенту').maybeSingle();if(cat.error)throw cat.error;
  const cash=await service.from('cash_transactions').upsert({organization_id:ctx.org.id,cash_account_id:ctx.account.id,category_id:cat.data?.id||null,direction:'EXPENSE',amount,payment_method:'Наличные',description:`Контрольный тест: возврат по продаже ${saleRow.moysklad_sale_name||saleRow.moysklad_sale_id}`,transaction_date:new Date().toISOString().slice(0,10),created_by:ctx.operator.id,external_source:'MOYSKLAD_POS_RETURN',external_id:idOf(ret)},{onConflict:'organization_id,external_source,external_id,direction',ignoreDuplicates:true});if(cash.error)throw cash.error;
  return q.data.id;
}
async function makeReturn(ctx,saleRow,reason){
  const ret=await createRetailReturn({token,saleId:saleRow.moysklad_sale_id,items:[{id:ctx.item.id,name:ctx.item.name,qty:1,price:25,external_href:ctx.item.external_href,external_type:'service'}],paymentMethod:'Наличные',operatorName:ctx.operator.full_name,reason});
  const hubId=await recordReturn(ctx,saleRow,ret,25);return{ret,hubId};
}
async function cashOut(ctx){
  const shift=await openShiftEntity();const before=await balance();if(before.amount<100)throw new Error('CASH_OUT_EXCEEDS_BALANCE');
  const template=await msRequest(token,'/entity/retaildrawercashout/new',{method:'PUT',body:JSON.stringify({retailShift:{meta:shift.meta}})}).catch(()=>null);
  const payload={retailShift:{meta:shift.meta},sum:10000,moment:msMoment(),applicable:true,description:`A4PRINT KASSA · Изъятие денег · Оператор: ${ctx.operator.full_name} · Причина: Контрольный тест A4PRINT HUB: изъятие 100 ₽`};
  if(template?.organization?.meta)payload.organization={meta:template.organization.meta};else if(shift.organization?.meta)payload.organization={meta:shift.organization.meta};if(template?.agent?.meta)payload.agent={meta:template.agent.meta};if(template?.owner?.meta)payload.owner={meta:template.owner.meta};
  const op=await msRequest(token,'/entity/retaildrawercashout',{method:'POST',body:JSON.stringify(payload)});const opId=idOf(op);if(!opId)throw new Error('CASH_OUT_NO_ID');
  const log=await service.from('pos_cash_operations').upsert({operator_id:ctx.operator.id,moysklad_shift_id:String(idOf(shift)),moysklad_operation_id:String(opId),moysklad_operation_name:op.name||null,operation_type:'CASH_OUT',amount:100,reason:'Контрольный тест A4PRINT HUB: изъятие 100 ₽'},{onConflict:'moysklad_operation_id'});if(log.error)throw log.error;return op;
}
async function run(){
  const prior=await state();if(prior?.status==='PASS'||prior?.status==='RUNNING'||prior?.status==='ABORTED')return;
  const trace={status:'RUNNING',started_at:new Date().toISOString(),steps:[]};await save(trace);let sale=null,saleRow=null,returned=false;
  try{
    const ctx=await context();trace.operator=ctx.operator.full_name;trace.item=ctx.item.name;trace.account=ctx.account.name;
    const shift=await getRetailShiftStatus(token);trace.shift={preexisting_open:Boolean(shift.shift),id:shift.shift?.id||null,name:shift.shift?.name||null};if(!shift.shift)throw new Error('SHIFT_NOT_OPEN');
    const start=await balance();trace.steps.push({step:'start',expected:4210,actual:start.amount,source:start.source});if(Math.abs(start.amount-4210)>=0.005){trace.status='ABORTED';trace.error=`START_BALANCE_MISMATCH expected=4210 actual=${start.amount}`;return}
    sale=await createRetailSale({token,items:[{id:ctx.item.id,name:ctx.item.name,qty:1,price:25,external_href:ctx.item.external_href,external_type:'service'}],paymentMethod:'Наличные',operatorName:ctx.operator.full_name});trace.sale={moysklad_id:idOf(sale),name:sale.name||null,sum:r2(Number(sale.sum||0)/100)};if(!trace.sale.moysklad_id)throw new Error('SALE_NO_ID');
    const b1=await waitBalance(4235);trace.steps.push({step:'sale_25',expected:4235,actual:b1.amount,source:b1.source});saleRow=await waitSale(trace.sale.moysklad_id);trace.sale.hub_id=saleRow.id;
    const rr=await makeReturn(ctx,saleRow,'Контрольный тест A4PRINT HUB: возврат 25 ₽');returned=true;trace.return={hub_id:rr.hubId,moysklad_id:idOf(rr.ret),name:rr.ret.name||null,amount:25};
    const b2=await waitBalance(4210);trace.steps.push({step:'return_25',expected:4210,actual:b2.amount,source:b2.source});const op=await cashOut(ctx);trace.cashout={moysklad_id:idOf(op),name:op.name||null,amount:100};
    const b3=await waitBalance(4110);trace.steps.push({step:'cashout_100',expected:4110,actual:b3.amount,source:b3.source});trace.status='PASS';
  }catch(e){trace.status='FAIL';trace.error=String(e?.message||e);if(sale&&!returned){try{const ctx=await context();saleRow=saleRow||await waitSale(idOf(sale));const rr=await makeReturn(ctx,saleRow,'Автовозврат после остановки контрольного теста A4PRINT HUB');trace.compensation={success:true,moysklad_id:idOf(rr.ret),amount:25};trace.compensation.restored_balance=(await waitBalance(4210)).amount}catch(re){trace.compensation={success:false,error:String(re?.message||re)}}}}
  finally{trace.finished_at=new Date().toISOString();await save(trace);console.log('[A4 CASH CHAIN SELFTEST]',JSON.stringify(trace))}
}

if(service&&token&&port===internalPort)setTimeout(()=>run().catch(async e=>{await save({status:'FAIL',error:String(e?.message||e),finished_at:new Date().toISOString()});console.error('[A4 CASH CHAIN SELFTEST]',e)}),18000);
