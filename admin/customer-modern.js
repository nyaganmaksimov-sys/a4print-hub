import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const successStatuses=new Set(['PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED']);
const id=new URLSearchParams(location.search).get('id');
if(!id)location.replace('./customers.html');
const initialRoles=Array.isArray(window.__A4_CURRENT_ROLES__)?[...window.__A4_CURRENT_ROLES__]:[];
const state={customer:null,orders:[],payments:[],docs:[],sales:[],metrics:null,roles:initialRoles,loading:false,reloadQueued:false,channel:null,ordersError:null,financeError:null,salesError:null};
let reloadTimer=null;
const fields=['customer_type','full_name','company_name','legal_name','phone','email','inn','kpp','ogrn','bank_name','bik','settlement_account','correspondent_account','legal_address','actual_address','signatory_name','signatory_title','signatory_basis','telegram','whatsapp','vk','instagram','viber','notes'];

function canManage(){return state.roles.includes('ADMIN')||state.roles.includes('MANAGER')}
function paymentOk(x){return successStatuses.has(String(x.status||'').toUpperCase())}
function saleOk(x){return !['FAILED','ERROR','CANCELLED'].includes(String(x.sync_status||'').toUpperCase())}
function fmtDate(v,withTime=false){if(!v)return'—';const d=new Date(v);if(!Number.isFinite(d.getTime()))return'—';return withTime?d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('ru-RU')}
function docPaid(doc){return state.payments.filter(x=>x.customer_document_id===doc.id&&paymentOk(x)).reduce((s,x)=>s+Number(x.amount||0),0)}
function docOutstanding(doc){return Math.max(0,Number(doc.amount||0)-docPaid(doc))}

async function load(force=false){
  if(state.loading){if(force)state.reloadQueued=true;return}
  state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';
  try{
    const rolesPromise=state.roles.length?Promise.resolve({data:state.roles,error:null}):supabase.rpc('get_my_roles');
    const customerFields='id,customer_type,full_name,company_name,legal_name,phone,email,inn,kpp,ogrn,bank_name,bik,settlement_account,correspondent_account,legal_address,actual_address,signatory_name,signatory_title,signatory_basis,telegram,whatsapp,vk,instagram,viber,notes,created_at,updated_at';
    const queries=[
      supabase.from('customers').select(customerFields).eq('id',id).single(),
      supabase.from('orders').select('id,order_number,status,total,business_unit,model_name,source,created_at').eq('customer_id',id).or('source.is.null,source.neq.KASSA').order('created_at',{ascending:false}).limit(100),
      supabase.from('payments').select('id,payment_number,status,amount,currency,payment_method,payment_type,paid_at,created_at,note,order_id,customer_document_id').eq('customer_id',id).order('created_at',{ascending:false}),
      supabase.from('customer_documents').select('id,customer_id,order_id,document_number,document_type,status,title,amount,currency,issue_date,due_date,description,created_at').eq('customer_id',id).order('created_at',{ascending:false}),
      supabase.from('pos_sales').select('id,moysklad_sale_name,total,payment_method,sold_at,created_at,sync_status').eq('customer_id',id).order('sold_at',{ascending:false}).limit(100),
      supabase.rpc('get_customer_profile_metrics',{p_customer_id:id}),
      rolesPromise
    ];
    const [customerR,ordersR,paymentsR,docsR,salesR,metricsR,rolesR]=await Promise.all(queries);
    if(customerR.error)throw customerR.error;
    state.customer=customerR.data;
    if(!rolesR.error&&Array.isArray(rolesR.data))state.roles=rolesR.data;

    state.ordersError=ordersR.error||null;
    state.orders=ordersR.error?[]:(ordersR.data||[]);
    if(ordersR.error)console.warn('Customer orders unavailable',ordersR.error);

    state.financeError=paymentsR.error||docsR.error||null;
    state.payments=paymentsR.error?[]:(paymentsR.data||[]);
    state.docs=docsR.error?[]:(docsR.data||[]);
    if(state.financeError)console.warn('Customer finance unavailable',state.financeError);

    state.salesError=salesR.error||null;
    state.sales=salesR.error?[]:(salesR.data||[]);
    if(salesR.error)console.warn('Customer KASSA history unavailable',salesR.error);

    if(metricsR.error)console.warn('Customer metrics unavailable',metricsR.error);
    state.metrics=metricsR.error?null:(Array.isArray(metricsR.data)?metricsR.data[0]:metricsR.data);

    render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){
    console.error('Customer profile load failed',error);
    document.getElementById('profileRoot').innerHTML=`<div class="cf-card"><div class="a4-error"><b>Не удалось загрузить карточку клиента</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="customerRetry" type="button" class="a4-btn" style="margin-top:10px">Повторить</button></div></div>`;
    $('customerRetry')?.addEventListener('click',()=>load(true));
    $('updatedAt').textContent='ошибка загрузки';
  }finally{
    state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить';
    if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>load(),0)}
  }
}

