import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const cfg=window.A4PRINT_CONFIG||{};
const apiBase=String(cfg.apiBaseUrl||'https://a4print-hub-api.onrender.com').replace(/\/$/,'');
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})+' ₽';
const typeLabel={PRODUCT:'Товар',MATERIAL:'Материал',SERVICE:'Услуга',FINISHED_PRODUCT:'Готовая продукция',MODEL_3D:'3D-модель'};
const state={items:[],transactions:[],localBalances:new Map(),msStock:{},msStockAvailable:false,msStockStale:false,roles:[],profileId:null,organizationId:null,loading:false,channel:null};
let reloadTimer=null;

async function sessionToken(){const {data:{session}}=await supabase.auth.getSession();return session?.access_token||''}
async function api(path,opt={}){
  const token=await sessionToken();
  const headers={Authorization:`Bearer ${token}`,...(opt.body?{'Content-Type':'application/json'}:{}),...(opt.headers||{})};
  const r=await fetch(`${apiBase}${path}`,{...opt,headers,cache:'no-store'});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.message||data.error||`HTTP ${r.status}`);
  return data;
}
function canCatalogWrite(){return state.roles.includes('ADMIN')||state.roles.includes('MANAGER')}
function canStockMove(){return ['ADMIN','MANAGER','WAREHOUSE','PRODUCTION'].some(x=>state.roles.includes(x))}

async function initContext(){
  const {data:{session}}=await supabase.auth.getSession();
  const [rolesResult,orgResult]=await Promise.all([
    supabase.rpc('get_my_roles'),
    supabase.from('organizations').select('id').eq('code','A4PRINT').maybeSingle()
  ]);
  state.roles=Array.isArray(rolesResult.data)?rolesResult.data:[];
  state.organizationId=orgResult.data?.id||null;
  if(session?.user?.id){
    const {data}=await supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle();
    state.profileId=data?.id||null;
  }
  $('addItem').hidden=!canCatalogWrite();
  $('syncCatalog').hidden=!state.roles.includes('ADMIN');
}

function calculateLocalBalances(rows){
  const map=new Map();
  for(const x of rows||[]){
    let qty=Number(x.quantity||0);
    if(['ISSUE','TRANSFER_OUT','PRODUCTION_OUT'].includes(x.transaction_type))qty=-Math.abs(qty);
    else if(['RECEIPT','TRANSFER_IN','PRODUCTION_IN'].includes(x.transaction_type))qty=Math.abs(qty);
    map.set(x.catalog_item_id,(map.get(x.catalog_item_id)||0)+qty);
  }
  return map;
}
function isMoySklad(item){return item.external_source==='MOYSKLAD'&&Boolean(item.external_id)}
function stockOf(item){
  if(item.item_type==='SERVICE')return null;
  if(isMoySklad(item)){
    if(!state.msStockAvailable)return null;
    return Number(state.msStock[item.external_id]??0);
  }
  return Number(state.localBalances.get(item.id)||0);
}
function stockTone(item,stock){
  if(stock==null||item.item_type==='SERVICE')return'';
  const min=Number(item.min_stock||0);
  if(stock<=0)return'low';
  if(stock<=min)return'warn';
  return'';
}
function sourceName(item){return isMoySklad(item)?'МойСклад':'HUB'}

async function loadStock(){
  try{
    const data=await api('/api/v1/warehouse/stock');
    state.msStock=data.stock||{};
    state.msStockAvailable=true;
    state.msStockStale=Boolean(data.stale);
    $('stockSource').textContent=data.stale?'МойСклад · резервные данные':'МойСклад · LIVE';
  }catch(error){
    state.msStockAvailable=false;
    state.msStock={};
    $('stockSource').textContent=`МойСклад недоступен: ${error.message}`;
  }
}

async function load(){
  if(state.loading)return;
  state.loading=true;
  $('refresh').disabled=true;
  $('refresh').textContent='Обновление…';
  $('list').innerHTML='<div class="warehouse-empty">Загрузка склада…</div>';
  try{
    const [catalog,tx]=await Promise.all([
      supabase.from('catalog_items').select('*').order('name'),
      supabase.from('inventory_transactions').select('catalog_item_id,transaction_type,quantity,created_at').order('created_at',{ascending:false}).limit(10000)
    ]);
    if(catalog.error)throw catalog.error;if(tx.error)throw tx.error;
    state.items=catalog.data||[];state.transactions=tx.data||[];state.localBalances=calculateLocalBalances(state.transactions);
    await loadStock();
    render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){
    console.error('Warehouse load failed',error);
    $('list').innerHTML=`<div class="warehouse-empty error">Ошибка загрузки: ${esc(error.message||error)}</div>`;
  }finally{
    state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить';
  }
}

