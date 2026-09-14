import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=n=>Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:3});
const money=n=>Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
const state={permissions:[],jobs:[],materials:[],warehouses:[],assignments:[],transactions:[],costs:new Map(),loading:false,channel:null};

function can(code){return state.permissions.includes(code)}
function stockKey(itemId,warehouseId){return `${itemId}|${warehouseId||''}`}
function stockBalance(itemId,warehouseId){
  let total=0;
  for(const t of state.transactions){
    if(t.catalog_item_id!==itemId||(warehouseId&&t.warehouse_id!==warehouseId))continue;
    const q=Number(t.quantity||0);
    if(['RECEIPT','TRANSFER_IN','PRODUCTION_IN','ADJUSTMENT'].includes(t.transaction_type))total+=q;
    else if(['SALE','WRITE_OFF','TRANSFER_OUT','PRODUCTION_OUT'].includes(t.transaction_type))total-=q;
  }
  return total;
}
function translate(error){
  const t=String(error?.message||error||'Ошибка');
  if(t.includes('INSUFFICIENT_STOCK'))return'Недостаточно остатка на выбранном складе.';
  if(t.includes('RETURN_EXCEEDS_AVAILABLE'))return'Нельзя вернуть больше, чем осталось из выданного материала.';
  if(t.includes('WASTE_EXCEEDS_NET_ISSUE'))return'Отход/брак превышает фактически выданное количество.';
  if(t.includes('PERMISSION_DENIED'))return'Недостаточно прав для управления материалами.';
  if(t.includes('MATERIAL_NOT_FOUND'))return'Материал не найден или отключён.';
  if(t.includes('WAREHOUSE_REQUIRED'))return'Не выбран склад.';
  return t;
}

