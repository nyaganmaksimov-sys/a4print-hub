import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const successStatuses=new Set(['PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED']);
const state={customerDocs:[],hubDocs:[],payments:[],customers:[],orders:[],roles:[],loading:false,channel:null};
let reloadTimer=null;

function canManage(){return state.roles.includes('ADMIN')||state.roles.includes('MANAGER')}
function paymentOk(x){return successStatuses.has(String(x.status||'').toUpperCase())}
function customerOf(id){return state.customers.find(x=>x.id===id)||null}
function orderOf(id){return state.orders.find(x=>x.id===id)||null}
function customerName(id){const c=customerOf(id);return c?.company_name||c?.full_name||'Клиент не указан'}
function fmtDate(v){if(!v)return'—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('ru-RU'):'—'}
function paidFor(docId){return state.payments.filter(x=>x.customer_document_id===docId&&paymentOk(x)).reduce((s,x)=>s+Number(x.amount||0),0)}
function outstanding(doc){return Math.max(0,Number(doc.amount||0)-paidFor(doc.id))}
function overdue(doc){return Boolean(doc.due_date)&&outstanding(doc)>0&&!['PAID','CANCELLED','ARCHIVED'].includes(String(doc.status||'').toUpperCase())&&new Date(doc.due_date+'T23:59:59').getTime()<Date.now()}
function tone(status,late=false){if(late)return'red';const s=String(status||'').toUpperCase();if(s==='PAID'||s==='SIGNED'||s==='ACTIVE'||s==='APPROVED')return'green';if(s==='CANCELLED'||s==='TERMINATED'||s==='EXPIRED')return'red';if(s==='ISSUED'||s==='PENDING_APPROVAL')return'orange';return'blue'}

async function load(){
  if(state.loading)return;state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';
  try{
    const [customerDocs,hubDocs,payments,customers,orders,roles]=await Promise.all([
      supabase.from('customer_documents').select('*').order('created_at',{ascending:false}).limit(3000),
      supabase.from('documents').select('id,document_number,title,status,business_unit,customer_id,order_id,issue_date,valid_until,notes,metadata,created_at').order('created_at',{ascending:false}).limit(3000),
      supabase.from('payments').select('id,customer_document_id,status,amount').limit(5000),
      supabase.from('customers').select('id,full_name,company_name').order('full_name'),
      supabase.from('orders').select('id,order_number,customer_id,total,status,model_name,source').order('created_at',{ascending:false}).limit(3000),
      supabase.rpc('get_my_roles')
    ]);
    for(const r of [customerDocs,hubDocs,payments,customers,orders])if(r.error)throw r.error;
    state.customerDocs=customerDocs.data||[];state.hubDocs=hubDocs.data||[];state.payments=payments.data||[];state.customers=customers.data||[];state.orders=orders.data||[];state.roles=Array.isArray(roles.data)?roles.data:[];
    $('createInvoice').hidden=!canManage();fillCustomerOptions();render();$('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){console.error('Documents load failed',error);$('list').innerHTML=`<div class="cf-empty error">Ошибка загрузки: ${esc(error.message||error)}</div>`}
  finally{state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить'}
}

function allRows(){
  const invoices=state.customerDocs.map(d=>({...d,kind:'INVOICE',source:'Счёт клиенту',sortDate:d.created_at,displayAmount:Number(d.amount||0)}));
  const hub=state.hubDocs.map(d=>({...d,kind:'HUB',source:'Документ HUB',sortDate:d.created_at,displayAmount:Number(d.metadata?.amount||0)}));
  return [...invoices,...hub].sort((a,b)=>new Date(b.sortDate)-new Date(a.sortDate));
}
function renderStats(){
  const rows=allRows();const invoices=state.customerDocs.filter(x=>String(x.status||'').toUpperCase()!=='CANCELLED');
  $('docsCount').textContent=rows.length;$('invoiceCount').textContent=state.customerDocs.length;$('issuedTotal').textContent=money(invoices.reduce((s,x)=>s+Number(x.amount||0),0));$('overdueTotal').textContent=money(state.customerDocs.filter(overdue).reduce((s,x)=>s+outstanding(x),0));
}
function filtered(){
  const q=$('search').value.trim().toLowerCase(),source=$('sourceFilter').value,status=$('statusFilter').value;
  return allRows().filter(d=>{const c=customerOf(d.customer_id),o=orderOf(d.order_id);const text=[d.document_number,d.title,d.description,d.notes,c?.full_name,c?.company_name,o?.order_number].filter(Boolean).join(' ').toLowerCase();if(q&&!text.includes(q))return false;if(source&&d.kind!==source)return false;if(status&&String(d.status||'').toUpperCase()!==status)return false;return true})
}
function invoiceRow(d){const c=customerOf(d.customer_id),o=orderOf(d.order_id),paid=paidFor(d.id),left=outstanding(d),late=overdue(d);return `<div class="cf-row"><div class="cf-main"><b><a class="cf-link" href="./invoice.html?id=${encodeURIComponent(d.id)}">${esc(d.document_number||'Счёт')}</a> <span class="cf-badge ${tone(d.status,late)}">${late?'ПРОСРОЧЕН':esc(d.status||'ISSUED')}</span></b><small>${esc(d.title||d.description||'Счёт на оплату')} · ${esc(fmtDate(d.issue_date))}${d.due_date?' · оплатить до '+esc(fmtDate(d.due_date)):''}</small></div><div class="cf-cell"><span>Клиент / заказ</span><b>${c?`<a class="cf-link" href="./customer.html?id=${encodeURIComponent(c.id)}">${esc(customerName(c.id))}</a>`:'—'}</b><small class="cf-note">${o?`заказ №${esc(o.order_number)}`:'без заказа'}</small></div><div class="cf-cell"><span>Оплачено / остаток</span><b>${money(paid)} / ${money(left)}</b><small class="cf-note">сумма счёта ${money(d.amount)}</small></div><div class="cf-row-actions"><span class="cf-badge blue">Счёт</span><a class="primary" href="./invoice.html?id=${encodeURIComponent(d.id)}">Открыть →</a></div></div>`}
function hubRow(d){const c=customerOf(d.customer_id),o=orderOf(d.order_id);return `<div class="cf-row"><div class="cf-main"><b>${esc(d.document_number||'—')} <span class="cf-badge ${tone(d.status)}">${esc(d.status||'DRAFT')}</span></b><small>${esc(d.title||'Документ HUB')} · ${esc(fmtDate(d.issue_date||d.created_at))}</small></div><div class="cf-cell"><span>Клиент / заказ</span><b>${c?`<a class="cf-link" href="./customer.html?id=${encodeURIComponent(c.id)}">${esc(customerName(c.id))}</a>`:'—'}</b><small class="cf-note">${o?`заказ №${esc(o.order_number)}`:'без заказа'}</small></div><div class="cf-cell"><span>Сумма / срок</span><b>${d.displayAmount?money(d.displayAmount):'—'}</b><small class="cf-note">${d.valid_until?'до '+esc(fmtDate(d.valid_until)):'срок не указан'}</small></div><div class="cf-row-actions"><span class="cf-badge">HUB</span>${o?`<a href="./order.html?id=${encodeURIComponent(o.id)}">Заказ →</a>`:''}</div></div>`}
function render(){renderStats();const rows=filtered();$('visibleCount').textContent=`${rows.length} из ${allRows().length}`;$('list').innerHTML=rows.map(d=>d.kind==='INVOICE'?invoiceRow(d):hubRow(d)).join('')||'<div class="cf-empty">Документов по выбранным условиям нет</div>'}

function fillCustomerOptions(){const current=$('invoiceCustomer').value;$('invoiceCustomer').innerHTML='<option value="">Выберите клиента</option>'+state.customers.map(c=>`<option value="${c.id}">${esc(c.company_name||c.full_name||'Клиент')}</option>`).join('');if([...$('invoiceCustomer').options].some(o=>o.value===current))$('invoiceCustomer').value=current;fillOrderOptions()}
function fillOrderOptions(){const customerId=$('invoiceCustomer').value,current=$('invoiceOrder').value;const orders=state.orders.filter(o=>(!customerId||o.customer_id===customerId)&&o.status!=='CANCELLED');$('invoiceOrder').innerHTML='<option value="">Без заказа</option>'+orders.map(o=>`<option value="${o.id}">№${esc(o.order_number)} · ${money(o.total)} · ${esc(o.model_name||o.source||'Заказ')}</option>`).join('');if([...$('invoiceOrder').options].some(o=>o.value===current))$('invoiceOrder').value=current}
function openInvoice(){if(!canManage())return;$('invoiceForm').reset();$('invoiceError').textContent='';fillCustomerOptions();$('invoiceDlg').showModal()}
$('createInvoice').addEventListener('click',openInvoice);$('closeInvoiceDlg').addEventListener('click',()=>$('invoiceDlg').close());$('invoiceCustomer').addEventListener('change',fillOrderOptions);$('invoiceOrder').addEventListener('change',()=>{const o=orderOf($('invoiceOrder').value);if(!o)return;if(o.customer_id){$('invoiceCustomer').value=o.customer_id;fillOrderOptions();$('invoiceOrder').value=o.id}if(!$('invoiceAmount').value)$('invoiceAmount').value=Number(o.total||0);if(!$('invoiceDescription').value.trim())$('invoiceDescription').value=o.model_name||o.source||`Заказ №${o.order_number}`});
$('invoiceForm').addEventListener('submit',async e=>{e.preventDefault();if(!canManage())return;const b=$('saveInvoice');b.disabled=true;$('invoiceError').textContent='';const customerId=$('invoiceCustomer').value;if(!customerId){$('invoiceError').textContent='Выберите клиента.';b.disabled=false;return}try{const {data,error}=await supabase.rpc('create_customer_invoice',{p_customer_id:customerId,p_amount:Number($('invoiceAmount').value),p_description:$('invoiceDescription').value.trim(),p_due_date:$('invoiceDue').value||null,p_order_id:$('invoiceOrder').value||null});if(error)throw error;$('invoiceDlg').close();await load();if(data)location.href=`./invoice.html?id=${encodeURIComponent(data)}`}catch(error){$('invoiceError').textContent=error.message||String(error)}finally{b.disabled=false}});
$('refresh').addEventListener('click',load);$('search').addEventListener('input',render);$('sourceFilter').addEventListener('change',render);$('statusFilter').addEventListener('change',render);$('clearFilters').addEventListener('click',()=>{$('search').value='';$('sourceFilter').value='';$('statusFilter').value='';render()});
function initRealtime(){if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(load,650)};let ch=supabase.channel('documents-workspace-v2');for(const table of ['customer_documents','documents','payments','customers','orders'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);state.channel=ch.subscribe();window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true})}
await load();initRealtime();
