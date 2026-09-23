import {supabase} from './guard.js?v=20260923-executors1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const state={requests:[],signed:new Map(),roles:[],selected:null,action:null,loading:false};
const fields=[
  'id','company_name','legal_name','company_type','inn','kpp','ogrn','contact_name','phone','email','website',
  'telegram','whatsapp','city','address','latitude','longitude','description','services','equipment','delivery_info',
  'working_hours','logo_url','cover_url','verification_file_path','verification_file_name','status','admin_comment',
  'approved_partner_id','created_at','updated_at','invite_sent_at','invited_user_id','activity_type'
].join(',');

function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}
function canManage(){return state.roles.includes('ADMIN')||state.roles.includes('MANAGER')}
function safeUrl(raw){
  if(!raw)return null;
  try{const u=new URL(String(raw),location.origin);if(!['http:','https:'].includes(u.protocol))return null;return u.href}catch{return null}
}
function phoneHref(raw){return String(raw||'').replace(/[^\d+]/g,'')}
function fmtDate(v){if(!v)return'—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU'):'—'}

async function loadSignedUrls(rows){
  state.signed.clear();
  const paths=[...new Set(rows.map(r=>r.verification_file_path).filter(Boolean))];
  if(!paths.length)return;
  const {data,error}=await supabase.storage.from('executor-registration-private').createSignedUrls(paths,3600);
  if(error){console.warn('Executor verification signed URLs unavailable',error);return}
  for(const item of data||[])if(item?.path&&item?.signedUrl)state.signed.set(item.path,item.signedUrl);
}
function card(row){
  const file=state.signed.get(row.verification_file_path)||null;
  const website=safeUrl(row.website),logo=safeUrl(row.logo_url),cover=safeUrl(row.cover_url);
  const approved=row.status==='APPROVED';
  return `<article class="request-card" data-request-id="${row.id}">
    <div class="request-head"><div><h3 style="margin:0">${esc(row.company_name)}</h3><div class="meta"><span class="chip">${esc(row.company_type||'Тип не указан')}</span>${row.city?`<span class="chip">${esc(row.city)}</span>`:''}<span class="chip">${esc(fmtDate(row.created_at))}</span></div></div><div class="status">${esc(row.status)}</div></div>
    <div class="cols">
      <div class="box"><b>Компания</b>${esc(row.legal_name||'—')}<br>ИНН: ${esc(row.inn||'—')} · КПП: ${esc(row.kpp||'—')}<br>ОГРН/ОГРНИП: ${esc(row.ogrn||'—')}<br>${esc(row.address||'')}</div>
      <div class="box"><b>Контакт</b>${esc(row.contact_name)}<br>${row.phone?`<a href="tel:${esc(phoneHref(row.phone))}">${esc(row.phone)}</a><br>`:''}<a href="mailto:${esc(row.email)}">${esc(row.email)}</a>${website?`<br><a href="${esc(website)}" target="_blank" rel="noopener noreferrer">${esc(row.website)}</a>`:''}</div>
      <div class="box"><b>Описание</b>${esc(row.description||'—')}</div>
      <div class="box"><b>Услуги</b>${esc(row.services||'—')}<br><br><b>Оборудование</b>${esc(row.equipment||'—')}</div>
      <div class="box"><b>Условия</b>Доставка: ${esc(row.delivery_info||'—')}<br>График: ${esc(row.working_hours||'—')}</div>
      <div class="box"><b>Координаты</b>${row.latitude!=null&&row.longitude!=null?`${esc(row.latitude)}, ${esc(row.longitude)}`:'Не указаны'}${file?`<br><br><a class="btn" href="${esc(file)}" target="_blank" rel="noopener noreferrer">Проверочный документ</a>`:''}</div>
    </div>
    ${logo||cover?`<div class="photo-row">${logo?`<img src="${esc(logo)}" alt="Логотип">`:''}${cover?`<img src="${esc(cover)}" alt="Обложка">`:''}</div>`:''}
    ${row.admin_comment?`<div class="executor-admin-comment"><b>Комментарий:</b> ${esc(row.admin_comment)}</div>`:''}
    <div class="admin-actions">
      ${!approved?`<button data-review="${row.id}">На проверке</button><button data-approve="${row.id}">Подтвердить компанию</button><button data-reject="${row.id}">Отклонить</button>`:`<span class="chip">Партнёр создан</span>${row.invite_sent_at?`<span class="chip">Приглашение отправлено ${esc(fmtDate(row.invite_sent_at))}</span><button data-invite="${row.id}">Отправить приглашение повторно</button>`:`<button data-invite="${row.id}">Отправить приглашение в Partner CRM</button>`}`}
    </div>
  </article>`;
}
function render(){
  $('requests').innerHTML=state.requests.map(card).join('')||'<div class="empty">Заявок пока нет</div>';
}
function renderLoading(){$('requests').innerHTML='<div class="executor-loading-list"><div class="a4-skeleton"></div><div class="a4-skeleton"></div><div class="a4-skeleton"></div></div>'}
function renderError(error){$('requests').innerHTML=`<div class="a4-error"><b>Не удалось загрузить заявки</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="executorRetry" class="a4-btn" type="button" style="margin-top:10px">Повторить</button></div>`;$('executorRetry')?.addEventListener('click',()=>load())}

