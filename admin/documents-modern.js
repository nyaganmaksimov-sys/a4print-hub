import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const initialRoles=Array.isArray(window.__A4_CURRENT_ROLES__)?[...window.__A4_CURRENT_ROLES__]:[];
const state={rows:[],metrics:null,roles:initialRoles,loading:false,reloadQueued:false,channel:null,page:1,pageSize:50,total:0,refs:{customers:[],orders:[],customersLoaded:false,loading:false}};
let reloadTimer=null,searchTimer=null;

function canManage(){return state.roles.includes('ADMIN')||state.roles.includes('MANAGER')}
function fmtDate(v){if(!v)return'—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('ru-RU'):'—'}
function tone(status,late=false){if(late)return'red';const s=String(status||'').toUpperCase();if(s==='PAID'||s==='SIGNED'||s==='ACTIVE'||s==='APPROVED')return'green';if(s==='CANCELLED'||s==='TERMINATED'||s==='EXPIRED')return'red';if(s==='ISSUED'||s==='PENDING_APPROVAL')return'orange';return'blue'}
function currentFilters(){return{q:$('search')?.value.trim()||'',source:$('sourceFilter')?.value||'',status:$('statusFilter')?.value||''}}
function syncUrl(){
  const f=currentFilters(),url=new URL(location.href);['q','source','status','page'].forEach(k=>url.searchParams.delete(k));
  if(f.q)url.searchParams.set('q',f.q);if(f.source)url.searchParams.set('source',f.source);if(f.status)url.searchParams.set('status',f.status);if(state.page>1)url.searchParams.set('page',String(state.page));
  history.replaceState(null,'',url.pathname+url.search);
}
async function loadPage(){
  const f=currentFilters();
  const {data,error}=await supabase.rpc('get_documents_workspace_page',{p_query:f.q,p_source:f.source,p_status:f.status,p_page:state.page,p_page_size:state.pageSize});
  if(error)throw error;const rows=Array.isArray(data)?data:[];return{rows,total:rows.length?Number(rows[0].total_count||0):0};
}
async function loadMetrics(){
  const {data,error}=await supabase.rpc('get_documents_workspace_metrics');if(error)throw error;return Array.isArray(data)?(data[0]||null):data;
}
function renderStats(){
  const m=state.metrics||{};
  $('docsCount').textContent=state.metrics?Number(m.docs_count||0):'—';
  $('invoiceCount').textContent=state.metrics?Number(m.invoice_count||0):'—';
  $('issuedTotal').textContent=state.metrics?money(m.issued_total||0):'—';
  $('overdueTotal').textContent=state.metrics?money(m.overdue_total||0):'—';
}
function invoiceRow(d){
  const customer=d.customer_company_name||d.customer_full_name||'Клиент не указан';
  return `<div class="cf-row">
    <div class="cf-main"><b><a class="cf-link" href="./invoice.html?id=${encodeURIComponent(d.id)}">${esc(d.document_number||'Счёт')}</a> <span class="cf-badge ${tone(d.status,d.is_overdue)}">${d.is_overdue?'ПРОСРОЧЕН':esc(d.status||'ISSUED')}</span></b><small>${esc(d.title||d.description||'Счёт на оплату')} · ${esc(fmtDate(d.issue_date))}${d.due_date?' · оплатить до '+esc(fmtDate(d.due_date)):''}</small></div>
    <div class="cf-cell"><span>Клиент / заказ</span><b>${d.customer_id?`<a class="cf-link" href="./customer.html?id=${encodeURIComponent(d.customer_id)}">${esc(customer)}</a>`:'—'}</b><small class="cf-note">${d.order_id?`заказ №${esc(d.order_number??'—')}`:'без заказа'}</small></div>
    <div class="cf-cell"><span>Оплачено / остаток</span><b>${money(d.paid_amount)} / ${money(d.outstanding_amount)}</b><small class="cf-note">сумма счёта ${money(d.display_amount)}</small></div>
    <div class="cf-row-actions"><span class="cf-badge blue">Счёт</span><a class="primary" href="./invoice.html?id=${encodeURIComponent(d.id)}">Открыть →</a></div>
  </div>`;
}
function hubRow(d){
  const customer=d.customer_company_name||d.customer_full_name||'Клиент не указан';
  return `<div class="cf-row">
    <div class="cf-main"><b>${esc(d.document_number||'—')} <span class="cf-badge ${tone(d.status)}">${esc(d.status||'DRAFT')}</span></b><small>${esc(d.title||'Документ HUB')} · ${esc(fmtDate(d.issue_date||d.created_at))}</small></div>
    <div class="cf-cell"><span>Клиент / заказ</span><b>${d.customer_id?`<a class="cf-link" href="./customer.html?id=${encodeURIComponent(d.customer_id)}">${esc(customer)}</a>`:'—'}</b><small class="cf-note">${d.order_id?`заказ №${esc(d.order_number??'—')}`:'без заказа'}</small></div>
    <div class="cf-cell"><span>Сумма / срок</span><b>${Number(d.display_amount||0)?money(d.display_amount):'—'}</b><small class="cf-note">${d.valid_until?'до '+esc(fmtDate(d.valid_until)):'срок не указан'}</small></div>
    <div class="cf-row-actions"><span class="cf-badge">HUB</span>${d.order_id?`<a href="./order.html?id=${encodeURIComponent(d.order_id)}">Заказ →</a>`:''}</div>
  </div>`;
}
function renderPager(){
  const pages=Math.max(1,Math.ceil(state.total/state.pageSize)),pager=$('documentsPager');if(!pager)return;
  pager.hidden=state.total<=state.pageSize;$('documentsPageLabel').textContent=`Страница ${state.page} из ${pages}`;
  $('documentsPrevPage').disabled=state.page<=1;$('documentsNextPage').disabled=state.page>=pages;
}
function render(){
  syncUrl();renderStats();$('visibleCount').textContent=`${state.rows.length} на странице · всего ${state.total}`;
  $('list').innerHTML=state.rows.map(d=>d.kind==='INVOICE'?invoiceRow(d):hubRow(d)).join('')||'<div class="cf-empty">Документов по выбранным условиям нет</div>';renderPager();
}
function renderLoading(){$('list').innerHTML='<div class="finance-loading-list"><div class="a4-skeleton"></div><div class="a4-skeleton"></div><div class="a4-skeleton"></div></div>'}
function renderError(error){$('list').innerHTML=`<div class="a4-error"><b>Не удалось загрузить документы</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="documentsRetry" class="a4-btn" type="button" style="margin-top:10px">Повторить</button></div>`;$('documentsRetry')?.addEventListener('click',()=>load(true))}

async function load(force=false){
  if(state.loading){if(force)state.reloadQueued=true;return}
  state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';if(!state.rows.length)renderLoading();
  try{
    const rolesPromise=state.roles.length?Promise.resolve({data:state.roles,error:null}):supabase.rpc('get_my_roles');
    const [pageR,metricsR,rolesR]=await Promise.allSettled([loadPage(),loadMetrics(),rolesPromise]);
    if(pageR.status==='rejected')throw pageR.reason;state.rows=pageR.value.rows;state.total=pageR.value.total;
    if(!state.rows.length&&state.page>1){state.page=Math.max(1,state.page-1);state.loading=false;return load(true)}
    if(metricsR.status==='fulfilled')state.metrics=metricsR.value;else console.warn('Documents metrics unavailable',metricsR.reason);
    if(rolesR.status==='fulfilled'&&!rolesR.value.error&&Array.isArray(rolesR.value.data))state.roles=rolesR.value.data.map(String);
    $('createInvoice').hidden=!canManage();render();$('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){console.error('Documents load failed',error);renderError(error);$('updatedAt').textContent='ошибка загрузки'}
  finally{state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить';if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>load(),0)}}
}

function customerOption(c){return `<option value="${c.id}">${esc(c.company_name||c.full_name||'Клиент')}</option>`}
async function ensureCustomers(){
  if(state.refs.customersLoaded)return;
  const {data,error}=await supabase.from('customers').select('id,full_name,company_name').order('full_name',{ascending:true}).limit(500);
  if(error)throw error;state.refs.customers=data||[];state.refs.customersLoaded=true;
}
function renderCustomerOptions(selected=''){
  $('invoiceCustomer').innerHTML='<option value="">Выберите клиента</option>'+state.refs.customers.map(customerOption).join('');
  if(selected&&[...$('invoiceCustomer').options].some(o=>o.value===selected))$('invoiceCustomer').value=selected;
}
async function loadOrdersForCustomer(customerId,selected=''){
  const select=$('invoiceOrder');select.innerHTML='<option value="">Загрузка заказов…</option>';state.refs.orders=[];
  if(!customerId){select.innerHTML='<option value="">Сначала выберите клиента</option>';return}
  const {data,error}=await supabase.from('orders').select('id,order_number,customer_id,total,status,model_name,source,created_at').eq('customer_id',customerId).or('source.is.null,source.neq.KASSA').neq('status','CANCELLED').order('created_at',{ascending:false}).limit(100);
  if(error)throw error;state.refs.orders=data||[];
  select.innerHTML='<option value="">Без заказа</option>'+state.refs.orders.map(o=>`<option value="${o.id}">№${esc(o.order_number)} · ${money(o.total)} · ${esc(o.model_name||o.source||'Заказ')}</option>`).join('');
  if(selected&&[...select.options].some(o=>o.value===selected))select.value=selected;
}
async function openInvoice(){
  if(!canManage())return;const dlg=$('invoiceDlg'),save=$('saveInvoice');
  $('invoiceForm').reset();$('invoiceError').textContent='';$('invoiceCustomer').innerHTML='<option value="">Загрузка клиентов…</option>';$('invoiceOrder').innerHTML='<option value="">Сначала выберите клиента</option>';save.disabled=true;dlg.showModal();
  try{await ensureCustomers();renderCustomerOptions();save.disabled=false}
  catch(error){console.error('Invoice refs unavailable',error);$('invoiceError').textContent='Не удалось загрузить клиентов: '+(error.message||error)}
}
async function submitInvoice(e){
  e.preventDefault();if(!canManage())return;const b=$('saveInvoice');b.disabled=true;$('invoiceError').textContent='';const customerId=$('invoiceCustomer').value;
  if(!customerId){$('invoiceError').textContent='Выберите клиента.';b.disabled=false;return}
  try{
    const {data,error}=await supabase.rpc('create_customer_invoice',{p_customer_id:customerId,p_amount:Number($('invoiceAmount').value),p_description:$('invoiceDescription').value.trim(),p_due_date:$('invoiceDue').value||null,p_order_id:$('invoiceOrder').value||null});
    if(error)throw error;$('invoiceDlg').close();if(data)location.href=`./invoice.html?id=${encodeURIComponent(data)}`;else await load(true)
  }catch(error){$('invoiceError').textContent=error.message||String(error)}finally{b.disabled=false}
}

function resetPageAndLoad(){state.page=1;void load(true)}
function initParams(){
  const p=new URLSearchParams(location.search);if(p.get('q'))$('search').value=p.get('q');
  for(const [id,key] of [['sourceFilter','source'],['statusFilter','status']]){const v=p.get(key),el=$(id);if(el&&v&&[...el.options].some(o=>o.value===v))el.value=v}
  const page=Number(p.get('page')||1);state.page=Number.isInteger(page)&&page>0?page:1;
}
function bind(){
  $('createInvoice').addEventListener('click',openInvoice);$('closeInvoiceDlg').addEventListener('click',()=>$('invoiceDlg').close());
  $('invoiceCustomer').addEventListener('change',async()=>{try{await loadOrdersForCustomer($('invoiceCustomer').value)}catch(error){$('invoiceError').textContent=error.message||String(error)}});
  $('invoiceOrder').addEventListener('change',()=>{const o=state.refs.orders.find(x=>x.id===$('invoiceOrder').value);if(!o)return;if(!$('invoiceAmount').value)$('invoiceAmount').value=Number(o.total||0);if(!$('invoiceDescription').value.trim())$('invoiceDescription').value=o.model_name||o.source||`Заказ №${o.order_number}`});
  $('invoiceForm').addEventListener('submit',submitInvoice);$('refresh').addEventListener('click',()=>load(true));
  $('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(resetPageAndLoad,280)});
  $('sourceFilter').addEventListener('change',resetPageAndLoad);$('statusFilter').addEventListener('change',resetPageAndLoad);
  $('clearFilters').addEventListener('click',()=>{$('search').value='';$('sourceFilter').value='';$('statusFilter').value='';resetPageAndLoad()});
  $('documentsPrevPage')?.addEventListener('click',()=>{if(state.page>1){state.page--;void load(true)}});
  $('documentsNextPage')?.addEventListener('click',()=>{const pages=Math.max(1,Math.ceil(state.total/state.pageSize));if(state.page<pages){state.page++;void load(true)}});
}
function initRealtime(){
  if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>load(true),450)};
  let ch=supabase.channel('documents-workspace-v3');for(const table of ['customer_documents','documents','payments','customers','orders'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);
  state.channel=ch.subscribe();window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true});
}

initParams();bind();await load();initRealtime();
