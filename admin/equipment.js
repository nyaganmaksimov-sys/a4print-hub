import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
const qty=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:3});
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const fmtDate=v=>{if(!v)return'—';const d=new Date(String(v).length===10?v+'T00:00:00':v);return Number.isFinite(d.getTime())?d.toLocaleDateString('ru-RU'):'—'};
const fmtDateTime=v=>{if(!v)return'—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'};
const isoToday=()=>new Date().toISOString().slice(0,10);
const addDays=(date,days)=>{const d=new Date(`${date}T00:00:00`);if(!Number.isFinite(d.getTime()))return'';d.setDate(d.getDate()+Number(days||0));return d.toISOString().slice(0,10)};
const statusLabels={ACTIVE:'В эксплуатации',REPAIR:'В ремонте',RESERVE:'Резерв',STORAGE:'На хранении',WRITTEN_OFF:'Списано'};
const moveLabels={RECEIPT:'Приход',ISSUE:'Выдача',RETURN:'Возврат',WRITE_OFF:'Списание',ADJUSTMENT:'Корректировка'};
const serviceLabels={MAINTENANCE:'ТО',REPAIR:'Ремонт',INSPECTION:'Осмотр',CALIBRATION:'Калибровка',CLEANING:'Чистка',OTHER:'Другое'};
const initialRoles=Array.isArray(window.__A4_CURRENT_ROLES__)?[...window.__A4_CURRENT_ROLES__]:[];
const state={
  assets:[],consumables:[],balances:[],links:[],movements:[],detailMovements:[],detailServices:[],
  users:[],organizations:[],roles:initialRoles,profileId:null,organizationId:null,lowStockCount:null,
  loading:false,reloadQueued:false,consumablesLoading:false,movementsLoading:false,
  consumablesLoaded:false,movementsLoaded:false,activeTab:'equipment',selectedAssetId:null,channel:null
};
let reloadTimer=null;

const canManage=()=>['ADMIN','MANAGER','WAREHOUSE'].some(r=>state.roles.includes(r));
const canMove=()=>canManage()||state.roles.includes('PRODUCTION');
const userBy=id=>state.users.find(x=>x.id===id)||null;
const orgBy=id=>state.organizations.find(x=>x.id===id)||null;
const consumableBy=id=>state.consumables.find(x=>x.id===id)||null;
const balanceBy=id=>state.balances.find(x=>x.consumable_id===id)||null;
const assetBy=id=>state.assets.find(x=>x.id===id)||null;
function notify(tone,title,message,options={}){if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});const method=tone==='error'?'error':tone==='warning'?'warn':'log';console[method]('[A4PRINT HUB]',title,message)}

