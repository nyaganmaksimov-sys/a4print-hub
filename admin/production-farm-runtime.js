import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const operationLabels={PRINT_2D:'2D-печать',PRINT_3D_FDM:'3D FDM',PRINT_3D_RESIN:'3D фотополимер',LASER_CUT:'Лазерная резка',LASER_ENGRAVE:'Лазерная гравировка',CNC:'ЧПУ',LAMINATION:'Ламинация',POSTPRESS:'Постпечатная обработка',ASSEMBLY:'Сборка',OTHER:'Другое'};
const machineStatusLabels={FREE:'Свободно',WORKING:'В работе',QUEUED:'В очереди',MAINTENANCE:'ТО',REPAIR:'Ремонт',FAULT:'Неисправность',WAITING_PARTS:'Ждёт запчасти',OFFLINE:'Не используется',RETIRED:'Выведено'};
const unavailable=new Set(['MAINTENANCE','REPAIR','FAULT','WAITING_PARTS','OFFLINE','RETIRED']);
const state={jobs:new Map(),equipment:new Map(),runs:[],permissions:[],channel:null,loading:false,materials:[],reloadTimer:null};
let observer=null,timer=null;

function can(code){return state.permissions.includes(code)}
function machine(id){return state.equipment.get(id)||null}
function jobRun(jobId){return state.runs.find(r=>r.production_job_id===jobId&&!r.ended_at)||null}
function fmtMinutes(value){
  const total=Math.max(0,Math.round(Number(value||0)));const h=Math.floor(total/60),m=total%60;
  return h?`${h} ч ${m} мин`:`${m} мин`;
}
function liveMinutes(job){
  let seconds=Number(job.actual_machine_minutes||0)*60;const run=jobRun(job.id);
  if(run){const started=new Date(run.started_at).getTime();if(Number.isFinite(started))seconds+=Math.max(0,(Date.now()-started)/1000)}
  return seconds/60;
}
function statusClass(status){if(status==='WORKING')return'working';if(status==='QUEUED')return'queue';if(['MAINTENANCE','REPAIR','WAITING_PARTS'].includes(status))return'service';if(['FAULT','OFFLINE','RETIRED'].includes(status))return'bad';return''}
function injectStyle(){
  if(document.querySelector('link[data-production-farm-runtime]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='./production-farm-runtime.css?v=20260914-1';link.dataset.productionFarmRuntime='1';document.head.appendChild(link);
}

function ensureDialogs(){
  if(!$('farmMachineDlg')){
    const d=document.createElement('dialog');d.id='farmMachineDlg';d.className='farm-machine-dialog';d.innerHTML=`<div class="farm-prod-dialog-head"><div><h2>Производственная ферма</h2><p>Текущая загрузка оборудования, очередь и фактическое машинное время</p></div><button type="button" data-farm-runtime-close="farmMachineDlg">×</button></div><div class="farm-machine-body"><section class="farm-machine-kpis"><article class="farm-machine-kpi"><span>Всего машин</span><strong id="farmMachineAll">0</strong></article><article class="farm-machine-kpi"><span>Работают</span><strong id="farmMachineWorking">0</strong></article><article class="farm-machine-kpi"><span>В очереди</span><strong id="farmMachineQueued">0</strong></article><article class="farm-machine-kpi"><span>Недоступны</span><strong id="farmMachineUnavailable">0</strong></article></section><div id="farmMachineGrid" class="farm-machine-grid"><div class="farm-empty">Загрузка…</div></div></div>`;document.body.appendChild(d);
  }
  if(!$('farmJobConfigDlg')){
    const d=document.createElement('dialog');d.id='farmJobConfigDlg';d.className='farm-job-config-dialog';d.innerHTML=`<form id="farmJobConfigForm"><div class="farm-prod-dialog-head"><div><h3 id="farmConfigTitle">Настройка производства</h3><p id="farmConfigSubtitle">Оборудование, операция и плановое машинное время</p></div><button type="button" data-farm-runtime-close="farmJobConfigDlg">×</button></div><div class="farm-config-body"><input id="farmConfigJobId" type="hidden"><div class="farm-config-grid">
      <label class="farm-config-field full"><span>Оборудование</span><select id="farmConfigEquipment"><option value="">Не назначено</option></select></label>
      <label class="farm-config-field full"><span>Позиция заказа</span><select id="farmConfigOrderItem"><option value="">Без привязки к позиции</option></select></label>
      <label class="farm-config-field"><span>Производственная операция</span><select id="farmConfigOperation"><option value="">Не указана</option>${Object.entries(operationLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="farm-config-field"><span>Количество</span><input id="farmConfigQuantity" type="number" min="0.001" step="0.001" value="1"></label>
      <label class="farm-config-field"><span>Плановое время, минут</span><input id="farmConfigPlannedMinutes" type="number" min="0" step="0.01"></label>
      <label class="farm-config-field"><span>Сумма операции, ₽</span><input id="farmConfigOperationAmount" type="number" min="0" step="0.01" value="0"></label>
      <label class="farm-config-field"><span>Основной материал</span><select id="farmConfigMaterial"><option value="">Не выбран</option></select></label>
      <label class="farm-config-field"><span>Плановая себестоимость, ₽</span><input id="farmConfigCost" type="number" min="0" step="0.01" value="0"></label>
      <div class="farm-config-note">Фактическое машинное время считается автоматически по запускам, паузам и завершению. Ручного ввода фактического времени нет.</div>
    </div><div id="farmConfigError" class="farm-config-error"></div></div><div class="farm-config-foot"><button type="button" data-farm-runtime-close="farmJobConfigDlg">Отмена</button><button id="farmConfigSave" class="primary" type="submit">Сохранить</button></div></form>`;document.body.appendChild(d);
    $('farmJobConfigForm').addEventListener('submit',saveConfig);
  }
  document.querySelectorAll('[data-farm-runtime-close]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',()=>$(b.dataset.farmRuntimeClose)?.close())});
}

