import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const successStatuses=new Set(['PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED']);
const state={customers:[],orders:[],payments:[],sales:[],roles:[],loading:false,channel:null};
let reloadTimer=null;

function canManage(){return state.roles.includes('ADMIN')||state.roles.includes('MANAGER')}
function paymentOk(x){return successStatuses.has(String(x.status||'').toUpperCase())}
function saleOk(x){return !['FAILED','ERROR','CANCELLED'].includes(String(x.sync_status||'').toUpperCase())}
function typeLabel(v){return v==='LEGAL'?'Организация':v==='IP'?'ИП':'Физлицо'}
function fmtDate(v){const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—'}

function metrics(c){
  const orders=state.orders.filter(x=>x.customer_id===c.id);
  const payments=state.payments.filter(x=>x.customer_id===c.id&&paymentOk(x));
  const sales=state.sales.filter(x=>x.customer_id===c.id&&saleOk(x));
  const orderSum=orders.filter(x=>x.status!=='CANCELLED').reduce((s,x)=>s+Number(x.total||0),0);
  const paid=payments.reduce((s,x)=>s+Number(x.amount||0),0);
  const pos=sales.reduce((s,x)=>s+Number(x.total||0),0);
  const dates=[c.updated_at,c.created_at,...orders.map(x=>x.created_at),...payments.map(x=>x.paid_at||x.created_at),...sales.map(x=>x.sold_at||x.created_at)].filter(Boolean).map(x=>new Date(x).getTime()).filter(Number.isFinite);
  return{orders,orderSum,paid,pos,last:dates.length?new Date(Math.max(...dates)).toISOString():c.updated_at||c.created_at};
}

async function load(){
  if(state.loading)return;state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';
  try{
    const [customers,orders,payments,sales,roles]=await Promise.all([
      supabase.from('customers').select('*').order('updated_at',{ascending:false}),
      supabase.from('orders').select('id,customer_id,order_number,status,total,created_at').order('created_at',{ascending:false}).limit(5000),
      supabase.from('payments').select('id,customer_id,status,amount,paid_at,created_at').order('created_at',{ascending:false}).limit(5000),
      supabase.from('pos_sales').select('id,customer_id,total,sync_status,sold_at,created_at').order('sold_at',{ascending:false}).limit(5000),
      supabase.rpc('get_my_roles')
    ]);
    for(const r of [customers,orders,payments,sales])if(r.error)throw r.error;
    state.customers=customers.data||[];state.orders=orders.data||[];state.payments=payments.data||[];state.sales=sales.data||[];state.roles=Array.isArray(roles.data)?roles.data:[];
    $('addCustomer').hidden=!canManage();render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){console.error('Customers load failed',error);$('list').innerHTML=`<div class="cf-empty error">Ошибка загрузки: ${esc(error.message||error)}</div>`}
  finally{state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить'}
}

function renderStats(){
  $('customersCount').textContent=state.customers.length;
  $('companiesCount').textContent=state.customers.filter(x=>x.customer_type==='LEGAL'||x.customer_type==='IP'||x.company_name).length;
  $('withOrdersCount').textContent=new Set(state.orders.map(x=>x.customer_id).filter(Boolean)).size;
  $('paidTotal').textContent=money(state.payments.filter(paymentOk).reduce((s,x)=>s+Number(x.amount||0),0));
}
function filtered(){
  const q=$('search').value.trim().toLowerCase(),type=$('type').value,activity=$('activity').value;
  return state.customers.filter(c=>{
    const m=metrics(c);const text=[c.full_name,c.company_name,c.legal_name,c.phone,c.email,c.inn,c.telegram,c.whatsapp,c.vk].filter(Boolean).join(' ').toLowerCase();
    if(q&&!text.includes(q))return false;
    if(type&&c.customer_type!==type)return false;
    if(activity==='orders'&&!m.orders.length)return false;
    if(activity==='pos'&&!(m.pos>0))return false;
    if(activity==='none'&&(m.orders.length||m.pos>0||m.paid>0))return false;
    return true;
  });
}
function row(c){
  const m=metrics(c);const company=c.company_name||c.legal_name||typeLabel(c.customer_type);const contacts=[c.phone,c.email].filter(Boolean).join(' · ')||'Контакты не указаны';
  return `<article class="cf-row" data-customer-id="${c.id}">
    <div class="cf-main"><b>${esc(c.full_name||company||'Клиент')}</b><small>${esc(company)} · ${esc(contacts)}</small></div>
    <div class="cf-cell"><span>Заказы HUB</span><b>${m.orders.length} · ${money(m.orderSum)}</b><small class="cf-note">последняя активность ${esc(fmtDate(m.last))}</small></div>
    <div class="cf-cell"><span>Подтверждено / KASSA</span><b>${money(m.paid)} / ${money(m.pos)}</b><small class="cf-note">раздельные источники денег</small></div>
    <div class="cf-row-actions"><span class="cf-badge ${c.inn?'green':'blue'}">${esc(typeLabel(c.customer_type))}</span><a class="primary" href="./customer.html?id=${encodeURIComponent(c.id)}">Карточка →</a></div>
  </article>`;
}
function render(){renderStats();const rows=filtered();$('visibleCount').textContent=`${rows.length} из ${state.customers.length}`;$('list').innerHTML=rows.map(row).join('')||'<div class="cf-empty">Клиенты не найдены</div>'}

function openCreate(){if(!canManage())return;$('customerForm').reset();$('customerError').textContent='';$('customerDlg').showModal();setTimeout(()=>$('full_name').focus(),50)}
$('addCustomer').addEventListener('click',openCreate);$('closeCustomerDlg').addEventListener('click',()=>$('customerDlg').close());
$('refresh').addEventListener('click',load);$('search').addEventListener('input',render);$('type').addEventListener('change',render);$('activity').addEventListener('change',render);$('clearFilters').addEventListener('click',()=>{$('search').value='';$('type').value='';$('activity').value='';render()});
$('customerForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!canManage())return;const b=$('saveCustomer');b.disabled=true;$('customerError').textContent='';
  const val=id=>$(id).value.trim();
  const payload={customer_type:$('customer_type').value,full_name:val('full_name'),company_name:val('company_name')||null,inn:val('inn')||null,phone:val('phone')||null,email:val('email').toLowerCase()||null,telegram:val('telegram')||null,whatsapp:val('whatsapp')||null,notes:val('notes')||null,updated_at:new Date().toISOString()};
  try{const {data,error}=await supabase.from('customers').insert(payload).select('id').single();if(error)throw error;$('customerDlg').close();await load();if(data?.id)location.href=`./customer.html?id=${encodeURIComponent(data.id)}`}
  catch(error){$('customerError').textContent=error.message||String(error)}finally{b.disabled=false}
});
function initRealtime(){if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(load,600)};let ch=supabase.channel('customers-workspace-v2');for(const table of ['customers','orders','payments','pos_sales'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);state.channel=ch.subscribe();window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true})}
await load();initRealtime();