function render(){
  const c=state.customer;if(!c)return;
  const manage=canManage(),m=state.metrics||{};
  $('pageTitle').textContent=c.company_name||c.legal_name||c.full_name||'Клиент';
  $('subtitle').textContent=[c.full_name,c.phone,c.email].filter(Boolean).join(' · ')||'Карточка клиента';
  fields.forEach(f=>{if($(f)){$(f).value=c[f]??'';$(f).disabled=!manage}});
  $('saveCustomer').hidden=!manage;
  $('newPaymentLink').hidden=!manage;$('newPaymentLinkBottom').hidden=!manage;
  $('newPaymentLink').href=`./payments.html?customer=${encodeURIComponent(id)}`;
  $('newPaymentLinkBottom').href=`./payments.html?customer=${encodeURIComponent(id)}`;

  $('ordersKpi').textContent=state.metrics?Number(m.orders_count||0):'—';
  $('orderValueKpi').textContent=state.metrics?money(m.order_value||0):'—';
  $('paidKpi').textContent=manage&&state.metrics?money(m.paid_total||0):'—';
  $('posKpi').textContent=!state.salesError&&state.metrics?money(m.pos_total||0):'—';
  $('invoiceTotal').textContent=manage&&state.metrics?money(m.invoiced_total||0):'—';
  $('invoiceOutstanding').textContent=manage&&state.metrics?money(m.invoice_outstanding||0):'—';

  const invoiceControls=$('invoiceForm')?.querySelectorAll('input,select,textarea,button')||[];
  invoiceControls.forEach(node=>node.disabled=!manage);
  $('createInvoice').hidden=!manage;

  renderOrders();renderDocs();renderPayments();renderPos();fillInvoiceOrders();
}

function renderOrders(){
  if(state.ordersError){$('ordersList').innerHTML='<div class="a4-error">История заказов временно недоступна.</div>';return}
  const suffix=state.metrics&&Number(state.metrics.orders_count||0)>state.orders.length?`<div class="cf-note">Показаны последние ${state.orders.length} из ${Number(state.metrics.orders_count||0)} заказов.</div>`:'';
  $('ordersList').innerHTML=(state.orders.map(o=>`<div class="cf-mini-row"><span><b><a class="cf-link" href="./order.html?id=${encodeURIComponent(o.id)}">Заказ №${esc(o.order_number)}</a></b><small>${esc(o.model_name||o.source||'Заказ')} · ${esc(o.status||'—')} · ${esc(fmtDate(o.created_at))}</small></span><strong>${money(o.total)}</strong></div>`).join('')||'<div class="cf-empty">Заказов пока нет</div>')+suffix;
}
function renderDocs(){
  if(!canManage()){$('docsList').innerHTML='<div class="cf-empty">Финансовые документы доступны менеджеру или администратору.</div>';return}
  if(state.financeError){$('docsList').innerHTML='<div class="a4-error">Счета и документы временно недоступны.</div>';return}
  $('docsList').innerHTML=state.docs.map(d=>{const paid=docPaid(d),left=docOutstanding(d),late=d.due_date&&left>0&&new Date(d.due_date+'T23:59:59').getTime()<Date.now();const tone=d.status==='PAID'?'green':late?'red':'blue';return `<div class="cf-mini-row"><span><b><a class="cf-link" href="./invoice.html?id=${encodeURIComponent(d.id)}">${esc(d.document_number||'Счёт')}</a> <span class="cf-badge ${tone}">${esc(d.status||'ISSUED')}</span></b><small>${esc(d.title||d.description||'Счёт клиенту')} · ${esc(fmtDate(d.issue_date))}${d.due_date?' · до '+esc(fmtDate(d.due_date)):''}</small><small>Оплачено ${money(paid)} · остаток ${money(left)}</small></span><strong>${money(d.amount)}</strong></div>`}).join('')||'<div class="cf-empty">Счетов и документов пока нет</div>';
}
function renderPayments(){
  if(!canManage()){$('paymentsList').innerHTML='<div class="cf-empty">Оплаты HUB доступны менеджеру или администратору.</div>';return}
  if(state.financeError){$('paymentsList').innerHTML='<div class="a4-error">Оплаты временно недоступны.</div>';return}
  $('paymentsList').innerHTML=state.payments.map(p=>`<div class="cf-mini-row"><span><b>${esc(p.payment_number||'Оплата')} <span class="cf-badge ${paymentOk(p)?'green':p.status==='CANCELLED'?'red':'orange'}">${esc(p.status||'PENDING')}</span></b><small>${esc(p.payment_method||'Способ не указан')} · ${esc(fmtDate(p.paid_at||p.created_at,true))}${p.note?' · '+esc(p.note):''}</small></span><strong>${money(p.amount)}</strong></div>`).join('')||'<div class="cf-empty">Оплат в HUB пока нет</div>';
}
function renderPos(){
  if(state.salesError){$('posList').innerHTML='<div class="a4-error">История KASSA временно недоступна.</div>';return}
  const rows=state.sales.filter(saleOk);$('posList').innerHTML=rows.map(s=>`<div class="cf-mini-row"><span><b>${s.moysklad_sale_name?'Чек №'+esc(s.moysklad_sale_name):'Продажа KASSA'}</b><small>${esc(s.payment_method||'—')} · ${esc(fmtDate(s.sold_at||s.created_at,true))}</small></span><strong>${money(s.total)}</strong></div>`).join('')||'<div class="cf-empty">Покупок KASSA у этого клиента пока нет</div>';
}
function fillInvoiceOrders(){
  const select=$('invoiceOrder');if(!select)return;
  if(!canManage()){select.innerHTML='<option value="">Недоступно для текущей роли</option>';return}
  const current=select.value;
  select.innerHTML='<option value="">Без привязки к заказу</option>'+state.orders.filter(o=>o.status!=='CANCELLED').map(o=>`<option value="${o.id}">№${esc(o.order_number)} · ${money(o.total)} · ${esc(o.model_name||o.source||'Заказ')}</option>`).join('');
  if([...select.options].some(o=>o.value===current))select.value=current;
}

