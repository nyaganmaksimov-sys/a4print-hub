// Server-side only. MOYSKLAD_TOKEN must never be exposed to admin/*.html or committed to git.
const BASE = 'https://api.moysklad.ru/api/remap/1.2';
const headers = token => ({ Authorization: `Bearer ${token}`, Accept: 'application/json;charset=utf-8', 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ms(token, path, options = {}) {
  const url = path.startsWith('http') ? path : BASE + path;
  const method = String(options.method || 'GET').toUpperCase();
  const attempts = method === 'GET' ? 3 : 1;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: { ...headers(token), ...(options.headers || {}) }
      });
      clearTimeout(timer);
      if (!r.ok) throw new Error(`MoySklad HTTP ${r.status}: ${await r.text()}`);
      return r.status === 204 ? null : r.json();
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      if (String(e?.message || '').startsWith('MoySklad HTTP ')) throw e;
      if (attempt < attempts) {
        await sleep(500 * attempt);
        continue;
      }
    }
  }

  const cause = lastError?.cause?.code || lastError?.cause?.message || lastError?.name || lastError?.message || 'unknown';
  throw new Error(`Не удалось соединиться с МойСклад (${method} ${url}): ${cause}. Повторите попытку через несколько секунд.`);
}

function salePrice(row){const p=Array.isArray(row.salePrices)?row.salePrices[0]:null;return p?Number(p.value||0)/100:0}
function itemType(type){return type==='service'?'SERVICE':'PRODUCT'}
function sku(row){return row.article||row.code||`MS-${row.id}`}
function msDate(value=new Date()){
  const d=value instanceof Date?value:new Date(value);
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function normalizeMsMoment(value){
  const m=String(value||'').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m?`${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`:null;
}
function addSecondsToMsMoment(value,seconds=1){
  const s=normalizeMsMoment(value);
  if(!s)return null;
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6])+Number(seconds||0)));
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function resolveRetailReturnMoment(templateMoment,demandMoment){
  const source=normalizeMsMoment(demandMoment);
  const suggested=normalizeMsMoment(templateMoment);
  if(suggested&&(!source||suggested>source))return suggested;
  if(source)return addSecondsToMsMoment(source,1);
  return suggested||msDate();
}
export async function fetchAssortment(token){if(!token)throw new Error('MOYSKLAD_TOKEN is not configured');const rows=[];let url=`${BASE}/entity/assortment?limit=1000`;while(url){const data=await ms(token,url);rows.push(...(data.rows||[]));url=data.meta?.nextHref||null}return rows}
export async function syncMoySkladCatalog({supabase,token,organizationId}){const sourceRows=await fetchAssortment(token);let created=0,updated=0;for(const row of sourceRows){const type=row.meta?.type;if(!['product','variant','service','bundle'].includes(type))continue;const payload={organization_id:organizationId,external_source:'MOYSKLAD',external_id:row.id,external_href:row.meta?.href||null,sku:sku(row),name:row.name||sku(row),item_type:itemType(type),article:row.article||null,barcode:row.barcodes?.[0]?.ean13||row.barcodes?.[0]?.ean8||row.barcodes?.[0]?.code128||null,unit:row.uom?.name||'шт',description:row.description||null,sale_price:salePrice(row),external_updated_at:row.updated||null,last_synced_at:new Date().toISOString(),is_active:row.archived!==true};const {data:existing,error:findError}=await supabase.from('catalog_items').select('id').eq('external_source','MOYSKLAD').eq('external_id',row.id).maybeSingle();if(findError)throw findError;if(existing){const {error}=await supabase.from('catalog_items').update(payload).eq('id',existing.id);if(error)throw error;updated++}else{const {error}=await supabase.from('catalog_items').insert(payload);if(error)throw error;created++}}return{received:sourceRows.length,created,updated}}
export async function fetchMoySkladStock(token){const data=await ms(token,'/report/stock/all?limit=1000');const map={};for(const row of data.rows||[]){const id=row.meta?.href?.split('/').pop();if(id)map[id]=Number(row.stock??row.quantity??0)}return map}

