import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const statusLabels={NEW:'Новая',QUEUED:'В очереди',IN_PROGRESS:'В работе',PAUSED:'Пауза',DONE:'Готово',CANCELLED:'Отменена'};
const unitLabels={A4_PRINT:'А4-Принт','3D_ARTPRINT':'3D-ARTPRINT',COMMON:'Общее'};
const statusOrder=['NEW','QUEUED','IN_PROGRESS','PAUSED','DONE','CANCELLED'];
const initialRoles=Array.isArray(window.__A4_CURRENT_ROLES__)?[...window.__A4_CURRENT_ROLES__]:[];
const state={jobs:[],metrics:null,users:[],roles:initialRoles,orders:[],ordersLoaded:false,loading:false,reloadQueued:false,channel:null};
let reloadTimer=null,searchTimer=null;

function notify(tone,title,message,options={}){if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});const method=tone==='error'?'error':tone==='warning'?'warn':'log';console[method]('[A4PRINT HUB]',title,message)}
function canManage(){return ['ADMIN','MANAGER','PRODUCTION'].some(x=>state.roles.includes(x))}
function fmtDate(value){if(!value)return'—';const d=new Date(value);if(!Number.isFinite(d.getTime()))return'—';return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}
function inputDate(value){if(!value)return'';const d=new Date(value);if(!Number.isFinite(d.getTime()))return'';const off=d.getTimezoneOffset();return new Date(d.getTime()-off*60000).toISOString().slice(0,16)}
function userName(job){return job.assignee_name||job.assignee_email||'Не назначен'}
function orderOf(id){return state.orders.find(x=>x.id===id)||null}
function deadlineOf(job){return job?.deadline_at||job?.order_due_at||null}
function overdue(job){const deadline=deadlineOf(job);return Boolean(deadline)&&!['DONE','CANCELLED'].includes(job.status)&&new Date(deadline).getTime()<Date.now()}
function orderLabel(order){if(!order)return'Без заказа';return `№${order.order_number} · ${unitLabels[order.business_unit]||order.business_unit||'Общее'} · ${order.model_name||order.source||'заказ'}`}
function scheduleLabel(job){return job?.equipment_id&&job?.planned_start&&job?.planned_end?`${fmtDate(job.planned_start)} → ${fmtDate(job.planned_end)}`:'не запланировано'}
function currentFilters(){return{q:$('search')?.value.trim()||'',unit:$('unit')?.value||'',assignee:$('assignee')?.value||'',priority:$('priorityFilter')?.value||''}}

