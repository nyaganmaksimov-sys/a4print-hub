import test from 'node:test';
import assert from 'node:assert/strict';
import { registerPosMoySkladInvoices } from '../src/pos-invoices.js';

const invoiceId='11111111-1111-4111-8111-111111111111';
const agentId='22222222-2222-4222-8222-222222222222';
const orgId='33333333-3333-4333-8333-333333333333';
const storeId='44444444-4444-4444-8444-444444444444';
const assortmentId='55555555-5555-4555-8555-555555555555';
const demandId='66666666-6666-4666-8666-666666666666';
const entity=(type,id)=>({meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/'+type+'/'+id,type,mediaType:'application/json'},id});
const fakeInvoice=(paid)=>({
  id:invoiceId,name:'TEST-100',sum:100000,payedSum:paid?100000:0,
  agent:entity('counterparty',agentId),organization:entity('organization',orgId),
  positions:{rows:[{quantity:1,price:100000,assortment:entity('service',assortmentId)}]},
  demands:[],vatEnabled:false,vatSum:0
});
function setup({paid=true}={}){
 const calls={demandPost:0,requests:[]};
 let demand=null;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname+new URL(url).search;
  calls.requests.push({path,method:options.method||'GET',body:options.body});
  let result;
  if(path.includes('/entity/invoiceout/'+invoiceId+'?expand='))result=fakeInvoice(paid);
  else if(path.includes('/entity/demand?'))result={rows:demand?[demand]:[]};
  else if(path.includes('/entity/factureout?'))result={rows:[]};
  else if(path.includes('/entity/store?'))result={rows:[{id:storeId,name:'TEST STORE'}]};
  else if(path.endsWith('/entity/demand')&&options.method==='POST'){
    calls.demandPost++;
    const body=JSON.parse(options.body);
    assert.equal(body.store.meta.href,entity('store',storeId).meta.href);
    assert.equal(body.invoicesOut[0].meta.href,entity('invoiceout',invoiceId).meta.href);
    demand={...entity('demand',demandId),name:'TEST-DEMAND',externalCode:body.externalCode};
    result=demand;
  }else throw Error('Unexpected mocked MoySklad request '+path);
  return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const routes={};
 const app={
  get(path,...handlers){routes['GET '+path]=handlers.at(-1)},
  post(path,...handlers){routes['POST '+path]=handlers.at(-1)}
 };
 registerPosMoySkladInvoices(app,(_req,_res,next)=>next(),()=>true,async()=>true,()=> 'mock-token');
 const invoke=async(method,path,{params={},body={}}={})=>{
  const res={statusCode:200,status(n){this.statusCode=n;return this},json(value){this.body=value;return this}};
  await routes[method+' '+path]({params,body},res,e=>{throw e});
  return res;
 };
 return{invoke,calls,restore(){globalThis.fetch=originalFetch}};
}
test('unpaid invoices cannot create closing shipments',async()=>{
 const x=setup({paid:false});
 try{
  const response=await x.invoke('POST','/api/v1/pos/invoices/:id/closing/prepare',{params:{id:invoiceId},body:{store_id:storeId}});
  assert.equal(response.statusCode,409);
  assert.equal(x.calls.demandPost,0);
 }finally{x.restore()}
});
test('fully paid invoice creates exactly one linked realization even on retry',async()=>{
 const x=setup();
 try{
  const run=()=>x.invoke('POST','/api/v1/pos/invoices/:id/closing/prepare',{params:{id:invoiceId},body:{store_id:storeId}});
  const first=await run();
  assert.equal(first.statusCode,200);
  assert.equal(first.body.demand.id,demandId);
  const second=await run();
  assert.equal(second.statusCode,200);
  assert.equal(second.body.demand.id,demandId);
  assert.equal(x.calls.demandPost,1);
 }finally{x.restore()}
});

test('cash invoice payment creates linked cashin once, then reuses operation id',async()=>{
 const opId='77777777-7777-4777-8777-777777777777';
 const payId='88888888-8888-4888-8888-888888888888';
 const originalFetch=globalThis.fetch;
 let doc=null,posted=0;
 globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname+new URL(url).search;
  let result;
  if(path.includes('/entity/cashin?'))result={rows:doc?[doc]:[]};
  else if(path.includes('/entity/invoiceout/'+invoiceId))result=fakeInvoice(false);
  else if(path.endsWith('/entity/cashin')&&options.method==='POST'){
   const body=JSON.parse(options.body);
   assert.equal(body.sum,50000);
   assert.equal(body.operations[0].linkedSum,50000);
   assert.equal(body.operations[0].meta.href,entity('invoiceout',invoiceId).meta.href);
   doc={...entity('cashin',payId),name:'TEST-CASHIN'};posted++;result=doc;
  }else throw Error('Unexpected '+path);
  return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  const routes={};
  const app={get(p,...h){routes['GET '+p]=h.at(-1)},post(p,...h){routes['POST '+p]=h.at(-1)}};
  registerPosMoySkladInvoices(app,()=>{},()=>true,async()=>true,()=> 'mock-token');
  const invoke=async()=>{
   const res={statusCode:200,status(n){this.statusCode=n;return this},json(x){this.body=x;return this}};
   await routes['POST /api/v1/pos/invoices/:id/confirm-payment'](
    {params:{id:invoiceId},body:{operation_id:opId,method:'CASH',amount:500}},res,e=>{throw e}
   );
   return res;
  };
  assert.equal((await invoke()).statusCode,201);
  assert.equal((await invoke()).body.reused,true);
  assert.equal(posted,1);
 }finally{globalThis.fetch=originalFetch}
});
test('a paid invoice rejects an additional financial document',async()=>{
 const opId='77777777-7777-4777-8777-777777777777';
 const originalFetch=globalThis.fetch;
 let posted=0;
 globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname+new URL(url).search;
  let result;
  if(path.includes('/entity/cashin?'))result={rows:[]};
  else if(path.includes('/entity/invoiceout/'+invoiceId))result=fakeInvoice(true);
  else if(options.method==='POST')posted++;
  else throw Error('Unexpected '+path);
  return new Response(JSON.stringify(result||{}),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  const routes={};
  const app={get(p,...h){routes['GET '+p]=h.at(-1)},post(p,...h){routes['POST '+p]=h.at(-1)}};
  registerPosMoySkladInvoices(app,()=>{},()=>true,async()=>true,()=> 'mock-token');
  const res={statusCode:200,status(n){this.statusCode=n;return this},json(x){this.body=x;return this}};
  await routes['POST /api/v1/pos/invoices/:id/confirm-payment']({params:{id:invoiceId},body:{operation_id:opId,method:'CASH',amount:1000}},res,e=>{throw e});
  assert.equal(res.statusCode,409);
  assert.equal(posted,0);
 }finally{globalThis.fetch=originalFetch}
});

test('payment options load actual organization accounts subresource',async()=>{
 const originalFetch=globalThis.fetch;
 let sawAccounts=false;
 globalThis.fetch=async(url)=>{
  const path=new URL(url).pathname;
  let result;
  if(path.endsWith('/entity/invoiceout/'+invoiceId))result=fakeInvoice(false);
  else if(path.endsWith('/entity/organization/'+orgId+'/accounts')){sawAccounts=true;result={rows:[{id:storeId,meta:entity('account',storeId).meta,accountNumber:'40702810000000000000',bankName:'TEST BANK'}]};}
  else throw Error('Unexpected request: '+path);
  return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  const routes={};const app={get(p,...h){routes[p]=h.at(-1)},post(){}};
  registerPosMoySkladInvoices(app,()=>{},()=>true,async()=>true,()=> 'mock-token');
  const res={statusCode:200,status(n){this.statusCode=n;return this},json(x){this.body=x;return this}};
  await routes['/api/v1/pos/invoices/:id/payment-options']({params:{id:invoiceId}},res,e=>{throw e});
  assert.equal(res.statusCode,200);
  assert.equal(res.body.bank_accounts.length,1);
  assert.equal(res.body.bank_accounts[0].id,storeId);
  assert.equal(sawAccounts,true);
 }finally{globalThis.fetch=originalFetch}
});
