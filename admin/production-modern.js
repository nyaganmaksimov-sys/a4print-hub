import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
const statusLabels={NEW:'Новая',QUEUED:'В очереди',IN_PROGRESS:'В работе',PAUSED:'Пауза',DONE:'Готово',CANCELLED:'Отменена'};
const unitLabels={A4_PRINT:'А4-Принт','3D_ARTPRINT':'3D-ARTPRINT',COMMON:'Общее'};
const statusOrder=['NEW','QUEUED','IN_PROGRESS','PAUSED','DONE','CANCELLED'];
const initialRoles=Array.isArray(window.__A4_CURRENT_ROLES__)?[...window.__A4_CURRENT_ROLES__]:[];
const state={jobs:[],metrics:null,formOrders:[],users:[],roles:initialRoles,refsLoaded:false,loading:false,reloadQueued:false,channel:null};
let reloadTimer=null,searchTimer=null;

function canManage(){return ['ADMIN','MANAGER','PRODUCTION'].some(x=>state.roles.includes(x))}
function notify(tone,title,message,options={}){if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});const method=tone==='error'?'error':tone==='warning'?'warn':'log';console[method]('[A4PRINT HUB]',title,message)}
function fmtDate(value){if(!value)return'—';const d=new Date(value);if(!Number.isFinite(d.getTime()))return'—';return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}
function inputDate(value){if(!value)return'';const d=new Date(value);if(!Number.isFinite(d.getTime()))return'';const off=d.getTimezoneOffset();return new Date(d.getTime()-off*60000).toISOString().slice(0,16)}
function orderFromJob(job){
  if(!job?.order_id)return null;
  return{id:job.order_id,order_number:job.order_number,status:job.order_status,total:job.order_total,business_unit:job.order_business_unit,model_name:job.order_model_name,source:job.order_source,due_at:job.order_due_at};
}
function orderOf(id){
  if(!id)return null;
  return state.formOrders.find(x=>x.id===id)||orderFromJob(state.jobs.find(x=>x.order_id===id))||null;
}
function deadlineOf(job){return job?.deadline_at||job?.order_due_at||null}
function overdue(job){const deadline=deadlineOf(job);return Boolean(deadline)&&!['DONE','CANCELLED'].includes(job.status)&&new Date(deadline).getTime()<Date.now()}
function orderLabel(order){if(!order)return'Без заказа';return `№${order.order_number} · ${unitLabels[order.business_unit]||order.business_unit||'Общее'} · ${order.model_name||order.source||'заказ'}`}
function scheduleLabel(job){return job?.equipment_id&&job?.planned_start&&job?.planned_end?`${fmtDate(job.planned_start)} → ${fmtDate(job.planned_end)}`:'не запланировано'}
function currentFilters(){return{q:$('search')?.value.trim()||'',unit:$('unit')?.value||'',assignee:$('assignee')?.value||'',priority:$('priorityFilter')?.value||''}}

async function initContext(){
  const rolesPromise=state.roles.length?Promise.resolve({data:state.roles,error:null}):supabase.rpc('get_my_roles');
  const [usersR,rolesR]=await Promise.all([
    supabase.from('users').select('id,full_name,email,is_active').eq('is_active',true).order('full_name'),
    rolesPromise
  ]);
  if(usersR.error)throw usersR.error;
  state.users=usersR.data||[];
  if(!rolesR.error&&Array.isArray(rolesR.data))state.roles=rolesR.data.map(String);
  const current=$('assignee')?.value||'';
  $('assignee').innerHTML='<option value="">Все исполнители</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.full_name||u.email||'Сотрудник')}</option>`).join('');
  if(current&&[...$('assignee').options].some(o=>o.value===current))$('assignee').value=current;
  $('jobAssignee').innerHTML='<option value="">Не назначен</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.full_name||u.email||'Сотрудник')}</option>`).join('');
  $('addJob').hidden=!canManage();
}