async function context(){
  const {data:{session}}=await supabase.auth.getSession();
  const [roles,profile,organization]=await Promise.all([
    state.roles.length?Promise.resolve({data:state.roles,error:null}):supabase.rpc('get_my_roles'),
    session?.user?.id?supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle():Promise.resolve({data:null,error:null}),
    supabase.rpc('current_user_organization_id')
  ]);
  if(!roles.error&&Array.isArray(roles.data))state.roles=roles.data.map(String);
  state.profileId=profile.data?.id||null;state.organizationId=organization.data||null;
  const [users,org]=await Promise.all([
    supabase.from('users').select('id,full_name,email,is_active').eq('is_active',true).order('full_name'),
    state.organizationId?supabase.from('organizations').select('id,code,name').eq('id',state.organizationId).maybeSingle():Promise.resolve({data:null,error:null})
  ]);
  if(users.error)throw users.error;if(org.error)console.warn('Organization label unavailable',org.error);
  state.users=users.data||[];state.organizations=org.data?[org.data]:[];
  $('addEquipment').hidden=!canManage();$('addConsumable').hidden=!canManage();$('addMovement').hidden=!canMove();$('addMovement2').hidden=!canMove();
  fillSelects();
}
async function loadLowStockCount(){
  const {count,error}=await supabase.from('equipment_consumable_balances').select('consumable_id',{count:'exact',head:true}).eq('is_active',true).eq('low_stock',true);
  if(error){console.warn('Low stock KPI unavailable',error);state.lowStockCount=null}else state.lowStockCount=Number(count||0);
}
async function loadAssets(){
  const fields='id,organization_id,inventory_number,name,category,brand,model,serial_number,location,responsible_user_id,status,purchase_date,purchase_price,warranty_until,service_interval_days,last_service_date,next_service_date,notes,created_by,created_at,updated_at,ownership_type,current_owner_partner_id,operational_status';
  const {data,error}=await supabase.from('equipment_assets').select(fields).order('created_at',{ascending:false});
  if(error)throw error;state.assets=data||[];
}
async function loadBase(){
  await Promise.all([loadAssets(),loadLowStockCount()]);
  fillSelects();renderKpis();renderEquipment();
}
async function loadConsumables(force=false){
  if(state.consumablesLoading)return;if(state.consumablesLoaded&&!force)return;
  state.consumablesLoading=true;
  try{
    const [consumables,balances,links]=await Promise.all([
      supabase.from('equipment_consumables').select('id,organization_id,name,category,sku,unit,min_stock,supplier,storage_location,notes,is_active,created_by,created_at,updated_at,catalog_item_id').order('name'),
      supabase.from('equipment_consumable_balances').select('consumable_id,organization_id,name,category,sku,unit,min_stock,storage_location,is_active,current_stock,low_stock').order('name'),
      supabase.from('equipment_consumable_links').select('equipment_id,consumable_id,note,created_by,created_at')
    ]);
    for(const r of [consumables,balances,links])if(r.error)throw r.error;
    state.consumables=consumables.data||[];state.balances=balances.data||[];state.links=links.data||[];state.consumablesLoaded=true;
    state.lowStockCount=state.balances.filter(b=>b.is_active&&b.low_stock).length;
    fillSelects();renderKpis();renderConsumables();
    document.dispatchEvent(new CustomEvent('a4:equipment-consumables-rendered'));
  }finally{state.consumablesLoading=false}
}
async function loadMovements(force=false){
  if(state.movementsLoading)return;if(state.movementsLoaded&&!force)return;
  state.movementsLoading=true;
  try{
    await loadConsumables();
    const {data,error}=await supabase.from('equipment_consumable_movements')
      .select('id,consumable_id,equipment_id,movement_type,quantity_delta,note,document_ref,created_by,created_at')
      .order('created_at',{ascending:false}).limit(250);
    if(error)throw error;state.movements=data||[];state.movementsLoaded=true;renderMovements();
  }finally{state.movementsLoading=false}
}
async function loadDetailData(assetId){
  await loadConsumables();
  const [moves,services]=await Promise.all([
    supabase.from('equipment_consumable_movements').select('id,consumable_id,equipment_id,movement_type,quantity_delta,note,document_ref,created_by,created_at').eq('equipment_id',assetId).order('created_at',{ascending:false}).limit(20),
    supabase.from('equipment_service_log').select('id,equipment_id,service_type,serviced_at,description,cost,next_due_date,provider,created_by,created_at,maintenance_plan_id,incident_id,production_job_id,repair_cause,payer_type,contract_id,resolution').eq('equipment_id',assetId).order('serviced_at',{ascending:false}).order('created_at',{ascending:false}).limit(100)
  ]);
  if(moves.error)throw moves.error;if(services.error)throw services.error;
  state.detailMovements=moves.data||[];state.detailServices=services.data||[];
}
async function load(force=false){
  if(state.loading){if(force)state.reloadQueued=true;return}
  state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';
  try{
    await loadBase();
    if(state.activeTab==='consumables')await loadConsumables(true);
    if(state.activeTab==='movements')await loadMovements(true);
    if(state.selectedAssetId&&$('detailDlg')?.open){await loadDetailData(state.selectedAssetId);renderDetail(state.selectedAssetId)}
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){
    console.error('Equipment workspace load failed',error);
    $('equipmentGrid').innerHTML=`<div class="a4-error"><b>Не удалось загрузить оборудование</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="equipmentRetry" type="button" class="a4-btn" style="margin-top:10px">Повторить</button></div>`;
    $('equipmentRetry')?.addEventListener('click',()=>load(true));$('updatedAt').textContent='ошибка загрузки';
  }finally{
    state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить';
    if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>load(),0)}
  }
}

