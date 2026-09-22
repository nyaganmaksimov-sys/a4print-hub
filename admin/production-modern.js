import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const statusLabels={NEW:'Новая',QUEUED:'В очереди',IN_PROGRESS:'В работе',PAUSED:'Пауза',DONE:'Готово',CANCELLED:'Отменена'};
const unitLabels={A4_PRINT:'А4-Принт','3D_ARTPRINT':'3D-ARTPRINT',COMMON:'Общее'};
const statusOrder=['NEW','QUEUED','IN_PROGRESS','PAUSED','DONE','CANCELLED'];
const initialRoles=Array.isArray(window.__A4_CURRENT_ROLES__)?[...window.__A4_CURRENT_ROLES__]:[];
const state={jobs:[],users:[],roles:initialRoles,metrics:null,loading:false,reloadQueued:false,channel:null,formOrders:[],formOrdersLoaded:false};
let reloadTimer=null,searchTimer=null;

function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}
function canManage(){return ['ADMIN','MANAGER','PRODUCTION'].some(x=>state.roles.includes(x))}
function fmtDate(value){if(!value)return'—';const d=new Date(value);if(!Number.isFinite(d.getTime()))return'—';return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}
function inputDate(value){if(!value)return'';const d=new Date(value);if(!Number.isFinite(d.getTime()))return'';const off=d.getTimezoneOffset();return new Date(d.getTime()-off*60000).toISOString().slice(0,16)}
function userName(job){return job.assignee_name||job.assignee_email||'Не назначен'}
function deadlineOf(job){return job?.deadline_at||job?.order_due_at||null}
function overdue(job){const deadline=deadlineOf(job);return Boolean(deadline)&&!['DONE','CANCELLED'].includes(job.status)&&new Date(deadline).getTime()<Date.now()}
function orderLabel(order){if(!order)return'Без заказа';return `№${order.order_number} · ${unitLabels[order.business_unit]||order.business_unit||'Общее'} · ${order.model_name||order.source||'заказ'}`}
function scheduleLabel(job){return job?.equipment_id&&job?.planned_start&&job?.planned_end?`${fmtDate(job.planned_start)} → ${fmtDate(job.planned_end)}`:'не запланировано'}
function filters(){return{q:$('search').value.trim(),unit:$('unit').value,assignee:$('assignee').value||null,priority:$('priorityFilter').value}}

async function loadJobs(){
  const f=filters();
  const {data,error}=await supabase.rpc('get_production_workspace_jobs',{
    p_query:f.q,p_unit:f.unit,p_assignee:f.assignee,p_priority:f.priority,p_done_limit:50,p_cancelled_limit:20
  });
  if(error)throw error;
  return Array.isArray(data)?data:[];
}
async function loadMetrics(){
  const {data,error}=await supabase.rpc('get_production_workspace_metrics');
  if(error)throw error;
  return Array.isArray(data)?(data[0]||null):data;
}
async function loadUsers(){
  const {data,error}=await supabase.from('users').select('id,full_name,email,is_active').eq('is_active',true).order('full_name');
  if(error)throw error;
  return data||[];
}
async function ensureFormOrders(){
  if(state.formOrdersLoaded)return;
  const {data,error}=await supabase.from('orders')
    .select('id,order_number,status,business_unit,model_name,source,due_at')
    .not('status','in','("COMPLETED","CANCELLED")')
    .or('source.is.null,source.neq.KASSA')
    .order('created_at',{ascending:false})
    .limit(200);
  if(error)throw error;
  state.formOrders=data||[];
  state.formOrdersLoaded=true;
}

