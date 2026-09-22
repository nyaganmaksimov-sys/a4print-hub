import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const successStatuses=new Set(['PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED']);
const initialRoles=Array.isArray(window.__A4_CURRENT_ROLES__)?[...window.__A4_CURRENT_ROLES__]:[];
const state={
  payments:[],metrics:null,roles:initialRoles,organizationId:null,profileId:null,
  loading:false,reloadQueued:false,channel:null,page:1,pageSize:50,total:0,autoOpened:false,
  refs:{customers:[],orders:[],docs:[],docPayments:[],customersLoaded:false,loading:false}
};
let reloadTimer=null,searchTimer=null;

function canManage(){return state.roles.includes('ADMIN')||state.roles.includes('MANAGER')}
function isSuccess(x){return successStatuses.has(String(x?.status||'').toUpperCase())}
function statusTone(status){const s=String(status||'').toUpperCase();return successStatuses.has(s)?'green':s==='CANCELLED'||s==='FAILED'||s==='REFUNDED'?'red':'orange'}
function fmtDate(v){if(!v)return'—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'}
function currentFilters(){return{q:$('search')?.value.trim()||'',status:$('statusFilter')?.value||'',method:$('methodFilter')?.value||''}}
function syncUrl(){
  const f=currentFilters(),url=new URL(location.href);
  ['q','status','method','page'].forEach(k=>url.searchParams.delete(k));
  if(f.q)url.searchParams.set('q',f.q);if(f.status)url.searchParams.set('status',f.status);if(f.method)url.searchParams.set('method',f.method);
  if(state.page>1)url.searchParams.set('page',String(state.page));
  for(const key of ['customer','document','order']){const value=new URLSearchParams(location.search).get(key);if(value)url.searchParams.set(key,value)}
  history.replaceState(null,'',url.pathname+url.search);
}

async function initContext(){
  const {data:{session}}=await supabase.auth.getSession();
  const [roles,profile,organization]=await Promise.all([
    state.roles.length?Promise.resolve({data:state.roles,error:null}):supabase.rpc('get_my_roles'),
    session?.user?.id?supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle():Promise.resolve({data:null,error:null}),
    supabase.rpc('current_user_organization_id')
  ]);
  if(!roles.error&&Array.isArray(roles.data))state.roles=roles.data.map(String);
  if(organization.error)console.warn('Current organization unavailable',organization.error);
  state.organizationId=organization.data||null;
  state.profileId=profile.data?.id||null;
}

async function loadPage(){
  const f=currentFilters();
  const {data,error}=await supabase.rpc('get_payments_workspace_page',{
    p_query:f.q,p_status:f.status,p_method:f.method,p_page:state.page,p_page_size:state.pageSize
  });
  if(error)throw error;
  const rows=Array.isArray(data)?data:[];
  return{rows,total:rows.length?Number(rows[0].total_count||0):0};
}
async function loadMetrics(){
  const {data,error}=await supabase.rpc('get_payments_workspace_metrics');
  if(error)throw error;
  return Array.isArray(data)?(data[0]||null):data;
}
function renderStats(){
  const m=state.metrics||{};
  $('paymentsCount').textContent=state.metrics?Number(m.payments_count||0):'—';
  $('confirmedTotal').textContent=state.metrics?money(m.confirmed_total||0):'—';
  $('pendingTotal').textContent=state.metrics?money(m.pending_total||0):'—';
  $('unlinkedCount').textContent=state.metrics?Number(m.unlinked_count||0):'—';
}
function statusSelect(p){return canManage()?`<select data-payment-status="${p.id}" class="finance-status-select"><option value="PENDING" ${p.status==='PENDING'?'selected':''}>Ожидается</option><option value="PAID" ${p.status==='PAID'?'selected':''}>Оплачен</option><option value="CANCELLED" ${p.status==='CANCELLED'?'selected':''}>Отменён</option><option value="REFUNDED" ${p.status==='REFUNDED'?'selected':''}>Возвращён</option></select>`:`<span class="cf-badge ${statusTone(p.status)}">${esc(p.status||'PENDING')}</span>`}
function row(p){
  const customer=p.customer_company_name||p.customer_full_name||'Клиент не указан';
  const link=p.customer_document_id?`Счёт ${p.document_number||'—'}`:p.order_id?`Заказ №${p.order_number??'—'}`:'Без привязки';
  return `<div class="cf-row">
    <div class="cf-main"><b>${esc(p.payment_number||'Платёж')}</b><small>${esc(fmtDate(p.paid_at||p.created_at))} · ${esc(p.payment_method||'способ не указан')}</small></div>
    <div class="cf-cell"><span>Клиент</span><b>${p.customer_id?`<a class="cf-link" href="./customer.html?id=${encodeURIComponent(p.customer_id)}">${esc(customer)}</a>`:'—'}</b></div>
    <div class="cf-cell"><span>Привязка</span><b>${p.customer_document_id?`<a class="cf-link" href="./invoice.html?id=${encodeURIComponent(p.customer_document_id)}">${esc(link)}</a>`:p.order_id?`<a class="cf-link" href="./order.html?id=${encodeURIComponent(p.order_id)}">${esc(link)}</a>`:esc(link)}</b></div>
    <div class="cf-row-actions"><strong>${money(p.amount)}</strong>${statusSelect(p)}</div>
  </div>`;
}
function renderPager(){
  const pages=Math.max(1,Math.ceil(state.total/state.pageSize)),pager=$('paymentsPager');if(!pager)return;
  pager.hidden=state.total<=state.pageSize;$('paymentsPageLabel').textContent=`Страница ${state.page} из ${pages}`;
  $('paymentsPrevPage').disabled=state.page<=1;$('paymentsNextPage').disabled=state.page>=pages;
}
function render(){
  syncUrl();renderStats();$('visibleCount').textContent=`${state.payments.length} на странице · всего ${state.total}`;
  $('list').innerHTML=state.payments.map(row).join('')||'<div class="cf-empty">Платежей по выбранным условиям нет</div>';renderPager();
}
function renderLoading(){$('list').innerHTML='<div class="finance-loading-list"><div class="a4-skeleton"></div><div class="a4-skeleton"></div><div class="a4-skeleton"></div></div>'}
function renderError(error){$('list').innerHTML=`<div class="a4-error"><b>Не удалось загрузить оплаты</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="paymentsRetry" class="a4-btn" type="button" style="margin-top:10px">Повторить</button></div>`;$('paymentsRetry')?.addEventListener('click',()=>load(true))}

