import { supabase } from './guard.js';

const cfg=window.A4PRINT_CONFIG||{};
const apiBase=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=v=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(Number(v||0));
const count=v=>new Intl.NumberFormat('ru-RU').format(Number(v||0));
const dateTime=v=>{if(!v)return'—';const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(d):'—'};
const params=new URLSearchParams(location.search);
const partnerId=params.get('id')||'';
let data=null;
let orderMode='hub';

async function token(){const {data:{session}}=await supabase.auth.getSession();return session?.access_token||''}
async function api(path,opt={}){
  const bearer=await token();
  const r=await fetch(`${apiBase}${path}`,{...opt,cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${bearer}`,...(opt.headers||{})}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.message||j.error||`HTTP ${r.status}`);
  return j;
}
function initials(name){return String(name||'П').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('')||'П'}
function statusText(value){
  const key=String(value||'').toUpperCase();
  const map={NEW:'Новый',CREATED:'Создан',IN_PROGRESS:'В работе',PROCESSING:'В работе',READY:'Готов',DONE:'Выполнен',COMPLETED:'Завершён',CANCELLED:'Отменён',CANCELED:'Отменён',PAID:'Оплачен',DRAFT:'Черновик'};
  return map[key]||String(value||'—').replaceAll('_',' ');
}
function setFormStatus(text,type=''){const el=$('partnerFormStatus');el.textContent=text||'';el.className=`form-status ${type}`.trim()}
function fillForm(p){
  const form=$('partnerForm');
  for(const name of ['name','legal_name','tax_id','contact_name','email','phone','address','discount_percent','payment_terms_days','credit_limit','notes']){
    if(form.elements[name])form.elements[name].value=p[name]??'';
  }
}
function renderHero(){
  const p=data.partner,s=data.stats||{};
  $('partnerAvatar').textContent=initials(p.name);
  $('partnerName').textContent=p.name||'Партнёр';
  $('partnerMeta').textContent=[p.contact_name,p.phone,p.email].filter(Boolean).join(' · ')||'Контактные данные не указаны';
  $('partnerState').textContent=p.is_active?'Активен':'Отключён';
  $('partnerState').className=`state-pill ${p.is_active?'':'off'}`.trim();
  $('togglePartner').textContent=p.is_active?'Отключить доступ':'Включить доступ';
  $('togglePartner').className=p.is_active?'danger':'';
  document.title=`${p.name||'Партнёр'} — A4PRINT HUB`;
  $('pageTitle').textContent=p.name||'Карточка партнёра';
  $('pageSubtitle').textContent=`Профиль партнёра · создан ${dateTime(p.created_at)}`;
  const kpis=[
    ['kpiFromOrders',count(s.orders_from_partner),'Заказов партнёра → A4PRINT'],
    ['kpiFromTurnover',money(s.turnover_from_partner),'Оборот партнёра у A4PRINT'],
    ['kpiToOrders',count(s.orders_to_partner),'Заказов A4PRINT → партнёру'],
    ['kpiToTurnover',money(s.turnover_to_partner),'Закупки у партнёра'],
    ['kpiCrmSales',money(s.crm_sales),'Продажи в Partner CRM'],
    ['kpiCrmDebt',money(s.crm_receivable),'Дебиторка клиентов партнёра']
  ];
  for(const [id,val,note] of kpis){$(id).querySelector('.partner-kpi-value').textContent=val;$(id).querySelector('.partner-kpi-note').textContent=note}
}
function renderUsers(){
  const rows=data.users||[];
  $('usersCount').textContent=`${rows.filter(x=>x.is_active).length} активных из ${rows.length}`;
  $('partnerUsers').innerHTML=rows.length?rows.map(u=>`<div class="partner-user" data-user-id="${esc(u.id)}"><div class="partner-user-top"><div><div class="partner-user-name">${esc(u.full_name||'Пользователь')}</div><div class="partner-user-meta">${esc(u.email||'Email не указан')}${u.phone?' · '+esc(u.phone):''}<br>Доступ создан ${esc(dateTime(u.created_at))}</div></div><div class="partner-user-badges"><span class="mini-pill ${u.is_active?'ok':'off'}">${u.is_active?'Активен':'Отключён'}</span>${u.is_admin?'<span class="mini-pill">Администратор</span>':''}</div></div><div class="partner-user-actions"><button type="button" data-user-active>${u.is_active?'Отключить':'Включить'}</button><button type="button" data-user-admin>${u.is_admin?'Убрать права администратора':'Сделать администратором'}</button></div></div>`).join(''):'<div class="empty-state">У партнёра пока нет пользователей Partner CRM.</div>';
  $('partnerUsers').querySelectorAll('[data-user-id]').forEach(row=>{
    const user=rows.find(x=>x.id===row.dataset.userId);
    row.querySelector('[data-user-active]').onclick=e=>updateUser(user,{is_active:!user.is_active},e.currentTarget);
    row.querySelector('[data-user-admin]').onclick=e=>updateUser(user,{is_admin:!user.is_admin},e.currentTarget);
  });
}
async function updateUser(user,patch,button){
  button.disabled=true;
  try{await api(`/api/v1/partner-admin/${encodeURIComponent(partnerId)}/users/${encodeURIComponent(user.id)}`,{method:'PATCH',body:JSON.stringify(patch)});await load()}
  catch(error){alert(error.message)}finally{button.disabled=false}
}
function renderServices(){
  const rows=data.supplier_services||[];
  $('servicesCount').textContent=`${rows.filter(x=>x.is_active).length} активных из ${rows.length}`;
  $('supplierServices').innerHTML=rows.length?rows.slice(0,60).map(s=>`<div class="supplier-service"><div><div class="supplier-name">${esc(s.name)}</div><div class="supplier-meta">${esc(s.category||'Без категории')} · ${esc(s.unit||'шт.')}${s.is_active?'':' · отключена'}</div></div><div class="supplier-price">${esc(money(s.price))}</div></div>`).join(''):'<div class="empty-state">Партнёр ещё не заполнил собственный прайс.</div>';
}
function hubDirection(o){
  if(o.partner_id===partnerId&&o.fulfillment_partner_id===partnerId)return'Внутренний';
  if(o.partner_id===partnerId)return'Партнёр → A4PRINT';
  if(o.fulfillment_partner_id===partnerId)return'A4PRINT → Партнёр';
  return o.partner_direction||'—';
}
function renderOrders(){
  document.querySelectorAll('[data-order-mode]').forEach(b=>b.classList.toggle('active',b.dataset.orderMode===orderMode));
  const target=$('ordersTable');
  if(orderMode==='hub'){
    const rows=data.orders||[];
    $('ordersPanelSub').textContent=`${rows.length} связанных заказов A4PRINT HUB`;
    target.innerHTML=rows.length?`<div class="table-wrap"><table class="partner-table"><thead><tr><th>Заказ</th><th>Направление</th><th>Статус</th><th>Сумма</th><th>Дата</th></tr></thead><tbody>${rows.map(o=>`<tr><td><b>№${esc(o.order_number||'—')}</b><div class="order-direction">${esc(o.source||'HUB')}</div></td><td>${esc(hubDirection(o))}</td><td><span class="order-status">${esc(statusText(o.status))}</span></td><td><b>${esc(money(o.total))}</b></td><td>${esc(dateTime(o.created_at))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">Связанных заказов между A4PRINT и этим партнёром пока нет.</div>';
  }else{
    const rows=data.crm_orders||[];
    $('ordersPanelSub').textContent=`${rows.length} заказов во внутреннем Partner CRM`;
    target.innerHTML=rows.length?`<div class="table-wrap"><table class="partner-table"><thead><tr><th>Заказ</th><th>Название</th><th>Статус</th><th>Продажа</th><th>Оплачено</th><th>Долг</th><th>Дата</th></tr></thead><tbody>${rows.map(o=>{const debt=Math.max(0,Number(o.sale_total||0)-Number(o.prepaid||0));return`<tr><td><b>№${esc(o.order_number||'—')}</b></td><td>${esc(o.title||'—')}</td><td><span class="order-status">${esc(statusText(o.status))}</span></td><td>${esc(money(o.sale_total))}</td><td>${esc(money(o.prepaid))}</td><td><b>${esc(money(debt))}</b></td><td>${esc(dateTime(o.created_at))}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty-state">В Partner CRM пока нет собственных заказов этого партнёра.</div>';
  }
}
function render(){
  $('loading').hidden=true;$('partnerContent').hidden=false;
  renderHero();fillForm(data.partner);renderUsers();renderServices();renderOrders();
}
async function load(){
  if(!partnerId){$('loading').hidden=true;$('error').hidden=false;$('errorText').textContent='В адресе страницы отсутствует ID партнёра.';return}
  try{data=await api(`/api/v1/partner-admin/${encodeURIComponent(partnerId)}`);render()}
  catch(error){$('loading').hidden=true;$('partnerContent').hidden=true;$('error').hidden=false;$('errorText').textContent=error.message}
}
$('partnerForm').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.currentTarget,btn=$('savePartner');btn.disabled=true;setFormStatus('Сохраняю…');
  try{
    const fd=new FormData(form);const payload={};
    for(const name of ['name','legal_name','tax_id','contact_name','email','phone','address','notes'])payload[name]=String(fd.get(name)||'').trim();
    payload.discount_percent=Number(fd.get('discount_percent')||0);payload.payment_terms_days=Number(fd.get('payment_terms_days')||0);payload.credit_limit=Number(fd.get('credit_limit')||0);
    await api(`/api/v1/partner-admin/${encodeURIComponent(partnerId)}`,{method:'PATCH',body:JSON.stringify(payload)});setFormStatus('Сохранено ✓','ok');await load();
  }catch(error){setFormStatus(error.message,'err')}finally{btn.disabled=false}
});
$('togglePartner').addEventListener('click',async e=>{
  if(!data?.partner)return;const next=!data.partner.is_active;const btn=e.currentTarget;btn.disabled=true;
  try{await api(`/api/v1/partner-admin/${encodeURIComponent(partnerId)}`,{method:'PATCH',body:JSON.stringify({is_active:next})});await load()}
  catch(error){alert(error.message)}finally{btn.disabled=false}
});
$('refreshPartner').addEventListener('click',load);
document.querySelectorAll('[data-order-mode]').forEach(b=>b.addEventListener('click',()=>{orderMode=b.dataset.orderMode;renderOrders()}));
load();