function filters(){return{q:$('search').value.trim().toLowerCase(),type:$('type').value,source:$('source').value,stock:$('stockFilter').value}}
function filteredItems(){
  const f=filters();
  return state.items.filter(item=>{
    const stock=stockOf(item);const source=isMoySklad(item)?'MS':'LOCAL';
    const text=[item.name,item.sku,item.article,item.barcode,item.category].filter(Boolean).join(' ').toLowerCase();
    if(f.q&&!text.includes(f.q))return false;
    if(f.type&&item.item_type!==f.type)return false;
    if(f.source&&source!==f.source)return false;
    if(f.stock){
      if(item.item_type==='SERVICE'||stock==null)return false;
      const min=Number(item.min_stock||0);
      if(f.stock==='positive'&&stock<=0)return false;
      if(f.stock==='zero'&&stock!==0)return false;
      if(f.stock==='low'&&!(stock<=min))return false;
    }
    return true;
  });
}

function renderStats(){
  const stocked=state.items.filter(x=>x.item_type!=='SERVICE').map(item=>({item,stock:stockOf(item)}));
  $('itemsCount').textContent=state.items.length;
  $('linkedCount').textContent=state.items.filter(isMoySklad).length;
  $('availableCount').textContent=stocked.filter(x=>x.stock!=null&&x.stock>0).length;
  $('lowCount').textContent=stocked.filter(x=>x.stock!=null&&x.stock<=Number(x.item.min_stock||0)).length;
}

function rowHtml(item){
  const stock=stockOf(item),tone=stockTone(item,stock),ms=isMoySklad(item),inactive=item.is_active===false;
  const stockText=item.item_type==='SERVICE'?'—':stock==null?'—':`${Number(stock).toLocaleString('ru-RU',{maximumFractionDigits:3})} ${esc(item.unit||'шт')}`;
  const stockSub=item.item_type==='SERVICE'?'без складского учёта':stock==null?'остаток не получен':`мин. ${Number(item.min_stock||0).toLocaleString('ru-RU',{maximumFractionDigits:3})}`;
  const edit=canCatalogWrite()?`<button type="button" data-action="edit" data-id="${item.id}">Изменить</button>`:'';
  const qty=!ms&&item.item_type!=='SERVICE'&&canStockMove()?`<button type="button" data-action="qty" data-id="${item.id}">+ Приход</button>`:'';
  return `<div class="warehouse-row" data-id="${item.id}">
    <div class="warehouse-item"><b>${esc(item.name||'Без названия')}</b><small>${esc(item.sku||'без SKU')} · ${esc(typeLabel[item.item_type]||item.item_type||'—')}${item.category?' · '+esc(item.category):''}</small></div>
    <div class="warehouse-source-wrap"><span class="warehouse-source ${ms?'':'local'}">${sourceName(item)}</span></div>
    <div class="warehouse-price">${money(item.sale_price)}</div>
    <div class="warehouse-stock ${tone}"><b>${stockText}</b><small>${stockSub}</small></div>
    <div class="warehouse-actions"><span class="warehouse-status ${inactive?'inactive':''}">${inactive?'Неактивна':'Активна'}</span>${qty}${edit}<a href="./item.html?id=${encodeURIComponent(item.id)}">Карточка</a></div>
  </div>`;
}
function render(){
  renderStats();
  const rows=filteredItems();
  $('visibleCount').textContent=`${rows.length} из ${state.items.length}`;
  $('list').innerHTML=rows.map(rowHtml).join('')||'<div class="warehouse-empty">По выбранным условиям ничего не найдено</div>';
}

function openItem(id=''){
  const item=state.items.find(x=>x.id===id)||null;
  $('itemForm').reset();$('editId').value=item?.id||'';$('itemDlgTitle').textContent=item?'Изменить позицию':'Новая позиция';
  $('itemDlgText').textContent=item&&isMoySklad(item)?'Название и цена синхронизируются из МойСклад. Минимальный остаток и локальные поля сохраняются в HUB.':'Локальная позиция A4PRINT HUB.';
  $('name').value=item?.name||'';$('sku').value=item?.sku||'';$('category').value=item?.category||'';$('itemType').value=item?.item_type||'PRODUCT';$('unit').value=item?.unit||'шт';$('sale').value=Number(item?.sale_price||0);$('cost').value=Number(item?.cost_price||0);$('min').value=Number(item?.min_stock||0);$('description').value=item?.description||'';$('active').checked=item?.is_active!==false;$('itemError').textContent='';
  $('itemDlg').showModal();
}
function openQty(id){
  const item=state.items.find(x=>x.id===id);if(!item)return;
  $('qtyForm').reset();$('qtyItemId').value=item.id;$('qtyItemName').textContent=`${item.name} · сейчас ${Number(stockOf(item)||0).toLocaleString('ru-RU',{maximumFractionDigits:3})} ${item.unit||'шт'}`;$('qtyCost').value=Number(item.cost_price||0);$('qtyError').textContent='';$('qtyDlg').showModal();
}

