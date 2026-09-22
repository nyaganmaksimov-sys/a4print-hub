import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const statusClass=s=>String(s||'').toLowerCase();
const statusText=s=>({NEW:'Новая',CONTACTED:'В работе',REVIEW:'На проверке',APPROVED:'Подтверждена',REJECTED:'Отклонена'}[s]||s||'—');
const state={tab:'connect',rows:[],page:1,pageSize:50,total:0,loading:false,reloadQueued:false};
let searchTimer=null;

const fields={
  connect:'id,company_name,contact_name,phone,email,city,interest,message,status,created_at,updated_at',
  executor:'id,company_name,legal_name,company_type,inn,kpp,ogrn,contact_name,phone,email,website,telegram,whatsapp,city,address,description,services,equipment,delivery_info,working_hours,logo_url,cover_url,verification_file_path,verification_file_name,status,admin_comment,approved_partner_id,created_at,updated_at,invite_sent_at,invited_user_id,activity_type'
};

function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}
function cleanSearch(value){return String(value||'').replace(/[%(),]/g,' ').replace(/s+/g,' ').trim().slice(0,160)}
function tableName(){return state.tab==='connect'?'connection_requests':'executor_registration_requests'}
function searchOr(q){
  if(!q)return'';
  const pattern=`%${q}%`;
  return state.tab==='connect'
    ? `company_name.ilike.${pattern},contact_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},city.ilike.${pattern}`
    : `company_name.ilike.${pattern},legal_name.ilike.${pattern},contact_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},city.ilike.${pattern},inn.ilike.${pattern}`;
}
function applyFilters(query,statusOverride){
  const q=cleanSearch($('q')?.value),status=statusOverride??$('statusFilter')?.value??'';
  if(status)query=query.eq('status',status);
  const or=searchOr(q);if(or)query=query.or(or);
  return query;
}
async function signed(path){
  if(!path)return null;
  const {data,error}=await supabase.storage.from('executor-registration-private').createSignedUrl(path,3600);
  if(error){console.warn('Verification signed URL unavailable',error);return null}
  return data?.signedUrl||null;
}
function connectCard(r){
  return `<article class="request-card"><div class="headrow"><div><h3>${esc(r.company_name)}</h3><div class="meta"><span class="chip ${statusClass(r.status)}">${statusText(r.status)}</span>${r.interest?`<span class="chip">${esc(r.interest)}</span>`:''}${r.city?`<span class="chip">${esc(r.city)}</span>`:''}<span class="chip">${new Date(r.created_at).toLocaleString('ru-RU')}</span></div></div></div><div class="cols"><div class="box"><b>Контакт</b>${esc(r.contact_name)}${r.phone?`<br><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>`:''}${r.email?`<br><a href="mailto:${esc(r.email)}">${esc(r.email)}</a>`:''}</div><div class="box"><b>Комментарий</b>${esc(r.message||'Комментарий не указан')}</div></div><div class="actions">${r.status!=='CONTACTED'?`<button data-connect-status="${r.id}|CONTACTED">В работу / связались</button>`:''}${r.status!=='APPROVED'?`<button data-connect-status="${r.id}|APPROVED">Подтвердить</button>`:''}${r.status!=='REJECTED'?`<button data-connect-status="${r.id}|REJECTED">Отклонить</button>`:''}</div></article>`;
}
async function executorCard(r){
  const file=await signed(r.verification_file_path);
  return `<article class="request-card"><div class="headrow"><div><h3>${esc(r.company_name)}</h3><div class="meta"><span class="chip ${statusClass(r.status)}">${statusText(r.status)}</span>${r.company_type?`<span class="chip">${esc(r.company_type)}</span>`:''}${r.city?`<span class="chip">${esc(r.city)}</span>`:''}<span class="chip">${new Date(r.created_at).toLocaleString('ru-RU')}</span></div></div></div><div class="cols"><div class="box"><b>Компания</b>${esc(r.legal_name||'—')}<br>ИНН: ${esc(r.inn||'—')} · КПП: ${esc(r.kpp||'—')}<br>ОГРН/ОГРНИП: ${esc(r.ogrn||'—')}<br>${esc(r.address||'')}</div><div class="box"><b>Контакт</b>${esc(r.contact_name)}${r.phone?`<br><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>`:''}${r.email?`<br><a href="mailto:${esc(r.email)}">${esc(r.email)}</a>`:''}${r.website?`<br><a href="${esc(r.website)}" target="_blank" rel="noopener">${esc(r.website)}</a>`:''}</div><div class="box"><b>Описание</b>${esc(r.description||'—')}<br><br><b>Услуги</b><br>${esc(r.services||'—')}</div><div class="box"><b>Оборудование</b>${esc(r.equipment||'—')}<br><br><b>Доставка / график</b><br>${esc(r.delivery_info||'—')} · ${esc(r.working_hours||'—')}</div></div>${r.logo_url||r.cover_url?`<div class="photos">${r.logo_url?`<img src="${esc(r.logo_url)}" alt="Логотип">`:''}${r.cover_url?`<img src="${esc(r.cover_url)}" alt="Обложка">`:''}</div>`:''}<div class="actions">${file?`<a class="btn" href="${esc(file)}" target="_blank" rel="noopener">Проверочный документ</a>`:''}${r.status==='NEW'?`<button data-exec-review="${r.id}">На проверку</button>`:''}${r.status!=='APPROVED'?`<button data-exec-approve="${r.id}">Подтвердить и создать партнёра</button>`:''}${r.status!=='REJECTED'?`<button data-exec-reject="${r.id}">Отклонить</button>`:''}${r.status==='APPROVED'?`<button data-invite="${r.id}">${r.invite_sent_at?'Отправить приглашение повторно':'Отправить приглашение в Partner CRM'}</button>`:''}</div>${r.invite_sent_at?`<div class="note">Приглашение отправлено: ${new Date(r.invite_sent_at).toLocaleString('ru-RU')}</div>`:''}${r.admin_comment?`<div class="note">Комментарий администратора: ${esc(r.admin_comment)}</div>`:''}</article>`;
}
function renderPager(){
  const pager=$('requestsPager');if(!pager)return;
  const pages=Math.max(1,Math.ceil(state.total/state.pageSize));
  pager.hidden=state.total<=state.pageSize;
  $('requestsPageLabel').textContent=`Страница ${state.page} из ${pages}`;
  $('requestsPrevPage').disabled=state.page<=1;
  $('requestsNextPage').disabled=state.page>=pages;
}
async function render(){
  if(state.tab==='connect')$('list').innerHTML=state.rows.map(connectCard).join('')||'<div class="empty">Заявок нет</div>';
  else $('list').innerHTML=(await Promise.all(state.rows.map(executorCard))).join('')||'<div class="empty">Заявок нет</div>';
  renderPager();
  $('visibleCount')&&($('visibleCount').textContent=`${state.rows.length} на странице · всего ${state.total}`);
}
async function countStatus(status){
  let q=supabase.from(tableName()).select('id',{count:'exact',head:true});
  q=applyFilters(q,status);
  const {count,error}=await q;if(error)throw error;return Number(count||0);
}
async function updateStats(){
  const [n,w,a,r]=await Promise.all([
    countStatus('NEW'),
    Promise.all([countStatus('CONTACTED'),countStatus('REVIEW')]).then(x=>x[0]+x[1]),
    countStatus('APPROVED'),
    countStatus('REJECTED')
  ]);
  $('statNew').textContent=n;$('statWork').textContent=w;$('statApproved').textContent=a;$('statRejected').textContent=r;
}
async function updateBadges(){
  const [connect,executor]=await Promise.all([
    supabase.from('connection_requests').select('id',{count:'exact',head:true}).eq('status','NEW'),
    supabase.from('executor_registration_requests').select('id',{count:'exact',head:true}).eq('status','NEW')
  ]);
  if(connect.error)throw connect.error;if(executor.error)throw executor.error;
  $('connectBadge').textContent=connect.count?`(${connect.count})`:'';
  $('executorBadge').textContent=executor.count?`(${executor.count})`:'';
}
async function load(force=false){
  if(state.loading){if(force)state.reloadQueued=true;return}
  state.loading=true;$('reload').disabled=true;$('list').innerHTML='<div class="empty">Загрузка…</div>';
  try{
    const from=(state.page-1)*state.pageSize,to=from+state.pageSize-1;
    let q=supabase.from(tableName()).select(fields[state.tab],{count:'exact'}).order('created_at',{ascending:false}).range(from,to);
    q=applyFilters(q);
    const [{data,error,count}]=await Promise.all([q]);
    if(error)throw error;
    state.rows=data||[];state.total=Number(count||0);
    if(!state.rows.length&&state.page>1){state.page=Math.max(1,state.page-1);state.loading=false;return load(true)}
    await Promise.all([render(),updateStats(),updateBadges()]);
  }catch(error){
    console.error('Requests load failed',error);
    $('list').innerHTML=`<div class="empty" style="color:#b91c1c"><b>Не удалось загрузить заявки</b><br>${esc(error.message||error)}<br><button id="requestsRetry" type="button" style="margin-top:10px">Повторить</button></div>`;
    $('requestsRetry')?.addEventListener('click',()=>load(true));
  }finally{
    state.loading=false;$('reload').disabled=false;
    if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>load(),0)}
  }
}
async function updateConnectionStatus(id,status,button){
  let extra={};
  if(status==='REJECTED'){
    const reason=window.prompt('Причина отклонения (необязательно):')||null;
    const original=state.rows.find(x=>x.id===id)?.message||'';
    extra.message=reason?`${original}\n\nКомментарий администратора: ${reason}`:original||null;
  }
  button.disabled=true;
  try{
    const {error}=await supabase.from('connection_requests').update({status,...extra,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)throw error;await load(true);
  }catch(error){notify('error','Статус заявки не изменён',error.message||String(error))}
  finally{button.disabled=false}
}
async function execStatus(id,status){
  const {error}=await supabase.from('executor_registration_requests').update({status,updated_at:new Date().toISOString()}).eq('id',id);
  if(error){notify('error','Статус исполнителя не изменён',error.message||String(error));return}
  await load(true);
}
async function rejectExecutor(id,button){
  const comment=window.prompt('Причина отклонения (необязательно):')||null;button.disabled=true;
  try{
    const {error}=await supabase.from('executor_registration_requests').update({status:'REJECTED',admin_comment:comment,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)throw error;await load(true);
  }catch(error){notify('error','Заявка исполнителя не отклонена',error.message||String(error))}
  finally{button.disabled=false}
}
async function approveExecutor(id,button){
  if(!window.confirm('Подтвердить компанию и создать партнёра?'))return;button.disabled=true;
  try{
    const {data,error}=await supabase.rpc('approve_executor_registration',{p_request_id:id});if(error)throw error;
    notify('success','Партнёр создан',String(data||'Регистрация подтверждена'));await load(true);
  }catch(error){notify('error','Не удалось подтвердить исполнителя',error.message||String(error))}
  finally{button.disabled=false}
}
async function inviteExecutor(id,button){
  if(!window.confirm('Отправить приглашение на email исполнителя?'))return;
  button.disabled=true;const old=button.textContent;button.textContent='Отправляем…';
  try{
    const {data,error}=await supabase.functions.invoke('invite-approved-executor',{body:{request_id:id}});if(error)throw error;
    notify('success','Приглашение отправлено',data?.message||'Email отправлен');await load(true);
  }catch(error){notify('error','Приглашение не отправлено',error.message||String(error))}
  finally{button.disabled=false;button.textContent=old}
}
function bind(){
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',async()=>{
    state.tab=b.dataset.tab;state.page=1;
    document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));
    $('statusFilter').value='';$('q').value='';await load(true);
  }));
  $('q').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.page=1;load(true)},280)});
  $('statusFilter').addEventListener('change',()=>{state.page=1;load(true)});
  $('reload').addEventListener('click',()=>load(true));
  $('requestsPrevPage')?.addEventListener('click',()=>{if(state.page>1){state.page--;load(true)}});
  $('requestsNextPage')?.addEventListener('click',()=>{const pages=Math.max(1,Math.ceil(state.total/state.pageSize));if(state.page<pages){state.page++;load(true)}});
  $('list').addEventListener('click',event=>{
    const c=event.target.closest('[data-connect-status]');if(c){const[id,status]=c.dataset.connectStatus.split('|');updateConnectionStatus(id,status,c);return}
    const review=event.target.closest('[data-exec-review]');if(review){execStatus(review.dataset.execReview,'REVIEW');return}
    const reject=event.target.closest('[data-exec-reject]');if(reject){rejectExecutor(reject.dataset.execReject,reject);return}
    const approve=event.target.closest('[data-exec-approve]');if(approve){approveExecutor(approve.dataset.execApprove,approve);return}
    const invite=event.target.closest('[data-invite]');if(invite)inviteExecutor(invite.dataset.invite,invite);
  });
}
bind();await load();
