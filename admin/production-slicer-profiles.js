// Optional printer profile picker in existing production cards.
// No mutation of production_jobs: profile assignment has its own guarded table.
import {supabase} from './guard.js?v=20260905-netfix1';
let jobs=[],profiles=[],assignments=[],loading=false;
const canEdit=()=>Array.isArray(window.__A4_CURRENT_ROLES__)&&window.__A4_CURRENT_ROLES__.some(r=>['ADMIN','MANAGER','PRODUCTION'].includes(r));
function text(tag,content){const e=document.createElement(tag);e.textContent=content;return e}
async function refresh(){
 if(loading)return;loading=true;
 try{
  const selected=jobs.filter(j=>j.order_business_unit==='3D_ARTPRINT'&&j.equipment_id);
  if(!selected.length)return;
  const equipmentIds=[...new Set(selected.map(j=>j.equipment_id))],jobIds=selected.map(j=>j.id);
  const [p,a]=await Promise.all([
   supabase.from('production_printer_profiles').select('id,equipment_id,name,is_active').in('equipment_id',equipmentIds),
   supabase.from('production_job_printer_profiles').select('production_job_id,printer_profile_id').in('production_job_id',jobIds)
  ]);
  if(p.error||a.error)return;
  profiles=p.data||[];assignments=a.data||[];
  render();
 }finally{loading=false}
}
function render(){
 const editable=canEdit();
 for(const job of jobs){
  const node=document.querySelector('[data-production-job-id="'+job.id+'"]');
  if(!node||job.order_business_unit!=='3D_ARTPRINT'||!job.equipment_id)continue;
  node.querySelector('[data-slicer-profile-control]')?.remove();
  const wrap=text('div','');wrap.className='production-slicer-profile';wrap.dataset.slicerProfileControl='';
  wrap.append(text('small','Профиль OrcaSlicer'));
  const select=document.createElement('select');select.setAttribute('aria-label','Профиль печати для задания '+(job.title||job.id));
  select.add(new Option('Не выбран',''));
  const options=profiles.filter(p=>p.equipment_id===job.equipment_id&&p.is_active);
  for(const p of options)select.add(new Option(p.name,p.id));
  const existing=assignments.find(a=>a.production_job_id===job.id);
  if(existing&&options.some(p=>p.id===existing.printer_profile_id))select.value=existing.printer_profile_id;
  else if(existing){wrap.append(text('small','Сохранённый профиль недоступен — выбор требуется повторно'));}
  select.disabled=!editable||!['NEW','QUEUED','PAUSED'].includes(job.status);
  wrap.append(select);
  if(editable){
   const save=text('button','Применить');save.type='button';save.disabled=select.disabled;
   const status=text('small','');
   save.addEventListener('click',async()=>{
    save.disabled=true;
    const value=select.value;
    try{
      const result=value
       ?await supabase.from('production_job_printer_profiles').upsert({production_job_id:job.id,printer_profile_id:value,organization_id:job.organization_id},{onConflict:'production_job_id'})
       :await supabase.from('production_job_printer_profiles').delete().eq('production_job_id',job.id);
      if(result.error)throw result.error;
      status.textContent='Сохранено';await refresh();
    }catch(e){status.textContent='Ошибка: '+e.message}finally{save.disabled=false}
   });wrap.append(save,status);
  }
  node.append(wrap);
 }
}
document.addEventListener('a4:production-board-rendered',event=>{
 jobs=(event.detail?.jobs||[]).filter(j=>j&&typeof j.id==='string');
 void refresh();
});
