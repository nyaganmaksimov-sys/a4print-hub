import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const statusLabels={NEW:'Новая',QUEUED:'В очереди',IN_PROGRESS:'В работе',PAUSED:'Пауза',DONE:'Готово',CANCELLED:'Отменена'};
const unitLabels={A4_PRINT:'А4-Принт','3D_ARTPRINT':'3D-ARTPRINT',COMMON:'Общее'};
const statusOrder=['NEW','QUEUED','IN_PROGRESS','PAUSED','DONE','CANCELLED'];
const state={jobs:[],orders:[],users:[],roles:[],loading:false,channel:null};
let reloadTimer=null;

function canManage(){return ['ADMIN','MANAGER','PRODUCTION'].some(x=>state.roles.includes(x))}
function fmtDate(value){if(!value)return'—';const d=new Date(value);if(!Number.isFinite(d.getTime()))return'—';return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}
function inputDate(value){if(!value)return'';const d=new Date(value);if(!Number.isFinite(d.getTime()))return'';const off=d.getTimezoneOffset();return new Date(d.getTime()-off*60000).toISOString().slice(0,16)}
function overdue(job){return Boolean(job.planned_end)&&!['DONE','CANCELLED'].includes(job.status)&&new Date(job.planned_end).getTime()<Date.now()}
function userName(id){const u=state.users.find(x=>x.id===id);return u?.full_name||u?.email||'Не назначен'}
function orderOf(id){return state.orders.find(x=>x.id===id)||null}
function orderLabel(order){if(!order)return'Без заказа';return `№${order.order_number} · ${unitLabels[order.business_unit]||order.business_unit||'Общее'} · ${order.model_name||order.source||'заказ'}`}