function installTopButton(){
  if($('farmMachinesBtn'))return;const actions=document.querySelector('.production-top-actions');if(!actions)return;
  const b=document.createElement('button');b.id='farmMachinesBtn';b.type='button';b.className='farm-prod-top-btn';b.textContent='⚙ Машины';b.addEventListener('click',()=>{ensureDialogs();renderMachines();$('farmMachineDlg').showModal()});
  actions.insertBefore(b,$('refresh')||null);
}

async function loadPermissions(){const {data,error}=await supabase.rpc('get_my_permissions');if(error)throw error;state.permissions=Array.isArray(data)?data:[]}
async function loadData(){
  if(state.loading)return;state.loading=true;
  try{
    const [jobs,equipment,runs]=await Promise.all([
      supabase.from('production_jobs').select('id,order_id,order_item_id,equipment_id,status,title,quantity,operation_type,planned_machine_minutes,actual_machine_minutes,operation_amount,primary_material_id,production_cost,priority,created_at,updated_at'),
      supabase.from('equipment_assets').select('id,inventory_number,name,brand,model,status,operational_status,ownership_type,location').order('name'),
      supabase.from('production_job_runs').select('id,production_job_id,equipment_id,operator_user_id,started_at,ended_at,elapsed_seconds,end_reason').order('started_at',{ascending:false}).limit(2000)
    ]);
    for(const result of [jobs,equipment,runs])if(result.error)throw result.error;
    state.jobs=new Map((jobs.data||[]).map(j=>[j.id,j]));state.equipment=new Map((equipment.data||[]).map(e=>[e.id,e]));state.runs=runs.data||[];
    enhanceCards();renderMachines();
  }catch(error){console.warn('Production farm runtime load failed',error)}finally{state.loading=false}
}

