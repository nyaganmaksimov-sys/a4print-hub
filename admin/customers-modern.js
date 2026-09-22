import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const initialRoles=Array.isArray(window.__A4_CURRENT_ROLES__)?[...window.__A4_CURRENT_ROLES__]:[];
const state={customers:[],metrics:new Map(),roles:initialRoles,loading:false,channel:null};
let reloadTimer=null,metricsReloadTimer=null;

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
function metrics(c){
  const row=state.metrics.get(c.id)||{};
  const dates=[c.updated_at,c.created_at,row.last_activity].filter(Boolean).map(timestamp).filter(Boolean);
  return{
    ordersCount:Number(row.orders_count||0),
    orderSum:Number(row.order_sum||0),
    paid:Number(row.paid_total||0),
    pos:Number(row.pos_total||0),
    last:dates.length?new Date(Math.max(...dates)).toISOString():c.updated_at||c.created_at
  };
}

async function loadMetrics(){
  const result=await supabase.rpc('get_customer_workspace_metrics');
  if(result.error)throw result.error;
  state.metrics=new Map((result.data||[]).map(x=>[x.customer_id,x]));
}

async function load(){
  if(state.loading)return;state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';
  try{
    const rolesPromise=state.roles.length?Promise.resolve({data:state.roles,error:null}):supabase.rpc('get_my_roles');
    const [customers,summary,roles]=await Promise.all([
      supabase.from('customers').select('*').order('updated_at',{ascending:false}),
      supabase.rpc('get_customer_workspace_metrics'),
      rolesPromise
    ]);
    if(customers.error)throw customers.error;
    if(summary.error)throw summary.error;
    state.customers=customers.data||[];
    state.metrics=new Map((summary.data||[]).map(x=>[x.customer_id,x]));
    if(!roles.error&&Array.isArray(roles.data))state.roles=roles.data;
    const allowed=canManage();$('addCustomer').hidden=!allowed;if($('addCustomerInline'))$('addCustomerInline').hidden=!allowed;
    render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){console.error('Customers load failed',error);$('list').innerHTML=`<div class="cf-empty error">Ошибка загрузки: ${esc(error.message||error)}</div>`}
  finally{state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить'}
}

function renderStats(){
  $('customersCount').textContent=state.customers.length;
  $('companiesCount').textContent=state.customers.filter(x=>x.customer_type==='LEGAL'||x.customer_type==='IP'||x.company_name).length;
  $('withOrdersCount').textContent=state.customers.filter(c=>metrics(c).ordersCount>0).length;
  $('paidTotal').textContent=money([...state.metrics.values()].reduce((s,x)=>s+Number(x.paid_total||0),0));
}
function filtered(){
  const q=$('search').value.trim().toLowerCase(),type=$('type').value,activity=$('activity').value,sort=$('sort')?.value||'activity';
  const rows=state.customers.filter(c=>{
    const m=metrics(c);const text=[c.full_name,c.company_name,c.legal_name,c.phone,c.email,c.inn,c.telegram,c.whatsapp,c.vk].filter(Boolean).join(' ').toLowerCase();
    if(q&&!text.includes(q))return false;
    if(type&&c.customer_type!==type)return false;
    if(activity==='orders'&&!m.ordersCount)return false;
    if(activity==='pos'&&!(m.pos>0))return false;
    if(activity==='none'&&(m.ordersCount||m.pos>0||m.paid>0))return false;
    return true;
  });
  rows.sort((a,b)=>{
    const ma=metrics(a),mb=metrics(b);
    if(sort==='name')return String(a.full_name||a.company_name||'').localeCompare(String(b.full_name||b.company_name||''),'ru');
    if(sort==='orders')return mb.ordersCount-ma.ordersCount||timestamp(mb.last)-timestamp(ma.last);
    if(sort==='value')return mb.orderSum-ma.orderSum||timestamp(mb.last)-timestamp(ma.last);
    return timestamp(mb.last)-timestamp(ma.last);
  });
  return rows;
}
function row(c){
  const m=metrics(c),company=c.company_name||c.legal_name||typeLabel(c.customer_type),hasContacts=!!(c.phone||c.email);
  const phone=c.phone?`<a class="cf-contact-link" href="tel:${esc(String(c.phone).replace(/[^\d+]/g,''))}" title="Позвонить">${esc(c.phone)}</a>`:'';
  const email=c.email?`<a class="cf-contact-link" href="mailto:${encodeURIComponent(c.email)}" title="Написать">${esc(c.email)}</a>`:'';
  const contacts=[phone,email].filter(Boolean).join('<span class="cf-contact-link" aria-hidden="true">·</span>')||'<span class="cf-contact-empty">Контакты не указаны</span>';
  return `<article class="cf-row customers-row" data-customer-id="${esc(c.id)}" tabindex="0" role="link" aria-label="Открыть карточку клиента ${esc(c.full_name||company||'')}">
    <div class="cf-customer-identity">
      <span class="cf-customer-avatar" aria-hidden="true">${esc(initials(c))}</span>
      <div class="cf-customer-copy"><div class="cf-customer-name">${esc(c.full_name||company||'Клиент')}</div><div class="cf-customer-company">${esc(company)}</div><div class="cf-contact-line">${contacts}</div></div>
    </div>
    <div class="cf-cell"><span>Заказы HUB</span><b>${m.ordersCount} · ${money(m.orderSum)}</b><small class="cf-note"><i class="cf-activity-dot ${activityClass(m.last)}"></i>активность ${esc(fmtDate(m.last))}</small></div>
    <div class="cf-cell cf-money-split"><span>Деньги отдельно</span><b>${money(m.paid)} <em>HUB</em></b><b>${money(m.pos)} <em>KASSA</em></b></div>
    <div class="cf-row-actions customer-actions">${!hasContacts?'<span class="cf-badge warn">Нет контактов</span>':''}<span class="cf-badge ${c.inn?'green':'blue'}">${esc(typeLabel(c.customer_type))}</span><a class="primary" href="./customer.html?id=${encodeURIComponent(c.id)}">Карточка →</a></div>
  </article>`;
}
function render(){renderStats();const rows=filtered();$('visibleCount').textContent=`${rows.length} из ${state.customers.length}`;$('list').innerHTML=rows.map(row).join('')||'<div class="cf-empty">По выбранным условиям клиентов нет</div>'}

function openCreate(){if(!canManage())return;$('customerForm').reset();$('customerError').textContent='';$('customerDlg').showModal();setTimeout(()=>$('full_name').focus(),50)}
$('addCustomer').addEventListener('click',openCreate);$('addCustomerInline')?.addEventListener('click',openCreate);$('closeCustomerDlg').addEventListener('click',()=>$('customerDlg').close());
$('refresh').addEventListener('click',load);$('search').addEventListener('input',render);$('type').addEventListener('change',render);$('activity').addEventListener('change',render);$('sort')?.addEventListener('change',render);$('clearFilters').addEventListener('click',()=>{$('search').value='';$('type').value='';$('activity').value='';if($('sort'))$('sort').value='activity';render()});
$('list').addEventListener('click',e=>{if(e.target.closest('a,button,input,select'))return;const item=e.target.closest('[data-customer-id]');if(item)location.href=`./customer.html?id=${encodeURIComponent(item.dataset.customerId)}`});
$('list').addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key)||e.target.closest('a,button,input,select'))return;const item=e.target.closest('[data-customer-id]');if(item){e.preventDefault();location.href=`./customer.html?id=${encodeURIComponent(item.dataset.customerId)}`}});
$('customerForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!canManage())return;const b=$('saveCustomer');b.disabled=true;$('customerError').textContent='';
  const val=id=>$(id).value.trim();
  const payload={customer_type:$('customer_type').value,full_name:val('full_name'),company_name:val('company_name')||null,inn:val('inn')||null,phone:val('phone')||null,email:val('email').toLowerCase()||null,telegram:val('telegram')||null,whatsapp:val('whatsapp')||null,notes:val('notes')||null,updated_at:new Date().toISOString()};
  try{const {data,error}=await supabase.from('customers').insert(payload).select('id').single();if(error)throw error;$('customerDlg').close();await load();if(data?.id)location.href=`./customer.html?id=${encodeURIComponent(data.id)}`}
  catch(error){$('customerError').textContent=error.message||String(error)}finally{b.disabled=false}
});
function initRealtime(){
  if(typeof supabase.channel!=='function')return;
  const reloadAll=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(load,600)};
  const reloadMetrics=()=>{
    clearTimeout(metricsReloadTimer);
    metricsReloadTimer=setTimeout(()=>loadMetrics().then(render).catch(console.warn),350);
  };
  let ch=supabase.channel('customers-workspace-v4')
    .on('postgres_changes',{event:'*',schema:'public',table:'customers'},reloadAll);
  for(const table of ['orders','payments','pos_sales'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reloadMetrics);
  state.channel=ch.subscribe();
  window.addEventListener('beforeunload',()=>{
    if(reloadTimer)clearTimeout(reloadTimer);
    if(metricsReloadTimer)clearTimeout(metricsReloadTimer);
    if(state.channel)supabase.removeChannel(state.channel);
  },{once:true});
}
await load();initRealtime();
