import {supabase} from './guard.js?v=20260923-operators1';

const $=id=>document.getElementById(id);
const cfg=window.A4PRINT_CONFIG||{};
const apiBase=String(cfg.apiBaseUrl||'https://a4print-hub-api.onrender.com').replace(/\/$/,'');
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const state={operators:[],selected:null,loading:false};

function note(text,tone='ok'){
  $('notice').textContent=text||'';
  $('notice').className='notice '+(text?tone:'');
}
function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}
async function session(){
  const {data:{session},error}=await supabase.auth.getSession();
  if(error)throw error;
  if(!session)throw new Error('Сессия истекла.');
  return session;
}
async function api(path,opt={}){
  const s=await session();
  const r=await fetch(apiBase+path,{
    ...opt,
    headers:{Authorization:`Bearer ${s.access_token}`,'Content-Type':'application/json',...(opt.headers||{})},
    cache:'no-store'
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.message||d.error||`HTTP ${r.status}`);
  return d;
}
function initials(name){return String(name||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()}
function render(){
  const q=$('search').value.trim().toLowerCase();
  const rows=state.operators.filter(x=>`${x.full_name||''} ${x.email||''}`.toLowerCase().includes(q));
  $('count').textContent=`${state.operators.length} операторов`;
  $('cards').innerHTML=rows.map(x=>`<div class="operator">
    <div class="person"><div class="avatar">${esc(initials(x.full_name))}</div><div><div class="name">${esc(x.full_name)}</div><div class="email">${esc(x.email)}</div></div></div>
    <div class="op-actions"><span class="badge ${x.is_active?'on':'off'}">${x.is_active?'Активен':'Отключён'}</span><button class="small" data-pass="${x.id}">Пароль</button><button class="small" data-toggle="${x.id}">${x.is_active?'Отключить':'Включить'}</button></div>
  </div>`).join('')||'<div class="empty">Операторов пока нет</div>';
}
async function ensureAdmin(){
  const {data:admin,error}=await supabase.rpc('has_role',{required_role:'ADMIN'});
  if(error)throw error;
  if(!admin){
    $('createForm').closest('.panel').hidden=true;
    $('cards').innerHTML='<div class="a4-error">Управление операторами доступно только администратору.</div>';
    notify('warning','Нет доступа','Управление операторами кассы доступно только ADMIN.');
    return false;
  }
  return true;
}
async function load(){
  if(state.loading)return;
  state.loading=true;$('cards').innerHTML='<div class="a4-skeleton" style="height:60px"></div><div class="a4-skeleton" style="height:60px;margin-top:8px"></div>';
  try{
    const d=await api('/api/v1/operators');
    state.operators=Array.isArray(d.operators)?d.operators:[];
    render();
  }finally{state.loading=false}
}
async function toggle(id){
  const operator=state.operators.find(o=>o.id===id);if(!operator)return;
  try{
    await api('/api/v1/operators/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({is_active:!operator.is_active})});
    await load();
    notify('success','Оператор обновлён',operator.is_active?'Доступ кассира отключён.':'Доступ кассира включён.');
  }catch(error){note(error.message||String(error),'error')}
}
function openPassword(id){
  state.selected=state.operators.find(o=>o.id===id)||null;if(!state.selected)return;
  $('modalName').textContent=state.selected.full_name||state.selected.email||'Оператор';
  $('newPassword').value='';$('passwordError').textContent='';$('modal').classList.add('show');
  setTimeout(()=>$('newPassword').focus(),30);
}
async function savePassword(){
  const password=$('newPassword').value;
  $('passwordError').textContent='';
  if(password.length<6){$('passwordError').textContent='Минимум 6 символов.';return}
  const button=$('savePassword');button.disabled=true;
  try{
    await api('/api/v1/operators/'+encodeURIComponent(state.selected.id),{method:'PATCH',body:JSON.stringify({password})});
    $('modal').classList.remove('show');note('Пароль обновлён.','ok');
    notify('success','Пароль обновлён','Новый пароль оператора сохранён.');
  }catch(error){$('passwordError').textContent=error.message||String(error)}
  finally{button.disabled=false}
}

$('cards').addEventListener('click',event=>{
  const toggleButton=event.target.closest('[data-toggle]');if(toggleButton){void toggle(toggleButton.dataset.toggle);return}
  const passButton=event.target.closest('[data-pass]');if(passButton)openPassword(passButton.dataset.pass);
});
$('cancelModal').addEventListener('click',()=>$('modal').classList.remove('show'));
$('modal').addEventListener('click',event=>{if(event.target===$('modal'))$('modal').classList.remove('show')});
$('savePassword').addEventListener('click',savePassword);
$('createForm').addEventListener('submit',async event=>{
  event.preventDefault();$('createBtn').disabled=true;note('');
  try{
    await api('/api/v1/operators',{method:'POST',body:JSON.stringify({
      full_name:$('fullName').value.trim(),
      email:$('email').value.trim().toLowerCase(),
      password:$('password').value
    })});
    $('createForm').reset();note('Оператор создан. Теперь он может войти в кассу своим логином и паролем.','ok');
    await load();
    notify('success','Оператор создан','Личный доступ кассира готов.');
  }catch(error){note(error.message||String(error),'error')}
  finally{$('createBtn').disabled=false}
});
$('search').addEventListener('input',render);

try{
  if(await ensureAdmin())await load();
}catch(error){
  console.error('POS operators load failed',error);
  $('cards').innerHTML=`<div class="a4-error"><b>Не удалось загрузить операторов</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="operatorsRetry" class="a4-btn" type="button" style="margin-top:10px">Повторить</button></div>`;
  $('operatorsRetry')?.addEventListener('click',()=>load().catch(e=>note(e.message||String(e),'error')));
}