function runtimeActions(job){
  if(!can('production.manage'))return'';
  const buttons=[`<button class="farm-configure" data-farm-config="${job.id}" type="button">⚙ Настроить</button>`];
  if(job.equipment_id&&['NEW','QUEUED'].includes(job.status))buttons.push(`<button class="farm-start" data-farm-action="${job.id}|START" type="button">▶ Старт</button>`);
  if(job.status==='IN_PROGRESS')buttons.push(`<button class="farm-pause" data-farm-action="${job.id}|PAUSE" type="button">Ⅱ Пауза</button>`,`<button class="farm-finish" data-farm-action="${job.id}|COMPLETE" type="button">✓ Готово</button>`);
  if(job.status==='PAUSED')buttons.push(`<button class="farm-start" data-farm-action="${job.id}|RESUME" type="button">▶ Продолжить</button>`,`<button class="farm-finish" data-farm-action="${job.id}|COMPLETE" type="button">✓ Готово</button>`);
  return `<div class="farm-job-actions">${buttons.join('')}</div>`;
}
function runtimeHtml(job){
  const e=machine(job.equipment_id),run=jobRun(job.id),running=job.status==='IN_PROGRESS'&&Boolean(run),unconfigured=!job.equipment_id;
  const cls=running?'running':job.status==='PAUSED'?'paused':unconfigured?'unconfigured':'';
  const name=e?`${e.inventory_number} · ${e.name}`:'Станок не назначен';
  const detail=e?[e.brand,e.model,machineStatusLabels[e.operational_status]||e.operational_status].filter(Boolean).join(' · '):'Назначьте оборудование перед фактическим запуском';
  const op=job.operation_type?operationLabels[job.operation_type]||job.operation_type:'Операция не указана';
  const live=liveMinutes(job),plan=Number(job.planned_machine_minutes||0);
  const warning=e&&unavailable.has(e.operational_status)?`<div class="farm-runtime-warning">Оборудование сейчас недоступно: ${esc(machineStatusLabels[e.operational_status]||e.operational_status)}</div>`:'';
  return `<div class="farm-job-runtime ${cls}" data-farm-runtime-for="${job.id}"><div class="farm-job-machine"><div class="farm-job-machine-main"><b>${running?'<span class="farm-live-dot"></span>':''}${esc(name)}</b><small>${esc(detail)}</small><span class="farm-op-chip">${esc(op)}</span></div><div class="farm-job-time"><b class="farm-runtime-clock" data-farm-clock="${job.id}">${esc(fmtMinutes(live))}</b><small>${plan>0?`план ${esc(fmtMinutes(plan))}`:'план не задан'}</small></div></div>${warning}${runtimeActions(job)}</div>`;
}
function enhanceCards(){
  document.querySelectorAll('article.production-job').forEach(card=>{
    const control=card.querySelector('[data-status][data-id], [data-edit]');const id=control?.dataset.id||control?.dataset.edit;if(!id)return;
    const job=state.jobs.get(id);if(!job)return;
    card.querySelector('[data-farm-runtime-for]')?.remove();
    const holder=document.createElement('div');holder.innerHTML=runtimeHtml(job);const runtime=holder.firstElementChild;
    const actions=card.querySelector('.production-job-actions');if(actions)actions.insertAdjacentElement('beforebegin',runtime);else card.appendChild(runtime);
  });
}
function updateTimers(){
  document.querySelectorAll('[data-farm-clock]').forEach(el=>{const job=state.jobs.get(el.dataset.farmClock);if(job)el.textContent=fmtMinutes(liveMinutes(job))});
  if($('farmMachineDlg')?.open)renderMachines();
}