function fillSelects(){
  const orgOptions='<option value="">Не выбрано</option>'+state.organizations.map(o=>`<option value="${o.id}">${esc(o.name||o.code)}</option>`).join('');
  $('eqOrganization').innerHTML=orgOptions;$('conOrganization').innerHTML=orgOptions;
  const currentEqOrg=$('equipmentOrg').value,currentConOrg=$('consumableOrg').value;
  $('equipmentOrg').innerHTML='<option value="">Все подразделения</option>'+state.organizations.map(o=>`<option value="${o.id}">${esc(o.name||o.code)}</option>`).join('');
  $('consumableOrg').innerHTML='<option value="">Все подразделения</option>'+state.organizations.map(o=>`<option value="${o.id}">${esc(o.name||o.code)}</option>`).join('');
  if([...$('equipmentOrg').options].some(o=>o.value===currentEqOrg))$('equipmentOrg').value=currentEqOrg;
  if([...$('consumableOrg').options].some(o=>o.value===currentConOrg))$('consumableOrg').value=currentConOrg;
  $('eqResponsible').innerHTML='<option value="">Не назначен</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.full_name||u.email)}</option>`).join('');
  const assetOptions='<option value="">Не привязано</option>'+state.assets.map(a=>`<option value="${a.id}">${esc(a.inventory_number)} · ${esc(a.name)}</option>`).join('');
  $('moveEquipmentSelect').innerHTML=assetOptions;
  $('movementEquipment').innerHTML='<option value="">Любое оборудование</option>'+state.assets.map(a=>`<option value="${a.id}">${esc(a.inventory_number)} · ${esc(a.name)}</option>`).join('');
  if(state.consumablesLoaded)$('moveConsumable').innerHTML=state.consumables.filter(c=>c.is_active).map(c=>`<option value="${c.id}">${esc(c.name)} · остаток ${qty(balanceBy(c.id)?.current_stock||0)} ${esc(c.unit)}</option>`).join('');
}
function renderKpis(){
  const soon=Date.now()+14*86400000;
  const service=state.assets.filter(a=>a.status!=='WRITTEN_OFF'&&a.next_service_date&&new Date(a.next_service_date+'T23:59:59').getTime()<=soon).length;
  $('equipmentCount').textContent=state.assets.length;$('activeCount').textContent=state.assets.filter(a=>a.status==='ACTIVE').length;$('serviceCount').textContent=service;
  $('lowStockCount').textContent=state.lowStockCount==null?'—':state.lowStockCount;
}
function statusTone(status){return status==='ACTIVE'?'green':status==='REPAIR'?'red':status==='RESERVE'?'blue':status==='WRITTEN_OFF'?'red':'orange'}
function serviceState(a){if(!a.next_service_date)return{label:'ТО не задано',tone:''};const due=new Date(a.next_service_date+'T23:59:59').getTime(),now=Date.now();if(due<now)return{label:'ТО просрочено',tone:'red'};if(due<now+14*86400000)return{label:'ТО скоро',tone:'orange'};return{label:`ТО ${fmtDate(a.next_service_date)}`,tone:'green'}}
function renderEquipment(){
  const q=$('equipmentSearch').value.trim().toLowerCase(),status=$('equipmentStatus').value,org=$('equipmentOrg').value;
  const rows=state.assets.filter(a=>{const u=userBy(a.responsible_user_id),o=orgBy(a.organization_id),text=[a.inventory_number,a.name,a.category,a.brand,a.model,a.serial_number,a.location,u?.full_name,u?.email,o?.name,o?.code].filter(Boolean).join(' ').toLowerCase();return(!q||text.includes(q))&&(!status||a.status===status)&&(!org||a.organization_id===org)});
  $('equipmentGrid').innerHTML=rows.map(a=>{const u=userBy(a.responsible_user_id),s=serviceState(a);return `<article class="eq-asset" tabindex="0" data-asset="${a.id}"><div class="eq-asset-top"><div><div class="eq-inv">${esc(a.inventory_number)}</div><h3>${esc(a.name)}</h3><div class="eq-muted">${esc([a.brand,a.model].filter(Boolean).join(' ')||a.category||'Категория не указана')}</div></div><span class="eq-badge ${statusTone(a.status)}">${esc(statusLabels[a.status]||a.status)}</span></div><div class="eq-meta"><div><span>Место</span><b>${esc(a.location||'—')}</b></div><div><span>Ответственный</span><b>${esc(u?.full_name||u?.email||'—')}</b></div><div><span>Последнее ТО</span><b>${esc(fmtDate(a.last_service_date))}</b></div><div><span>Сервис</span><b class="${s.tone==='red'?'eq-service-due':''}">${esc(s.label)}</b></div></div></article>`}).join('')||'<div class="eq-empty">Оборудование не найдено</div>';
  document.dispatchEvent(new CustomEvent('a4:equipment-grid-rendered'));
}
function renderConsumables(){
  if(!state.consumablesLoaded){$('consumablesList').innerHTML='<div class="eq-empty">Откройте вкладку для загрузки расходников</div>';return}
  const q=$('consumableSearch').value.trim().toLowerCase(),filter=$('stockFilter').value,org=$('consumableOrg').value;
  const rows=state.balances.filter(b=>{const c=consumableBy(b.consumable_id),o=orgBy(b.organization_id),text=[b.name,b.category,b.sku,b.storage_location,c?.supplier,o?.name].filter(Boolean).join(' ').toLowerCase();if(q&&!text.includes(q))return false;if(org&&b.organization_id!==org)return false;const stock=Number(b.current_stock||0);if(filter==='LOW'&&!b.low_stock)return false;if(filter==='ZERO'&&stock!==0)return false;if(filter==='OK'&&(b.low_stock||stock<=0))return false;return true});
  $('consumablesList').innerHTML=rows.map(b=>{const c=consumableBy(b.consumable_id),o=orgBy(b.organization_id),linked=state.links.filter(l=>l.consumable_id===b.consumable_id).length,low=b.low_stock;return `<div class="eq-row" data-consumable="${b.consumable_id}"><div><b>${esc(b.name)}</b><small>${esc([b.category,b.sku?`SKU ${b.sku}`:'',o?.name].filter(Boolean).join(' · '))}</small></div><div><span class="eq-stock ${low?'low':''}">${qty(b.current_stock)} ${esc(b.unit)}</span><small>мин. ${qty(b.min_stock)}</small></div><div class="hide-mobile"><b>${linked}</b><small>совместимых устройств</small></div><div class="hide-mid"><b>${esc(b.storage_location||'—')}</b><small>место хранения</small></div><div class="hide-mid"><b>${esc(c?.supplier||'—')}</b><small>поставщик</small></div><div>${canManage()?`<button type="button" class="eq-tab" data-edit-consumable="${b.consumable_id}">Изменить</button>`:`<span class="eq-badge ${low?'red':'green'}">${low?'Мало':'Норма'}</span>`}</div></div>`}).join('')||'<div class="eq-empty">Расходники не найдены</div>';
  document.dispatchEvent(new CustomEvent('a4:equipment-consumables-rendered'));
}
function renderMovements(){
  if(!state.movementsLoaded){$('movementsList').innerHTML='<div class="eq-empty">Откройте вкладку для загрузки движений</div>';return}
  const q=$('movementSearch').value.trim().toLowerCase(),type=$('movementType').value,equipment=$('movementEquipment').value;
  const rows=state.movements.filter(m=>{const c=consumableBy(m.consumable_id),a=assetBy(m.equipment_id),u=userBy(m.created_by),text=[c?.name,c?.sku,a?.inventory_number,a?.name,m.document_ref,m.note,u?.full_name,u?.email].filter(Boolean).join(' ').toLowerCase();return(!q||text.includes(q))&&(!type||m.movement_type===type)&&(!equipment||m.equipment_id===equipment)});
  $('movementsList').innerHTML=rows.map(m=>{const c=consumableBy(m.consumable_id),a=assetBy(m.equipment_id),u=userBy(m.created_by),positive=Number(m.quantity_delta)>0;return `<div class="eq-row"><div><b>${esc(c?.name||'Расходник')}</b><small>${esc(moveLabels[m.movement_type]||m.movement_type)} · ${esc(fmtDateTime(m.created_at))}</small></div><div><span class="${positive?'eq-move-plus':'eq-move-minus'}">${positive?'+':''}${qty(m.quantity_delta)} ${esc(c?.unit||'')}</span><small>движение</small></div><div class="hide-mobile"><b>${esc(a?.inventory_number||'—')}</b><small>${esc(a?.name||'без оборудования')}</small></div><div class="hide-mid"><b>${esc(m.document_ref||'—')}</b><small>основание</small></div><div class="hide-mid"><b>${esc(u?.full_name||u?.email||'—')}</b><small>${esc(m.note||'')}</small></div><div><span class="eq-badge ${positive?'green':'orange'}">${esc(moveLabels[m.movement_type]||m.movement_type)}</span></div></div>`}).join('')||'<div class="eq-empty">Движений пока нет</div>';
}