async function load(){
  if(state.loading)return;state.loading=true;renderLoading();$('reload').disabled=true;
  try{
    if(!state.roles.length){
      const {data,error}=await supabase.rpc('get_my_roles');
      if(error)throw error;state.roles=Array.isArray(data)?data.map(String):[];
    }
    if(!canManage()){$('requests').innerHTML='<div class="a4-error">Раздел доступен ADMIN или MANAGER.</div>';return}
    const {data,error}=await supabase.from('executor_registration_requests').select(fields).order('created_at',{ascending:false}).limit(100);
    if(error)throw error;
    state.requests=data||[];
    await loadSignedUrls(state.requests);
    render();
  }catch(error){console.error('Executor requests load failed',error);renderError(error)}
  finally{state.loading=false;$('reload').disabled=false}
}
async function setStatus(id,status){
  const {error}=await supabase.from('executor_registration_requests').update({status,updated_at:new Date().toISOString()}).eq('id',id);
  if(error)throw error;
  await load();
}
function openReview(id,action){
  const row=state.requests.find(x=>x.id===id);if(!row)return;
  state.selected=row;state.action=action;
  $('reviewTitle').textContent=action==='approve'?'Подтвердить компанию':'Отклонить заявку';
  $('reviewText').textContent=action==='approve'
    ?`Будет создан партнёр для «${row.company_name}». После подтверждения можно отправить приглашение в Partner CRM.`
    :`Укажите причину отклонения заявки «${row.company_name}».`;
  $('reviewCommentWrap').hidden=action!=='reject';
  $('reviewComment').value=row.admin_comment||'';
  $('reviewError').textContent='';
  $('reviewSubmit').textContent=action==='approve'?'Подтвердить':'Отклонить';
  $('reviewDlg').showModal();
}
async function submitReview(event){
  event.preventDefault();if(!state.selected)return;
  const button=$('reviewSubmit');button.disabled=true;$('reviewError').textContent='';
  try{
    if(state.action==='approve'){
      const {error}=await supabase.rpc('approve_executor_registration',{p_request_id:state.selected.id});
      if(error)throw error;
      notify('success','Компания подтверждена','Теперь можно отправить приглашение исполнителю.');
    }else{
      const {error}=await supabase.from('executor_registration_requests').update({
        status:'REJECTED',
        admin_comment:$('reviewComment').value.trim()||null,
        updated_at:new Date().toISOString()
      }).eq('id',state.selected.id);
      if(error)throw error;
      notify('success','Заявка отклонена','Статус заявки обновлён.');
    }
    $('reviewDlg').close();await load();
  }catch(error){$('reviewError').textContent=error.message||String(error)}
  finally{button.disabled=false}
}
async function invite(id,button){
  const old=button.textContent;button.disabled=true;button.textContent='Отправляем…';
  try{
    const {data,error}=await supabase.functions.invoke('invite-approved-executor',{body:{request_id:id}});
    if(error||data?.error)throw new Error(data?.error||error.message);
    notify('success','Приглашение отправлено',data?.email?`Отправлено на ${data.email}`:'Приглашение отправлено.');
    await load();
  }catch(error){notify('error','Не удалось отправить приглашение',error.message||String(error))}
  finally{button.disabled=false;button.textContent=old}
}

$('requests').addEventListener('click',event=>{
  const review=event.target.closest('[data-review]');if(review){setStatus(review.dataset.review,'REVIEW').catch(e=>notify('error','Не удалось изменить статус',e.message||String(e)));return}
  const approve=event.target.closest('[data-approve]');if(approve){openReview(approve.dataset.approve,'approve');return}
  const reject=event.target.closest('[data-reject]');if(reject){openReview(reject.dataset.reject,'reject');return}
  const inviteButton=event.target.closest('[data-invite]');if(inviteButton)void invite(inviteButton.dataset.invite,inviteButton);
});
$('reload').addEventListener('click',load);
$('reviewCancel').addEventListener('click',()=>$('reviewDlg').close());
$('reviewForm').addEventListener('submit',submitReview);

await load();