function machineRuntimeToday(equipmentId){
  const start=new Date();start.setHours(0,0,0,0);let seconds=0;
  for(const r of state.runs){if(r.equipment_id!==equipmentId)continue;const s=new Date(r.started_at).getTime();if(!Number.isFinite(s)||s<start.getTime())continue;if(r.ended_at)seconds+=Number(r.elapsed_seconds||0);else seconds+=Math.max(0,(Date.now()-s)/1000)}
  return seconds/60;
}
function renderMachines(){
  if(!$('farmMachineGrid'))return;const rows=[...state.equipment.values()];
  $('farmMachineAll').textContent=rows.length;$('farmMachineWorking').textContent=rows.filter(e=>e.operational_status==='WORKING').length;$('farmMachineQueued').textContent=rows.filter(e=>e.operational_status==='QUEUED').length;$('farmMachineUnavailable').textContent=rows.filter(e=>unavailable.has(e.operational_status)).length;
  $('farmMachineGrid').innerHTML=rows.map(e=>{
    const current=[...state.jobs.values()].find(j=>j.equipment_id===e.id&&j.status==='IN_PROGRESS');const queue=[...state.jobs.values()].filter(j=>j.equipment_id===e.id&&['NEW','QUEUED','PAUSED'].includes(j.status));
    return `<article class="farm-machine-card"><div class="farm-machine-card-head"><div><b>${esc(e.inventory_number)} · ${esc(e.name)}</b><br><small>${esc([e.brand,e.model,e.location].filter(Boolean).join(' · ')||'')}</small></div><span class="farm-status-pill ${statusClass(e.operational_status)}">${esc(machineStatusLabels[e.operational_status]||e.operational_status)}</span></div><div class="farm-machine-card-body"><span>Сейчас</span><strong>${current?esc(current.title):'—'}</strong><span>Очередь</span><strong>${queue.length}</strong><span>Сегодня</span><strong>${esc(fmtMinutes(machineRuntimeToday(e.id)))}</strong><span>Владение</span><strong>${esc(e.ownership_type==='HUB'?'HUB':e.ownership_type||'—')}</strong></div></article>`;
  }).join('')||'<div class="farm-empty">Оборудование не заведено</div>';
}

