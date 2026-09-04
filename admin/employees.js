import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.A4PRINT_CONFIG || {};
const supabase = createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
const $ = id => document.getElementById(id);
const edgeUrl = `${cfg.supabaseUrl}/functions/v1/staff-admin`;

let session = null;
let roles = [];
let employees = [];
let requests = [];
let organizations = [];
let departments = [];
let positions = [];

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const initials = n => (String(n || '?').trim().split(/\s+/).slice(0,2).map(x => x[0]).join('').toUpperCase() || '?');
const providerLabel = p => { p = String(p || 'email').toLowerCase(); if (p.includes('google')) return 'Google'; if (p.includes('yandex')) return 'Яндекс'; if (p.includes('mail')) return 'Mail.ru'; return 'Email'; };
const fmt = v => v ? new Date(v).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

async function call(action, payload = {}, timeout = 7000) {
  if (!session) throw new Error('AUTH_REQUIRED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.supabasePublishableKey,
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(d.message || d.error || 'Ошибка загрузки данных.');
      e.code = d.error;
      e.status = r.status;
      throw e;
    }
    return d;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('Сервер сотрудников не ответил вовремя. Нажмите «Обновить».');
    throw e;
  } finally { clearTimeout(timer); }
}

function departmentName(id) {
  const d = departments.find(x => x.id === id);
  if (!d) return '';
  const o = organizations.find(x => x.id === d.organization_id);
  return [o?.name, d.name].filter(Boolean).join(' · ');
}
function positionName(id, fallback = '') { return positions.find(x => x.id === id)?.name || fallback || ''; }
function departmentOptions(selected = '') {
  return '<option value="">Выберите отдел</option>' + organizations.map(o => {
    const list = departments.filter(d => d.organization_id === o.id && d.is_active !== false);
    return list.length ? `<optgroup label="${esc(o.name)}">${list.map(d => `<option value="${d.id}" ${d.id===selected?'selected':''}>${esc(d.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}
function positionOptions(departmentId = '', selected = '') {
  return '<option value="">Выберите должность</option>' + positions.filter(p => p.organization_unit_id === departmentId && p.is_active !== false).map(p => `<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('');
}
function wirePosition(deptId, posId, selected = '') {
  const dept = $(deptId), pos = $(posId); if (!dept || !pos) return;
  const redraw = value => { pos.innerHTML = positionOptions(dept.value, value); pos.disabled = !dept.value; };
  dept.onchange = () => redraw(''); redraw(selected);
}
function drawRoles(el, selected = []) {
  const set = new Set(selected);
  el.innerHTML = roles.map(r => `<label class="rolecheck"><input type="checkbox" value="${r.id}" ${set.has(r.id)?'checked':''}><span><b>${esc(r.name)}</b><small>${esc(r.description || '')}</small></span></label>`).join('') || '<div class="muted">Роли не найдены</div>';
}
const selectedRoles = el => [...el.querySelectorAll('input[type=checkbox]:checked')].map(x => x.value);

async function load() {
  $('employeeList').className = 'empty';
  $('employeeList').textContent = 'Загрузка…';
  const d = await call('bootstrap');
  roles = d.roles || []; employees = d.users || []; requests = d.requests || [];
  organizations = d.organizations || []; departments = d.organization_units || []; positions = d.staff_positions || [];
  renderAll();
}
function renderAll() {
  const pending = requests.filter(x => x.status === 'PENDING');
  $('activeCount').textContent = employees.filter(x => x.is_active).length;
  $('disabledCount').textContent = employees.filter(x => !x.is_active).length;
  $('pendingCount').textContent = pending.length;
  $('requestBadge').textContent = pending.length;
  $('requestBadge').style.display = pending.length ? 'inline-grid' : 'none';
  renderEmployees(); renderRequests();
}
function renderEmployees() {
  const q = $('search').value.trim().toLowerCase();
  const list = employees.filter(u => `${u.full_name||''} ${u.email||''} ${u.phone||''} ${positionName(u.position_id,u.position)} ${departmentName(u.organization_unit_id)} ${(u.roles||[]).map(r=>r.name).join(' ')}`.toLowerCase().includes(q));
  if (!list.length) { $('employeeList').className='empty'; $('employeeList').textContent='Сотрудники не найдены'; return; }
  $('employeeList').className='table-wrap';
  $('employeeList').innerHTML = `<table class="table"><thead><tr><th>Сотрудник</th><th>Отдел / должность</th><th>Роли</th><th>Статус</th><th></th></tr></thead><tbody>${list.map(u => `<tr><td><div class="person"><div class="avatar">${esc(initials(u.full_name))}</div><div><b>${esc(u.full_name)}</b><small>${esc(u.email||'')}</small><small>${esc(u.phone||'')}</small></div></div></td><td><b>${esc(positionName(u.position_id,u.position)||'Не назначена')}</b><small>${esc(departmentName(u.organization_unit_id)||'Отдел не назначен')}</small></td><td><div class="roles">${(u.roles||[]).map(r=>`<span class="role">${esc(r.name)}</span>`).join('')||'<span class="muted">Нет ролей</span>'}</div></td><td><span class="status ${u.is_active?'on':'off'}">${u.is_active?'Активен':'Отключён'}</span></td><td><button class="btn secondary" data-edit="${u.id}">Настроить</button></td></tr>`).join('')}</tbody></table>`;
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEdit(b.dataset.edit));
}
function renderRequests() {
  const list = requests.filter(x => x.status === 'PENDING');
  if (!list.length) { $('requestList').className='empty'; $('requestList').textContent='Новых заявок пока нет'; return; }
  $('requestList').className='requests';
  $('requestList').innerHTML = list.map(r => `<article class="request"><div><b>${esc(r.full_name)}</b><small>${esc(r.email||'')} ${r.phone?'· '+esc(r.phone):''} · ${providerLabel(r.provider)} · ${fmt(r.requested_at)}</small></div><div class="request-actions"><button class="btn" data-approve="${r.id}">Одобрить</button><button class="btn danger" data-reject="${r.id}">Отклонить</button></div></article>`).join('');
  document.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => openApprove(b.dataset.approve));
  document.querySelectorAll('[data-reject]').forEach(b => b.onclick = () => rejectRequest(b.dataset.reject));
}
function openNew() {
  $('employeeForm').reset(); $('employeeError').textContent=''; $('employeeId').value=''; $('employeeModalTitle').textContent='Новый сотрудник';
  $('email').disabled=false; $('password').required=true; $('activeWrap').style.display='none';
  $('employeeDepartment').innerHTML=departmentOptions(); wirePosition('employeeDepartment','employeePosition'); drawRoles($('employeeRoles'));
  $('employeeModal').classList.add('open');
}
function openEdit(id) {
  const u = employees.find(x => x.id === id); if (!u) return;
  $('employeeForm').reset(); $('employeeError').textContent=''; $('employeeId').value=u.id; $('employeeModalTitle').textContent='Настройки сотрудника';
  $('fullName').value=u.full_name||''; $('phone').value=u.phone||''; $('email').value=u.email||''; $('email').disabled=true; $('password').required=false; $('active').checked=u.is_active!==false; $('activeWrap').style.display='block';
  $('employeeDepartment').innerHTML=departmentOptions(u.organization_unit_id||''); $('employeeDepartment').value=u.organization_unit_id||''; wirePosition('employeeDepartment','employeePosition',u.position_id||'');
  drawRoles($('employeeRoles'),(u.roles||[]).map(r=>r.id)); $('employeeModal').classList.add('open');
}
function openApprove(id) {
  const r = requests.find(x => x.id === id); if (!r) return;
  $('approveForm').reset(); $('approveError').textContent=''; $('requestId').value=id; $('approvePerson').innerHTML=`<b>${esc(r.full_name)}</b><small>${esc(r.email||'')} · ${providerLabel(r.provider)}</small>`;
  $('approveDepartment').innerHTML=departmentOptions(); wirePosition('approveDepartment','approvePosition'); drawRoles($('approveRoles')); $('approveModal').classList.add('open');
}
async function rejectRequest(id) {
  const reason = prompt('Причина отклонения заявки (необязательно):'); if (reason === null) return;
  try { await call('reject',{payload:{request_id:id,reason}}); await load(); } catch(e) { alert(e.message); }
}

$('employeeForm').onsubmit = async e => {
  e.preventDefault(); const id=$('employeeId').value, role_ids=selectedRoles($('employeeRoles')); $('employeeError').textContent='';
  const body={full_name:$('fullName').value.trim(),phone:$('phone').value.trim(),role_ids,department_id:$('employeeDepartment').value,position_id:$('employeePosition').value};
  if(!role_ids.length) return $('employeeError').textContent='Выберите хотя бы одну роль.';
  if(!body.department_id||!body.position_id) return $('employeeError').textContent='Выберите отдел и должность.';
  if(!id){body.email=$('email').value.trim();body.password=$('password').value}else{body.is_active=$('active').checked;if($('password').value)body.password=$('password').value}
  try{$('employeeSave').disabled=true;await call(id?'update':'create',id?{user_id:id,payload:body}:{payload:body},12000);$('employeeModal').classList.remove('open');await load()}catch(x){$('employeeError').textContent=x.message}finally{$('employeeSave').disabled=false}
};
$('approveForm').onsubmit = async e => {
  e.preventDefault(); const role_ids=selectedRoles($('approveRoles')); $('approveError').textContent=''; const payload={request_id:$('requestId').value,role_ids,department_id:$('approveDepartment').value,position_id:$('approvePosition').value};
  if(!role_ids.length) return $('approveError').textContent='Назначьте хотя бы одну роль.'; if(!payload.department_id||!payload.position_id) return $('approveError').textContent='Выберите отдел и должность.';
  try{$('approveSave').disabled=true;await call('approve',{payload},12000);$('approveModal').classList.remove('open');await load();document.querySelector('[data-tab="employees"]').click()}catch(x){$('approveError').textContent=x.message}finally{$('approveSave').disabled=false}
};

document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active')); b.classList.add('active'); $('employeesSection').classList.toggle('active',b.dataset.tab==='employees'); $('requestsSection').classList.toggle('active',b.dataset.tab==='requests'); });
$('search').oninput=renderEmployees; $('newEmployee').onclick=openNew; $('refresh').onclick=()=>load().catch(showLoadError); $('employeeCancel').onclick=()=> $('employeeModal').classList.remove('open'); $('approveCancel').onclick=()=> $('approveModal').classList.remove('open');
[$('employeeModal'),$('approveModal')].forEach(m=>m.onclick=e=>{if(e.target===m)m.classList.remove('open')});
function showLoadError(e){$('employeeList').className='empty errorbox';$('employeeList').innerHTML=`<b>Не удалось загрузить сотрудников</b><small>${esc(e.message||'Ошибка')}</small><button class="btn secondary" id="retryLoad">Повторить</button>`;$('retryLoad')?.addEventListener('click',()=>load().catch(showLoadError));}

(async()=>{const s=await supabase.auth.getSession();session=s.data.session;if(!session)return location.replace('./login.html');$('adminEmail').textContent=session.user.email||'';try{await load()}catch(e){if(e.status===401)return location.replace('./login.html');if(e.status===403){alert('Раздел доступен только администратору.');return location.replace('./index.html')}showLoadError(e)}})();