function openEquipment(a=null){
  if(!canManage())return;$('equipmentForm').reset();$('equipmentError').textContent='';$('equipmentId').value=a?.id||'';$('equipmentDlgTitle').textContent=a?'Редактировать оборудование':'Новое оборудование';$('equipmentDlgText').textContent=a?`Инвентарный номер ${a.inventory_number}`:'Инвентарный номер будет присвоен автоматически.';
  $('eqOrganization').value=a?.organization_id||state.organizationId||'';$('eqName').value=a?.name||'';$('eqCategory').value=a?.category||'';$('eqBrand').value=a?.brand||'';$('eqModel').value=a?.model||'';$('eqSerial').value=a?.serial_number||'';$('eqLocation').value=a?.location||'';$('eqResponsible').value=a?.responsible_user_id||'';$('eqStatus').value=a?.status||'ACTIVE';$('eqPurchaseDate').value=a?.purchase_date||'';$('eqPurchasePrice').value=a?.purchase_price??'';$('eqWarranty').value=a?.warranty_until||'';$('eqServiceInterval').value=a?.service_interval_days??'';$('eqLastService').value=a?.last_service_date||'';$('eqNextService').value=a?.next_service_date||'';$('eqNotes').value=a?.notes||'';$('equipmentDlg').showModal();
}
async function saveEquipment(e){
  e.preventDefault();if(!canManage())return;const b=$('saveEquipment');b.disabled=true;$('equipmentError').textContent='';const id=$('equipmentId').value;let next=$('eqNextService').value||null;const last=$('eqLastService').value,interval=Number($('eqServiceInterval').value||0);if(!next&&last&&interval>0)next=addDays(last,interval);
  const payload={organization_id:$('eqOrganization').value||state.organizationId||null,name:$('eqName').value.trim(),category:$('eqCategory').value||null,brand:$('eqBrand').value.trim()||null,model:$('eqModel').value.trim()||null,serial_number:$('eqSerial').value.trim()||null,location:$('eqLocation').value.trim()||null,responsible_user_id:$('eqResponsible').value||null,status:$('eqStatus').value,purchase_date:$('eqPurchaseDate').value||null,purchase_price:$('eqPurchasePrice').value?Number($('eqPurchasePrice').value):null,warranty_until:$('eqWarranty').value||null,service_interval_days:interval||null,last_service_date:last||null,next_service_date:next,notes:$('eqNotes').value.trim()||null};if(!id)payload.created_by=state.profileId;
  try{const q=id?supabase.from('equipment_assets').update(payload).eq('id',id):supabase.from('equipment_assets').insert(payload);const {error}=await q;if(error)throw error;$('equipmentDlg').close();await load(true)}catch(err){$('equipmentError').textContent=err.message||String(err)}finally{b.disabled=false}
}
async function openConsumable(c=null){
  if(!canManage())return;await loadConsumables();$('consumableForm').reset();$('consumableError').textContent='';$('consumableId').value=c?.id||'';$('consumableDlgTitle').textContent=c?'Редактировать расходник':'Новый расходник';$('conOrganization').value=c?.organization_id||state.organizationId||'';$('conName').value=c?.name||'';$('conCategory').value=c?.category||'';$('conSku').value=c?.sku||'';$('conUnit').value=c?.unit||'шт';$('conMinStock').value=c?.min_stock??0;$('conStorage').value=c?.storage_location||'';$('conSupplier').value=c?.supplier||'';$('conActive').value=c?.is_active===false?'0':'1';$('conNotes').value=c?.notes||'';$('consumableDlg').showModal();document.dispatchEvent(new CustomEvent('a4:equipment-consumable-dialog-opened'));
}
async function saveConsumable(e){
  e.preventDefault();if(!canManage())return;const b=$('saveConsumable');b.disabled=true;$('consumableError').textContent='';const id=$('consumableId').value,payload={organization_id:$('conOrganization').value||state.organizationId||null,name:$('conName').value.trim(),category:$('conCategory').value.trim()||null,sku:$('conSku').value.trim()||null,unit:$('conUnit').value.trim()||'шт',min_stock:Number($('conMinStock').value||0),storage_location:$('conStorage').value.trim()||null,supplier:$('conSupplier').value.trim()||null,is_active:$('conActive').value==='1',notes:$('conNotes').value.trim()||null};if(!id)payload.created_by=state.profileId;
  try{const q=id?supabase.from('equipment_consumables').update(payload).eq('id',id):supabase.from('equipment_consumables').insert(payload);const {error}=await q;if(error)throw error;$('consumableDlg').close();await loadConsumables(true)}catch(err){$('consumableError').textContent=err.message||String(err)}finally{b.disabled=false}
}
async function openMovement(consumableId='',equipmentId=''){
  if(!canMove())return;await loadConsumables();$('movementForm').reset();$('movementError').textContent='';$('moveType').value='RECEIPT';$('moveQty').value='1';fillSelects();if(consumableId)$('moveConsumable').value=consumableId;if(equipmentId)$('moveEquipmentSelect').value=equipmentId;updateMovementHint();$('movementDlg').showModal();document.dispatchEvent(new CustomEvent('a4:equipment-movement-dialog-opened'));
}
function updateMovementHint(){const c=consumableBy($('moveConsumable').value),b=balanceBy(c?.id),type=$('moveType').value;$('movementHint').textContent=c?`Доступно: ${qty(b?.current_stock||0)} ${c.unit}. ${type==='ADJUSTMENT'?'Для корректировки можно указать положительное или отрицательное число.':'Количество вводится положительным числом.'}`:''}
async function saveMovement(e){
  e.preventDefault();if(!canMove())return;const b=$('saveMovement');b.disabled=true;$('movementError').textContent='';const type=$('moveType').value,raw=Number($('moveQty').value);if(!raw||(type!=='ADJUSTMENT'&&raw<0)){$('movementError').textContent='Проверьте количество.';b.disabled=false;return}let delta=raw;if(type==='ISSUE'||type==='WRITE_OFF')delta=-Math.abs(raw);else if(type==='RECEIPT'||type==='RETURN')delta=Math.abs(raw);
  const payload={consumable_id:$('moveConsumable').value,equipment_id:$('moveEquipmentSelect').value||null,movement_type:type,quantity_delta:delta,note:$('moveNote').value.trim()||null,document_ref:$('moveDocument').value.trim()||null,created_by:state.profileId};
  try{const {error}=await supabase.from('equipment_consumable_movements').insert(payload);if(error)throw error;$('movementDlg').close();await loadConsumables(true);if(state.activeTab==='movements')await loadMovements(true);if(state.selectedAssetId&&$('detailDlg')?.open){await loadDetailData(state.selectedAssetId);renderDetail(state.selectedAssetId)}}catch(err){$('movementError').textContent=String(err.message||err).replace('INSUFFICIENT_CONSUMABLE_STOCK:','Недостаточный остаток:')}finally{b.disabled=false}
}
function openService(assetId){
  if(!canManage())return;const a=assetBy(assetId);if(!a)return;$('serviceForm').reset();$('serviceError').textContent='';$('serviceEquipmentId').value=assetId;$('serviceDlgText').textContent=`${a.inventory_number} · ${a.name}`;$('serviceType').value='MAINTENANCE';$('serviceDate').value=isoToday();$('serviceCost').value='';$('serviceProvider').value='';$('serviceDescription').value='';$('serviceNext').value=a.service_interval_days?addDays(isoToday(),a.service_interval_days):(a.next_service_date||'');$('serviceDlg').showModal();
}
async function saveService(e){
  e.preventDefault();if(!canManage())return;const b=$('saveService');b.disabled=true;$('serviceError').textContent='';const equipmentId=$('serviceEquipmentId').value,servicedAt=$('serviceDate').value,description=$('serviceDescription').value.trim();if(!equipmentId||!servicedAt||!description){$('serviceError').textContent='Укажите дату и что было сделано.';b.disabled=false;return}
  const costRaw=$('serviceCost').value.trim(),payload={equipment_id:equipmentId,service_type:$('serviceType').value,serviced_at:servicedAt,description,cost:costRaw===''?null:Number(costRaw),next_due_date:$('serviceNext').value||null,provider:$('serviceProvider').value.trim()||null,created_by:state.profileId};
  try{const {error}=await supabase.from('equipment_service_log').insert(payload);if(error)throw error;$('serviceDlg').close();await loadAssets();renderKpis();renderEquipment();if(state.selectedAssetId===equipmentId&&$('detailDlg')?.open){await loadDetailData(equipmentId);renderDetail(equipmentId)}}catch(err){$('serviceError').textContent=err.message||String(err)}finally{b.disabled=false}
}

