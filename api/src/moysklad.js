// Server-side only. MOYSKLAD_TOKEN must never be exposed to admin/*.html or committed to git.
const BASE = 'https://api.moysklad.ru/api/remap/1.2';
const headers = token => ({ Authorization: `Bearer ${token}`, Accept: 'application/json;charset=utf-8', 'Content-Type': 'application/json' });

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
export async function fetchAssortment(token){if(!token)throw new Error('MOYSKLAD_TOKEN is not configured');const rows=[];let url=`${BASE}/entity/assortment?limit=1000`;while(url){const data=await ms(token,url);rows.push(...(data.rows||[]));url=data.meta?.nextHref||null}return rows}
export async function syncMoySkladCatalog({supabase,token,organizationId}){const sourceRows=await fetchAssortment(token);let created=0,updated=0;for(const row of sourceRows){const type=row.meta?.type;if(!['product','variant','service','bundle'].includes(type))continue;const payload={organization_id:organizationId,external_source:'MOYSKLAD',external_id:row.id,external_href:row.meta?.href||null,sku:sku(row),name:row.name||sku(row),item_type:itemType(type),article:row.article||null,barcode:row.barcodes?.[0]?.ean13||row.barcodes?.[0]?.ean8||row.barcodes?.[0]?.code128||null,unit:row.uom?.name||'шт',description:row.description||null,sale_price:salePrice(row),external_updated_at:row.updated||null,last_synced_at:new Date().toISOString(),is_active:row.archived!==true};const {data:existing,error:findError}=await supabase.from('catalog_items').select('id').eq('external_source','MOYSKLAD').eq('external_id',row.id).maybeSingle();if(findError)throw findError;if(existing){const {error}=await supabase.from('catalog_items').update(payload).eq('id',existing.id);if(error)throw error;updated++}else{const {error}=await supabase.from('catalog_items').insert(payload);if(error)throw error;created++}}return{received:sourceRows.length,created,updated}}
export async function fetchMoySkladStock(token){const data=await ms(token,'/report/stock/all?limit=1000');const map={};for(const row of data.rows||[]){const id=row.meta?.href?.split('/').pop();if(id)map[id]=Number(row.stock??row.quantity??0)}return map}

function metaId(entity){return entity?.id||entity?.meta?.href?.split('/').pop()||null}
function sameEntity(a,b){const ai=metaId(a),bi=metaId(b);return Boolean(ai&&bi&&ai===bi)}
async function retailBaseContext(token){const [stores,orgs]=await Promise.all([ms(token,'/entity/retailstore?limit=100'),ms(token,'/entity/organization?limit=100')]);const store=stores.rows?.find(x=>!x.archived)||stores.rows?.[0];const organization=orgs.rows?.find(x=>!x.archived)||orgs.rows?.[0];if(!store)throw new Error('В МойСклад не найдена активная точка продаж');if(!organization)throw new Error('В МойСклад не найдено юрлицо');return{store,organization}}
async function findOpenShift(token,store){const shifts=await ms(token,'/entity/retailshift?limit=100&order=created,desc');const rows=shifts.rows||[];return rows.find(x=>!x.closeDate&&sameEntity(x.retailStore,store))||rows.find(x=>!x.closeDate)||null}

export async function getRetailShiftStatus(token){const {store,organization}=await retailBaseContext(token);const shift=await findOpenShift(token,store);return{store:{id:store.id,name:store.name},organization:{id:organization.id,name:organization.name},shift:shift?{id:shift.id,name:shift.name,openDate:shift.openDate||shift.moment||shift.created,closeDate:shift.closeDate||null}:null}}

export async function openRetailShift(token,{operatorName}={}){const {store,organization}=await retailBaseContext(token);const current=await findOpenShift(token,store);if(current)return{alreadyOpen:true,shift:current,store,organization};const payload={organization:{meta:organization.meta},retailStore:{meta:store.meta},description:`Открыто из A4PRINT HUB${operatorName?` · ${operatorName}`:''}`};const shift=await ms(token,'/entity/retailshift',{method:'POST',body:JSON.stringify(payload)});return{alreadyOpen:false,shift,store,organization}}

export async function closeRetailShift(token,{operatorName}={}){const {store}=await retailBaseContext(token);const shift=await findOpenShift(token,store);if(!shift)throw new Error('Открытая смена не найдена');const id=metaId(shift);const closeDate=new Date().toISOString();const updated=await ms(token,`/entity/retailshift/${id}`,{method:'PUT',body:JSON.stringify({closeDate,description:`Закрыто из A4PRINT HUB${operatorName?` · ${operatorName}`:''}`})});return{shift:updated||{...shift,closeDate},store}}

export async function getRetailContext(token){const {store,organization}=await retailBaseContext(token);const shift=await findOpenShift(token,store);if(!shift)throw new Error('В МойСклад нет открытой розничной смены. Откройте смену в кассе и повторите оплату.');return{store,organization,shift}}

export async function createRetailSale({token,items,paymentMethod,operatorName,customer}){if(!items?.length)throw new Error('Пустой чек');const {store,organization,shift}=await getRetailContext(token);const positions=items.map(x=>{if(!x.external_href)throw new Error(`Позиция ${x.name||x.id} не связана с МойСклад`);return{quantity:Number(x.qty),price:Math.round(Number(x.price)*100),discount:0,vat:0,assortment:{meta:{href:x.external_href,type:x.external_type||'product',mediaType:'application/json'}}}});const total=Math.round(items.reduce((s,x)=>s+Number(x.price)*Number(x.qty),0)*100);const customerText=customer?` · Клиент: ${customer.name||'без имени'}${customer.phone?` ${customer.phone}`:''}${customer.company?` (${customer.company})`:''}`:'';const payload={organization:{meta:organization.meta},retailStore:{meta:store.meta},retailShift:{meta:shift.meta},positions,payedSum:total,description:`A4PRINT HUB · Оператор: ${operatorName||'не указан'}${customerText} · ${paymentMethod||'Оплата'}`};return ms(token,'/entity/retaildemand',{method:'POST',body:JSON.stringify(payload)})}