function fillFilters(){
  const current=$('assignee').value;
  $('assignee').innerHTML='<option value="">Все исполнители</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.full_name||u.email||'Сотрудник')}</option>`).join('');
  if([...$('assignee').options].some(o=>o.value===current))$('assignee').value=current;
}
function fillFormOptions(selectedOrder='',selectedUser=''){
  $('jobOrder').innerHTML='<option value="">Без привязки к заказу</option>'+state.formOrders.map(o=>`<option value="${o.id}">${esc(orderLabel(o))}</option>`).join('');
  $('jobAssignee').innerHTML='<option value="">Не назначен</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.full_name||u.email||'Сотрудник')}</option>`).join('');
  if(selectedOrder&&[...$('jobOrder').options].some(o=>o.value===selectedOrder))$('jobOrder').value=selectedOrder;
  if(selectedUser&&[...$('jobAssignee').options].some(o=>o.value===selectedUser))$('jobAssignee').value=selectedUser;
}
function statusOptions(current){return statusOrder.map(s=>`<option value="${s}" ${s===current?'selected':''}>${statusLabels[s]}</option>`).join('')}
function jobHtml(job){
  const late=overdue(job),priority=Number(job.priority||0),high=priority>=70,deadline=deadlineOf(job);
  const controls=canManage()?`<select class="production-status-select" data-status data-id="${job.id}">${statusOptions(job.status)}</select><button class="production-edit" type="button" data-edit="${job.id}">Изменить</button>`:`<span style="font-size:11px;font-weight:800;color:#64748b">${esc(statusLabels[job.status]||job.status)}</span>`;
  return `<article class="production-job ${late?'overdue':''}" data-job-id="${job.id}">
    <div class="production-job-top"><div class="production-job-title"><b>${esc(job.title||'Производственное задание')}</b><small>${job.order_id?`Заказ №${esc(job.order_number)} · ${esc(unitLabels[job.order_business_unit]||job.order_business_unit||'Общее')}`:'Внутреннее задание'}${job.operation_type?` · ${esc(job.operation_type)}`:''}</small></div><span class="production-priority ${high?'high':''}" title="Приоритет">${priority}</span></div>
    <div class="production-job-meta"><div class="production-meta-cell"><span>Исполнитель</span><b>${esc(userName(job))}</b></div><div class="production-meta-cell ${late?'danger':''}"><span>Срок</span><b>${esc(fmtDate(deadline))}</b></div></div>
    <div class="production-job-meta"><div class="production-meta-cell"><span>Машинное время</span><b>${job.planned_machine_minutes?`${esc(Math.round(Number(job.planned_machine_minutes)))} мин`:'не задано'}</b></div><div class="production-meta-cell"><span>План станка</span><b>${esc(scheduleLabel(job))}</b></div></div>
    <div class="production-job-actions">${controls}</div>
  </article>`;
}
function renderStats(){
  const m=state.metrics||{};
  $('all').textContent=state.metrics?Number(m.all_count||0):'—';
  $('queue').textContent=state.metrics?Number(m.queue_count||0):'—';
  $('work').textContent=state.metrics?Number(m.work_count||0):'—';
  $('overdue').textContent=state.metrics?Number(m.overdue_count||0):'—';
  $('done').textContent=state.metrics?Number(m.done_count||0):'—';
}
function render(){
  renderStats();
  const rows=state.jobs;
  $('visibleCount').textContent=`${rows.length} в рабочем наборе`;
  const queue=rows.filter(x=>['NEW','QUEUED'].includes(x.status));
  const work=rows.filter(x=>['IN_PROGRESS','PAUSED'].includes(x.status));
  const done=rows.filter(x=>x.status==='DONE');
  const cancelled=rows.filter(x=>x.status==='CANCELLED');
  $('queueCount').textContent=queue.length;$('workCount').textContent=work.length;$('doneCount').textContent=done.length;
  $('queueCol').innerHTML=queue.map(jobHtml).join('')||'<div class="production-empty">Очередь пуста</div>';
  $('workCol').innerHTML=work.map(jobHtml).join('')||'<div class="production-empty">Нет заданий в работе</div>';
  $('doneCol').innerHTML=done.map(jobHtml).join('')||'<div class="production-empty">Готовых заданий пока нет</div>';
  $('cancelledCount').textContent=state.metrics?Number(state.metrics.cancelled_count||0):cancelled.length;
  $('cancelledList').innerHTML=cancelled.map(j=>`<div class="production-cancelled-row"><span><b>${esc(j.title)}</b>${j.order_id?' · заказ №'+esc(j.order_number||'—'):''}</span><span>${esc(fmtDate(j.updated_at||j.created_at))}</span></div>`).join('')||'<div class="production-empty">Отменённых заданий нет</div>';
  window.__A4_PRODUCTION_BOARD__={jobs:state.jobs.map(x=>({...x}))};
  document.dispatchEvent(new CustomEvent('a4:production-board-rendered',{detail:window.__A4_PRODUCTION_BOARD__}));
}
function renderLoading(){
  for(const id of ['queueCol','workCol','doneCol'])$(id).innerHTML='<div class="production-empty">Загрузка…</div>';
}
function renderError(error){
  $('queueCol').innerHTML=`<div class="a4-error"><b>Не удалось загрузить производство</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="productionRetry" class="a4-btn" type="button" style="margin-top:10px">Повторить</button></div>`;
  $('productionRetry')?.addEventListener('click',()=>load(true));
}