function installStyle(){
  if(document.querySelector('link[data-farm-materials]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='./production-farm-materials.css?v=20260914-1';link.dataset.farmMaterials='1';document.head.appendChild(link);
}
function ensureDialog(){
  if($('farmMaterialsDlg'))return;
  const d=document.createElement('dialog');d.id='farmMaterialsDlg';d.className='farm-materials-dialog';d.innerHTML=`
    <div class="farm-materials-head"><div><h2>Материалы производства</h2><p>План, выдача, возврат, отходы и фактическая себестоимость</p></div><button type="button" data-materials-close>×</button></div>
    <div class="farm-materials-body">
      <div class="farm-materials-toolbar"><label><span>Производственное задание</span><select id="farmMaterialsJob"></select></label><button id="farmMaterialsReload" type="button">↻ Обновить</button></div>
      <section id="farmCostSummary" class="farm-cost-summary"></section>
      <form id="farmMaterialPlanForm" class="farm-material-plan">
        <label><span>Материал</span><select id="farmPlanMaterial" required></select></label>
        <label><span>Склад</span><select id="farmPlanWarehouse" required></select></label>
        <label><span>Плановое количество</span><input id="farmPlanQty" type="number" min="0" step="0.001" value="0" required></label>
        <label class="wide"><span>Комментарий</span><input id="farmPlanNote" maxlength="500" placeholder="Партия, цвет, формат, особые условия"></label>
        <button id="farmPlanSave" class="primary" type="submit">Добавить / обновить план</button>
      </form>
      <div id="farmMaterialsError" class="farm-material-error"></div>
      <div id="farmMaterialsList" class="farm-material-list"><div class="farm-material-empty">Загрузка…</div></div>
    </div>`;
  document.body.appendChild(d);
  d.querySelector('[data-materials-close]').addEventListener('click',()=>d.close());
  $('farmMaterialsJob').addEventListener('change',render);
  $('farmMaterialsReload').addEventListener('click',loadData);
  $('farmMaterialPlanForm').addEventListener('submit',savePlan);
  $('farmMaterialsList').addEventListener('click',handleAction);
}
function installButton(){
  if($('farmMaterialsBtn'))return;
  const actions=document.querySelector('.production-top-actions');if(!actions)return;
  const b=document.createElement('button');b.id='farmMaterialsBtn';b.type='button';b.textContent='📦 Материалы';b.addEventListener('click',async()=>{ensureDialog();await loadData();$('farmMaterialsDlg').showModal()});
  actions.insertBefore(b,$('refresh')||null);
}

async function loadPermissions(){const {data,error}=await supabase.rpc('get_my_permissions');if(error)throw error;state.permissions=Array.isArray(data)?data:[]}
async function loadData(){
  if(state.loading)return;state.loading=true;$('farmMaterialsError')&&($('farmMaterialsError').textContent='');
  try{
    const [jobs,materials,warehouses,assignments,transactions,costs]=await Promise.all([
      supabase.from('production_jobs').select('id,title,status,order_id,production_cost').order('updated_at',{ascending:false}).limit(500),
      supabase.from('catalog_items').select('id,sku,name,unit,cost_price,is_active').eq('item_type','MATERIAL').eq('is_active',true).order('name'),
      supabase.from('warehouses').select('id,name,business_unit,is_active').eq('is_active',true).order('name'),
      supabase.from('production_job_materials').select('*').order('created_at'),
      supabase.from('inventory_transactions').select('catalog_item_id,warehouse_id,transaction_type,quantity,reference_type,reference_id,created_at').order('created_at',{ascending:false}).limit(10000),
      supabase.from('production_job_cost_breakdown').select('*')
    ]);
    for(const r of [jobs,materials,warehouses,assignments,transactions,costs])if(r.error)throw r.error;
    state.jobs=jobs.data||[];state.materials=materials.data||[];state.warehouses=warehouses.data||[];state.assignments=assignments.data||[];state.transactions=transactions.data||[];state.costs=new Map((costs.data||[]).map(x=>[x.production_job_id,x]));
    fillSelectors();render();
  }catch(error){if($('farmMaterialsError'))$('farmMaterialsError').textContent=translate(error);console.warn('Production materials load failed',error)}finally{state.loading=false}
}
function fillSelectors(){
  const jobSel=$('farmMaterialsJob');if(!jobSel)return;
  const keep=jobSel.value;
  jobSel.innerHTML=state.jobs.map(j=>`<option value="${j.id}">${esc(j.title)} · ${esc(j.status)}</option>`).join('')||'<option value="">Нет заданий</option>';
  if(keep&&state.jobs.some(j=>j.id===keep))jobSel.value=keep;
  $('farmPlanMaterial').innerHTML=state.materials.map(m=>`<option value="${m.id}">${esc(m.sku)} · ${esc(m.name)} (${esc(m.unit)})</option>`).join('')||'<option value="">Нет материалов</option>';
  $('farmPlanWarehouse').innerHTML=state.warehouses.map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join('')||'<option value="">Нет склада</option>';
  const writable=can('production.manage');$('farmMaterialPlanForm').classList.toggle('readonly',!writable);$('farmMaterialPlanForm').querySelectorAll('input,select,button').forEach(el=>el.disabled=!writable);
}
function render(){
  const jobId=$('farmMaterialsJob')?.value;if(!jobId)return;
  const cost=state.costs.get(jobId)||{};
  $('farmCostSummary').innerHTML=`<article><span>Станок</span><strong>${money(cost.machine_cost)}</strong></article><article><span>Электроэнергия</span><strong>${money(cost.electricity_cost)}</strong></article><article><span>Материалы</span><strong>${money(cost.material_cost)}</strong></article><article class="total"><span>Факт. себестоимость</span><strong>${money(cost.total_production_cost)}</strong></article>`;
  const rows=state.assignments.filter(x=>x.production_job_id===jobId);
  $('farmMaterialsList').innerHTML=rows.map(row=>{
    const m=state.materials.find(x=>x.id===row.catalog_item_id)||{name:'Материал',sku:'',unit:''};
    const w=state.warehouses.find(x=>x.id===row.warehouse_id)||{name:'—'};
    const net=Number(row.issued_quantity||0)-Number(row.returned_quantity||0);
    const available=stockBalance(row.catalog_item_id,row.warehouse_id);
    const cost=net*Number(row.unit_cost_snapshot||0);
    return `<article class="farm-material-row" data-material-row="${row.id}"><div class="farm-material-main"><div><b>${esc(m.name)}</b><small>${esc(m.sku||'без SKU')} · ${esc(w.name)} · остаток ${esc(fmt(available))} ${esc(m.unit)}</small></div><span class="farm-material-cost">${money(cost)}</span></div><div class="farm-material-metrics"><span>План <b>${esc(fmt(row.planned_quantity))}</b></span><span>Выдано <b>${esc(fmt(row.issued_quantity))}</b></span><span>Возврат <b>${esc(fmt(row.returned_quantity))}</b></span><span>Отход/брак <b>${esc(fmt(row.waste_quantity))}</b></span><span>Факт <b>${esc(fmt(net))}</b></span></div>${can('production.manage')?`<div class="farm-material-actions"><input data-material-qty type="number" min="0.001" step="0.001" value="1"><button data-material-action="ISSUE" data-job="${jobId}" data-item="${row.catalog_item_id}" data-wh="${row.warehouse_id||''}" type="button">Выдать</button><button data-material-action="RETURN" data-job="${jobId}" data-item="${row.catalog_item_id}" data-wh="${row.warehouse_id||''}" type="button">Вернуть</button><button data-material-action="WASTE" data-job="${jobId}" data-item="${row.catalog_item_id}" data-wh="${row.warehouse_id||''}" type="button">В отход/брак</button></div>`:''}</article>`;
  }).join('')||'<div class="farm-material-empty">Для задания ещё не запланированы материалы.</div>';
}
async function savePlan(event){
  event.preventDefault();const btn=$('farmPlanSave');btn.disabled=true;$('farmMaterialsError').textContent='';
  try{
    const {error}=await supabase.rpc('save_production_job_material_plan',{p_job_id:$('farmMaterialsJob').value,p_catalog_item_id:$('farmPlanMaterial').value,p_planned_quantity:Number($('farmPlanQty').value||0),p_warehouse_id:$('farmPlanWarehouse').value||null,p_notes:$('farmPlanNote').value||null});
    if(error)throw error;$('farmPlanNote').value='';await loadData();
  }catch(error){$('farmMaterialsError').textContent=translate(error)}finally{btn.disabled=false}
}
async function handleAction(event){
  const btn=event.target.closest('[data-material-action]');if(!btn)return;
  const row=btn.closest('[data-material-row]');const input=row?.querySelector('[data-material-qty]');const quantity=Number(input?.value||0);
  if(!(quantity>0))return;
  btn.disabled=true;$('farmMaterialsError').textContent='';
  try{
    const {error}=await supabase.rpc('production_material_action',{p_job_id:btn.dataset.job,p_catalog_item_id:btn.dataset.item,p_action:btn.dataset.materialAction,p_quantity:quantity,p_warehouse_id:btn.dataset.wh||null,p_note:null});
    if(error)throw error;await loadData();
  }catch(error){$('farmMaterialsError').textContent=translate(error)}finally{btn.disabled=false}
}
function initRealtime(){
  if(typeof supabase.channel!=='function')return;
  let timer;const reload=()=>{clearTimeout(timer);timer=setTimeout(loadData,350)};
  state.channel=supabase.channel('production-farm-materials-v1').on('postgres_changes',{event:'*',schema:'public',table:'production_job_materials'},reload).on('postgres_changes',{event:'*',schema:'public',table:'inventory_transactions'},reload).subscribe();
}
async function init(){
  try{await loadPermissions();if(!can('production.view'))return;installStyle();ensureDialog();installButton();initRealtime();window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true})}
  catch(error){console.warn('Production materials unavailable',error)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();