async function loadUsers(){
  if(state.users.length)return;
  const {data,error}=await supabase.from('users').select('id,full_name,email,is_active').eq('is_active',true).order('full_name');
  if(error)throw error;state.users=data||[];
}
async function loadJobs(){
  const f=currentFilters();
  const {data,error}=await supabase.rpc('get_production_workspace_jobs',{
    p_query:f.q,p_unit:f.unit,p_assignee:f.assignee||null,p_priority:f.priority,p_done_limit:50,p_cancelled_limit:20
  });
  if(error)throw error;return Array.isArray(data)?data:[];
}
async function loadMetrics(){
  const {data,error}=await supabase.rpc('get_production_workspace_metrics');
  if(error)throw error;return Array.isArray(data)?(data[0]||null):data;
}
async function load(force=false){
  if(state.loading){if(force)state.reloadQueued=true;return}
  state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';
  try{
    const rolesPromise=state.roles.length?Promise.resolve({data:state.roles,error:null}):supabase.rpc('get_my_roles');
    const [jobsR,metricsR,usersR,rolesR]=await Promise.allSettled([loadJobs(),loadMetrics(),loadUsers(),rolesPromise]);
    if(jobsR.status==='rejected')throw jobsR.reason;
    state.jobs=jobsR.value;
    if(metricsR.status==='fulfilled')state.metrics=metricsR.value;else console.warn('Production metrics unavailable',metricsR.reason);
    if(usersR.status==='rejected')console.warn('Production users unavailable',usersR.reason);
    if(rolesR.status==='fulfilled'&&!rolesR.value.error&&Array.isArray(rolesR.value.data))state.roles=rolesR.value.data.map(String);
    $('addJob').hidden=!canManage();fillFilters();render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){
    console.error('Production load failed',error);
    $('queueCol').innerHTML=`<div class="production-empty" style="color:#b91c1c">${esc(error.message||error)}</div>`;
  }finally{
    state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить';
    if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>load(),0)}
  }
}
function fillFilters(){
  const current=$('assignee').value;
  $('assignee').innerHTML='<option value="">Все исполнители</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.full_name||u.email||'Сотрудник')}</option>`).join('');
  if([...$('assignee').options].some(o=>o.value===current))$('assignee').value=current;
}
function statusOptions(current){return statusOrder.map(s=>`<option value="${s}" ${s===current?'selected':''}>${statusLabels[s]}</option>`).join('')}
function jobHtml(job){
  const late=overdue(job),priority=Number(job.priority||0),high=priority>=70,deadline=deadlineOf(job);
  const controls=canManage()?`<select class="production-status-select" data-status data-id="${job.id}">${statusOptions(job.status)}</select><button class="production-edit" type="button" data-edit="${job.id}">Изменить</button>`:`<span style="font-size:11px;font-weight:800;color:#64748b">${esc(statusLabels[job.status]||job.status)}</span>`;
  return `<article class="production-job ${late?'overdue':''}" data-job-id="${esc(job.id)}">
    <div class="production-job-top"><div class="production-job-title"><b>${esc(job.title||'Производственное задание')}</b><small>${job.order_id?`Заказ №${esc(job.order_number??'—')} · ${esc(unitLabels[job.order_business_unit]||job.order_business_unit||'Общее')}`:'Внутреннее задание'}${job.operation_type?` · ${esc(job.operation_type)}`:''}</small></div><span class="production-priority ${high?'high':''}" title="Приоритет">${priority}</span></div>
    <div class="production-job-meta"><div class="production-meta-cell"><span>Исполнитель</span><b>${esc(userName(job))}</b></div><div class="production-meta-cell ${late?'danger':''}"><span>Срок</span><b>${esc(fmtDate(deadline))}</b></div></div>
    <div class="production-job-meta"><div class="production-meta-cell"><span>Машинное время</span><b>${job.planned_machine_minutes?`${esc(Math.round(Number(job.planned_machine_minutes)))} мин`:'не задано'}</b></div><div class="production-meta-cell"><span>План станка</span><b>${esc(scheduleLabel(job))}</b></div></div>
    <div class="production-job-actions">${controls}</div>
  </article>`;
}
function renderStats(){
  const m=state.metrics||{};
  $('all').textContent=state.metrics?Number(m.all_count||0):state.jobs.length;
  $('queue').textContent=state.metrics?Number(m.queue_count||0):state.jobs.filter(x=>['NEW','QUEUED'].includes(x.status)).length;
  $('work').textContent=state.metrics?Number(m.work_count||0):state.jobs.filter(x=>['IN_PROGRESS','PAUSED'].includes(x.status)).length;
  $('overdue').textContent=state.metrics?Number(m.overdue_count||0):state.jobs.filter(overdue).length;
  $('done').textContent=state.metrics?Number(m.done_count||0):state.jobs.filter(x=>x.status==='DONE').length;
}
function render(){
  renderStats();const rows=state.jobs;$('visibleCount').textContent=`${rows.length} в рабочем наборе`;
  const queue=rows.filter(x=>['NEW','QUEUED'].includes(x.status)),work=rows.filter(x=>['IN_PROGRESS','PAUSED'].includes(x.status)),done=rows.filter(x=>x.status==='DONE'),cancelled=rows.filter(x=>x.status==='CANCELLED');
  $('queueCount').textContent=queue.length;$('workCount').textContent=work.length;$('doneCount').textContent=done.length;
  $('queueCol').innerHTML=queue.map(jobHtml).join('')||'<div class="production-empty">Очередь пуста</div>';
  $('workCol').innerHTML=work.map(jobHtml).join('')||'<div class="production-empty">Нет заданий в работе</div>';
  $('doneCol').innerHTML=done.map(jobHtml).join('')||'<div class="production-empty">Готовых заданий пока нет</div>';
  $('cancelledCount').textContent=state.metrics?Number(state.metrics.cancelled_count||0):cancelled.length;
  $('cancelledList').innerHTML=cancelled.map(j=>`<div class="production-cancelled-row"><span><b>${esc(j.title)}</b>${j.order_id?' · заказ №'+esc(j.order_number||'—'):''}</span><span>${esc(fmtDate(j.updated_at||j.created_at))}</span></div>`).join('')||'<div class="production-empty">Отменённых заданий нет</div>';
  window.__A4_PRODUCTION_WORKSPACE__={jobs:state.jobs,metrics:state.metrics};
  document.dispatchEvent(new CustomEvent('a4:production-rendered',{detail:window.__A4_PRODUCTION_WORKSPACE__}));
}
async function ensureOrders(selectedId=''){
  if(!state.ordersLoaded){
    const {data,error}=await supabase.from('orders').select('id,order_number,status,total,business_unit,model_name,source,created_at,due_at').not('status','in','(COMPLETED,CANCELLED)').order('created_at',{ascending:false}).limit(200);
    if(error)throw error;state.orders=data||[];state.ordersLoaded=true;
  }
  if(selectedId&&!state.orders.some(o=>o.id===selectedId)){
    const {data}=await supabase.from('orders').select('id,order_number,status,total,business_unit,model_name,source,created_at,due_at').eq('id',selectedId).maybeSingle();
    if(data)state.orders.unshift(data);
  }
}
function fillFormOptions(job=null){
  const orderCurrent=job?.order_id||$('jobOrder').value,userCurrent=job?.assigned_to||$('jobAssignee').value;
  $('jobOrder').innerHTML='<option value="">Без привязки к заказу</option>'+state.orders.map(o=>`<option value="${o.id}">${esc(orderLabel(o))}</option>`).join('');
  $('jobAssignee').innerHTML='<option value="">Не назначен</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.full_name||u.email||'Сотрудник')}</option>`).join('');
  if([...$('jobOrder').options].some(o=>o.value===orderCurrent))$('jobOrder').value=orderCurrent;
  if([...$('jobAssignee').options].some(o=>o.value===userCurrent))$('jobAssignee').value=userCurrent;
}
async function openJob(id=''){
  if(!canManage())return;const job=state.jobs.find(x=>x.id===id)||null;
  $('jobForm').reset();$('jobId').value=job?.id||'';$('jobDlgTitle').textContent=job?'Изменить задание':'Новое производственное задание';
  $('jobDlgText').textContent=job?'Измените дедлайн, машинное время, тип операции, исполнителя или описание.':'Создайте задание, задайте длительность и дедлайн.';
  $('jobOrder').innerHTML='<option value="">Загрузка заказов…</option>';$('jobAssignee').innerHTML='<option value="">Загрузка исполнителей…</option>';
  $('jobError').textContent='';$('saveJob').disabled=true;$('jobDlg').showModal();
  try{
    await Promise.all([ensureOrders(job?.order_id||''),loadUsers()]);fillFormOptions(job);
    $('jobTitle').value=job?.title||'';$('jobPriority').value=Number(job?.priority??50);$('jobOperation').value=job?.operation_type||'';$('jobDuration').value=job?.planned_machine_minutes?Math.round(Number(job.planned_machine_minutes)):'';$('jobEnd').value=inputDate(deadlineOf(job));$('jobNotes').value=job?.notes||'';$('saveJob').disabled=false;
  }catch(error){$('jobError').textContent=error.message||String(error)}
}
async function syncOrderForJob(job,nextStatus){
  if(!job.order_id)return;
  if(['COMPLETED','CANCELLED'].includes(job.order_status))return;
  if(nextStatus==='IN_PROGRESS'&&['NEW','CONFIRMED'].includes(job.order_status)){
    const {error}=await supabase.from('orders').update({status:'IN_PROGRESS',updated_at:new Date().toISOString()}).eq('id',job.order_id);if(!error)job.order_status='IN_PROGRESS';return;
  }
  if(nextStatus==='DONE'){
    const {data,error}=await supabase.from('production_jobs').select('id,status').eq('order_id',job.order_id).neq('status','CANCELLED');
    if(error)return;
    if((data||[]).length&&(data||[]).every(x=>x.id===job.id||x.status==='DONE')){
      const upd=await supabase.from('orders').update({status:'READY',updated_at:new Date().toISOString()}).eq('id',job.order_id);if(!upd.error)job.order_status='READY';
    }
  }
}
async function changeStatus(id,next,select){
  const job=state.jobs.find(x=>x.id===id);if(!job||job.status===next||!canManage())return;
  const previous=job.status;select.disabled=true;const now=new Date().toISOString(),payload={status:next,updated_at:now};
  if(next==='IN_PROGRESS'&&!job.started_at)payload.started_at=now;if(next==='DONE')payload.completed_at=now;else if(previous==='DONE')payload.completed_at=null;
  try{const {error}=await supabase.from('production_jobs').update(payload).eq('id',id);if(error)throw error;Object.assign(job,payload);await syncOrderForJob(job,next);await load(true)}
  catch(error){select.value=previous;notify('error','Не удалось изменить статус',error.message||String(error))}finally{select.disabled=false}
}
function resetFiltersAndLoad(){void load(true)}
$('addJob').addEventListener('click',()=>openJob());$('refresh').addEventListener('click',()=>load(true));$('closeJobDlg').addEventListener('click',()=>$('jobDlg').close());
for(const id of ['unit','assignee','priorityFilter'])$(id).addEventListener('change',resetFiltersAndLoad);
$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>load(true),280)});
$('clearFilters').addEventListener('click',()=>{$('search').value='';$('unit').value='';$('assignee').value='';$('priorityFilter').value='';load(true)});
document.addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(b)openJob(b.dataset.edit)});
document.addEventListener('change',e=>{const s=e.target.closest('[data-status]');if(s)changeStatus(s.dataset.id,s.value,s)});
$('jobOrder').addEventListener('change',()=>{const order=orderOf($('jobOrder').value);if(!order)return;if(!$('jobTitle').value.trim())$('jobTitle').value=order.model_name||order.source||`Заказ №${order.order_number}`;if(!$('jobEnd').value&&order.due_at)$('jobEnd').value=inputDate(order.due_at)});
$('jobForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!canManage())return;$('saveJob').disabled=true;$('jobError').textContent='';
  const id=$('jobId').value,order=orderOf($('jobOrder').value),duration=Number($('jobDuration').value||0);
  const payload={order_id:$('jobOrder').value||null,assigned_to:$('jobAssignee').value||null,title:$('jobTitle').value.trim(),priority:Math.max(0,Math.min(100,Number($('jobPriority').value)||0)),operation_type:$('jobOperation').value.trim()||null,planned_machine_minutes:duration>0?Math.min(43200,Math.round(duration)):null,deadline_at:$('jobEnd').value?new Date($('jobEnd').value).toISOString():(order?.due_at||null),notes:$('jobNotes').value.trim()||null,updated_at:new Date().toISOString()};
  if(!payload.title){$('jobError').textContent='Укажите название задания.';$('saveJob').disabled=false;return}
  try{const result=id?await supabase.from('production_jobs').update(payload).eq('id',id):await supabase.from('production_jobs').insert({...payload,status:'NEW'});if(result.error)throw result.error;$('jobDlg').close();await load(true)}
  catch(error){$('jobError').textContent=error.message||String(error)}finally{$('saveJob').disabled=false}
});
function initRealtime(){
  if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>load(true),450)};
  state.channel=supabase.channel('production-live-v4').on('postgres_changes',{event:'*',schema:'public',table:'production_jobs'},reload).on('postgres_changes',{event:'*',schema:'public',table:'orders'},reload).subscribe();
  window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true});
}
await load();initRealtime();