function metaId(entity){return entity?.id||entity?.meta?.href?.split('/').pop()||null}
function sameEntity(a,b){const ai=metaId(a),bi=metaId(b);return Boolean(ai&&bi&&ai===bi)}
function cents(value){return Number(value||0)/100}
function shiftTime(entity){
  const raw=entity?.openDate||entity?.moment||entity?.created||entity?.updated||'';
  const d=new Date(String(raw).replace(' ','T'));
  return Number.isFinite(d.getTime())?d.getTime():0;
}

async function retailBaseContext(token){
  const [stores,orgs]=await Promise.all([ms(token,'/entity/retailstore?limit=100'),ms(token,'/entity/organization?limit=100')]);
  const store=stores.rows?.find(x=>!x.archived)||stores.rows?.[0];
  const organization=orgs.rows?.find(x=>!x.archived)||orgs.rows?.[0];
  if(!store)throw new Error('В МойСклад не найдена активная точка продаж');
  if(!organization)throw new Error('В МойСклад не найдено юрлицо');
  return{store,organization};
}

async function latestOpenShift(token){
  const shifts=await ms(token,'/entity/retailshift?limit=100&order=created,desc');
  const rows=(shifts.rows||[]).filter(x=>!x.closeDate).sort((a,b)=>shiftTime(b)-shiftTime(a));
  if(!rows.length)return null;
  const row=rows[0];
  const id=metaId(row);
  if(!id)return row;
  try{return await ms(token,`/entity/retailshift/${encodeURIComponent(id)}`)}catch{return row}
}

async function fetchMetaEntity(token,entity){
  const href=entity?.meta?.href;
  if(!href)return entity||null;
  try{return await ms(token,href)}catch{return entity||null}
}

async function contextFromShift(token,shift){
  if(!shift)return null;
  const [store,organization]=await Promise.all([
    fetchMetaEntity(token,shift.retailStore),
    fetchMetaEntity(token,shift.organization)
  ]);
  if(store&&organization)return{shift,store,organization};
  const base=await retailBaseContext(token);
  return{shift,store:store||base.store,organization:organization||base.organization};
}

async function loadShiftOperations(token,shift){
  const embedded=Array.isArray(shift?.operations)?shift.operations:Array.isArray(shift?.operations?.rows)?shift.operations.rows:[];
  if(embedded.length){
    const out=[];
    for(const ref of embedded){
      const href=ref?.meta?.href;
      if(!href){out.push(ref);continue}
      try{out.push(await ms(token,href))}catch{out.push(ref)}
    }
    return out.filter(Boolean);
  }

  const href=shift?.meta?.href;
  if(!href)return[];
  const types=['retaildemand','retailsalesreturn','retaildrawercashin','retaildrawercashout'];
  const out=[];
  for(const type of types){
    try{
      const data=await ms(token,`/entity/${type}?limit=1000&filter=${encodeURIComponent(`retailShift=${href}`)}`);
      out.push(...(data?.rows||[]));
    }catch{}
  }
  return out;
}

function operationType(op){return String(op?.meta?.type||'').toLowerCase()}

async function shiftCashBalance(token,shift,store){
  const direct=[store?.cash,store?.cashBalance,store?.state?.cash,shift?.cash,shift?.cashBalance];
  for(const value of direct){
    const n=Number(value);
    if(Number.isFinite(n))return cents(n);
  }
  try{
    const report=await ms(token,'/report/money/bymoment');
    const orgId=metaId(shift?.organization);
    const rows=Array.isArray(report?.rows)?report.rows:[];
    const exact=rows.find(row=>!row.account&&(!orgId||metaId(row.organization)===orgId));
    const fallback=rows.find(row=>!row.account);
    if(exact||fallback)return cents((exact||fallback).balance||0);
  }catch{}
  return cents(shift?.receivedCash||0);
}