async function load(force=false){
  if(state.loading){if(force)state.reloadQueued=true;return}
  state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';if(!state.payments.length)renderLoading();
  try{
    const [pageR,metricsR]=await Promise.allSettled([loadPage(),loadMetrics()]);
    if(pageR.status==='rejected')throw pageR.reason;
    state.payments=pageR.value.rows;state.total=pageR.value.total;
    if(!state.payments.length&&state.page>1){state.page=Math.max(1,state.page-1);state.loading=false;return load(true)}
    if(metricsR.status==='fulfilled')state.metrics=metricsR.value;else console.warn('Payments metrics unavailable',metricsR.reason);
    $('addPayment').hidden=!canManage();render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
    if(!state.autoOpened)void autoOpenFromUrl();
  }catch(error){console.error('Payments load failed',error);renderError(error);$('updatedAt').textContent='ошибка загрузки'}
  finally{state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить';if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>load(),0)}}
}

function customerOption(c){return `<option value="${c.id}">${esc(c.company_name||c.full_name||'Клиент')}</option>`}
async function ensureCustomers(selectedId=''){
  if(state.refs.customersLoaded){
    if(selectedId&&!state.refs.customers.some(c=>c.id===selectedId)){
      const {data}=await supabase.from('customers').select('id,full_name,company_name,phone,email').eq('id',selectedId).maybeSingle();
      if(data)state.refs.customers.push(data);
    }
    return;
  }
  const {data,error}=await supabase.from('customers').select('id,full_name,company_name,phone,email').order('full_name',{ascending:true}).limit(500);
  if(error)throw error;state.refs.customers=data||[];state.refs.customersLoaded=true;
  if(selectedId&&!state.refs.customers.some(c=>c.id===selectedId)){
    const extra=await supabase.from('customers').select('id,full_name,company_name,phone,email').eq('id',selectedId).maybeSingle();
    if(extra.data)state.refs.customers.push(extra.data);
  }
}
function docPaid(docId){return state.refs.docPayments.filter(p=>p.customer_document_id===docId&&isSuccess(p)).reduce((s,p)=>s+Number(p.amount||0),0)}
function docOutstanding(doc){return Math.max(0,Number(doc?.amount||0)-docPaid(doc?.id))}
function renderReferenceOptions(customerId='',orderId='',documentId=''){
  const customer=$('paymentCustomer'),order=$('paymentOrder'),doc=$('paymentDocument');
  customer.innerHTML='<option value="">Клиент не выбран</option>'+state.refs.customers.map(customerOption).join('');
  if(customerId&&[...customer.options].some(o=>o.value===customerId))customer.value=customerId;
  order.innerHTML='<option value="">Без заказа</option>'+state.refs.orders.map(o=>`<option value="${o.id}">№${esc(o.order_number)} · ${money(o.total)} · ${esc(o.model_name||o.source||'Заказ')}</option>`).join('');
  doc.innerHTML='<option value="">Без счёта</option>'+state.refs.docs.map(d=>`<option value="${d.id}">${esc(d.document_number||'Счёт')} · остаток ${money(docOutstanding(d))}</option>`).join('');
  if(orderId&&[...order.options].some(o=>o.value===orderId))order.value=orderId;
  if(documentId&&[...doc.options].some(o=>o.value===documentId))doc.value=documentId;
}
async function loadLinkedReferences(customerId='',documentId='',orderId=''){
  if(state.refs.loading)return;
  state.refs.loading=true;const save=$('savePayment');save.disabled=true;
  try{
    let targetCustomer=customerId,targetOrder=orderId,targetDocument=documentId,specificDoc=null,specificOrder=null;
    if(targetDocument){
      const r=await supabase.from('customer_documents').select('id,customer_id,order_id,document_number,status,title,amount,due_date,issue_date').eq('id',targetDocument).maybeSingle();
      if(r.error)throw r.error;specificDoc=r.data||null;if(specificDoc){targetCustomer=targetCustomer||specificDoc.customer_id||'';targetOrder=targetOrder||specificDoc.order_id||''}
    }
    if(targetOrder){
      const r=await supabase.from('orders').select('id,order_number,customer_id,status,total,model_name,source,created_at').eq('id',targetOrder).maybeSingle();
      if(r.error)throw r.error;specificOrder=r.data||null;if(specificOrder)targetCustomer=targetCustomer||specificOrder.customer_id||'';
    }
    await ensureCustomers(targetCustomer);
    if(targetCustomer){
      const [ordersR,docsR]=await Promise.all([
        supabase.from('orders').select('id,order_number,customer_id,status,total,model_name,source,created_at').eq('customer_id',targetCustomer).or('source.is.null,source.neq.KASSA').order('created_at',{ascending:false}).limit(100),
        supabase.from('customer_documents').select('id,customer_id,order_id,document_number,status,title,amount,due_date,issue_date').eq('customer_id',targetCustomer).neq('status','CANCELLED').order('created_at',{ascending:false}).limit(100)
      ]);
      if(ordersR.error)throw ordersR.error;if(docsR.error)throw docsR.error;
      state.refs.orders=ordersR.data||[];state.refs.docs=docsR.data||[];
    }else{state.refs.orders=[];state.refs.docs=[]}
    if(specificOrder&&!state.refs.orders.some(x=>x.id===specificOrder.id))state.refs.orders.unshift(specificOrder);
    if(specificDoc&&!state.refs.docs.some(x=>x.id===specificDoc.id))state.refs.docs.unshift(specificDoc);
    const ids=state.refs.docs.map(d=>d.id);
    if(ids.length){
      const payR=await supabase.from('payments').select('id,customer_document_id,status,amount').in('customer_document_id',ids);
      if(payR.error)throw payR.error;state.refs.docPayments=payR.data||[];
    }else state.refs.docPayments=[];
    renderReferenceOptions(targetCustomer,targetOrder,targetDocument);
    return{customerId:targetCustomer,order:specificOrder,document:specificDoc};
  }finally{state.refs.loading=false;save.disabled=false}
}

async function openPayment(customerId='',documentId='',orderId=''){
  if(!canManage())return;
  $('paymentForm').reset();$('paymentError').textContent='';$('paymentStatus').value='PAID';$('paymentMethod').value='Банк';$('paymentDate').value=new Date().toISOString().slice(0,16);
  $('paymentCustomer').innerHTML='<option value="">Загрузка клиентов…</option>';$('paymentDocument').innerHTML='<option value="">Загрузка счетов…</option>';$('paymentOrder').innerHTML='<option value="">Загрузка заказов…</option>';
  $('paymentDlg').showModal();
  try{
    const result=await loadLinkedReferences(customerId,documentId,orderId);
    if(result.document){$('paymentAmount').value=docOutstanding(result.document)}
    else if(result.order&&!documentId)$('paymentAmount').value=Number(result.order.total||0).toFixed(2);
  }catch(error){console.error('Payment references unavailable',error);$('paymentError').textContent='Не удалось загрузить справочники: '+(error.message||error)}
}
async function autoOpenFromUrl(){
  if(state.autoOpened||!canManage())return;const p=new URLSearchParams(location.search),customer=p.get('customer')||'',documentId=p.get('document')||'',orderId=p.get('order')||'';
  if(customer||documentId||orderId){state.autoOpened=true;await openPayment(customer,documentId,orderId)}
}

function resetPageAndLoad(){state.page=1;void load(true)}
function initParams(){
  const p=new URLSearchParams(location.search);if(p.get('q'))$('search').value=p.get('q');
  for(const [id,key] of [['statusFilter','status'],['methodFilter','method']]){const v=p.get(key),el=$(id);if(el&&v&&[...el.options].some(o=>o.value===v))el.value=v}
  const page=Number(p.get('page')||1);state.page=Number.isInteger(page)&&page>0?page:1;
}
function bind(){
  $('addPayment').addEventListener('click',()=>openPayment());$('closePaymentDlg').addEventListener('click',()=>$('paymentDlg').close());$('refresh').addEventListener('click',()=>load(true));
  $('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(resetPageAndLoad,280)});
  $('statusFilter').addEventListener('change',resetPageAndLoad);$('methodFilter').addEventListener('change',resetPageAndLoad);
  $('clearFilters').addEventListener('click',()=>{$('search').value='';$('statusFilter').value='';$('methodFilter').value='';resetPageAndLoad()});
  $('paymentsPrevPage')?.addEventListener('click',()=>{if(state.page>1){state.page--;void load(true)}});
  $('paymentsNextPage')?.addEventListener('click',()=>{const pages=Math.max(1,Math.ceil(state.total/state.pageSize));if(state.page<pages){state.page++;void load(true)}});
  $('paymentCustomer').addEventListener('change',async()=>{try{await loadLinkedReferences($('paymentCustomer').value)}catch(error){$('paymentError').textContent=error.message||String(error)}});
  $('paymentOrder').addEventListener('change',()=>{const o=state.refs.orders.find(x=>x.id===$('paymentOrder').value);if(o&&!$('paymentAmount').value)$('paymentAmount').value=Number(o.total||0)});
  $('paymentDocument').addEventListener('change',()=>{const d=state.refs.docs.find(x=>x.id===$('paymentDocument').value);if(!d)return;if(d.order_id&&[...$('paymentOrder').options].some(o=>o.value===d.order_id))$('paymentOrder').value=d.order_id;$('paymentAmount').value=docOutstanding(d)});
  $('paymentForm').addEventListener('submit',submitPayment);
  document.addEventListener('change',changePaymentStatus);
}
async function submitPayment(e){
  e.preventDefault();if(!canManage())return;const b=$('savePayment');b.disabled=true;$('paymentError').textContent='';
  const status=$('paymentStatus').value,amount=Number($('paymentAmount').value);
  if(!(amount>0)){$('paymentError').textContent='Сумма должна быть больше нуля.';b.disabled=false;return}
  if(!state.organizationId){$('paymentError').textContent='Не определена организация текущего сотрудника.';b.disabled=false;return}
  const payload={organization_id:state.organizationId,customer_id:$('paymentCustomer').value||null,order_id:$('paymentOrder').value||null,customer_document_id:$('paymentDocument').value||null,payment_type:'INCOME',status,amount,currency:'RUB',payment_method:$('paymentMethod').value||null,paid_at:isSuccess({status})?new Date($('paymentDate').value||Date.now()).toISOString():null,note:$('paymentNote').value.trim()||null,created_by:state.profileId,updated_at:new Date().toISOString()};
  try{const {data,error}=await supabase.from('payments').insert(payload).select('id,payment_number').single();if(error)throw error;$('paymentDlg').close();await load(true);if(data?.payment_number)$('updatedAt').textContent=`создан ${data.payment_number}`}
  catch(error){$('paymentError').textContent=error.message||String(error)}finally{b.disabled=false}
}
async function changePaymentStatus(e){
  const s=e.target.closest('[data-payment-status]');if(!s||!canManage())return;const p=state.payments.find(x=>x.id===s.dataset.paymentStatus);if(!p)return;
  const prev=p.status,next=s.value;s.disabled=true;const payload={status:next,updated_at:new Date().toISOString()};if(isSuccess({status:next})&&!p.paid_at)payload.paid_at=new Date().toISOString();
  try{const {error}=await supabase.from('payments').update(payload).eq('id',p.id);if(error)throw error;await load(true)}
  catch(error){s.value=prev;window.A4Feedback?.error?.('Не удалось изменить статус',error.message||String(error))}finally{s.disabled=false}
}
function initRealtime(){
  if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>load(true),450)};
  let ch=supabase.channel('payments-workspace-v3');
  for(const table of ['payments','customers','orders','customer_documents'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);
  state.channel=ch.subscribe();window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true});
}

await initContext();initParams();bind();await load();initRealtime();