async function loadJobs(){
  const f=currentFilters();
  const {data,error}=await supabase.rpc('get_production_workspace_jobs',{
    p_query:f.q,p_unit:f.unit,p_assignee:f.assignee||null,p_priority:f.priority,p_done_limit:50,p_cancelled_limit:20
  });
  if(error)throw error;
  return Array.isArray(data)?data:[];
}
async function loadMetrics(){
  const {data,error}=await supabase.rpc('get_production_workspace_metrics');
  if(error)throw error;
  return Array.isArray(data)?(data[0]||null):data;
}
async function load(force=false){
  if(state.loading){if(force)state.reloadQueued=true;return}
  state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';
  try{
    const [jobsR,metricsR]=await Promise.allSettled([loadJobs(),loadMetrics()]);
    if(jobsR.status==='rejected')throw jobsR.reason;
    state.jobs=jobsR.value;
    if(metricsR.status==='fulfilled')state.metrics=metricsR.value;else console.warn('Production metrics unavailable',metricsR.reason);
    render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){
    console.error('Production load failed',error);
    $('queueCol').innerHTML=`<div class="a4-error"><b>Не удалось загрузить производство</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="productionRetry" type="button" class="a4-btn" style="margin-top:10px">Повторить</button></div>`;
    $('workCol').innerHTML='<div class="production-empty">—</div>';$('doneCol').innerHTML='<div class="production-empty">—</div>';
    $('productionRetry')?.addEventListener('click',()=>load(true));$('updatedAt').textContent='ошибка загрузки';
  }finally{
    state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить';
    if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>load(),0)}
  }
}