async function summarizeShift(token,shift,store){
  const operations=await loadShiftOperations(token,shift);
  const d={sales_count:0,sales_total:0,sales_cash:0,sales_cashless:0,returns_count:0,returns_total:0,returns_cash:0,returns_cashless:0,deposits_count:0,deposits_total:0,payouts_count:0,payouts_total:0};
  for(const op of operations){
    const type=operationType(op);
    if(type==='retaildemand'){
      d.sales_count++;
      d.sales_total+=cents(op.sum);
      d.sales_cash+=cents(op.cashSum);
      d.sales_cashless+=cents(Number(op.noCashSum||0)+Number(op.qrSum||0));
    }else if(type==='retailsalesreturn'){
      d.returns_count++;
      d.returns_total+=cents(op.sum);
      d.returns_cash+=cents(op.cashSum);
      d.returns_cashless+=cents(Number(op.noCashSum||0)+Number(op.qrSum||0));
    }else if(type==='retaildrawercashin'){
      d.deposits_count++;
      d.deposits_total+=cents(op.sum);
    }else if(type==='retaildrawercashout'){
      d.payouts_count++;
      d.payouts_total+=cents(op.sum);
    }
  }
  const hasProceedsCash=Number.isFinite(Number(shift?.proceedsCash));
  const hasProceedsNoCash=Number.isFinite(Number(shift?.proceedsNoCash));
  d.revenue_cash=hasProceedsCash?cents(shift.proceedsCash):Math.max(0,d.sales_cash-d.returns_cash);
  d.revenue_cashless=hasProceedsNoCash?cents(shift.proceedsNoCash):Math.max(0,d.sales_cashless-d.returns_cashless);
  d.revenue_total=d.revenue_cash+d.revenue_cashless;
  d.received_cash=cents(shift?.receivedCash||0);
  d.received_cashless=cents(shift?.receivedNoCash||0);
  d.cash_in_register=await shiftCashBalance(token,shift,store);
  d.source='MOYSKLAD_LIVE';
  return d;
}

async function findOpenShift(token,store){
  const shift=await latestOpenShift(token);
  if(!shift)return null;
  if(!store||sameEntity(shift.retailStore,store))return shift;
  return shift;
}

export async function getRetailShiftStatus(token){
  const current=await latestOpenShift(token);
  if(!current){
    const {store,organization}=await retailBaseContext(token);
    return{build:'20260905-mslive5',store:{id:store.id,name:store.name},organization:{id:organization.id,name:organization.name},shift:null,summary:null};
  }
  const {shift,store,organization}=await contextFromShift(token,current);
  const summary=await summarizeShift(token,shift,store);
  return{
    build:'20260905-mslive5',
    store:{id:store?.id||metaId(shift.retailStore),name:store?.name||shift.retailStore?.name||null},
    organization:{id:organization?.id||metaId(shift.organization),name:organization?.name||shift.organization?.name||null},
    shift:{id:shift.id,name:shift.name,openDate:shift.openDate||shift.moment||shift.created,closeDate:shift.closeDate||null,updated:shift.updated||null},
    summary
  };
}

export async function openRetailShift(token,{operatorName}={}){
  const current=await latestOpenShift(token);
  if(current){const ctx=await contextFromShift(token,current);return{alreadyOpen:true,...ctx}}
  const {store,organization}=await retailBaseContext(token);
  const payload={organization:{meta:organization.meta},retailStore:{meta:store.meta},description:`Открыто из A4PRINT HUB${operatorName?` · ${operatorName}`:''}`};
  const shift=await ms(token,'/entity/retailshift',{method:'POST',body:JSON.stringify(payload)});
  return{alreadyOpen:false,shift,store,organization};
}

export async function closeRetailShift(token,{operatorName}={}){
  const current=await latestOpenShift(token);
  if(!current)throw new Error('Открытая смена не найдена');
  const {shift,store}=await contextFromShift(token,current);
  const id=metaId(shift);
  const closeDate=msDate();
  const updated=await ms(token,`/entity/retailshift/${id}`,{method:'PUT',body:JSON.stringify({closeDate,description:`Закрыто из A4PRINT HUB${operatorName?` · ${operatorName}`:''}`})});
  return{shift:updated||{...shift,closeDate},store};
}

