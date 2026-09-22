import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const initialRoles=Array.isArray(window.__A4_CURRENT_ROLES__)?[...window.__A4_CURRENT_ROLES__]:[];
const state={customers:[],summary:null,roles:initialRoles,loading:false,reloadQueued:false,channel:null,page:1,pageSize:50,total:0};
let reloadTimer=null,searchTimer=null;

function roleName(role){return String(role?.name||role||'').toUpperCase()}
function canManage(){return state.roles.some(r=>['ADMIN','MANAGER'].includes(roleName(r)))}
function typeLabel(v){return v==='LEGAL'?'Организация':v==='IP'?'ИП':'Физлицо'}
function fmtDate(v){const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—'}
function timestamp(v){const n=new Date(v||0).getTime();return Number.isFinite(n)?n:0}
function initials(c){
  const value=String(c.full_name||c.company_name||c.legal_name||'К').trim();
  const parts=value.split(/\s+/).filter(Boolean);
  return (parts.length>1?(parts[0][0]||'')+(parts[1][0]||''):(value.slice(0,2)||'К')).toUpperCase();
}
function activityClass(value){
  const age=Date.now()-timestamp(value);
  if(age<=30*86400000)return'recent';
  if(age<=120*86400000)return'stale';
  return'';
}
function currentFilters(){
  return{
    q:$('search')?.value.trim()||'',
    type:$('type')?.value||'',
    activity:$('activity')?.value||'',
    sort:$('sort')?.value||'activity'
  };
}
function syncUrl(){
  const f=currentFilters(),url=new URL(location.href);
  ['q','type','activity','sort','page'].forEach(key=>url.searchParams.delete(key));
  if(f.q)url.searchParams.set('q',f.q);
  if(f.type)url.searchParams.set('type',f.type);
  if(f.activity)url.searchParams.set('activity',f.activity);
  if(f.sort&&f.sort!=='activity')url.searchParams.set('sort',f.sort);
  if(state.page>1)url.searchParams.set('page',String(state.page));
  history.replaceState(null,'',url.pathname+url.search);
}
async function loadPage(){
  const f=currentFilters();
  const {data,error}=await supabase.rpc('get_customers_workspace_page',{
    p_query:f.q,p_type:f.type,p_activity:f.activity,p_sort:f.sort,p_page:state.page,p_page_size:state.pageSize
  });
  if(error)throw error;
  const rows=Array.isArray(data)?data:[];
  return{rows,total:rows.length?Number(rows[0].total_count||0):0};
}
async function loadSummary(){
  const {data,error}=await supabase.rpc('get_customers_workspace_summary');
  if(error)throw error;
  return Array.isArray(data)?(data[0]||null):data;
}
function renderStats(){
  const s=state.summary||{};
  $('customersCount').textContent=Number(s.customers_count||0);
  $('companiesCount').textContent=Number(s.companies_count||0);
  $('withOrdersCount').textContent=Number(s.with_orders_count||0);
  $('paidTotal').textContent=money(s.paid_total||0);
}
function row(c){
  const company=c.company_name||c.legal_name||typeLabel(c.customer_type),hasContacts=!!(c.phone||c.email);
  const phone=c.phone?`<a class="cf-contact-link" href="tel:${esc(String(c.phone).replace(/[^\d+]/g,''))}" title="Позвонить">${esc(c.phone)}</a>`:'';
  const email=c.email?`<a class="cf-contact-link" href="mailto:${encodeURIComponent(c.email)}" title="Написать">${esc(c.email)}</a>`:'';
  const contacts=[phone,email].filter(Boolean).join('<span class="cf-contact-link" aria-hidden="true">·</span>')||'<span class="cf-contact-empty">Контакты не указаны</span>';
  return `<article class="cf-row customers-row" data-customer-id="${esc(c.id)}" tabindex="0" role="link" aria-label="Открыть карточку клиента ${esc(c.full_name||company||'')}">
    <div class="cf-customer-identity">
      <span class="cf-customer-avatar" aria-hidden="true">${esc(initials(c))}</span>
      <div class="cf-customer-copy"><div class="cf-customer-name">${esc(c.full_name||company||'Клиент')}</div><div class="cf-customer-company">${esc(company)}</div><div class="cf-contact-line">${contacts}</div></div>
    </div>
    <div class="cf-cell"><span>Заказы HUB</span><b>${Number(c.orders_count||0)} · ${money(c.order_sum)}</b><small class="cf-note"><i class="cf-activity-dot ${activityClass(c.last_activity)}"></i>активность ${esc(fmtDate(c.last_activity))}</small></div>
    <div class="cf-cell cf-money-split"><span>Деньги отдельно</span><b>${money(c.paid_total)} <em>HUB</em></b><b>${money(c.pos_total)} <em>KASSA</em></b></div>
    <div class="cf-row-actions customer-actions">${!hasContacts?'<span class="cf-badge warn">Нет контактов</span>':''}<span class="cf-badge ${c.inn?'green':'blue'}">${esc(typeLabel(c.customer_type))}</span><a class="primary" href="./customer.html?id=${encodeURIComponent(c.id)}">Карточка →</a></div>
  </article>`;
}
function renderPager(){
  const totalPages=Math.max(1,Math.ceil(state.total/state.pageSize));
  const pager=$('customersPager');if(!pager)return;
  pager.hidden=state.total<=state.pageSize;
  $('customersPageLabel').textContent=`Страница ${state.page} из ${totalPages}`;
  $('customersPrevPage').disabled=state.page<=1;
  $('customersNextPage').disabled=state.page>=totalPages;
}
function render(){
  syncUrl();renderStats();
  $('visibleCount').textContent=`${state.customers.length} на странице · всего ${state.total}`;
  $('list').innerHTML=state.customers.map(row).join('')||'<div class="cf-empty">По выбранным условиям клиентов нет</div>';
  renderPager();
}
function renderLoading(){
  $('list').innerHTML='<div class="customers-loading-list" aria-label="Загрузка клиентов"><div class="a4-skeleton"></div><div class="a4-skeleton"></div><div class="a4-skeleton"></div></div>';
}
function renderError(error){
  $('list').innerHTML=`<div class="a4-error"><b>Не удалось загрузить клиентов</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="customersRetry" type="button" class="a4-btn" style="margin-top:10px">Повторить</button></div>`;
  $('customersRetry')?.addEventListener('click',()=>load(true));
}
async function load(force=false){
  if(state.loading){if(force)state.reloadQueued=true;return}
  state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';
  if(!state.customers.length)renderLoading();
  try{
    const rolesPromise=state.roles.length?Promise.resolve({data:state.roles,error:null}):supabase.rpc('get_my_roles');
    const [pageR,summaryR,rolesR]=await Promise.allSettled([loadPage(),loadSummary(),rolesPromise]);
    if(pageR.status==='rejected')throw pageR.reason;
    state.customers=pageR.value.rows;state.total=pageR.value.total;
    if(!state.customers.length&&state.page>1){state.page=Math.max(1,state.page-1);state.loading=false;return load(true)}
    if(summaryR.status==='fulfilled')state.summary=summaryR.value;else console.warn('Customers summary unavailable',summaryR.reason);
    if(rolesR.status==='fulfilled'&&!rolesR.value.error&&Array.isArray(rolesR.value.data))state.roles=rolesR.value.data;
    const allowed=canManage();$('addCustomer').hidden=!allowed;if($('addCustomerInline'))$('addCustomerInline').hidden=!allowed;
    render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){
    console.error('Customers load failed',error);renderError(error);$('updatedAt').textContent='ошибка загрузки';
  }finally{
    state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить';
    if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>load(),0)}
  }
}

