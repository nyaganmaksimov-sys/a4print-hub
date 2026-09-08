import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const qty=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:3});
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const fmtDate=v=>{if(!v)return'—';const d=new Date(String(v).length===10?v+'T00:00:00':v);return Number.isFinite(d.getTime())?d.toLocaleDateString('ru-RU'):'—'};
const fmtDateTime=v=>{if(!v)return'—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'};
const statusLabels={ACTIVE:'В эксплуатации',REPAIR:'В ремонте',RESERVE:'Резерв',STORAGE:'На хранении',WRITTEN_OFF:'Списано'};
const moveLabels={RECEIPT:'Приход',ISSUE:'Выдача',RETURN:'Возврат',WRITE_OFF:'Списание',ADJUSTMENT:'Корректировка'};
const serviceLabels={MAINTENANCE:'ТО',REPAIR:'Ремонт',INSPECTION:'Осмотр',CALIBRATION:'Калибровка',CLEANING:'Чистка',OTHER:'Другое'};
const state={assets:[],consumables:[],balances:[],links:[],movements:[],services:[],users:[],organizations:[],roles:[],profileId:null,loading:false,selectedAssetId:null,channel:null};
let reloadTimer=null;

const canManage=()=>['ADMIN','MANAGER','WAREHOUSE'].some(r=>state.roles.includes(r));
const canMove=()=>canManage()||state.roles.includes('PRODUCTION');
const userBy=id=>state.users.find(x=>x.id===id)||null;
const orgBy=id=>state.organizations.find(x=>x.id===id)||null;
const consumableBy=id=>state.consumables.find(x=>x.id===id)||null;
const balanceBy=id=>state.balances.find(x=>x.consumable_id===id)||null;
const assetBy=id=>state.assets.find(x=>x.id===id)||null;

async function context(){
  const {data:{session}}=await supabase.auth.getSession();
  const [roles,profile]=await Promise.all([
    supabase.rpc('get_my_roles'),
    session?.user?.id?supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle():Promise.resolve({data:null})
  ]);
  state.roles=Array.isArray(roles.data)?roles.data:[];state.profileId=profile.data?.id||null;
}

