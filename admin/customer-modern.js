import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const successStatuses=new Set(['PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED']);
const id=new URLSearchParams(location.search).get('id');
if(!id)location.replace('./customers.html');
const state={customer:null,orders:[],payments:[],docs:[],sales:[],roles:[],loading:false,channel:null};
let reloadTimer=null;
const fields=['customer_type','full_name','company_name','legal_name','phone','email','inn','kpp','ogrn','bank_name','bik','settlement_account','correspondent_account','legal_address','actual_address','signatory_name','signatory_title','signatory_basis','telegram','whatsapp','vk','instagram','viber','notes'];

function canManage(){return state.roles.includes('ADMIN')||state.roles.includes('MANAGER')}
function paymentOk(x){return successStatuses.has(String(x.status||'').toUpperCase())}
function saleOk(x){return !['FAILED','ERROR','CANCELLED'].includes(String(x.sync_status||'').toUpperCase())}
function fmtDate(v,withTime=false){if(!v)return'—';const d=new Date(v);if(!Number.isFinite(d.getTime()))return'—';return withTime?d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('ru-RU')}
function docPaid(doc){return state.payments.filter(x=>x.customer_document_id===doc.id&&paymentOk(x)).reduce((s,x)=>s+Number(x.amount||0),0)}
function docOutstanding(doc){return Math.max(0,Number(doc.amount||0)-docPaid(doc))}