$('invoiceOrder').addEventListener('change',()=>{const o=state.orders.find(x=>x.id===$('invoiceOrder').value);if(!o)return;if(!$('amount').value)$('amount').value=Number(o.total||0);if(!$('description').value.trim())$('description').value=o.model_name||o.source||`Заказ №${o.order_number}`});
$('customerForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!canManage())return;const b=$('saveCustomer');b.disabled=true;$('saveMsg').textContent='Сохранение…';$('saveMsg').className='cf-msg';
  const payload={updated_at:new Date().toISOString()};fields.forEach(f=>payload[f]=$(f).value.trim?($(f).value.trim()||null):$(f).value);payload.full_name=$('full_name').value.trim();payload.customer_type=$('customer_type').value;
  try{const {error}=await supabase.from('customers').update(payload).eq('id',id);if(error)throw error;$('saveMsg').className='cf-msg success';$('saveMsg').textContent='Сохранено ✓';await load(true)}
  catch(error){$('saveMsg').className='cf-msg error';$('saveMsg').textContent=error.message||String(error)}finally{b.disabled=false}
});
$('invoiceForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!canManage())return;const b=$('createInvoice');b.disabled=true;$('invoiceMsg').textContent='Создание…';$('invoiceMsg').className='cf-msg';
  try{const {data,error}=await supabase.rpc('create_customer_invoice',{p_customer_id:id,p_amount:Number($('amount').value),p_description:$('description').value.trim(),p_due_date:$('due_date').value||null,p_order_id:$('invoiceOrder').value||null});if(error)throw error;$('invoiceMsg').className='cf-msg success';$('invoiceMsg').innerHTML=`Счёт создан ✓ · <a class="cf-link" href="./invoice.html?id=${encodeURIComponent(data)}">открыть</a>`;e.currentTarget.reset();await load(true)}
  catch(error){$('invoiceMsg').className='cf-msg error';$('invoiceMsg').textContent=error.message||String(error)}finally{b.disabled=false}
});
$('refresh').addEventListener('click',()=>load(true));
function initRealtime(){if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>load(true),650)};let ch=supabase.channel(`customer-profile-v2-${id}`);for(const table of ['customers','orders','payments','customer_documents','pos_sales'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);state.channel=ch.subscribe();window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true})}
await load();initRealtime();