async function openDetail(id){
  state.selectedAssetId=id;$('detailBody').innerHTML='<div class="eq-empty">Загрузка карточки…</div>';$('detailDlg').showModal();
  try{await loadDetailData(id);renderDetail(id)}catch(error){$('detailBody').innerHTML=`<div class="a4-error">${esc(error.message||error)}</div>`}
}
function renderDetail(id){
  const a=assetBy(id);if(!a)return;const u=userBy(a.responsible_user_id),o=orgBy(a.organization_id),linked=state.links.filter(l=>l.equipment_id===id),moves=state.detailMovements,services=state.detailServices,available=state.consumables.filter(c=>c.is_active&&!linked.some(l=>l.consumable_id===c.id)),serviceCost=services.reduce((sum,s)=>sum+Number(s.cost||0),0);
  $('detailBody').innerHTML=`<div class="eq-detail-hero"><div><div class="eq-inv">${esc(a.inventory_number)}</div><h3>${esc(a.name)}</h3><div class="eq-muted">${esc([a.brand,a.model,a.serial_number?`S/N ${a.serial_number}`:''].filter(Boolean).join(' · '))}</div></div><div class="eq-actions">${canManage()?`<button type="button" data-edit-asset="${a.id}">Изменить</button><button class="primary" type="button" data-open-service="${a.id}">+ Записать ТО</button>`:''}${canMove()?`<button class="green" type="button" data-issue-asset="${a.id}">Выдать расходник</button>`:''}</div></div>
  <div class="eq-meta"><div><span>Статус</span><b>${esc(statusLabels[a.status]||a.status)}</b></div><div><span>Подразделение</span><b>${esc(o?.name||'—')}</b></div><div><span>Место</span><b>${esc(a.location||'—')}</b></div><div><span>Ответственный</span><b>${esc(u?.full_name||u?.email||'—')}</b></div><div><span>Покупка</span><b>${esc(fmtDate(a.purchase_date))}${a.purchase_price!=null?' · '+esc(money(a.purchase_price)):''}</b></div><div><span>Гарантия</span><b>${esc(fmtDate(a.warranty_until))}</b></div><div><span>Последнее обслуживание</span><b>${esc(fmtDate(a.last_service_date))}</b></div><div><span>Следующее ТО</span><b>${esc(fmtDate(a.next_service_date))}</b></div></div>
  ${a.notes?`<div class="eq-detail-section"><h4>Комментарий</h4><div class="eq-muted">${esc(a.notes)}</div></div>`:''}
  <div class="eq-detail-section"><h4>Совместимые расходники</h4><div class="eq-mini-list">${linked.length?linked.map(l=>{const c=consumableBy(l.consumable_id),b=balanceBy(l.consumable_id);return `<div class="eq-mini"><span><b>${esc(c?.name||'Расходник')}</b><small>${esc(l.note||c?.sku||'')}</small></span><strong class="${b?.low_stock?'eq-service-due':''}">${qty(b?.current_stock||0)} ${esc(c?.unit||'')}</strong></div>`}).join(''):'<div class="eq-empty" style="padding:16px">Расходники ещё не привязаны</div>'}</div>${canManage()?`<div class="eq-inline" style="margin-top:9px"><label class="eq-field"><span>Добавить совместимый расходник</span><select id="detailConsumable"><option value="">Выберите…</option>${available.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><button class="primary" type="button" data-link-consumable="${a.id}">Привязать</button></div>`:''}</div>
  <div class="eq-detail-section"><div class="eq-detail-title"><h4>ТО и обслуживание</h4><div class="eq-muted">Записей: <b>${services.length}</b> · затраты: <b>${esc(money(serviceCost))}</b></div></div><div class="eq-mini-list">${services.length?services.map(s=>{const creator=userBy(s.created_by);return `<div class="eq-mini"><span><b>${esc(serviceLabels[s.service_type]||s.service_type)} · ${esc(fmtDate(s.serviced_at))}</b><small>${esc(s.description)}${s.provider?' · исполнитель: '+esc(s.provider):''}${s.next_due_date?' · следующее ТО '+esc(fmtDate(s.next_due_date)):''}${creator?' · записал '+esc(creator.full_name||creator.email):''}</small></span><strong>${s.cost!=null?esc(money(s.cost)):'—'}</strong></div>`}).join(''):'<div class="eq-empty" style="padding:16px">Записей обслуживания нет</div>'}</div>${canManage()?`<div class="eq-inline"><button class="primary" type="button" data-open-service="${a.id}">+ Записать ТО / ремонт</button></div>`:''}</div>
  <div class="eq-detail-section"><h4>Последние движения расходников</h4><div class="eq-mini-list">${moves.length?moves.map(m=>{const c=consumableBy(m.consumable_id),pos=Number(m.quantity_delta)>0;return `<div class="eq-mini"><span><b>${esc(c?.name||'Расходник')} · ${esc(moveLabels[m.movement_type]||m.movement_type)}</b><small>${esc(fmtDateTime(m.created_at))}${m.note?' · '+esc(m.note):''}</small></span><strong class="${pos?'eq-move-plus':'eq-move-minus'}">${pos?'+':''}${qty(m.quantity_delta)} ${esc(c?.unit||'')}</strong></div>`}).join(''):'<div class="eq-empty" style="padding:16px">Движений нет</div>'}</div></div>`;
  document.dispatchEvent(new CustomEvent('a4:equipment-detail-rendered',{detail:{equipmentId:id}}));
}
async function linkConsumable(assetId){
  const cid=$('detailConsumable')?.value;if(!cid)return;const {error}=await supabase.from('equipment_consumable_links').insert({equipment_id:assetId,consumable_id:cid,created_by:state.profileId});
  if(error){notify('error','Не удалось привязать расходник',error.message||String(error));return}
  await loadConsumables(true);await loadDetailData(assetId);renderDetail(assetId);
}

async function switchTab(name){
  state.activeTab=name;
  for(const b of document.querySelectorAll('[data-tab]'))b.classList.toggle('active',b.dataset.tab===name);
  for(const [n,id] of [['equipment','equipmentTab'],['consumables','consumablesTab'],['movements','movementsTab']])$(id).classList.toggle('eq-hidden',n!==name);
  try{
    if(name==='consumables'){if(!state.consumablesLoaded)$('consumablesList').innerHTML='<div class="eq-empty">Загрузка расходников…</div>';await loadConsumables()}
    if(name==='movements'){if(!state.movementsLoaded)$('movementsList').innerHTML='<div class="eq-empty">Загрузка движений…</div>';await loadMovements()}
  }catch(error){const target=name==='consumables'?'consumablesList':'movementsList';$(target).innerHTML=`<div class="a4-error">${esc(error.message||error)}</div>`}
}

$('refresh').addEventListener('click',()=>load(true));
$('addEquipment').addEventListener('click',()=>openEquipment());
$('addConsumable').addEventListener('click',()=>openConsumable());
$('addMovement').addEventListener('click',()=>openMovement());
$('addMovement2').addEventListener('click',()=>openMovement());
$('equipmentForm').addEventListener('submit',saveEquipment);$('consumableForm').addEventListener('submit',saveConsumable);$('movementForm').addEventListener('submit',saveMovement);$('serviceForm').addEventListener('submit',saveService);
$('moveConsumable').addEventListener('change',updateMovementHint);$('moveType').addEventListener('change',updateMovementHint);
for(const id of ['equipmentSearch','equipmentStatus','equipmentOrg'])$(id).addEventListener(id==='equipmentSearch'?'input':'change',renderEquipment);
for(const id of ['consumableSearch','stockFilter','consumableOrg'])$(id).addEventListener(id==='consumableSearch'?'input':'change',renderConsumables);
for(const id of ['movementSearch','movementType','movementEquipment'])$(id).addEventListener(id==='movementSearch'?'input':'change',renderMovements);
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>void switchTab(b.dataset.tab)));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
document.addEventListener('click',e=>{
  const asset=e.target.closest('[data-asset]');if(asset&&!e.target.closest('button,a,input,select,textarea'))void openDetail(asset.dataset.asset);
  const editC=e.target.closest('[data-edit-consumable]');if(editC)void openConsumable(consumableBy(editC.dataset.editConsumable));
  const editA=e.target.closest('[data-edit-asset]');if(editA){$('detailDlg').close();openEquipment(assetBy(editA.dataset.editAsset))}
  const issue=e.target.closest('[data-issue-asset]');if(issue)void openMovement('',issue.dataset.issueAsset);
  const link=e.target.closest('[data-link-consumable]');if(link)void linkConsumable(link.dataset.linkConsumable);
  const service=e.target.closest('[data-open-service]');if(service)openService(service.dataset.openService);
});
document.addEventListener('keydown',e=>{const asset=e.target.closest?.('[data-asset]');if(asset&&(e.key==='Enter'||e.key===' ')){e.preventDefault();void openDetail(asset.dataset.asset)}});

