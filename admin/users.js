import {supabase} from './guard.js?v=20260905-netfix1';

const cfg=window.A4PRINT_CONFIG||{};
const apiBase=String(cfg.apiBaseUrl||'https://a4print-hub-api.onrender.com').replace(/\/$/,'');
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const state={session:null,roles:[],users:[],loaded:false};

function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}
async function api(path,opt={}){
  if(!state.session?.access_token)throw new Error('Нет активной сессии.');
  const r=await fetch(apiBase+path,{
    ...opt,
    headers:{Authorization:`Bearer ${state.session.access_token}`,'Content-Type':'application/json',...(opt.headers||{})},
    cache:'no-store'
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.message||d.error||'Ошибка API');
  return d;
}
async function ensureAdmin(){
  const {data:{session}}=await supabase.auth.getSession();
  state.session=session;
  if(!session){location.replace('./login.html');return false}
  const {data:isAdmin,error}=await supabase.rpc('has_role',{required_role:'ADMIN'});
  if(error)throw error;
  if(!isAdmin){
    notify('warning','Нет доступа','Управление пользователями доступно только администратору.');
    $('list').innerHTML='<div class="a4-error">Управление пользователями доступно только администратору.</div>';
    $('newUser').hidden=true;
    return false;
  }
  return true;
}
async function load(){
  $('list').innerHTML='<div class="a4-skeleton" style="height:54px"></div><div class="a4-skeleton" style="height:54px;margin-top:8px"></div>';
  const [r,u]=await Promise.all([api('/api/v1/users/roles'),api('/api/v1/users')]);
  state.roles=Array.isArray(r.roles)?r.roles:[];
  state.users=Array.isArray(u.users)?u.users:[];
  if(!state.roles.length)throw new Error('В базе не найдены роли доступа.');
  state.loaded=true;$('newUser').disabled=false;render();
}
function render(){
  if(!state.users.length){$('list').innerHTML='<div class="muted">Пользователей в вашей организации пока нет.</div>';return}
  $('list').innerHTML=`<table class="table"><thead><tr><th>Пользователь</th><th>Роли</th><th>Статус</th><th></th></tr></thead><tbody>${state.users.map(u=>`<tr><td><b>${esc(u.full_name)}</b><div class="muted">${esc(u.email||'')}</div><div class="muted">${esc(u.phone||'')}</div></td><td><div class="roles">${(u.roles||[]).map(r=>`<span class="role">${esc(r.name)}</span>`).join('')||'<span class="muted">Нет ролей</span>'}</div></td><td><span class="status ${u.is_active?'on':'off'}">${u.is_active?'Активен':'Отключён'}</span></td><td><button class="btn secondary" data-edit="${u.id}">Изменить</button></td></tr>`).join('')}</tbody></table>`;
}
function drawRoles(selected=[]){
  const set=new Set(selected);
  if(!state.roles.length){$('roles').innerHTML='<div class="role-loading">Роли не загрузились. Обновите страницу.</div>';return}
  $('roles').innerHTML=state.roles.map(r=>`<label class="rolecheck"><input type="checkbox" value="${esc(r.id)}" ${set.has(r.id)?'checked':''}><span><b>${esc(r.name)}</b><div class="muted">${esc(r.description||'')}</div></span></label>`).join('');
}
function openNew(){
  if(!state.loaded||!state.roles.length){notify('warning','Роли ещё загружаются','Обновите страницу, если список ролей не появился.');return}
  $('form').reset();$('formError').textContent='';$('userId').value='';$('modalTitle').textContent='Новый пользователь';
  $('email').disabled=false;$('password').required=true;$('password').placeholder='Минимум 6 символов';
  $('activeWrap').style.display='none';drawRoles();$('modal').classList.add('open');
}
function openEdit(id){
  const u=state.users.find(x=>x.id===id);if(!u)return;
  $('form').reset();$('formError').textContent='';$('userId').value=u.id;$('modalTitle').textContent='Изменить пользователя';
  $('fullName').value=u.full_name||'';$('phone').value=u.phone||'';$('email').value=u.email||'';$('email').disabled=true;
  $('password').required=false;$('password').placeholder='Оставьте пустым, чтобы не менять';$('active').checked=u.is_active!==false;
  $('activeWrap').style.display='block';drawRoles((u.roles||[]).map(r=>r.id));$('modal').classList.add('open');
}
function selectedRoles(){return[...$('roles').querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value)}

$('newUser').addEventListener('click',openNew);
$('cancel').addEventListener('click',()=>$('modal').classList.remove('open'));
$('modal').addEventListener('click',e=>{if(e.target===$('modal'))$('modal').classList.remove('open')});
$('list').addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(b)openEdit(b.dataset.edit)});
$('form').addEventListener('submit',async e=>{
  e.preventDefault();$('formError').textContent='';
  const id=$('userId').value,role_ids=selectedRoles();
  if(!role_ids.length){$('formError').textContent='Выберите хотя бы одну роль.';return}
  const body={full_name:$('fullName').value.trim(),phone:$('phone').value.trim(),role_ids};
  if(!id){body.email=$('email').value.trim();body.password=$('password').value}
  else{body.is_active=$('active').checked;if($('password').value)body.password=$('password').value}
  try{
    $('save').disabled=true;
    await api(id?'/api/v1/users/'+id:'/api/v1/users',{method:id?'PATCH':'POST',body:JSON.stringify(body)});
    $('modal').classList.remove('open');await load();
    notify('success',id?'Пользователь обновлён':'Пользователь создан','Изменения сохранены.');
  }catch(error){$('formError').textContent=error.message||String(error)}
  finally{$('save').disabled=false}
});
$('logout').addEventListener('click',async()=>{await supabase.auth.signOut();location.replace('./login.html')});

try{
  if(await ensureAdmin())await load();
}catch(error){
  console.error('Users admin load failed',error);
  $('list').innerHTML=`<div class="a4-error"><b>Не удалось загрузить пользователей</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="usersRetry" type="button" class="a4-btn" style="margin-top:10px">Повторить</button></div>`;
  $('usersRetry')?.addEventListener('click',()=>load().catch(e=>notify('error','Ошибка загрузки',e.message||String(e))));
}