async function load(force=false){
  if(state.loading){if(force)state.reloadQueued=true;return}
  state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';if(!state.jobs.length)renderLoading();
  try{
    const rolesPromise=state.roles.length?Promise.resolve({data:state.roles,error:null}):supabase.rpc('get_my_roles');
    const [jobsR,metricsR,usersR,rolesR]=await Promise.allSettled([loadJobs(),loadMetrics(),state.users.length?Promise.resolve(state.users):loadUsers(),rolesPromise]);
    if(jobsR.status==='rejected')throw jobsR.reason;state.jobs=jobsR.value;
    if(metricsR.status==='fulfilled')state.metrics=metricsR.value;else console.warn('Production metrics unavailable',metricsR.reason);
    if(usersR.status==='fulfilled')state.users=usersR.value;else console.warn('Production users unavailable',usersR.reason);
    if(rolesR.status==='fulfilled'&&!rolesR.value.error&&Array.isArray(rolesR.value.data))state.roles=rolesR.value.data.map(String);
    $('addJob').hidden=!canManage();fillFilters();render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){console.error('Production load failed',error);renderError(error);$('updatedAt').textContent='ошибка загрузки'}
  finally{state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить';if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>load(),0)}}
}

async function openJob(id=''){
  if(!canManage())return;
  const job=state.jobs.find(x=>x.id===id)||null;
  $('jobForm').reset();$('jobId').value=job?.id||'';$('jobDlgTitle').textContent=job?'Изменить задание':'Новое производственное задание';$('jobDlgText').textContent=job?'Измените дедлайн, машинное время, тип операции, исполнителя или описание. Само окно станка меняется в диспетчере.':'Создайте задание, задайте длительность и дедлайн — диспетчер сможет поставить его в свободное окно.';
  $('jobOrder').innerHTML='<option value="">Загрузка заказов…</option>';$('jobAssignee').innerHTML='<option value="">Загрузка исполнителей…</option>';
  $('jobTitle').value=job?.title||'';$('jobPriority').value=Number(job?.priority??50);$('jobOperation').value=job?.operation_type||'';$('jobDuration').value=job?.planned_machine_minutes?Math.round(Number(job.planned_machine_minutes)):'';$('jobEnd').value=inputDate(deadlineOf(job));$('jobNotes').value=job?.notes||'';$('jobError').textContent='';
  $('jobDlg').showModal();$('saveJob').disabled=true;
  try{await ensureFormOrders();fillFormOptions(job?.order_id||'',job?.assigned_to||'');$('saveJob').disabled=false}
  catch(error){$('jobError').textContent='Не удалось загрузить справочники: '+(error.message||error)}
}
async function syncOrderForJob(job,nextStatus){
  if(!job.order_id)return;
  if(['COMPLETED','CANCELLED'].includes(job.order_status))return;
  if(nextStatus==='IN_PROGRESS'&&['NEW','CONFIRMED'].includes(job.order_status)){
    const {error}=await supabase.from('orders').update({status:'IN_PROGRESS',updated_at:new Date().toISOString()}).eq('id',job.order_id);
    if(!error)job.order_status='IN_PROGRESS';return;
  }
  if(nextStatus==='DONE'){
    const {data,error}=await supabase.from('production_jobs').select('id,status').eq('order_id',job.order_id).neq('status','CANCELLED');
    if(!error&&Array.isArray(data)&&data.length&&data.every(x=>x.id===job.id?nextStatus==='DONE':x.status==='DONE')){
      const ready=await supabase.from('orders').update({status:'READY',updated_at:new Date().toISOString()}).eq('id',job.order_id);
      if(!ready.error)job.order_status='READY';
    }
  }
}
async function changeStatus(id,next,select){
  const job=state.jobs.find(x=>x.id===id);if(!job||job.status===next||!canManage())return;
  const previous=job.status;select.disabled=true;const now=new Date().toISOString(),payload={status:next,updated_at:now};
  if(next==='IN_PROGRESS'&&!job.started_at)payload.started_at=now;if(next==='DONE')payload.completed_at=now;else if(previous==='DONE')payload.completed_at=null;
  try{
    const {error}=await supabase.from('production_jobs').update(payload).eq('id',id);if(error)throw error;
    Object.assign(job,payload);await syncOrderForJob(job,next);await load(true);
  }catch(error){select.value=previous;notify('error','Не удалось изменить статус',error.message||String(error))}finally{select.disabled=false}
}

function resetFiltersAndLoad(){clearTimeout(searchTimer);searchTimer=setTimeout(()=>load(true),220)}
$('addJob').addEventListener('click',()=>openJob());$('refresh').addEventListener('click',()=>load(true));$('closeJobDlg').addEventListener('click',()=>$('jobDlg').close());
$('search').addEventListener('input',resetFiltersAndLoad);
for(const id of ['unit','assignee','priorityFilter'])$(id).addEventListener('change',()=>load(true));
$('clearFilters').addEventListener('click',()=>{$('search').value='';$('unit').value='';$('assignee').value='';$('priorityFilter').value='';void load(true)});
document.addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(b)openJob(b.dataset.edit)});
document.addEventListener('change',e=>{const s=e.target.closest('[data-status]');if(s)changeStatus(s.dataset.id,s.value,s)});
$('jobOrder').addEventListener('change',()=>{
  const order=state.formOrders.find(x=>x.id===$('jobOrder').value);if(!order)return;
  if(!$('jobTitle').value.trim())$('jobTitle').value=order.model_name||order.source||`Заказ №${order.order_number}`;
  if(!$('jobEnd').value&&order.due_at)$('jobEnd').value=inputDate(order.due_at);
});
$('jobForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!canManage())return;$('saveJob').disabled=true;$('jobError').textContent='';
  const id=$('jobId').value,order=state.formOrders.find(x=>x.id===$('jobOrder').value)||null,duration=Number($('jobDuration').value||0);
  const payload={order_id:$('jobOrder').value||null,assigned_to:$('jobAssignee').value||null,title:$('jobTitle').value.trim(),priority:Math.max(0,Math.min(100,Number($('jobPriority').value)||0)),operation_type:$('jobOperation').value.trim()||null,planned_machine_minutes:duration>0?Math.min(43200,Math.round(duration)):null,deadline_at:$('jobEnd').value?new Date($('jobEnd').value).toISOString():(order?.due_at||null),notes:$('jobNotes').value.trim()||null,updated_at:new Date().toISOString()};
  if(!payload.title){$('jobError').textContent='Укажите название задания.';$('saveJob').disabled=false;return}
  try{const result=id?await supabase.from('production_jobs').update(payload).eq('id',id):await supabase.from('production_jobs').insert({...payload,status:'NEW'});if(result.error)throw result.error;$('jobDlg').close();state.formOrdersLoaded=false;await load(true)}
  catch(error){$('jobError').textContent=error.message||String(error)}finally{$('saveJob').disabled=false}
});
function initRealtime(){
  if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>load(true),350)};
  state.channel=supabase.channel('production-live-v4').on('postgres_changes',{event:'*',schema:'public',table:'production_jobs'},reload).on('postgres_changes',{event:'*',schema:'public',table:'orders'},reload).subscribe();
  window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true});
}

await load();initRealtime();
