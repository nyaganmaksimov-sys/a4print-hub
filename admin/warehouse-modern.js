import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const cfg=window.A4PRINT_CONFIG||{};
const apiBase=String(cfg.apiBaseUrl||'https://a4print-hub-api.onrender.com').replace(/\/$/,'');
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})+' ₽';
const typeLabel={PRODUCT:'Товар',MATERIAL:'Материал',SERVICE:'Услуга',FINISHED_PRODUCT:'Готовая продукция',MODEL_3D:'3D-модель'};
const initialRoles=Array.isArray(window.__A4_CURRENT_ROLES__)?[...window.__A4_CURRENT_ROLES__]:[];
const state={
  items:[],metrics:null,msIndex:[],msStock:{},msStockAvailable:false,msStockStale:false,msStockLoadedAt:0,
  roles:initialRoles,profileId:null,organizationId:null,loading:false,reloadQueued:false,channel:null,
  page:1,pageSize:50,total:0
};
let reloadTimer=null,searchTimer=null,stockTimer=null;

function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';console[method]('[A4PRINT HUB]',title,message);
}
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
function isMoySklad(item){return item.external_source==='MOYSKLAD'&&Boolean(item.external_id)}
function stockOf(item){
  if(item.item_type==='SERVICE')return null;
  if(isMoySklad(item)){
    if(!state.msStockAvailable)return null;
    return Number(state.msStock[item.external_id]??0);
  }
  return Number(item.local_balance||0);
}
function stockTone(item,stock){
  if(stock==null||item.item_type==='SERVICE')return'';
  const min=Number(item.min_stock||0);
  if(stock<=0)return'low';
  if(stock<=min)return'warn';
  return'';
}
function sourceName(item){return isMoySklad(item)?'МойСклад':'HUB'}
function filters(){return{q:$('search')?.value.trim()||'',type:$('type')?.value||'',source:$('source')?.value||'',stock:$('stockFilter')?.value||''}}

async function initContext(){
  const {data:{session}}=await supabase.auth.getSession();
  const [rolesResult,profileResult,organizationResult]=await Promise.all([
    state.roles.length?Promise.resolve({data:state.roles,error:null}):supabase.rpc('get_my_roles'),
    session?.user?.id?supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle():Promise.resolve({data:null,error:null}),
    supabase.rpc('current_user_organization_id')
  ]);
  if(!rolesResult.error&&Array.isArray(rolesResult.data))state.roles=rolesResult.data.map(String);
  if(organizationResult.error)console.warn('Current organization unavailable',organizationResult.error);
  state.organizationId=organizationResult.data||null;
  state.profileId=profileResult.data?.id||null;
  $('addItem').hidden=!canCatalogWrite();
  $('syncCatalog').hidden=!state.roles.includes('ADMIN');
}

async function loadMetrics(){
  const {data,error}=await supabase.rpc('get_warehouse_catalog_metrics');
  if(error)throw error;
  state.metrics=Array.isArray(data)?(data[0]||null):data;
}
async function loadMsIndex(){
  const {data,error}=await supabase.rpc('get_warehouse_moysklad_stock_index');
  if(error)throw error;
  state.msIndex=Array.isArray(data)?data:[];
}
async function loadStock(){
  try{
    const data=await api('/api/v1/warehouse/stock');
    state.msStock=data.stock||{};
    state.msStockAvailable=true;
    state.msStockStale=Boolean(data.stale);
    state.msStockLoadedAt=Date.now();
    $('stockSource').textContent=data.stale?'МойСклад · резервные данные':'МойСклад · LIVE';
    return true;
  }catch(error){
    state.msStockAvailable=false;state.msStock={};state.msStockLoadedAt=Date.now();
    $('stockSource').textContent=`МойСклад недоступен: ${error.message}`;
    return false;
  }
}
async function ensureStockFresh(force=false){
  if(!force&&state.msStockLoadedAt&&Date.now()-state.msStockLoadedAt<300000)return state.msStockAvailable;
  return loadStock();
}
function msMatchingIds(kind){
  if(!kind||!state.msStockAvailable)return[];
  const ids=[];
  for(const row of state.msIndex){
    const stock=Number(state.msStock[row.external_id]??0),min=Number(row.min_stock||0);
    if(kind==='positive'&&stock>0)ids.push(row.id);
    else if(kind==='zero'&&stock===0)ids.push(row.id);
    else if(kind==='low'&&stock<=min)ids.push(row.id);
  }
  return ids;
}
async function loadPage(){
  const f=filters();
  if(f.stock)await ensureStockFresh();
  const {data,error}=await supabase.rpc('get_warehouse_catalog_page',{
    p_query:f.q,p_type:f.type,p_source:f.source,p_stock:f.stock,
    p_ms_ids:f.stock?msMatchingIds(f.stock):[],
    p_page:state.page,p_page_size:state.pageSize
  });
  if(error)throw error;
  const rows=Array.isArray(data)?data:[];
  return{rows,total:rows.length?Number(rows[0].total_count||0):0};
}
function syncUrl(){
  const f=filters(),url=new URL(location.href);
  ['q','type','source','stock','page'].forEach(k=>url.searchParams.delete(k));
  if(f.q)url.searchParams.set('q',f.q);if(f.type)url.searchParams.set('type',f.type);
  if(f.source)url.searchParams.set('source',f.source);if(f.stock)url.searchParams.set('stock',f.stock);
  if(state.page>1)url.searchParams.set('page',String(state.page));
  history.replaceState(null,'',url.pathname+url.search);
}