async function load(){
  if(state.loading)return;state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';
  try{
    const [jobs,orders,users,roles]=await Promise.all([
      supabase.from('production_jobs').select('*').order('priority',{ascending:false}).order('created_at',{ascending:false}),
      supabase.from('orders').select('id,order_number,status,total,business_unit,model_name,source,created_at').order('created_at',{ascending:false}).limit(1000),
      supabase.from('users').select('id,full_name,email,is_active').eq('is_active',true).order('full_name'),
      supabase.rpc('get_my_roles')
    ]);
    for(const x of [jobs,orders,users])if(x.error)throw x.error;
    state.jobs=jobs.data||[];state.orders=orders.data||[];state.users=users.data||[];state.roles=Array.isArray(roles.data)?roles.data:[];
    $('addJob').hidden=!canManage();
    fillFilters();fillFormOptions();render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){console.error('Production load failed',error);$('queueCol').innerHTML=`<div class="production-empty" style="color:#b91c1c">${esc(error.message||error)}</div>`}
  finally{state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить'}
}

function fillFilters(){
  const current=$('assignee').value;
  $('assignee').innerHTML='<option value="">Все исполнители</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.full_name||u.email||'Сотрудник')}</option>`).join('');
  if([...$('assignee').options].some(o=>o.value===current))$('assignee').value=current;
}
function fillFormOptions(){
  const orderCurrent=$('jobOrder').value,userCurrent=$('jobAssignee').value;
  const activeOrders=state.orders.filter(o=>!['COMPLETED','CANCELLED'].includes(o.status));
  $('jobOrder').innerHTML='<option value="">Без привязки к заказу</option>'+activeOrders.map(o=>`<option value="${o.id}">${esc(orderLabel(o))}</option>`).join('');
  $('jobAssignee').innerHTML='<option value="">Не назначен</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.full_name||u.email||'Сотрудник')}</option>`).join('');
  if([...$('jobOrder').options].some(o=>o.value===orderCurrent))$('jobOrder').value=orderCurrent;
  if([...$('jobAssignee').options].some(o=>o.value===userCurrent))$('jobAssignee').value=userCurrent;
}
function filters(){return{q:$('search').value.trim().toLowerCase(),unit:$('unit').value,assignee:$('assignee').value,priority:$('priorityFilter').value}}
function visibleJobs(){
  const f=filters();return state.jobs.filter(job=>{
    const order=orderOf(job.order_id);const text=[job.title,job.notes,order?.order_number,order?.model_name,order?.source,userName(job.assigned_to)].filter(Boolean).join(' ').toLowerCase();
    if(f.q&&!text.includes(f.q))return false;
    if(f.unit&&order?.business_unit!==f.unit)return false;
    if(f.assignee&&job.assigned_to!==f.assignee)return false;
    if(f.priority==='high'&&Number(job.priority||0)<70)return false;
    if(f.priority==='normal'&&Number(job.priority||0)>=70)return false;
    return true;
  })
}
function statusOptions(current){return statusOrder.map(s=>`<option value="${s}" ${s===current?'selected':''}>${statusLabels[s]}</option>`).join('')}
function jobHtml(job){
  const order=orderOf(job.order_id),late=overdue(job),priority=Number(job.priority||0),high=priority>=70;
  const controls=canManage()?`<select class="production-status-select" data-status data-id="${job.id}">${statusOptions(job.status)}</select><button class="production-edit" type="button" data-edit="${job.id}">Изменить</button>`:`<span style="font-size:11px;font-weight:800;color:#64748b">${esc(statusLabels[job.status]||job.status)}</span>`;
  return `<article class="production-job ${late?'overdue':''}">
    <div class="production-job-top"><div class="production-job-title"><b>${esc(job.title||'Производственное задание')}</b><small>${order?`Заказ №${esc(order.order_number)} · ${esc(unitLabels[order.business_unit]||order.business_unit||'Общее')}`:'Внутреннее задание'}</small></div><span class="production-priority ${high?'high':''}" title="Приоритет">${priority}</span></div>
    <div class="production-job-meta"><div class="production-meta-cell"><span>Исполнитель</span><b>${esc(userName(job.assigned_to))}</b></div><div class="production-meta-cell ${late?'danger':''}"><span>Срок</span><b>${esc(fmtDate(job.planned_end))}</b></div></div>
    <div class="production-job-actions">${controls}</div>
  </article>`
}
function renderStats(){
  const active=state.jobs.filter(x=>!['DONE','CANCELLED'].includes(x.status));
  $('all').textContent=state.jobs.length;$('queue').textContent=state.jobs.filter(x=>['NEW','QUEUED'].includes(x.status)).length;$('work').textContent=state.jobs.filter(x=>['IN_PROGRESS','PAUSED'].includes(x.status)).length;$('overdue').textContent=active.filter(overdue).length;$('done').textContent=state.jobs.filter(x=>x.status==='DONE').length;
}
function render(){
  renderStats();const rows=visibleJobs();$('visibleCount').textContent=`${rows.length} из ${state.jobs.length}`;
  const queue=rows.filter(x=>['NEW','QUEUED'].includes(x.status)),work=rows.filter(x=>['IN_PROGRESS','PAUSED'].includes(x.status)),done=rows.filter(x=>x.status==='DONE'),cancelled=rows.filter(x=>x.status==='CANCELLED');
  $('queueCount').textContent=queue.length;$('workCount').textContent=work.length;$('doneCount').textContent=done.length;
  $('queueCol').innerHTML=queue.map(jobHtml).join('')||'<div class="production-empty">Очередь пуста</div>';
  $('workCol').innerHTML=work.map(jobHtml).join('')||'<div class="production-empty">Нет заданий в работе</div>';
  $('doneCol').innerHTML=done.map(jobHtml).join('')||'<div class="production-empty">Готовых заданий пока нет</div>';
  $('cancelledCount').textContent=cancelled.length;$('cancelledList').innerHTML=cancelled.map(j=>`<div class="production-cancelled-row"><span><b>${esc(j.title)}</b>${j.order_id?' · заказ №'+esc(orderOf(j.order_id)?.order_number||'—'):''}</span><span>${esc(fmtDate(j.updated_at||j.created_at))}</span></div>`).join('')||'<div class="production-empty">Отменённых заданий нет</div>';
}

function openJob(id=''){
  if(!canManage())return;const job=state.jobs.find(x=>x.id===id)||null;
  $('jobForm').reset();$('jobId').value=job?.id||'';$('jobDlgTitle').textContent=job?'Изменить задание':'Новое производственное задание';$('jobDlgText').textContent=job?'Измените срок, исполнителя, приоритет или описание.':'Создайте задание и привяжите его к заказу при необходимости.';
  fillFormOptions();$('jobOrder').value=job?.order_id||'';$('jobTitle').value=job?.title||'';$('jobAssignee').value=job?.assigned_to||'';$('jobPriority').value=Number(job?.priority||50);$('jobStart').value=inputDate(job?.planned_start);$('jobEnd').value=inputDate(job?.planned_end);$('jobNotes').value=job?.notes||'';$('jobError').textContent='';$('jobDlg').showModal();
}

async function syncOrderForJob(job,nextStatus){
  if(!job.order_id)return;
  const order=orderOf(job.order_id);if(!order||['COMPLETED','CANCELLED'].includes(order.status))return;
  if(nextStatus==='IN_PROGRESS'&&['NEW','CONFIRMED'].includes(order.status)){
    const {error}=await supabase.from('orders').update({status:'IN_PROGRESS',updated_at:new Date().toISOString()}).eq('id',order.id);if(!error)order.status='IN_PROGRESS';return;
  }
  if(nextStatus==='DONE'){
    const siblings=state.jobs.filter(x=>x.order_id===job.order_id&&x.status!=='CANCELLED');
    if(siblings.length&&siblings.every(x=>x.status==='DONE')){
      const {error}=await supabase.from('orders').update({status:'READY',updated_at:new Date().toISOString()}).eq('id',order.id);if(!error)order.status='READY';
    }
  }
}
async function changeStatus(id,next,select){
  const job=state.jobs.find(x=>x.id===id);if(!job||job.status===next||!canManage())return;
  const previous=job.status;select.disabled=true;job.status=next;renderStats();
  const now=new Date().toISOString(),payload={status:next,updated_at:now};
  if(next==='IN_PROGRESS'&&!job.started_at)payload.started_at=now;
  if(next==='DONE')payload.completed_at=now;else if(previous==='DONE')payload.completed_at=null;
  try{
    const {error}=await supabase.from('production_jobs').update(payload).eq('id',id);if(error)throw error;Object.assign(job,payload);await syncOrderForJob(job,next);render();
  }catch(error){job.status=previous;select.value=previous;window.alert(`Не удалось изменить статус: ${error.message||error}`)}finally{select.disabled=false}
}

$('addJob').addEventListener('click',()=>openJob());$('refresh').addEventListener('click',load);$('closeJobDlg').addEventListener('click',()=>$('jobDlg').close());
for(const id of ['search','unit','assignee','priorityFilter'])$(id).addEventListener(id==='search'?'input':'change',render);
$('clearFilters').addEventListener('click',()=>{$('search').value='';$('unit').value='';$('assignee').value='';$('priorityFilter').value='';render()});
document.addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(b)openJob(b.dataset.edit)});
document.addEventListener('change',e=>{const s=e.target.closest('[data-status]');if(s)changeStatus(s.dataset.id,s.value,s)});
$('jobOrder').addEventListener('change',()=>{if($('jobTitle').value.trim())return;const order=orderOf($('jobOrder').value);if(order)$('jobTitle').value=order.model_name||order.source||`Заказ №${order.order_number}`});