function statusOptions(current){return statusOrder.map(s=>`<option value="${s}" ${s===current?'selected':''}>${statusLabels[s]}</option>`).join('')}
function jobHtml(job){
  const late=overdue(job),priority=Number(job.priority||0),high=priority>=70,deadline=deadlineOf(job);
  const assignee=job.assignee_name||job.assignee_email||'Не назначен';
  const controls=canManage()?`<select class="production-status-select" data-status data-id="${job.id}">${statusOptions(job.status)}</select><button class="production-edit" type="button" data-edit="${job.id}">Изменить</button>`:`<span class="production-readonly-status">${esc(statusLabels[job.status]||job.status)}</span>`;
  return `<article class="production-job ${late?'overdue':''}">
    <div class="production-job-top"><div class="production-job-title"><b>${esc(job.title||'Производственное задание')}</b><small>${job.order_id?`Заказ №${esc(job.order_number??'—')} · ${esc(unitLabels[job.order_business_unit]||job.order_business_unit||'Общее')}`:'Внутреннее задание'}${job.operation_type?` · ${esc(job.operation_type)}`:''}</small></div><span class="production-priority ${high?'high':''}" title="Приоритет">${priority}</span></div>
    <div class="production-job-meta"><div class="production-meta-cell"><span>Исполнитель</span><b>${esc(assignee)}</b></div><div class="production-meta-cell ${late?'danger':''}"><span>Срок</span><b>${esc(fmtDate(deadline))}</b></div></div>
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
  const rows=state.jobs,queue=rows.filter(x=>['NEW','QUEUED'].includes(x.status)),work=rows.filter(x=>['IN_PROGRESS','PAUSED'].includes(x.status)),done=rows.filter(x=>x.status==='DONE'),cancelled=rows.filter(x=>x.status==='CANCELLED');
  $('visibleCount').textContent=`${rows.length} показано · всего ${Number(state.metrics?.all_count||rows.length)}`;
  $('queueCount').textContent=queue.length;$('workCount').textContent=work.length;$('doneCount').textContent=done.length;
  $('queueCol').innerHTML=queue.map(jobHtml).join('')||'<div class="production-empty">Очередь пуста</div>';
  $('workCol').innerHTML=work.map(jobHtml).join('')||'<div class="production-empty">Нет заданий в работе</div>';
  $('doneCol').innerHTML=done.map(jobHtml).join('')||'<div class="production-empty">Готовых заданий пока нет</div>';
  $('cancelledCount').textContent=state.metrics?Number(state.metrics.cancelled_count||0):cancelled.length;
  $('cancelledList').innerHTML=cancelled.map(j=>`<div class="production-cancelled-row"><span><b>${esc(j.title)}</b>${j.order_id?' · заказ №'+esc(j.order_number??'—'):''}</span><span>${esc(fmtDate(j.updated_at||j.created_at))}</span></div>`).join('')||'<div class="production-empty">Отменённых заданий нет</div>';
  window.__A4_PRODUCTION_BOARD__={jobs:[...state.jobs]};
  document.dispatchEvent(new CustomEvent('a4:production-board-rendered',{detail:window.__A4_PRODUCTION_BOARD__}));
}

async function loadFormOrders(selectedOrderId=''){
  if(state.refsLoaded){
    if(selectedOrderId&&!state.formOrders.some(o=>o.id===selectedOrderId)){
      const x=await supabase.from('orders').select('id,order_number,status,total,business_unit,model_name,source,created_at,due_at').eq('id',selectedOrderId).maybeSingle();
      if(x.data)state.formOrders.unshift(x.data);
    }
    return;
  }
  const r=await supabase.from('orders').select('id,order_number,status,total,business_unit,model_name,source,created_at,due_at')
    .in('status',['NEW','CONFIRMED','IN_PROGRESS','READY','ON_HOLD'])
    .or('source.is.null,source.neq.KASSA').order('created_at',{ascending:false}).limit(300);
  if(r.error)throw r.error;state.formOrders=r.data||[];state.refsLoaded=true;
  if(selectedOrderId&&!state.formOrders.some(o=>o.id===selectedOrderId)){
    const x=await supabase.from('orders').select('id,order_number,status,total,business_unit,model_name,source,created_at,due_at').eq('id',selectedOrderId).maybeSingle();
    if(x.data)state.formOrders.unshift(x.data);
  }
}
function fillFormOptions(selectedOrderId='',selectedUserId=''){
  $('jobOrder').innerHTML='<option value="">Без привязки к заказу</option>'+state.formOrders.map(o=>`<option value="${o.id}">${esc(orderLabel(o))}</option>`).join('');
  $('jobAssignee').innerHTML='<option value="">Не назначен</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.full_name||u.email||'Сотрудник')}</option>`).join('');
  if(selectedOrderId&&[...$('jobOrder').options].some(o=>o.value===selectedOrderId))$('jobOrder').value=selectedOrderId;
  if(selectedUserId&&[...$('jobAssignee').options].some(o=>o.value===selectedUserId))$('jobAssignee').value=selectedUserId;
}
async function openJob(id=''){
  if(!canManage())return;
  const job=state.jobs.find(x=>x.id===id)||null,dlg=$('jobDlg'),save=$('saveJob');
  $('jobForm').reset();$('jobId').value=job?.id||'';$('jobDlgTitle').textContent=job?'Изменить задание':'Новое производственное задание';
  $('jobDlgText').textContent=job?'Измените дедлайн, машинное время, тип операции, исполнителя или описание. Само окно станка меняется в диспетчере.':'Создайте задание, задайте длительность и дедлайн — диспетчер сможет поставить его в свободное окно.';
  $('jobTitle').value=job?.title||'';$('jobPriority').value=Number(job?.priority??50);$('jobOperation').value=job?.operation_type||'';$('jobDuration').value=job?.planned_machine_minutes?Math.round(Number(job.planned_machine_minutes)):'';$('jobEnd').value=inputDate(deadlineOf(job));$('jobNotes').value=job?.notes||'';$('jobError').textContent='';
  $('jobOrder').innerHTML='<option value="">Загрузка заказов…</option>';fillFormOptions('',job?.assigned_to||'');save.disabled=true;
  dlg.showModal();
  try{await loadFormOrders(job?.order_id||'');fillFormOptions(job?.order_id||'',job?.assigned_to||'');save.disabled=false}
  catch(error){console.error('Production order references unavailable',error);$('jobError').textContent='Не удалось загрузить список заказов: '+(error.message||error)}
}