export async function getRetailContext(token){
  const current=await latestOpenShift(token);
  if(!current)throw new Error('В МойСклад нет открытой розничной смены. Откройте смену в кассе и повторите оплату.');
  return contextFromShift(token,current);
}

export async function createRetailSale({token,items,paymentMethod,operatorName,customer}){if(!items?.length)throw new Error('Пустой чек');const {store,organization,shift}=await getRetailContext(token);const positions=items.map(x=>{if(!x.external_href)throw new Error(`Позиция ${x.name||x.id} не связана с МойСклад`);return{quantity:Number(x.qty),price:Math.round(Number(x.price)*100),discount:0,vat:0,assortment:{meta:{href:x.external_href,type:x.external_type||'product',mediaType:'application/json'}}}});const total=Math.round(items.reduce((s,x)=>s+Number(x.price)*Number(x.qty),0)*100);const customerText=customer?` · Клиент: ${customer.name||'без имени'}${customer.phone?` ${customer.phone}`:''}${customer.company?` (${customer.company})`:''}`:'';const payload={organization:{meta:organization.meta},retailStore:{meta:store.meta},retailShift:{meta:shift.meta},positions,payedSum:total,description:`A4PRINT HUB · Оператор: ${operatorName||'не указан'}${customerText} · ${paymentMethod||'Оплата'}`};return ms(token,'/entity/retaildemand',{method:'POST',body:JSON.stringify(payload)})}

export async function createRetailReturn({token,saleId,items,paymentMethod,operatorName,reason}){
  if(!saleId)throw new Error('Не указана исходная продажа');
  if(!items?.length)throw new Error('Не выбраны позиции для возврата');
  const {store,organization,shift}=await getRetailContext(token);
  const demandHref=`${BASE}/entity/retaildemand/${saleId}`;
  let sourceDemand=null;
  try{sourceDemand=await ms(token,demandHref)}catch(e){throw new Error(`Не удалось прочитать исходную продажу ${saleId}: ${e.message}`)}
  let template=null;
  try{template=await ms(token,'/entity/retailsalesreturn/new',{method:'PUT',body:JSON.stringify({demand:{meta:{href:demandHref,type:'retaildemand',mediaType:'application/json'}}})})}catch(e){throw new Error(`Не удалось подготовить возврат по продаже ${saleId}: ${e.message}`)}
  const positions=items.map(x=>{
    if(!x.external_href)throw new Error(`Позиция ${x.name||x.id} не связана с МойСклад`);
    return {quantity:Number(x.qty),price:Math.round(Number(x.price)*100),discount:0,vat:0,assortment:{meta:{href:x.external_href,type:x.external_type||'product',mediaType:'application/json'}}};
  });
  const total=Math.round(items.reduce((s,x)=>s+Number(x.price)*Number(x.qty),0)*100);
  const payment=String(paymentMethod||'Наличные').toLowerCase();
  const returnMoment=resolveRetailReturnMoment(template?.moment,sourceDemand?.moment);
  const payload={
    organization:{meta:template?.organization?.meta||sourceDemand?.organization?.meta||organization.meta},
    retailStore:{meta:template?.retailStore?.meta||sourceDemand?.retailStore?.meta||store.meta},
    retailShift:{meta:shift.meta},
    demand:{meta:{href:demandHref,type:'retaildemand',mediaType:'application/json'}},
    positions,
    moment:returnMoment,
    cashSum:payment.includes('налич')?total:0,
    noCashSum:(payment.includes('карт')||payment.includes('банк'))?total:0,
    qrSum:payment.includes('сбп')?total:0,
    description:`A4PRINT HUB · Возврат · Оператор: ${operatorName||'не указан'}${reason?` · Причина: ${reason}`:''}`
  };
  if(template?.store?.meta)payload.store={meta:template.store.meta};
  else if(sourceDemand?.store?.meta)payload.store={meta:sourceDemand.store.meta};
  if(template?.agent?.meta)payload.agent={meta:template.agent.meta};
  else if(sourceDemand?.agent?.meta)payload.agent={meta:sourceDemand.agent.meta};
  return ms(token,'/entity/retailsalesreturn',{method:'POST',body:JSON.stringify(payload)});
}