function openCreate(){if(!canManage())return;$('customerForm').reset();$('customerError').textContent='';$('customerDlg').showModal();setTimeout(()=>$('full_name').focus(),50)}
function resetPageAndLoad(){state.page=1;void load(true)}
function initParams(){
  const params=new URLSearchParams(location.search);
  if(params.get('q'))$('search').value=params.get('q');
  for(const id of ['type','activity','sort']){
    const value=params.get(id),control=$(id);
    if(control&&value&&[...control.options].some(o=>o.value===value))control.value=value;
  }
  const page=Number(params.get('page')||1);state.page=Number.isInteger(page)&&page>0?page:1;
}
function bind(){
  $('addCustomer').addEventListener('click',openCreate);$('addCustomerInline')?.addEventListener('click',openCreate);$('closeCustomerDlg').addEventListener('click',()=>$('customerDlg').close());
  $('refresh').addEventListener('click',()=>load(true));
  $('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(resetPageAndLoad,280)});
  $('type').addEventListener('change',resetPageAndLoad);$('activity').addEventListener('change',resetPageAndLoad);$('sort')?.addEventListener('change',resetPageAndLoad);
  $('clearFilters').addEventListener('click',()=>{$('search').value='';$('type').value='';$('activity').value='';if($('sort'))$('sort').value='activity';resetPageAndLoad()});
  $('customersPrevPage')?.addEventListener('click',()=>{if(state.page>1){state.page--;void load(true)}});
  $('customersNextPage')?.addEventListener('click',()=>{const pages=Math.max(1,Math.ceil(state.total/state.pageSize));if(state.page<pages){state.page++;void load(true)}});
  $('list').addEventListener('click',e=>{if(e.target.closest('a,button,input,select'))return;const item=e.target.closest('[data-customer-id]');if(item)location.href=`./customer.html?id=${encodeURIComponent(item.dataset.customerId)}`});
  $('list').addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key)||e.target.closest('a,button,input,select'))return;const item=e.target.closest('[data-customer-id]');if(item){e.preventDefault();location.href=`./customer.html?id=${encodeURIComponent(item.dataset.customerId)}`}});
  $('customerForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!canManage())return;const b=$('saveCustomer');b.disabled=true;$('customerError').textContent='';
    const val=id=>$(id).value.trim();
    const payload={customer_type:$('customer_type').value,full_name:val('full_name'),company_name:val('company_name')||null,inn:val('inn')||null,phone:val('phone')||null,email:val('email').toLowerCase()||null,telegram:val('telegram')||null,whatsapp:val('whatsapp')||null,notes:val('notes')||null,updated_at:new Date().toISOString()};
    try{const {data,error}=await supabase.from('customers').insert(payload).select('id').single();if(error)throw error;$('customerDlg').close();if(data?.id)location.href=`./customer.html?id=${encodeURIComponent(data.id)}`;else await load(true)}
    catch(error){$('customerError').textContent=error.message||String(error)}finally{b.disabled=false}
  });
}
function initRealtime(){
  if(typeof supabase.channel!=='function')return;
  const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>load(true),450)};
  let ch=supabase.channel('customers-workspace-v5').on('postgres_changes',{event:'*',schema:'public',table:'customers'},reload);
  for(const table of ['orders','payments','pos_sales'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);
  state.channel=ch.subscribe();
  window.addEventListener('beforeunload',()=>{if(reloadTimer)clearTimeout(reloadTimer);if(searchTimer)clearTimeout(searchTimer);if(state.channel)supabase.removeChannel(state.channel)},{once:true});
}

initParams();bind();await load();initRealtime();