$('list').addEventListener('click',event=>{
  const b=event.target.closest('[data-action]');if(!b)return;
  if(b.dataset.action==='edit')openItem(b.dataset.id);else if(b.dataset.action==='qty')openQty(b.dataset.id);
});
$('addItem').addEventListener('click',()=>openItem());
$('refresh').addEventListener('click',load);
for(const id of ['search','type','source','stockFilter'])$(id).addEventListener(id==='search'?'input':'change',render);
$('clearFilters').addEventListener('click',()=>{$('search').value='';$('type').value='';$('source').value='';$('stockFilter').value='';render()});
$('closeItemDlg').addEventListener('click',()=>$('itemDlg').close());$('closeQtyDlg').addEventListener('click',()=>$('qtyDlg').close());

$('itemForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!canCatalogWrite())return;
  $('saveItem').disabled=true;$('itemError').textContent='';
  const id=$('editId').value;
  const payload={organization_id:state.organizationId,name:$('name').value.trim(),sku:$('sku').value.trim(),category:$('category').value.trim()||null,item_type:$('itemType').value,unit:$('unit').value.trim()||'шт',sale_price:Number($('sale').value)||0,cost_price:Number($('cost').value)||0,min_stock:Number($('min').value)||0,description:$('description').value.trim()||null,is_active:$('active').checked,updated_at:new Date().toISOString()};
  try{
    const result=id?await supabase.from('catalog_items').update(payload).eq('id',id):await supabase.from('catalog_items').insert(payload);
    if(result.error)throw result.error;$('itemDlg').close();await load();
  }catch(error){$('itemError').textContent=error.message||String(error)}finally{$('saveItem').disabled=false}
});

$('qtyForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!canStockMove())return;
  $('saveQty').disabled=true;$('qtyError').textContent='';
  const itemId=$('qtyItemId').value,quantity=Number($('qty').value),unitCost=Number($('qtyCost').value)||0;
  if(!(quantity>0)){$('qtyError').textContent='Количество должно быть больше нуля.';$('saveQty').disabled=false;return}
  try{
    const {error}=await supabase.from('inventory_transactions').insert({catalog_item_id:itemId,transaction_type:'RECEIPT',quantity,unit_cost:unitCost,note:$('qtyNote').value.trim()||'Быстрый приход',created_by:state.profileId});
    if(error)throw error;
    const item=state.items.find(x=>x.id===itemId);if(item&&unitCost>0&&Number(item.cost_price||0)!==unitCost&&canCatalogWrite())await supabase.from('catalog_items').update({cost_price:unitCost,updated_at:new Date().toISOString()}).eq('id',itemId);
    $('qtyDlg').close();await load();
  }catch(error){$('qtyError').textContent=error.message||String(error)}finally{$('saveQty').disabled=false}
});

$('syncCatalog').addEventListener('click',async()=>{
  const button=$('syncCatalog');button.disabled=true;button.textContent='Синхронизация…';
  try{
    const result=await api('/api/v1/integrations/moysklad/sync',{method:'POST',body:'{}'});
    $('stockSource').textContent=`Каталог: +${result.created||0}, обновлено ${result.updated||0}`;await load();
  }catch(error){window.alert(`Не удалось синхронизировать МойСклад: ${error.message}`)}finally{button.disabled=false;button.textContent='↻ Синхронизировать МойСклад'}
});

function initRealtime(){
  if(typeof supabase.channel!=='function')return;
  const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(load,650)};
  state.channel=supabase.channel('warehouse-live-v2').on('postgres_changes',{event:'*',schema:'public',table:'catalog_items'},reload).on('postgres_changes',{event:'*',schema:'public',table:'inventory_transactions'},reload).subscribe();
  window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true});
}

await initContext();
await load();
initRealtime();
setInterval(()=>{if(!document.hidden)loadStock().then(render).catch(()=>{})},60000);
