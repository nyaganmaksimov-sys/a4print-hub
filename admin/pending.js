import {supabase} from './guard.js?v=20260923-authpending1';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const ORG_KEY='a4print_staff_registration_org';
const state={profile:null,organizations:[],loading:false};

function showError(error){
  const el=$('error');if(!el)return;
  el.textContent=String(error?.message||error||'Ошибка');
  el.style.display='block';
}
function clearError(){const el=$('error');if(el){el.textContent='';el.style.display='none'}}
function storedOrganization(){try{return localStorage.getItem(ORG_KEY)||''}catch{return''}}
function rememberOrganization(id){try{if(id)localStorage.setItem(ORG_KEY,id)}catch{}}
function requestOrganization(){
  return state.profile?.request?.organization_id||storedOrganization()||'';
}
async function loadOrganizations(){
  const {data,error}=await supabase.rpc('get_public_staff_registration_organizations');
  if(error)throw error;
  state.organizations=Array.isArray(data)?data:[];
}
function organizationName(id){
  return state.organizations.find(o=>o.id===id)?.name||state.organizations.find(o=>o.id===id)?.code||'—';
}
function render(){
  const data=state.profile||{},r=data.request||{},rejected=data.status==='REJECTED';
  const orgId=requestOrganization();
  const orgLabel=organizationName(orgId);
  const orgSelect=rejected?`<label class="field">Организация<select id="resubmitOrganization" required>
    <option value="">Выберите организацию</option>
    ${state.organizations.map(o=>`<option value="${esc(o.id)}" ${o.id===orgId?'selected':''}>${esc(o.name||o.code||'Организация')}</option>`).join('')}
  </select></label>`:`<div class="row"><span>Организация</span><b>${esc(orgLabel)}</b></div>`;

  $('content').innerHTML=`
    <h1>${rejected?'Заявка отклонена':'Заявка отправлена'}</h1>
    <div class="state ${rejected?'rejected':'pending'}">
      <div class="icon">${rejected?'✕':'⏳'}</div>
      <div>
        <b>${rejected?'Администратор отклонил заявку':'Ожидается подтверждение администратора'}</b>
        <div style="margin-top:5px">${rejected?esc(r.rejection_reason||'Причина не указана'):'После одобрения вам назначат роли и откроется личный кабинет.'}</div>
      </div>
    </div>
    <div class="info">
      <div class="row"><span>ФИО</span><b>${esc(r.full_name||'—')}</b></div>
      <div class="row"><span>Email</span><b>${esc(r.email||'—')}</b></div>
      <div class="row"><span>Телефон</span><b>${esc(r.phone||'—')}</b></div>
      <div class="row"><span>Способ входа</span><b>${esc(data.provider||r.provider||'email')}</b></div>
      ${orgSelect}
    </div>`;
  $('resubmit').style.display=rejected?'inline-block':'none';
  if(rejected){
    const select=$('resubmitOrganization');
    select?.addEventListener('change',()=>rememberOrganization(select.value));
  }
}
async function load(){
  if(state.loading)return;state.loading=true;clearError();
  try{
    const {data:{session},error:sessionError}=await supabase.auth.getSession();
    if(sessionError)throw sessionError;
    if(!session){location.replace('./login.html');return}
    const {data,error}=await supabase.rpc('get_my_staff_profile');
    if(error)throw error;
    state.profile=data;
    if(data?.status==='ACTIVE'){location.replace('./profile.html');return}
    if(data?.status==='UNREGISTERED'){location.replace('./register.html');return}
    await loadOrganizations();
    render();
  }finally{state.loading=false}
}
async function resubmit(){
  clearError();
  const r=state.profile?.request||{};
  const organizationId=$('resubmitOrganization')?.value||requestOrganization();
  if(!organizationId)throw new Error('Выберите организацию.');
  rememberOrganization(organizationId);
  const button=$('resubmit');button.disabled=true;button.textContent='Отправляем…';
  try{
    const {error}=await supabase.rpc('submit_staff_registration_v2',{
      p_full_name:r.full_name||null,
      p_phone:r.phone||null,
      p_provider:state.profile?.provider||r.provider||null,
      p_organization_id:organizationId
    });
    if(error)throw error;
    await load();
  }finally{button.disabled=false;button.textContent='Подать повторно'}
}

$('refresh').addEventListener('click',()=>load().catch(showError));
$('resubmit').addEventListener('click',()=>resubmit().catch(showError));
$('logout').addEventListener('click',async()=>{await supabase.auth.signOut();location.replace('./login.html')});

load().catch(showError);
