// Printer profiles in the shared HUB database; requires the reviewed migration.
// A slicer profile is not a physical asset. No equipment rows are created here.
import {supabase} from './guard.js?v=20260905-netfix1';
const $=id=>document.getElementById(id);
const root=$('serverProfiles');
let available=[],orgId=null;
const safe=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(t){$('serverProfileStatus').textContent=t}
async function reload(){
 if(!orgId){message('Ожидание доступного оборудования организации');return;}
 const {data,error}=await supabase.from('production_printer_profiles')
 .select('id,equipment_id,name,slicer,nozzle_mm,machine_lifetime_hours,operation_cost_per_hour,is_active')
 .eq('organization_id',orgId).order('name');
 if(error){message('Централизованные профили пока недоступны: '+error.message);return;}
 root.replaceChildren();
 for(const p of data||[]){
  const row=document.createElement('div');row.className='line';
  row.innerHTML='<span><b>'+safe(p.name)+'</b><small>'+safe(p.slicer||'OrcaSlicer')+' · Сопло '+safe(p.nozzle_mm??'не указано')+' мм · '+safe(available.find(a=>a.id===p.equipment_id)?.name||'Станок недоступен')+'</small></span>';
  const small=document.createElement('span');small.className='pill';small.textContent=p.is_active?'Активен':'Отключён';row.append(small);root.append(row);
 }
 if(!(data||[]).length){root.textContent='Профили ещё не добавлены';}
 message('Профилей в общей базе: '+(data||[]).length);
}
document.addEventListener('a4:3d-equipment-loaded',async e=>{
 orgId=e.detail?.orgId||null;available=(e.detail?.assets||[]).filter(x=>x?.id);
 const select=$('serverProfileEquipment');select.replaceChildren(new Option('Выбрать станок',''));
 available.forEach(a=>select.add(new Option((a.inventory_number||'—')+' · '+(a.name||a.model),a.id)));
 await reload();
});
$('serverProfileForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const submit=$('serverProfileSave');
 const id=$('serverProfileEquipment').value,name=$('serverProfileName').value.trim();
 if(!orgId||!available.some(a=>a.id===id)||!name){message('Выберите станок и укажите название профиля');return;}
 const raw=$('serverProfileNozzle').value.trim();const nozzle=raw===''?null:Number(raw);
 if(nozzle!==null&&(!Number.isFinite(nozzle)||nozzle<=0)){message('Некорректный диаметр сопла');return;}
 submit.disabled=true;
 try{
  const {error}=await supabase.from('production_printer_profiles').insert({
   organization_id:orgId,equipment_id:id,name,slicer:'OrcaSlicer',nozzle_mm:nozzle
  });
  if(error)throw error;
  $('serverProfileName').value='';$('serverProfileNozzle').value='';await reload();
 }catch(err){message('Не удалось сохранить профиль: '+err.message);}
 finally{submit.disabled=false}
});