async function load(){
  if(state.loading)return;state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';
  try{
    const [assets,consumables,balances,links,movements,services,users,organizations]=await Promise.all([
      supabase.from('equipment_assets').select('*').order('created_at',{ascending:false}),
      supabase.from('equipment_consumables').select('*').order('name'),
      supabase.from('equipment_consumable_balances').select('*').order('name'),
      supabase.from('equipment_consumable_links').select('*'),
      supabase.from('equipment_consumable_movements').select('*').order('created_at',{ascending:false}).limit(1000),
      supabase.from('equipment_service_log').select('*').order('serviced_at',{ascending:false}).limit(1000),
      supabase.from('users').select('id,full_name,email,is_active').eq('is_active',true).order('full_name'),
      supabase.from('organizations').select('id,code,name').order('name')
    ]);
    for(const r of [assets,consumables,balances,links,movements,services,users,organizations])if(r.error)throw r.error;
    state.assets=assets.data||[];state.consumables=consumables.data||[];state.balances=balances.data||[];state.links=links.data||[];state.movements=movements.data||[];state.services=services.data||[];state.users=users.data||[];state.organizations=organizations.data||[];
    fillSelects();renderAll();
    $('addEquipment').hidden=!canManage();$('addConsumable').hidden=!canManage();$('addMovement').hidden=!canMove();$('addMovement2').hidden=!canMove();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
    if(state.selectedAssetId&&$('detailDlg').open)renderDetail(state.selectedAssetId);
  }catch(error){console.error('Equipment workspace load failed',error);$('equipmentGrid').innerHTML=`<div class="eq-empty" style="color:#b91c1c">Ошибка загрузки: ${esc(error.message||error)}</div>`}
  finally{state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить'}
}

function fillSelects(){
  const orgOptions='<option value="">Не выбрано</option>'+state.organizations.map(o=>`<option value="${o.id}">${esc(o.name||o.code)}</option>`).join('');
  $('eqOrganization').innerHTML=orgOptions;$('conOrganization').innerHTML=orgOptions;
  const currentEqOrg=$('equipmentOrg').value,currentConOrg=$('consumableOrg').value;
  $('equipmentOrg').innerHTML='<option value="">Все подразделения</option>'+state.organizations.map(o=>`<option value="${o.id}">${esc(o.name||o.code)}</option>`).join('');
  $('consumableOrg').innerHTML='<option value="">Все подразделения</option>'+state.organizations.map(o=>`<option value="${o.id}">${esc(o.name||o.code)}</option>`).join('');
  $('equipmentOrg').value=currentEqOrg;$('consumableOrg').value=currentConOrg;
  $('eqResponsible').innerHTML='<option value="">Не назначен</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.full_name||u.email)}</option>`).join('');
  const assetOptions='<option value="">Не привязано</option>'+state.assets.map(a=>`<option value="${a.id}">${esc(a.inventory_number)} · ${esc(a.name)}</option>`).join('');
  $('moveEquipmentSelect').innerHTML=assetOptions;$('movementEquipment').innerHTML='<option value="">Любое оборудование</option>'+state.assets.map(a=>`<option value="${a.id}">${esc(a.inventory_number)} · ${esc(a.name)}</option>`).join('');
  $('moveConsumable').innerHTML=state.consumables.filter(c=>c.is_active).map(c=>`<option value="${c.id}">${esc(c.name)} · остаток ${qty(balanceBy(c.id)?.current_stock||0)} ${esc(c.unit)}</option>`).join('');
}

function renderAll(){renderKpis();renderEquipment();renderConsumables();renderMovements()}
function renderKpis(){
  const today=Date.now(),soon=today+14*86400000;
  const service=state.assets.filter(a=>a.status!=='WRITTEN_OFF'&&a.next_service_date&&new Date(a.next_service_date+'T23:59:59').getTime()<=soon).length;
  $('equipmentCount').textContent=state.assets.length;$('activeCount').textContent=state.assets.filter(a=>a.status==='ACTIVE').length;$('serviceCount').textContent=service;$('lowStockCount').textContent=state.balances.filter(b=>b.is_active&&b.low_stock).length;
}
function statusTone(status){return status==='ACTIVE'?'green':status==='REPAIR'?'red':status==='RESERVE'?'blue':status==='WRITTEN_OFF'?'red':'orange'}
function serviceState(a){if(!a.next_service_date)return{label:'ТО не задано',tone:''};const due=new Date(a.next_service_date+'T23:59:59').getTime(),now=Date.now();if(due<now)return{label:'ТО просрочено',tone:'red'};if(due<now+14*86400000)return{label:'ТО скоро',tone:'orange'};return{label:`ТО ${fmtDate(a.next_service_date)}`,tone:'green'}}

function renderEquipment(){
  const q=$('equipmentSearch').value.trim().toLowerCase(),status=$('equipmentStatus').value,org=$('equipmentOrg').value;
  const rows=state.assets.filter(a=>{const u=userBy(a.responsible_user_id),o=orgBy(a.organization_id),text=[a.inventory_number,a.name,a.category,a.brand,a.model,a.serial_number,a.location,u?.full_name,u?.email,o?.name,o?.code].filter(Boolean).join(' ').toLowerCase();return(!q||text.includes(q))&&(!status||a.status===status)&&(!org||a.organization_id===org)});
  $('equipmentGrid').innerHTML=rows.map(a=>{const u=userBy(a.responsible_user_id),o=orgBy(a.organization_id),s=serviceState(a);return `<article class="eq-asset" tabindex="0" data-asset="${a.id}"><div class="eq-asset-top"><div><div class="eq-inv">${esc(a.inventory_number)}</div><h3>${esc(a.name)}</h3><div class="eq-muted">${esc([a.brand,a.model].filter(Boolean).join(' ')||a.category||'Категория не указана')}</div></div><span class="eq-badge ${statusTone(a.status)}">${esc(statusLabels[a.status]||a.status)}</span></div><div class="eq-meta"><div><span>Место</span><b>${esc(a.location||'—')}</b></div><div><span>Ответственный</span><b>${esc(u?.full_name||u?.email||'—')}</b></div><div><span>Подразделение</span><b>${esc(o?.name||'—')}</b></div><div><span>Сервис</span><b class="${s.tone==='red'?'eq-service-due':''}">${esc(s.label)}</b></div></div></article>`}).join('')||'<div class="eq-empty">Оборудование не найдено</div>';
}

function renderConsumables(){
  const q=$('consumableSearch').value.trim().toLowerCase(),filter=$('stockFilter').value,org=$('consumableOrg').value;
  const rows=state.balances.filter(b=>{const c=consumableBy(b.consumable_id),o=orgBy(b.organization_id),text=[b.name,b.category,b.sku,b.storage_location,c?.supplier,o?.name].filter(Boolean).join(' ').toLowerCase();if(q&&!text.includes(q))return false;if(org&&b.organization_id!==org)return false;const stock=Number(b.current_stock||0);if(filter==='LOW'&&!b.low_stock)return false;if(filter==='ZERO'&&stock!==0)return false;if(filter==='OK'&&(b.low_stock||stock<=0))return false;return true});
  $('consumablesList').innerHTML=rows.map(b=>{const c=consumableBy(b.consumable_id),o=orgBy(b.organization_id),linked=state.links.filter(l=>l.consumable_id===b.consumable_id).length,low=b.low_stock;return `<div class="eq-row" data-consumable="${b.consumable_id}"><div><b>${esc(b.name)}</b><small>${esc([b.category,b.sku?`SKU ${b.sku}`:'',o?.name].filter(Boolean).join(' · '))}</small></div><div><span class="eq-stock ${low?'low':''}">${qty(b.current_stock)} ${esc(b.unit)}</span><small>мин. ${qty(b.min_stock)}</small></div><div class="hide-mobile"><b>${linked}</b><small>совместимых устройств</small></div><div class="hide-mid"><b>${esc(b.storage_location||'—')}</b><small>место хранения</small></div><div class="hide-mid"><b>${esc(c?.supplier||'—')}</b><small>поставщик</small></div><div>${canManage()?`<button type="button" class="eq-tab" data-edit-consumable="${b.consumable_id}">Изменить</button>`:`<span class="eq-badge ${low?'red':'green'}">${low?'Мало':'Норма'}</span>`}</div></div>`}).join('')||'<div class="eq-empty">Расходники не найдены</div>';
}

function renderMovements(){
  const q=$('movementSearch').value.trim().toLowerCase(),type=$('movementType').value,equipment=$('movementEquipment').value;
  const rows=state.movements.filter(m=>{const c=consumableBy(m.consumable_id),a=assetBy(m.equipment_id),u=userBy(m.created_by),text=[c?.name,c?.sku,a?.inventory_number,a?.name,m.document_ref,m.note,u?.full_name,u?.email].filter(Boolean).join(' ').toLowerCase();return(!q||text.includes(q))&&(!type||m.movement_type===type)&&(!equipment||m.equipment_id===equipment)});
  $('movementsList').innerHTML=rows.map(m=>{const c=consumableBy(m.consumable_id),a=assetBy(m.equipment_id),u=userBy(m.created_by),positive=Number(m.quantity_delta)>0;return `<div class="eq-row"><div><b>${esc(c?.name||'Расходник')}</b><small>${esc(moveLabels[m.movement_type]||m.movement_type)} · ${esc(fmtDateTime(m.created_at))}</small></div><div><span class="${positive?'eq-move-plus':'eq-move-minus'}">${positive?'+':''}${qty(m.quantity_delta)} ${esc(c?.unit||'')}</span><small>движение</small></div><div class="hide-mobile"><b>${esc(a?.inventory_number||'—')}</b><small>${esc(a?.name||'без оборудования')}</small></div><div class="hide-mid"><b>${esc(m.document_ref||'—')}</b><small>основание</small></div><div class="hide-mid"><b>${esc(u?.full_name||u?.email||'—')}</b><small>${esc(m.note||'')}</small></div><div><span class="eq-badge ${positive?'green':'orange'}">${esc(moveLabels[m.movement_type]||m.movement_type)}</span></div></div>`}).join('')||'<div class="eq-empty">Движений пока нет</div>';
}

function openEquipment(a=null){
  if(!canManage())return;$('equipmentForm').reset();$('equipmentError').textContent='';$('equipmentId').value=a?.id||'';$('equipmentDlgTitle').textContent=a?'Редактировать оборудование':'Новое оборудование';$('equipmentDlgText').textContent=a?`Инвентарный номер ${a.inventory_number}`:'Инвентарный номер будет присвоен автоматически.';
  const defaultOrg=state.organizations.find(o=>o.code==='A4PRINT')?.id||'';$('eqOrganization').value=a?.organization_id||defaultOrg;$('eqName').value=a?.name||'';$('eqCategory').value=a?.category||'';$('eqBrand').value=a?.brand||'';$('eqModel').value=a?.model||'';$('eqSerial').value=a?.serial_number||'';$('eqLocation').value=a?.location||'';$('eqResponsible').value=a?.responsible_user_id||'';$('eqStatus').value=a?.status||'ACTIVE';$('eqPurchaseDate').value=a?.purchase_date||'';$('eqPurchasePrice').value=a?.purchase_price??'';$('eqWarranty').value=a?.warranty_until||'';$('eqServiceInterval').value=a?.service_interval_days??'';$('eqLastService').value=a?.last_service_date||'';$('eqNextService').value=a?.next_service_date||'';$('eqNotes').value=a?.notes||'';$('equipmentDlg').showModal();
}
async function saveEquipment(e){
  e.preventDefault();if(!canManage())return;const b=$('saveEquipment');b.disabled=true;$('equipmentError').textContent='';
  const id=$('equipmentId').value;let next=$('eqNextService').value||null;const last=$('eqLastService').value,interval=Number($('eqServiceInterval').value||0);if(!next&&last&&interval>0){const d=new Date(last+'T00:00:00');d.setDate(d.getDate()+interval);next=d.toISOString().slice(0,10)}
  const payload={organization_id:$('eqOrganization').value||null,name:$('eqName').value.trim(),category:$('eqCategory').value||null,brand:$('eqBrand').value.trim()||null,model:$('eqModel').value.trim()||null,serial_number:$('eqSerial').value.trim()||null,location:$('eqLocation').value.trim()||null,responsible_user_id:$('eqResponsible').value||null,status:$('eqStatus').value,purchase_date:$('eqPurchaseDate').value||null,purchase_price:$('eqPurchasePrice').value?Number($('eqPurchasePrice').value):null,warranty_until:$('eqWarranty').value||null,service_interval_days:interval||null,last_service_date:last||null,next_service_date:next,notes:$('eqNotes').value.trim()||null};
  if(!id)payload.created_by=state.profileId;
  try{const q=id?supabase.from('equipment_assets').update(payload).eq('id',id):supabase.from('equipment_assets').insert(payload);const {error}=await q;if(error)throw error;$('equipmentDlg').close();await load()}catch(err){$('equipmentError').textContent=err.message||String(err)}finally{b.disabled=false}
}

function openConsumable(c=null){
  if(!canManage())return;$('consumableForm').reset();$('consumableError').textContent='';$('consumableId').value=c?.id||'';$('consumableDlgTitle').textContent=c?'Редактировать расходник':'Новый расходник';const defaultOrg=state.organizations.find(o=>o.code==='A4PRINT')?.id||'';$('conOrganization').value=c?.organization_id||defaultOrg;$('conName').value=c?.name||'';$('conCategory').value=c?.category||'';$('conSku').value=c?.sku||'';$('conUnit').value=c?.unit||'шт';$('conMinStock').value=c?.min_stock??0;$('conStorage').value=c?.storage_location||'';$('conSupplier').value=c?.supplier||'';$('conActive').value=c?.is_active===false?'0':'1';$('conNotes').value=c?.notes||'';$('consumableDlg').showModal();
}
async function saveConsumable(e){
  e.preventDefault();if(!canManage())return;const b=$('saveConsumable');b.disabled=true;$('consumableError').textContent='';const id=$('consumableId').value,payload={organization_id:$('conOrganization').value||null,name:$('conName').value.trim(),category:$('conCategory').value.trim()||null,sku:$('conSku').value.trim()||null,unit:$('conUnit').value.trim()||'шт',min_stock:Number($('conMinStock').value||0),storage_location:$('conStorage').value.trim()||null,supplier:$('conSupplier').value.trim()||null,is_active:$('conActive').value==='1',notes:$('conNotes').value.trim()||null};if(!id)payload.created_by=state.profileId;
  try{const q=id?supabase.from('equipment_consumables').update(payload).eq('id',id):supabase.from('equipment_consumables').insert(payload);const {error}=await q;if(error)throw error;$('consumableDlg').close();await load()}catch(err){$('consumableError').textContent=err.message||String(err)}finally{b.disabled=false}
}

function openMovement(consumableId='',equipmentId=''){
  if(!canMove())return;$('movementForm').reset();$('movementError').textContent='';$('moveType').value='RECEIPT';$('moveQty').value='1';fillSelects();if(consumableId)$('moveConsumable').value=consumableId;if(equipmentId)$('moveEquipmentSelect').value=equipmentId;updateMovementHint();$('movementDlg').showModal();
}
function updateMovementHint(){const c=consumableBy($('moveConsumable').value),b=balanceBy(c?.id),type=$('moveType').value;$('movementHint').textContent=c?`Доступно: ${qty(b?.current_stock||0)} ${c.unit}. ${type==='ADJUSTMENT'?'Для корректировки можно указать положительное или отрицательное число.':'Количество вводится положительным числом.'}`:''}
async function saveMovement(e){
  e.preventDefault();if(!canMove())return;const b=$('saveMovement');b.disabled=true;$('movementError').textContent='';const type=$('moveType').value,raw=Number($('moveQty').value);if(!raw||(!['ADJUSTMENT'].includes(type)&&raw<0)){$('movementError').textContent='Проверьте количество.';b.disabled=false;return}let delta=raw;if(type==='ISSUE'||type==='WRITE_OFF')delta=-Math.abs(raw);else if(type==='RECEIPT'||type==='RETURN')delta=Math.abs(raw);const payload={consumable_id:$('moveConsumable').value,equipment_id:$('moveEquipmentSelect').value||null,movement_type:type,quantity_delta:delta,note:$('moveNote').value.trim()||null,document_ref:$('moveDocument').value.trim()||null,created_by:state.profileId};
  try{const {error}=await supabase.from('equipment_consumable_movements').insert(payload);if(error)throw error;$('movementDlg').close();await load()}catch(err){$('movementError').textContent=String(err.message||err).replace('INSUFFICIENT_CONSUMABLE_STOCK:','Недостаточный остаток:')}finally{b.disabled=false}
}

function openDetail(id){state.selectedAssetId=id;renderDetail(id);$('detailDlg').showModal()}
function renderDetail(id){
  const a=assetBy(id);if(!a)return;const u=userBy(a.responsible_user_id),o=orgBy(a.organization_id),linked=state.links.filter(l=>l.equipment_id===id),moves=state.movements.filter(m=>m.equipment_id===id).slice(0,20),services=state.services.filter(s=>s.equipment_id===id).slice(0,20),available=state.consumables.filter(c=>c.is_active&&!linked.some(l=>l.consumable_id===c.id));
  $('detailBody').innerHTML=`<div class="eq-detail-hero"><div><div class="eq-inv">${esc(a.inventory_number)}</div><h3>${esc(a.name)}</h3><div class="eq-muted">${esc([a.brand,a.model,a.serial_number?`S/N ${a.serial_number}`:''].filter(Boolean).join(' · '))}</div></div><div class="eq-actions">${canManage()?`<button type="button" data-edit-asset="${a.id}">Изменить</button>`:''}${canMove()?`<button class="green" type="button" data-issue-asset="${a.id}">Выдать расходник</button>`:''}</div></div><div class="eq-meta"><div><span>Статус</span><b>${esc(statusLabels[a.status]||a.status)}</b></div><div><span>Подразделение</span><b>${esc(o?.name||'—')}</b></div><div><span>Место</span><b>${esc(a.location||'—')}</b></div><div><span>Ответственный</span><b>${esc(u?.full_name||u?.email||'—')}</b></div><div><span>Покупка</span><b>${esc(fmtDate(a.purchase_date))}${a.purchase_price!=null?' · '+esc(money(a.purchase_price)):''}</b></div><div><span>Гарантия</span><b>${esc(fmtDate(a.warranty_until))}</b></div><div><span>Последнее ТО</span><b>${esc(fmtDate(a.last_service_date))}</b></div><div><span>Следующее ТО</span><b>${esc(fmtDate(a.next_service_date))}</b></div></div>${a.notes?`<div class="eq-detail-section"><h4>Комментарий</h4><div class="eq-muted">${esc(a.notes)}</div></div>`:''}<div class="eq-detail-section"><h4>Совместимые расходники</h4><div class="eq-mini-list">${linked.length?linked.map(l=>{const c=consumableBy(l.consumable_id),b=balanceBy(l.consumable_id);return `<div class="eq-mini"><span><b>${esc(c?.name||'Расходник')}</b><small>${esc(l.note||c?.sku||'')}</small></span><strong class="${b?.low_stock?'eq-service-due':''}">${qty(b?.current_stock||0)} ${esc(c?.unit||'')}</strong></div>`}).join(''):'<div class="eq-empty" style="padding:16px">Расходники ещё не привязаны</div>'}</div>${canManage()?`<div class="eq-inline" style="margin-top:9px"><label class="eq-field"><span>Добавить совместимый расходник</span><select id="detailConsumable"><option value="">Выберите…</option>${available.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><button class="primary" type="button" data-link-consumable="${a.id}">Привязать</button></div>`:''}</div><div class="eq-detail-section"><h4>Обслуживание</h4><div class="eq-mini-list">${services.length?services.map(s=>`<div class="eq-mini"><span><b>${esc(serviceLabels[s.service_type]||s.service_type)} · ${esc(fmtDate(s.serviced_at))}</b><small>${esc(s.description)}${s.provider?' · '+esc(s.provider):''}</small></span><strong>${s.cost!=null?esc(money(s.cost)):''}</strong></div>`).join(''):'<div class="eq-empty" style="padding:16px">Записей обслуживания нет</div>'}</div>${canManage()?`<div class="eq-inline" style="margin-top:9px"><label class="eq-field"><span>Тип</span><select id="serviceType"><option value="MAINTENANCE">ТО</option><option value="REPAIR">Ремонт</option><option value="INSPECTION">Осмотр</option><option value="CALIBRATION">Калибровка</option><option value="CLEANING">Чистка</option><option value="OTHER">Другое</option></select></label><label class="eq-field"><span>Описание</span><input id="serviceDescription" placeholder="Что сделано"></label><label class="eq-field"><span>Следующее ТО</span><input id="serviceNext" type="date"></label><button class="primary" type="button" data-add-service="${a.id}">Добавить</button></div>`:''}</div><div class="eq-detail-section"><h4>Последние движения расходников</h4><div class="eq-mini-list">${moves.length?moves.map(m=>{const c=consumableBy(m.consumable_id),pos=Number(m.quantity_delta)>0;return `<div class="eq-mini"><span><b>${esc(c?.name||'Расходник')} · ${esc(moveLabels[m.movement_type]||m.movement_type)}</b><small>${esc(fmtDateTime(m.created_at))}${m.note?' · '+esc(m.note):''}</small></span><strong class="${pos?'eq-move-plus':'eq-move-minus'}">${pos?'+':''}${qty(m.quantity_delta)} ${esc(c?.unit||'')}</strong></div>`}).join(''):'<div class="eq-empty" style="padding:16px">Движений нет</div>'}</div></div>`;
}

async function linkConsumable(assetId){const cid=$('detailConsumable')?.value;if(!cid)return;const {error}=await supabase.from('equipment_consumable_links').insert({equipment_id:assetId,consumable_id:cid,created_by:state.profileId});if(error)return alert(error.message);await load()}
async function addService(assetId){const description=$('serviceDescription')?.value.trim();if(!description)return alert('Укажите описание обслуживания.');const next=$('serviceNext')?.value||null,type=$('serviceType')?.value||'MAINTENANCE',today=new Date().toISOString().slice(0,10);const {error}=await supabase.from('equipment_service_log').insert({equipment_id:assetId,service_type:type,serviced_at:today,description,next_due_date:next,created_by:state.profileId});if(error)return alert(error.message);const patch={last_service_date:today};if(next)patch.next_service_date=next;await supabase.from('equipment_assets').update(patch).eq('id',assetId);await load()}

function switchTab(name){for(const b of document.querySelectorAll('[data-tab]'))b.classList.toggle('active',b.dataset.tab===name);for(const [n,id] of [['equipment','equipmentTab'],['consumables','consumablesTab'],['movements','movementsTab']])$(id).classList.toggle('eq-hidden',n!==name)}

$('refresh').addEventListener('click',load);$('addEquipment').addEventListener('click',()=>openEquipment());$('addConsumable').addEventListener('click',()=>openConsumable());$('addMovement').addEventListener('click',()=>openMovement());$('addMovement2').addEventListener('click',()=>openMovement());$('equipmentForm').addEventListener('submit',saveEquipment);$('consumableForm').addEventListener('submit',saveConsumable);$('movementForm').addEventListener('submit',saveMovement);$('moveConsumable').addEventListener('change',updateMovementHint);$('moveType').addEventListener('change',updateMovementHint);
for(const id of ['equipmentSearch','equipmentStatus','equipmentOrg'])$(id).addEventListener(id==='equipmentSearch'?'input':'change',renderEquipment);for(const id of ['consumableSearch','stockFilter','consumableOrg'])$(id).addEventListener(id==='consumableSearch'?'input':'change',renderConsumables);for(const id of ['movementSearch','movementType','movementEquipment'])$(id).addEventListener(id==='movementSearch'?'input':'change',renderMovements);document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));

document.addEventListener('click',e=>{const asset=e.target.closest('[data-asset]');if(asset&&!e.target.closest('button,a,input,select,textarea'))openDetail(asset.dataset.asset);const editC=e.target.closest('[data-edit-consumable]');if(editC)openConsumable(consumableBy(editC.dataset.editConsumable));const editA=e.target.closest('[data-edit-asset]');if(editA){$('detailDlg').close();openEquipment(assetBy(editA.dataset.editAsset))}const issue=e.target.closest('[data-issue-asset]');if(issue)openMovement('',issue.dataset.issueAsset);const link=e.target.closest('[data-link-consumable]');if(link)linkConsumable(link.dataset.linkConsumable);const service=e.target.closest('[data-add-service]');if(service)addService(service.dataset.addService)});
document.addEventListener('keydown',e=>{const asset=e.target.closest?.('[data-asset]');if(asset&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openDetail(asset.dataset.asset)}});

function realtime(){if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(load,600)};let ch=supabase.channel('equipment-workspace-v1');for(const table of ['equipment_assets','equipment_consumables','equipment_consumable_links','equipment_consumable_movements','equipment_service_log'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);state.channel=ch.subscribe();window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true})}

await context();await load();realtime();