function realtime(){
  if(typeof supabase.channel!=='function')return;
  const schedule=(key,fn,delay=450)=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>fn().catch(error=>console.warn(key,error)),delay)};
  let ch=supabase.channel('equipment-workspace-v3');
  ch=ch.on('postgres_changes',{event:'*',schema:'public',table:'equipment_assets'},()=>schedule('assets',async()=>{await loadAssets();renderKpis();renderEquipment();fillSelects();if(state.selectedAssetId&&$('detailDlg')?.open)renderDetail(state.selectedAssetId)}));
  ch=ch.on('postgres_changes',{event:'*',schema:'public',table:'equipment_consumables'},()=>{if(state.consumablesLoaded||$('detailDlg')?.open)schedule('consumables',()=>loadConsumables(true))});
  ch=ch.on('postgres_changes',{event:'*',schema:'public',table:'equipment_consumable_links'},()=>{if(state.consumablesLoaded||$('detailDlg')?.open)schedule('links',()=>loadConsumables(true))});
  ch=ch.on('postgres_changes',{event:'*',schema:'public',table:'equipment_consumable_movements'},()=>schedule('movements',async()=>{await loadLowStockCount();renderKpis();if(state.consumablesLoaded)await loadConsumables(true);if(state.activeTab==='movements')await loadMovements(true);if(state.selectedAssetId&&$('detailDlg')?.open){await loadDetailData(state.selectedAssetId);renderDetail(state.selectedAssetId)}}));
  ch=ch.on('postgres_changes',{event:'*',schema:'public',table:'equipment_service_log'},()=>{if(state.selectedAssetId&&$('detailDlg')?.open)schedule('service',async()=>{await loadDetailData(state.selectedAssetId);renderDetail(state.selectedAssetId)})});
  state.channel=ch.subscribe();window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true});
}

await context();await load();realtime();