$('jobForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!canManage())return;$('saveJob').disabled=true;$('jobError').textContent='';
  const id=$('jobId').value;const payload={order_id:$('jobOrder').value||null,assigned_to:$('jobAssignee').value||null,title:$('jobTitle').value.trim(),priority:Math.max(0,Math.min(100,Number($('jobPriority').value)||0)),planned_start:$('jobStart').value?new Date($('jobStart').value).toISOString():null,planned_end:$('jobEnd').value?new Date($('jobEnd').value).toISOString():null,notes:$('jobNotes').value.trim()||null,updated_at:new Date().toISOString()};
  if(!payload.title){$('jobError').textContent='Укажите название задания.';$('saveJob').disabled=false;return}
  try{
    const result=id?await supabase.from('production_jobs').update(payload).eq('id',id):await supabase.from('production_jobs').insert({...payload,status:'NEW'});if(result.error)throw result.error;$('jobDlg').close();await load();
  }catch(error){$('jobError').textContent=error.message||String(error)}finally{$('saveJob').disabled=false}
});

function initRealtime(){
  if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(load,650)};
  state.channel=supabase.channel('production-live-v2').on('postgres_changes',{event:'*',schema:'public',table:'production_jobs'},reload).on('postgres_changes',{event:'*',schema:'public',table:'orders'},reload).subscribe();
  window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true});
}

await load();initRealtime();
