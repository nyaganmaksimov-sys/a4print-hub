import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg=window.A4PRINT_CONFIG||{};
const sb=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
const edge=`${cfg.supabaseUrl}/functions/v1/staff-invite-admin`;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let session=null,meta={roles:[],organizations:[],organization_units:[],staff_positions:[]},invites=[];

async function call(action,payload={}){
  const r=await fetch(edge,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.supabasePublishableKey,'Authorization':`Bearer ${session.access_token}`},body:JSON.stringify({action,...payload})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.message||d.error||'Ошибка приглашений');
  return d;
}
function orgOptions(){return '<option value="">Выберите организацию</option>'+meta.organizations.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}
function deptOptions(org=''){return '<option value="">Выберите отдел</option>'+meta.organization_units.filter(x=>!org||x.organization_id===org).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}
function posOptions(dept=''){return '<option value="">Выберите должность</option>'+meta.staff_positions.filter(x=>x.organization_unit_id===dept).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}
function rolesHtml(){return meta.roles.map(r=>`<label class="rolecheck"><input type="checkbox" value="${r.id}"><span><b>${esc(r.name)}</b><small>${esc(r.description||'')}</small></span></label>`).join('')}
function active(i){return !i.used_at&&!i.revoked_at&&new Date(i.expires_at)>new Date()}
function status(i){if(i.used_at)return ['Использовано','on'];if(i.revoked_at)return ['Отменено','off'];if(new Date(i.expires_at)<=new Date())return ['Истекло','off'];return ['Активно','on']}
function fmt(v){return v?new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—'}

async function loadInvites(){
  const d=await call('bootstrap');meta=d.meta||meta;invites=d.invites||[];
  $('inviteCount').textContent=invites.filter(active).length;
  $('inviteCount').style.display=invites.some(active)?'inline-grid':'none';
  render();
}
function render(){
  const root=$('inviteList');if(!root)return;
  if(!invites.length){root.className='empty';root.textContent='Приглашений пока нет';return}
  root.className='table-wrap';
  root.innerHTML=`<table class="table"><thead><tr><th>Назначение</th><th>Роли</th><th>Срок</th><th>Статус</th><th></th></tr></thead><tbody>${invites.map(i=>{const st=status(i);return `<tr><td><b>${esc(i.position?.name||'Должность')}</b><small>${esc([i.organization?.name,i.department?.name].filter(Boolean).join(' · '))}</small>${i.used_user?`<small>Зарегистрирован: ${esc(i.used_user.full_name||i.used_user.email||'')}</small>`:''}</td><td><div class="roles">${(i.roles||[]).map(r=>`<span class="role">${esc(r.name)}</span>`).join('')}</div></td><td><b>${fmt(i.expires_at)}</b><small>Создано: ${fmt(i.created_at)}</small></td><td><span class="status ${st[1]}">${st[0]}</span></td><td>${active(i)?`<button class="btn danger" data-revoke-invite="${i.id}">Отменить</button>`:''}</td></tr>`}).join('')}</tbody></table>`;
  root.querySelectorAll('[data-revoke-invite]').forEach(b=>b.onclick=async()=>{if(!confirm('Отменить это приглашение? Ссылка перестанет работать.'))return;try{await call('revoke',{invite_id:b.dataset.revokeInvite});await loadInvites()}catch(e){alert(e.message)}});
}
function openModal(){
  $('inviteForm').reset();$('inviteError').textContent='';$('inviteResult').style.display='none';$('inviteCreate').style.display='inline-flex';
  $('inviteOrganization').innerHTML=orgOptions();$('inviteDepartment').innerHTML=deptOptions();$('invitePosition').innerHTML=posOptions();$('inviteRoles').innerHTML=rolesHtml();
  $('inviteDepartment').disabled=true;$('invitePosition').disabled=true;$('inviteModal').classList.add('open');
}
function wire(){
  $('inviteOrganization').onchange=()=>{$('inviteDepartment').innerHTML=deptOptions($('inviteOrganization').value);$('inviteDepartment').disabled=!$('inviteOrganization').value;$('invitePosition').innerHTML=posOptions();$('invitePosition').disabled=true};
  $('inviteDepartment').onchange=()=>{$('invitePosition').innerHTML=posOptions($('inviteDepartment').value);$('invitePosition').disabled=!$('inviteDepartment').value};
  $('newInvite').onclick=openModal;
  $('inviteCancel').onclick=()=>$('inviteModal').classList.remove('open');
  $('inviteModal').onclick=e=>{if(e.target===$('inviteModal'))$('inviteModal').classList.remove('open')};
  $('inviteTab').onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));$('inviteTab').classList.add('active');$('employeesSection').classList.remove('active');$('requestsSection').classList.remove('active');$('invitesSection').classList.add('active');loadInvites().catch(e=>{$('inviteList').className='empty error';$('inviteList').textContent=e.message})};
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>$('invitesSection').classList.remove('active')));
  $('inviteForm').onsubmit=async e=>{
    e.preventDefault();$('inviteError').textContent='';
    const role_ids=[...$('inviteRoles').querySelectorAll('input:checked')].map(x=>x.value);
    const payload={organization_id:$('inviteOrganization').value,department_id:$('inviteDepartment').value,position_id:$('invitePosition').value,role_ids,expires_days:Number($('inviteExpires').value||7)};
    if(!payload.organization_id||!payload.department_id||!payload.position_id)return $('inviteError').textContent='Выберите организацию, отдел и должность.';
    if(!role_ids.length)return $('inviteError').textContent='Выберите хотя бы одну роль.';
    try{$('inviteCreate').disabled=true;const d=await call('create',{payload});$('inviteLink').value=d.invite_url;$('inviteResult').style.display='block';$('inviteCreate').style.display='none';await loadInvites()}catch(x){$('inviteError').textContent=x.message}finally{$('inviteCreate').disabled=false}
  };
  $('copyInvite').onclick=async()=>{try{await navigator.clipboard.writeText($('inviteLink').value);$('copyInvite').textContent='Скопировано ✓';setTimeout(()=>$('copyInvite').textContent='Копировать',1500)}catch{$('inviteLink').select();document.execCommand('copy')}};
}

(async()=>{const s=await sb.auth.getSession();session=s.data.session;if(!session)return;wire();try{await loadInvites()}catch(e){console.warn('Staff invites init failed',e)}})();
