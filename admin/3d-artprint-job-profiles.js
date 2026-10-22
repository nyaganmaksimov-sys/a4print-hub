import {supabase} from './guard.js?v=20260905-netfix1';
const root=document.getElementById('jobProfileAssignments');
let orgId=null,assets=[],jobs=[],profiles=[],assignments=[];
const activeStatuses=new Set(['NEW','QUEUED','IN_PROGRESS','PAUSED']);
function el(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);return node}
function announce(msg){document.getElementById('jobProfileStatus').textContent=msg}
function render(){
 root.replaceChildren();
 for(const job of jobs.filter(j=>activeStatuses.has(j.status)&&j.equipment_id&&assets.some(a=>a.id===j.equipment_id))){
  const row=el('div');row.className='line job-profile-row';
  const details=el('div');details.append(el('b',job.title||'Задание'),el('small','Заказ №'+(job.order_number||'—')+' · '+(assets.find(a=>a.id===job.equipment_id)?.name||'Станок')));
  const select=el('select');select.setAttribute('aria-label','Профиль задания '+(job.title||job.id));
  select.add(new Option('Без профиля',''));
  profiles.filter(p=>p.equipment_id===job.equipment_id&&p.is_active).forEach(p=>select.add(new Option(p.name,p.id)));
  const assigned=assignments.find(a=>a.production_job_id===job.id);
  if(assigned&&profiles.some(p=>p.id===assigned.printer_profile_id&&p.equipment_id===job.equipment_id&&p.is_active))select.value=assigned.printer_profile_id;
  const save=el('button','Сохранить');save.type='button';save.disabled=!orgId;
  save.onclick=async()=>{
   save.disabled=true;
   try{
    const selected=select.value;
    const result=selected?await supabase.from('production_job_printer_profiles').upsert({organization_id:orgId,production_job_id:job.id,printer_profile_id:selected},{onConflict:'production_job_id'}):await supabase.from('production_job_printer_profiles').delete().eq('production_job_id',job.id);
    if(result.error)throw result.error;
    announce('Привязка профиля сохранена для задания');
    await reload();
   }catch(error){announce('Ошибка: '+error.message)}
   finally{save.disabled=false}
  };
  const controls=el('div');controls.className='job-profile-controls';controls.append(select,save);
  row.append(details,controls);root.append(row);
 }
 if(!root.children.length)root.append(el('div','Нет заданий с назначенным станком для выбора профиля.'));
}
async function reload(){
 if(!orgId)return;
 const [jobsResult,profilesResult,assignmentsResult]=await Promise.all([
 supabase.rpc('get_production_workspace_jobs',{p_query:'',p_unit:'3D_ARTPRINT',p_assignee:null,p_priority:'',p_done_limit:0,p_cancelled_limit:0}),
 supabase.from('production_printer_profiles').select('id,equipment_id,name,is_active').eq('organization_id',orgId),
 supabase.from('production_job_printer_profiles').select('production_job_id,printer_profile_id').eq('organization_id',orgId)
 ]);
 for(const result of [jobsResult,profilesResult,assignmentsResult])if(result.error){announce('Загрузка привязок недоступна: '+result.error.message);return;}
 jobs=(jobsResult.data||[]).filter(j=>j.order_business_unit==='3D_ARTPRINT');
 profiles=profilesResult.data||[];assignments=assignmentsResult.data||[];
 render();announce('Профили можно назначать только заданиям с выбранным станком');
}
document.addEventListener('a4:3d-equipment-loaded',event=>{
 orgId=event.detail?.orgId||null;assets=event.detail?.assets||[];
 reload();
});
document.getElementById('refreshJobProfiles').addEventListener('click',reload);