async function loadMaterials(){
  if(state.materials.length)return;
  const {data,error}=await supabase.from('catalog_items').select('id,sku,name,item_type,is_active').eq('is_active',true).eq('item_type','MATERIAL').order('name').limit(1000);
  if(!error)state.materials=data||[];
}
async function openConfig(id){
  if(!can('production.manage'))return;ensureDialogs();const job=state.jobs.get(id);if(!job)return;
  $('farmConfigJobId').value=id;$('farmConfigTitle').textContent=job.title||'Настройка производства';$('farmConfigSubtitle').textContent='Оборудование, операция и плановое машинное время';$('farmConfigError').textContent='';
  $('farmConfigEquipment').innerHTML='<option value="">Не назначено</option>'+[...state.equipment.values()].map(e=>{const disabled=unavailable.has(e.operational_status)&&e.id!==job.equipment_id?' disabled':'';return `<option value="${e.id}"${disabled}>${esc(e.inventory_number)} · ${esc(e.name)} — ${esc(machineStatusLabels[e.operational_status]||e.operational_status)}</option>`}).join('');$('farmConfigEquipment').value=job.equipment_id||'';
  $('farmConfigOperation').value=job.operation_type||'';$('farmConfigQuantity').value=Number(job.quantity||1);$('farmConfigPlannedMinutes').value=job.planned_machine_minutes??'';$('farmConfigOperationAmount').value=job.operation_amount??0;$('farmConfigCost').value=job.production_cost??0;
  $('farmConfigOrderItem').innerHTML='<option value="">Без привязки к позиции</option>';
  if(job.order_id){const {data,error}=await supabase.from('order_items').select('id,name,quantity,unit_price,total_price').eq('order_id',job.order_id).order('name');if(!error)$('farmConfigOrderItem').innerHTML='<option value="">Без привязки к позиции</option>'+((data||[]).map(i=>`<option value="${i.id}">${esc(i.name)} · ${Number(i.quantity||0).toLocaleString('ru-RU')}</option>`).join(''));}
  $('farmConfigOrderItem').value=job.order_item_id||'';
  await loadMaterials();$('farmConfigMaterial').innerHTML='<option value="">Не выбран</option>'+state.materials.map(m=>`<option value="${m.id}">${esc(m.sku)} · ${esc(m.name)}</option>`).join('');$('farmConfigMaterial').value=job.primary_material_id||'';
  $('farmJobConfigDlg').showModal();
}
async function saveConfig(event){
  event.preventDefault();const button=$('farmConfigSave');button.disabled=true;$('farmConfigError').textContent='';
  try{
    const payload={p_job_id:$('farmConfigJobId').value,p_equipment_id:$('farmConfigEquipment').value||null,p_order_item_id:$('farmConfigOrderItem').value||null,p_operation_type:$('farmConfigOperation').value||null,p_quantity:Number($('farmConfigQuantity').value||1),p_planned_machine_minutes:$('farmConfigPlannedMinutes').value===''?null:Number($('farmConfigPlannedMinutes').value),p_operation_amount:Number($('farmConfigOperationAmount').value||0),p_primary_material_id:$('farmConfigMaterial').value||null,p_production_cost:Number($('farmConfigCost').value||0)};
    const {error}=await supabase.rpc('configure_production_job',payload);if(error)throw error;$('farmJobConfigDlg').close();await loadData();
  }catch(error){$('farmConfigError').textContent=translateError(error)}finally{button.disabled=false}
}
function translateError(error){
  const text=String(error?.message||error||'Ошибка');
  if(text.includes('EQUIPMENT_REQUIRED'))return'Сначала назначьте оборудование.';
  if(text.includes('EQUIPMENT_UNAVAILABLE'))return'Оборудование недоступно: проверьте ремонт, ТО или рабочий статус.';
  if(text.includes('EQUIPMENT_ALREADY_RUNNING')||text.includes('production_jobs_one_running_per_equipment_idx'))return'На этом оборудовании уже выполняется другое задание.';
  if(text.includes('ORDER_ITEM_JOB_MISMATCH'))return'Выбранная позиция относится к другому заказу.';
  if(text.includes('PERMISSION_DENIED'))return'Недостаточно прав для управления производством.';
  return text;
}
async function runAction(id,action,button){
  button?.classList.add('farm-action-busy');
  try{const {error}=await supabase.rpc('transition_production_job',{p_job_id:id,p_action:action});if(error)throw error;await loadData()}
  catch(error){window.alert(translateError(error))}finally{button?.classList.remove('farm-action-busy')}
}

function bindDelegatedActions(){
  document.addEventListener('click',event=>{
    const config=event.target.closest('[data-farm-config]');if(config){event.preventDefault();openConfig(config.dataset.farmConfig);return}
    const action=event.target.closest('[data-farm-action]');if(action){event.preventDefault();const[id,verb]=action.dataset.farmAction.split('|');runAction(id,verb,action)}
  });
}
function observeBoard(){
  const board=document.querySelector('.production-board');if(!board)return;observer=new MutationObserver(()=>enhanceCards());observer.observe(board,{subtree:true,childList:true});
}
function initRealtime(){
  if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(state.reloadTimer);state.reloadTimer=setTimeout(loadData,300)};
  state.channel=supabase.channel('production-farm-runtime-v1').on('postgres_changes',{event:'*',schema:'public',table:'production_jobs'},reload).on('postgres_changes',{event:'*',schema:'public',table:'production_job_runs'},reload).on('postgres_changes',{event:'*',schema:'public',table:'equipment_assets'},reload).subscribe();
}
async function init(){
  try{await loadPermissions();if(!can('production.view'))return;injectStyle();ensureDialogs();installTopButton();bindDelegatedActions();observeBoard();await loadData();timer=setInterval(updateTimers,1000);initRealtime();$('refresh')?.addEventListener('click',()=>setTimeout(loadData,250));window.addEventListener('beforeunload',()=>{observer?.disconnect();if(timer)clearInterval(timer);if(state.channel)supabase.removeChannel(state.channel)},{once:true})}
  catch(error){console.warn('Production farm runtime unavailable',error)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
