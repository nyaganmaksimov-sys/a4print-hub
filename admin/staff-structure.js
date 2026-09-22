import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const state={organizations:[],departments:[],positions:[],loading:false};

function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}
async function ensureAdmin(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){location.replace('./login.html');return false}
  const {data,error}=await supabase.rpc('has_role',{required_role:'ADMIN'});
  if(error)throw error;
  if(!data){
    $('departments').innerHTML='<div class="a4-error">Раздел доступен только администратору.</div>';
    $('addDepartment').hidden=true;$('addPosition').hidden=true;
    notify('warning','Нет доступа','Структура команды доступна только администратору.');
    return false;
  }
  return true;
}
async function load(){
  if(state.loading)return;state.loading=true;
  try{
    const [o,d,p]=await Promise.all([
      supabase.from('organizations').select('id,name,code,is_active').order('name'),
      supabase.from('organization_units').select('id,organization_id,name,code,is_active').order('name'),
      supabase.from('staff_positions').select('id,organization_unit_id,name,code,is_active,sort_order').order('sort_order').order('name')
    ]);
    if(o.error)throw o.error;if(d.error)throw d.error;if(p.error)throw p.error;
    state.organizations=o.data||[];state.departments=d.data||[];state.positions=p.data||[];
    render();
  }finally{state.loading=false}
}
function orgName(id){return state.organizations.find(x=>x.id===id)?.name||'Организация'}
function deptName(id){const d=state.departments.find(x=>x.id===id);return d?`${orgName(d.organization_id)} · ${d.name}`:'Отдел'}
function render(){renderDepartments();renderFilters();renderPositions()}
function renderDepartments(){
  if(!state.organizations.length){$('departments').className='empty';$('departments').textContent='Организации не найдены';return}
  $('departments').className='';
  $('departments').innerHTML=state.organizations.map(o=>{
    const list=state.departments.filter(d=>d.organization_id===o.id);
    return `<section class="org-block"><div class="org-name">${esc(o.name)}</div>${list.length?list.map(d=>`<div class="dept"><div><b>${esc(d.name)}</b><div class="muted">${esc(d.code||'Без кода')} · <span class="status ${d.is_active?'on':'off'}">${d.is_active?'Активен':'Отключён'}</span></div></div><button class="btn secondary" data-dept-edit="${d.id}">Изменить</button></div>`).join(''):'<div class="muted">Отделов пока нет</div>'}</section>`;
  }).join('');
}
function renderFilters(){
  $('departmentFilter').innerHTML='<option value="">Все отделы</option>'+state.organizations.map(o=>`<optgroup label="${esc(o.name)}">${state.departments.filter(d=>d.organization_id===o.id).map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('')}</optgroup>`).join('');
  $('positionDepartment').innerHTML=state.organizations.map(o=>`<optgroup label="${esc(o.name)}">${state.departments.filter(d=>d.is_active&&d.organization_id===o.id).map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('')}</optgroup>`).join('');
}
function renderPositions(){
  const filter=$('departmentFilter').value;
  const list=state.positions.filter(p=>!filter||p.organization_unit_id===filter);
  if(!list.length){$('positions').className='empty';$('positions').textContent='Должностей не найдено';return}
  $('positions').className='positions';
  $('positions').innerHTML=list.map(p=>`<article class="position"><div><b>${esc(p.name)}</b><div class="muted">${esc(deptName(p.organization_unit_id))} · ${esc(p.code||'Без кода')} · <span class="status ${p.is_active?'on':'off'}">${p.is_active?'Активна':'Отключена'}</span></div></div><button class="btn secondary" data-pos-edit="${p.id}">Изменить</button></article>`).join('');
}
function orgOptions(selected=''){return state.organizations.filter(o=>o.is_active).map(o=>`<option value="${o.id}" ${o.id===selected?'selected':''}>${esc(o.name)}</option>`).join('')}
function openDepartment(id=''){
  const d=state.departments.find(x=>x.id===id);$('departmentForm').reset();$('departmentError').textContent='';$('departmentId').value=id;$('departmentTitle').textContent=d?'Изменить отдел':'Новый отдел';
  $('departmentOrganization').innerHTML=orgOptions(d?.organization_id||'');$('departmentOrganization').disabled=Boolean(d);$('departmentName').value=d?.name||'';$('departmentCode').value=d?.code||'';$('departmentActive').checked=d?.is_active!==false;$('departmentActiveWrap').style.display=d?'block':'none';$('departmentModal').classList.add('open');
}
function openPosition(id=''){
  const p=state.positions.find(x=>x.id===id);$('positionForm').reset();$('positionError').textContent='';$('positionId').value=id;$('positionTitle').textContent=p?'Изменить должность':'Новая должность';
  renderFilters();$('positionDepartment').value=p?.organization_unit_id||$('departmentFilter').value||state.departments.find(d=>d.is_active)?.id||'';$('positionDepartment').disabled=Boolean(p);$('positionName').value=p?.name||'';$('positionCode').value=p?.code||'';$('positionActive').checked=p?.is_active!==false;$('positionActiveWrap').style.display=p?'block':'none';$('positionModal').classList.add('open');
}