async function syncOrderForJob(job,nextStatus){
  if(!job.order_id)return;
  if(nextStatus==='IN_PROGRESS'&&['NEW','CONFIRMED'].includes(job.order_status)){
    const {error}=await supabase.from('orders').update({status:'IN_PROGRESS',updated_at:new Date().toISOString()}).eq('id',job.order_id);
    if(!error)job.order_status='IN_PROGRESS';return;
  }
  if(nextStatus==='DONE'){
    const siblings=await supabase.from('production_jobs').select('id,status').eq('order_id',job.order_id).neq('status','CANCELLED');
    if(siblings.error){console.warn('Production siblings check failed',siblings.error);return}
    if((siblings.data||[]).length&&(siblings.data||[]).every(x=>x.status==='DONE')){
      const {error}=await supabase.from('orders').update({status:'READY',updated_at:new Date().toISOString()}).eq('id',job.order_id);
      if(!error)job.order_status='READY';
    }
  }
}
async function changeStatus(id,next,select){
  const job=state.jobs.find(x=>x.id===id);if(!job||job.status===next||!canManage())return;
  const previous=job.status;select.disabled=true;
  const now=new Date().toISOString(),payload={status:next,updated_at:now};
  if(next==='IN_PROGRESS'&&!job.started_at)payload.started_at=now;
  if(next==='DONE')payload.completed_at=now;else if(previous==='DONE')payload.completed_at=null;
  try{
    const {error}=await supabase.from('production_jobs').update(payload).eq('id',id);if(error)throw error;
    Object.assign(job,payload);await syncOrderForJob(job,next);await load(true);
  }catch(error){select.value=previous;notify('error','Не удалось изменить статус',error.message||String(error))}finally{select.disabled=false}
}

function resetFiltersAndLoad(){$('search').value='';$('unit').value='';$('assignee').value='';$('priorityFilter').value='';void load(true)}
$('addJob').addEventListener('click',()=>openJob());
$('refresh').addEventListener('click',()=>load(true));
$('closeJobDlg').addEventListener('click',()=>$('jobDlg').close());
$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>load(true),280)});
for(const id of ['unit','assignee','priorityFilter'])$(id).addEventListener('change',()=>load(true));
$('clearFilters').addEventListener('click',resetFiltersAndLoad);
document.addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(b)openJob(b.dataset.edit)});
document.addEventListener('change',e=>{const s=e.target.closest('[data-status]');if(s)changeStatus(s.dataset.id,s.value,s)});
$('jobOrder').addEventListener('change',()=>{
  const order=orderOf($('jobOrder').value);if(!order)return;
  if(!$('jobTitle').value.trim())$('jobTitle').value=order.model_name||order.source||`Заказ №${order.order_number}`;
  if(!$('jobEnd').value&&order.due_at)$('jobEnd').value=inputDate(order.due_at);
});

$('jobForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!canManage())return;$('saveJob').disabled=true;$('jobError').textContent='';
  const id=$('jobId').value,order=orderOf($('jobOrder').value),duration=Number($('jobDuration').value||0);
  const payload={order_id:$('jobOrder').value||null,assigned_to:$('jobAssignee').value||null,title:$('jobTitle').value.trim(),priority:Math.max(0,Math.min(100,Number($('jobPriority').value)||0)),operation_type:$('jobOperation').value.trim()||null,planned_machine_minutes:duration>0?Math.min(43200,Math.round(duration)):null,deadline_at:$('jobEnd').value?new Date($('jobEnd').value).toISOString():(order?.due_at||null),notes:$('jobNotes').value.trim()||null,updated_at:new Date().toISOString()};
  if(!payload.title){$('jobError').textContent='Укажите название задания.';$('saveJob').disabled=false;return}
  try{
    const result=id?await supabase.from('production_jobs').update(payload).eq('id',id):await supabase.from('production_jobs').insert({...payload,status:'NEW'});
    if(result.error)throw result.error;$('jobDlg').close();await load(true);
  }catch(error){$('jobError').textContent=error.message||String(error)}finally{$('saveJob').disabled=false}
});

function initRealtime(){
  if(typeof supabase.channel!=='function')return;
  const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>load(true),450)};
  state.channel=supabase.channel('production-live-v4').on('postgres_changes',{event:'*',schema:'public',table:'production_jobs'},reload).on('postgres_changes',{event:'*',schema:'public',table:'orders'},reload).subscribe();
  window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true});
}

await initContext();await load();initRealtime();