function renderStats(){
  const m=state.metrics||{};
  $('itemsCount').textContent=state.metrics?Number(m.items_count||0):'—';
  $('linkedCount').textContent=state.metrics?Number(m.linked_count||0):'—';
  if(!state.metrics){$('availableCount').textContent='—';$('lowCount').textContent='—';return}
  if(Number(m.linked_count||0)>0&&!state.msStockAvailable){
    $('availableCount').textContent='—';$('lowCount').textContent='—';return;
  }
  let msAvailable=0,msLow=0;
  for(const row of state.msIndex){
    const stock=Number(state.msStock[row.external_id]??0),min=Number(row.min_stock||0);
    if(stock>0)msAvailable++;
    if(stock<=min)msLow++;
  }
  $('availableCount').textContent=Number(m.local_available_count||0)+msAvailable;
  $('lowCount').textContent=Number(m.local_low_count||0)+msLow;
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
function renderPager(){
  const pages=Math.max(1,Math.ceil(state.total/state.pageSize)),pager=$('warehousePager');if(!pager)return;
  pager.hidden=state.total<=state.pageSize;$('warehousePageLabel').textContent=`Страница ${state.page} из ${pages}`;
  $('warehousePrevPage').disabled=state.page<=1;$('warehouseNextPage').disabled=state.page>=pages;
}
function render(){
  syncUrl();renderStats();
  $('visibleCount').textContent=`${state.items.length} на странице · всего ${state.total}`;
  $('list').innerHTML=state.items.map(rowHtml).join('')||'<div class="warehouse-empty">По выбранным условиям ничего не найдено</div>';
  renderPager();
}
function renderLoading(){$('list').innerHTML='<div class="warehouse-loading-list"><div class="a4-skeleton"></div><div class="a4-skeleton"></div><div class="a4-skeleton"></div></div>'}
function renderError(error){
  $('list').innerHTML=`<div class="a4-error"><b>Не удалось загрузить склад</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="warehouseRetry" type="button" class="a4-btn" style="margin-top:10px">Повторить</button></div>`;
  $('warehouseRetry')?.addEventListener('click',()=>load(true));
}

async function load(force=false){
  if(state.loading){if(force)state.reloadQueued=true;return}
  state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';if(!state.items.length)renderLoading();
  try{
    const page=await loadPage();state.items=page.rows;state.total=page.total;
    if(!state.items.length&&state.page>1){state.page=Math.max(1,state.page-1);state.loading=false;return load(true)}
    render();$('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){console.error('Warehouse load failed',error);renderError(error);$('updatedAt').textContent='ошибка загрузки'}
  finally{state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить';if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>load(),0)}}
}
async function refreshCatalogContext({stock=false}={}){
  const tasks=[loadMetrics(),loadMsIndex()];if(stock)tasks.push(ensureStockFresh(true));
  await Promise.all(tasks);
}
async function refreshAfterStock(){
  await ensureStockFresh(true);
  if(filters().stock)await load(true);else render();
}
function resetPageAndLoad(){state.page=1;void load(true)}

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
function initParams(){
  const p=new URLSearchParams(location.search);
  if(p.get('q'))$('search').value=p.get('q');
  for(const [id,key] of [['type','type'],['source','source'],['stockFilter','stock']]){
    const value=p.get(key),el=$(id);if(el&&value&&[...el.options].some(o=>o.value===value))el.value=value;
  }
  const page=Number(p.get('page')||1);state.page=Number.isInteger(page)&&page>0?page:1;
}
function bind(){
  $('list').addEventListener('click',event=>{const b=event.target.closest('[data-action]');if(!b)return;if(b.dataset.action==='edit')openItem(b.dataset.id);else if(b.dataset.action==='qty')openQty(b.dataset.id)});
  $('addItem').addEventListener('click',()=>openItem());$('refresh').addEventListener('click',()=>load(true));
  $('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(resetPageAndLoad,280)});
  for(const id of ['type','source'])$(id).addEventListener('change',resetPageAndLoad);
  $('stockFilter').addEventListener('change',async()=>{state.page=1;if($('stockFilter').value)await ensureStockFresh();await load(true)});
  $('clearFilters').addEventListener('click',()=>{$('search').value='';$('type').value='';$('source').value='';$('stockFilter').value='';resetPageAndLoad()});
  $('warehousePrevPage')?.addEventListener('click',()=>{if(state.page>1){state.page--;void load(true)}});
  $('warehouseNextPage')?.addEventListener('click',()=>{const pages=Math.max(1,Math.ceil(state.total/state.pageSize));if(state.page<pages){state.page++;void load(true)}});
  $('closeItemDlg').addEventListener('click',()=>$('itemDlg').close());$('closeQtyDlg').addEventListener('click',()=>$('qtyDlg').close());
  $('itemForm').addEventListener('submit',saveItem);
  $('qtyForm').addEventListener('submit',saveQty);
  $('syncCatalog').addEventListener('click',syncCatalog);
}
async function saveItem(event){
  event.preventDefault();if(!canCatalogWrite())return;$('saveItem').disabled=true;$('itemError').textContent='';
  const id=$('editId').value;
  if(!id&&!state.organizationId){$('itemError').textContent='Не определена организация текущего сотрудника.';$('saveItem').disabled=false;return}
  const payload={name:$('name').value.trim(),sku:$('sku').value.trim(),category:$('category').value.trim()||null,item_type:$('itemType').value,unit:$('unit').value.trim()||'шт',sale_price:Number($('sale').value)||0,cost_price:Number($('cost').value)||0,min_stock:Number($('min').value)||0,description:$('description').value.trim()||null,is_active:$('active').checked,updated_at:new Date().toISOString()};
  if(!id)payload.organization_id=state.organizationId;
  try{
    const result=id?await supabase.from('catalog_items').update(payload).eq('id',id):await supabase.from('catalog_items').insert(payload);
    if(result.error)throw result.error;$('itemDlg').close();await refreshCatalogContext();await load(true);
  }catch(error){$('itemError').textContent=error.message||String(error)}finally{$('saveItem').disabled=false}
}
async function saveQty(event){
  event.preventDefault();if(!canStockMove())return;$('saveQty').disabled=true;$('qtyError').textContent='';
  const itemId=$('qtyItemId').value,quantity=Number($('qty').value),unitCost=Number($('qtyCost').value)||0;
  if(!(quantity>0)){$('qtyError').textContent='Количество должно быть больше нуля.';$('saveQty').disabled=false;return}
  try{
    const {error}=await supabase.from('inventory_transactions').insert({catalog_item_id:itemId,transaction_type:'RECEIPT',quantity,unit_cost:unitCost,note:$('qtyNote').value.trim()||'Быстрый приход',created_by:state.profileId});
    if(error)throw error;
    const item=state.items.find(x=>x.id===itemId);if(item&&unitCost>0&&Number(item.cost_price||0)!==unitCost&&canCatalogWrite())await supabase.from('catalog_items').update({cost_price:unitCost,updated_at:new Date().toISOString()}).eq('id',itemId);
    $('qtyDlg').close();await loadMetrics();await load(true);
  }catch(error){$('qtyError').textContent=error.message||String(error)}finally{$('saveQty').disabled=false}
}
async function syncCatalog(){
  const button=$('syncCatalog');button.disabled=true;button.textContent='Синхронизация…';
  try{
    const result=await api('/api/v1/integrations/moysklad/sync',{method:'POST',body:'{}'});
    $('stockSource').textContent=`Каталог: +${result.created||0}, обновлено ${result.updated||0}`;
    await refreshCatalogContext({stock:true});state.page=1;await load(true);
    notify('success','МойСклад синхронизирован',`Добавлено: ${result.created||0}, обновлено: ${result.updated||0}`);
  }catch(error){notify('error','Не удалось синхронизировать МойСклад',error.message||String(error))}
  finally{button.disabled=false;button.textContent='↻ Синхронизировать МойСклад'}
}
function initRealtime(){
  if(typeof supabase.channel!=='function')return;
  const reloadCatalog=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(async()=>{try{await refreshCatalogContext();await load(true)}catch(error){console.warn(error)}},450)};
  const reloadBalance=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(async()=>{try{await loadMetrics();await load(true)}catch(error){console.warn(error)}},300)};
  state.channel=supabase.channel('warehouse-live-v4')
    .on('postgres_changes',{event:'*',schema:'public',table:'catalog_items'},reloadCatalog)
    .on('postgres_changes',{event:'*',schema:'public',table:'inventory_transactions'},reloadBalance)
    .subscribe();
  window.addEventListener('beforeunload',()=>{if(stockTimer)clearInterval(stockTimer);if(state.channel)supabase.removeChannel(state.channel)},{once:true});
}

await initContext();initParams();bind();
await Promise.all([loadMetrics(),loadMsIndex()]);
if(filters().stock)await ensureStockFresh();
await load();
if(!state.msStockLoadedAt)void ensureStockFresh().then(()=>render()).catch(()=>{});
initRealtime();
stockTimer=setInterval(()=>{if(!document.hidden)refreshAfterStock().catch(console.warn)},300000);