$('addDepartment').addEventListener('click',()=>openDepartment());
$('addPosition').addEventListener('click',()=>openPosition());
$('departmentCancel').addEventListener('click',()=>$('departmentModal').classList.remove('open'));
$('positionCancel').addEventListener('click',()=>$('positionModal').classList.remove('open'));
$('departmentFilter').addEventListener('change',renderPositions);
$('departments').addEventListener('click',e=>{const b=e.target.closest('[data-dept-edit]');if(b)openDepartment(b.dataset.deptEdit)});
$('positions').addEventListener('click',e=>{const b=e.target.closest('[data-pos-edit]');if(b)openPosition(b.dataset.posEdit)});

$('departmentForm').addEventListener('submit',async e=>{
  e.preventDefault();$('departmentError').textContent='';
  try{
    const id=$('departmentId').value;
    if(id){
      const {error}=await supabase.rpc('admin_update_department',{p_department_id:id,p_name:$('departmentName').value.trim(),p_code:$('departmentCode').value.trim()||null,p_is_active:$('departmentActive').checked});if(error)throw error;
    }else{
      const {error}=await supabase.rpc('admin_create_department',{p_organization_id:$('departmentOrganization').value,p_name:$('departmentName').value.trim(),p_code:$('departmentCode').value.trim()||null});if(error)throw error;
    }
    $('departmentModal').classList.remove('open');await load();notify('success','Структура команды','Отдел сохранён.');
  }catch(error){$('departmentError').textContent=error?.message||'Не удалось сохранить отдел.'}
});
$('positionForm').addEventListener('submit',async e=>{
  e.preventDefault();$('positionError').textContent='';
  try{
    const id=$('positionId').value;
    if(id){
      const {error}=await supabase.rpc('admin_update_position',{p_position_id:id,p_name:$('positionName').value.trim(),p_code:$('positionCode').value.trim()||null,p_is_active:$('positionActive').checked});if(error)throw error;
    }else{
      const {error}=await supabase.rpc('admin_create_position',{p_department_id:$('positionDepartment').value,p_name:$('positionName').value.trim(),p_code:$('positionCode').value.trim()||null});if(error)throw error;
    }
    $('positionModal').classList.remove('open');await load();notify('success','Структура команды','Должность сохранена.');
  }catch(error){$('positionError').textContent=error?.message||'Не удалось сохранить должность.'}
});
for(const id of['departmentModal','positionModal'])$(id).addEventListener('click',e=>{if(e.target===$(id))$(id).classList.remove('open')});

try{
  if(await ensureAdmin())await load();
}catch(error){
  console.error(error);
  $('departments').innerHTML=`<div class="a4-error">${esc(error?.message||'Ошибка загрузки')}</div>`;
}