async function load(){
  if(state.loading)return;state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';
  try{
    const [customer,orders,payments,docs,sales,roles]=await Promise.all([
      supabase.from('customers').select('*').eq('id',id).single(),
      supabase.from('orders').select('id,order_number,status,total,business_unit,model_name,source,created_at').eq('customer_id',id).order('created_at',{ascending:false}),
      supabase.from('payments').select('id,payment_number,status,amount,currency,payment_method,payment_type,paid_at,created_at,note,order_id,customer_document_id').eq('customer_id',id).order('created_at',{ascending:false}),
      supabase.from('customer_documents').select('*').eq('customer_id',id).order('created_at',{ascending:false}),
      supabase.from('pos_sales').select('id,moysklad_sale_name,total,payment_method,sold_at,created_at,sync_status').eq('customer_id',id).order('sold_at',{ascending:false}).limit(100),
      supabase.rpc('get_my_roles')
    ]);
    for(const r of [customer,orders,payments,docs,sales])if(r.error)throw r.error;
    state.customer=customer.data;state.orders=orders.data||[];state.payments=payments.data||[];state.docs=docs.data||[];state.sales=sales.data||[];state.roles=Array.isArray(roles.data)?roles.data:[];
    render();$('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){console.error('Customer profile load failed',error);document.getElementById('profileRoot').innerHTML=`<div class="cf-card"><div class="cf-empty error">Ошибка загрузки: ${esc(error.message||error)}</div></div>`}
  finally{state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить'}
}

function render(){
  const c=state.customer;if(!c)return;
  $('pageTitle').textContent=c.company_name||c.legal_name||c.full_name||'Клиент';
  $('subtitle').textContent=[c.full_name,c.phone,c.email].filter(Boolean).join(' · ')||'Карточка клиента';
  fields.forEach(f=>{if($(f)){$(f).value=c[f]??'';$(f).disabled=!canManage()}});
  $('saveCustomer').hidden=!canManage();
  $('newPaymentLink').href=`./payments.html?customer=${encodeURIComponent(id)}`;
  const orderValue=state.orders.filter(x=>x.status!=='CANCELLED').reduce((s,x)=>s+Number(x.total||0),0);
  const paid=state.payments.filter(paymentOk).reduce((s,x)=>s+Number(x.amount||0),0);
  const pos=state.sales.filter(saleOk).reduce((s,x)=>s+Number(x.total||0),0);
  const invoiced=state.docs.filter(x=>String(x.status||'').toUpperCase()!=='CANCELLED').reduce((s,x)=>s+Number(x.amount||0),0);
  const outstanding=state.docs.reduce((s,x)=>s+docOutstanding(x),0);
  $('ordersKpi').textContent=state.orders.length;$('orderValueKpi').textContent=money(orderValue);$('paidKpi').textContent=money(paid);$('posKpi').textContent=money(pos);
  $('invoiceTotal').textContent=money(invoiced);$('invoiceOutstanding').textContent=money(outstanding);
  renderOrders();renderDocs();renderPayments();renderPos();fillInvoiceOrders();
}

function renderOrders(){
  $('ordersList').innerHTML=state.orders.map(o=>`<div class="cf-mini-row"><span><b><a class="cf-link" href="./order.html?id=${encodeURIComponent(o.id)}">Заказ №${esc(o.order_number)}</a></b><small>${esc(o.model_name||o.source||'Заказ')} · ${esc(o.status||'—')} · ${esc(fmtDate(o.created_at))}</small></span><strong>${money(o.total)}</strong></div>`).join('')||'<div class="cf-empty">Заказов пока нет</div>';
}
function renderDocs(){
  $('docsList').innerHTML=state.docs.map(d=>{const paid=docPaid(d),left=docOutstanding(d),late=d.due_date&&left>0&&new Date(d.due_date+'T23:59:59').getTime()<Date.now();const tone=d.status==='PAID'?'green':late?'red':'blue';return `<div class="cf-mini-row"><span><b><a class="cf-link" href="./invoice.html?id=${encodeURIComponent(d.id)}">${esc(d.document_number||'Счёт')}</a> <span class="cf-badge ${tone}">${esc(d.status||'ISSUED')}</span></b><small>${esc(d.title||d.description||'Счёт клиенту')} · ${esc(fmtDate(d.issue_date))}${d.due_date?' · до '+esc(fmtDate(d.due_date)):''}</small><small>Оплачено ${money(paid)} · остаток ${money(left)}</small></span><strong>${money(d.amount)}</strong></div>`}).join('')||'<div class="cf-empty">Счетов и документов пока нет</div>';
}
function renderPayments(){
  $('paymentsList').innerHTML=state.payments.map(p=>`<div class="cf-mini-row"><span><b>${esc(p.payment_number||'Оплата')} <span class="cf-badge ${paymentOk(p)?'green':p.status==='CANCELLED'?'red':'orange'}">${esc(p.status||'PENDING')}</span></b><small>${esc(p.payment_method||'Способ не указан')} · ${esc(fmtDate(p.paid_at||p.created_at,true))}${p.note?' · '+esc(p.note):''}</small></span><strong>${money(p.amount)}</strong></div>`).join('')||'<div class="cf-empty">Оплат в HUB пока нет</div>';
}
function renderPos(){
  const rows=state.sales.filter(saleOk);$('posList').innerHTML=rows.map(s=>`<div class="cf-mini-row"><span><b>${s.moysklad_sale_name?'Чек №'+esc(s.moysklad_sale_name):'Продажа KASSA'}</b><small>${esc(s.payment_method||'—')} · ${esc(fmtDate(s.sold_at||s.created_at,true))}</small></span><strong>${money(s.total)}</strong></div>`).join('')||'<div class="cf-empty">Покупок KASSA у этого клиента пока нет</div>';
}
function fillInvoiceOrders(){
  const current=$('invoiceOrder').value;$('invoiceOrder').innerHTML='<option value="">Без привязки к заказу</option>'+state.orders.filter(o=>o.status!=='CANCELLED').map(o=>`<option value="${o.id}">№${esc(o.order_number)} · ${money(o.total)} · ${esc(o.model_name||o.source||'Заказ')}</option>`).join('');if([...$('invoiceOrder').options].some(o=>o.value===current))$('invoiceOrder').value=current;
}

$('invoiceOrder').addEventListener('change',()=>{const o=state.orders.find(x=>x.id===$('invoiceOrder').value);if(!o)return;if(!$('amount').value)$('amount').value=Number(o.total||0);if(!$('description').value.trim())$('description').value=o.model_name||o.source||`Заказ №${o.order_number}`});
$('customerForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!canManage())return;const b=$('saveCustomer');b.disabled=true;$('saveMsg').textContent='Сохранение…';$ ('saveMsg').className='cf-msg';
  const payload={updated_at:new Date().toISOString()};fields.forEach(f=>payload[f]=$(f).value.trim?($(f).value.trim()||null):$(f).value);payload.full_name=$('full_name').value.trim();payload.customer_type=$('customer_type').value;
  try{const {error}=await supabase.from('customers').update(payload).eq('id',id);if(error)throw error;$('saveMsg').className='cf-msg success';$('saveMsg').textContent='Сохранено ✓';await load()}
  catch(error){$('saveMsg').className='cf-msg error';$('saveMsg').textContent=error.message||String(error)}finally{b.disabled=false}
});
$('invoiceForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!canManage())return;const b=$('createInvoice');b.disabled=true;$('invoiceMsg').textContent='Создание…';$('invoiceMsg').className='cf-msg';
  try{const {data,error}=await supabase.rpc('create_customer_invoice',{p_customer_id:id,p_amount:Number($('amount').value),p_description:$('description').value.trim(),p_due_date:$('due_date').value||null,p_order_id:$('invoiceOrder').value||null});if(error)throw error;$('invoiceMsg').className='cf-msg success';$('invoiceMsg').innerHTML=`Счёт создан ✓ · <a class="cf-link" href="./invoice.html?id=${encodeURIComponent(data)}">открыть</a>`;e.currentTarget.reset();await load()}
  catch(error){$('invoiceMsg').className='cf-msg error';$('invoiceMsg').textContent=error.message||String(error)}finally{b.disabled=false}
});
$('refresh').addEventListener('click',load);
function initRealtime(){if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(load,650)};let ch=supabase.channel(`customer-profile-${id}`);for(const table of ['customers','orders','payments','customer_documents','pos_sales'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);state.channel=ch.subscribe();window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true})}
await load();initRealtime();
