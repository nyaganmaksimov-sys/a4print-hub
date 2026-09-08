import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const successStatuses=new Set(['PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED']);
const state={payments:[],customers:[],orders:[],docs:[],roles:[],organizationId:null,profileId:null,loading:false,channel:null,autoOpened:false};
let reloadTimer=null;

function canManage(){return state.roles.includes('ADMIN')||state.roles.includes('MANAGER')}
function isSuccess(x){return successStatuses.has(String(x.status||'').toUpperCase())}
function customerOf(id){return state.customers.find(x=>x.id===id)||null}
function orderOf(id){return state.orders.find(x=>x.id===id)||null}
function docOf(id){return state.docs.find(x=>x.id===id)||null}
function customerName(id){const c=customerOf(id);return c?.company_name||c?.full_name||'Клиент не указан'}
function fmtDate(v){if(!v)return'—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'}
function docPaid(docId,ignorePaymentId=''){return state.payments.filter(x=>x.id!==ignorePaymentId&&x.customer_document_id===docId&&isSuccess(x)).reduce((s,x)=>s+Number(x.amount||0),0)}
function docOutstanding(doc){return Math.max(0,Number(doc?.amount||0)-docPaid(doc?.id))}
function statusTone(status){const s=String(status||'').toUpperCase();return successStatuses.has(s)?'green':s==='CANCELLED'||s==='FAILED'||s==='REFUNDED'?'red':'orange'}

async function initContext(){
  const {data:{session}}=await supabase.auth.getSession();
  const [roles,org,profile]=await Promise.all([
    supabase.rpc('get_my_roles'),
    supabase.from('organizations').select('id').eq('code','A4PRINT').maybeSingle(),
    session?.user?.id?supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle():Promise.resolve({data:null})
  ]);
  state.roles=Array.isArray(roles.data)?roles.data:[];state.organizationId=org.data?.id||null;state.profileId=profile.data?.id||null;
}

async function load(){
  if(state.loading)return;state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';
  try{
    const [payments,customers,orders,docs]=await Promise.all([
      supabase.from('payments').select('*').order('created_at',{ascending:false}).limit(5000),
      supabase.from('customers').select('id,full_name,company_name,phone,email').order('full_name'),
      supabase.from('orders').select('id,order_number,customer_id,status,total,model_name,source,created_at').order('created_at',{ascending:false}).limit(3000),
      supabase.from('customer_documents').select('id,customer_id,order_id,document_number,status,title,amount,due_date,issue_date').order('created_at',{ascending:false}).limit(3000)
    ]);
    for(const r of [payments,customers,orders,docs])if(r.error)throw r.error;
    state.payments=payments.data||[];state.customers=customers.data||[];state.orders=orders.data||[];state.docs=docs.data||[];
    $('addPayment').hidden=!canManage();fillCustomerOptions();render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
    autoOpenFromUrl();
  }catch(error){console.error('Payments load failed',error);$('list').innerHTML=`<div class="cf-empty error">Ошибка загрузки: ${esc(error.message||error)}</div>`}
  finally{state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить'}
}

function renderStats(){
  const confirmed=state.payments.filter(isSuccess);const pending=state.payments.filter(x=>!isSuccess(x)&&!['CANCELLED','FAILED','REFUNDED'].includes(String(x.status||'').toUpperCase()));
  $('paymentsCount').textContent=state.payments.length;$('confirmedTotal').textContent=money(confirmed.reduce((s,x)=>s+Number(x.amount||0),0));$('pendingTotal').textContent=money(pending.reduce((s,x)=>s+Number(x.amount||0),0));$('unlinkedCount').textContent=state.payments.filter(x=>!x.order_id&&!x.customer_document_id).length;
}
function filtered(){
  const q=$('search').value.trim().toLowerCase(),status=$('statusFilter').value,method=$('methodFilter').value;
  return state.payments.filter(p=>{
    const c=customerOf(p.customer_id),o=orderOf(p.order_id),d=docOf(p.customer_document_id);const text=[p.payment_number,p.note,p.payment_method,p.status,c?.full_name,c?.company_name,o?.order_number,d?.document_number].filter(Boolean).join(' ').toLowerCase();
    if(q&&!text.includes(q))return false;if(status&&String(p.status||'').toUpperCase()!==status)return false;if(method&&p.payment_method!==method)return false;return true;
  });
}
function statusSelect(p){return canManage()?`<select data-payment-status="${p.id}" style="min-height:32px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;padding:0 7px;font-size:10px;font-weight:800"><option value="PENDING" ${p.status==='PENDING'?'selected':''}>Ожидается</option><option value="PAID" ${p.status==='PAID'?'selected':''}>Оплачен</option><option value="CANCELLED" ${p.status==='CANCELLED'?'selected':''}>Отменён</option><option value="REFUNDED" ${p.status==='REFUNDED'?'selected':''}>Возвращён</option></select>`:`<span class="cf-badge ${statusTone(p.status)}">${esc(p.status||'PENDING')}</span>`}
function row(p){
  const c=customerOf(p.customer_id),o=orderOf(p.order_id),d=docOf(p.customer_document_id);const link=d?`Счёт ${d.document_number||'—'}`:o?`Заказ №${o.order_number}`:'Без привязки';
  return `<div class="cf-row"><div class="cf-main"><b>${esc(p.payment_number||'Платёж')}</b><small>${esc(fmtDate(p.paid_at||p.created_at))} · ${esc(p.payment_method||'способ не указан')}</small></div><div class="cf-cell"><span>Клиент</span><b>${c?`<a class="cf-link" href="./customer.html?id=${encodeURIComponent(c.id)}">${esc(customerName(c.id))}</a>`:'—'}</b></div><div class="cf-cell"><span>Привязка</span><b>${d?`<a class="cf-link" href="./invoice.html?id=${encodeURIComponent(d.id)}">${esc(link)}</a>`:o?`<a class="cf-link" href="./order.html?id=${encodeURIComponent(o.id)}">${esc(link)}</a>`:esc(link)}</b></div><div class="cf-row-actions"><strong style="margin-right:4px">${money(p.amount)}</strong>${statusSelect(p)}</div></div>`;
}
function render(){renderStats();const rows=filtered();$('visibleCount').textContent=`${rows.length} из ${state.payments.length}`;$('list').innerHTML=rows.map(row).join('')||'<div class="cf-empty">Платежей по выбранным условиям нет</div>'}

function fillCustomerOptions(){
  const current=$('paymentCustomer').value;$('paymentCustomer').innerHTML='<option value="">Клиент не выбран</option>'+state.customers.map(c=>`<option value="${c.id}">${esc(c.company_name||c.full_name||'Клиент')}</option>`).join('');if([...$('paymentCustomer').options].some(o=>o.value===current))$('paymentCustomer').value=current;refreshLinkedOptions();
}
function refreshLinkedOptions(){
  const customerId=$('paymentCustomer').value;const orderCurrent=$('paymentOrder').value,docCurrent=$('paymentDocument').value;
  const orders=state.orders.filter(o=>!customerId||o.customer_id===customerId);const docs=state.docs.filter(d=>(!customerId||d.customer_id===customerId)&&String(d.status||'').toUpperCase()!=='CANCELLED');
  $('paymentOrder').innerHTML='<option value="">Без заказа</option>'+orders.map(o=>`<option value="${o.id}">№${esc(o.order_number)} · ${money(o.total)} · ${esc(o.model_name||o.source||'Заказ')}</option>`).join('');
  $('paymentDocument').innerHTML='<option value="">Без счёта</option>'+docs.map(d=>`<option value="${d.id}">${esc(d.document_number||'Счёт')} · остаток ${money(docOutstanding(d))}</option>`).join('');
  if([...$('paymentOrder').options].some(o=>o.value===orderCurrent))$('paymentOrder').value=orderCurrent;if([...$('paymentDocument').options].some(o=>o.value===docCurrent))$('paymentDocument').value=docCurrent;
}
function openPayment(customerId='',documentId=''){
  if(!canManage())return;$('paymentForm').reset();$('paymentError').textContent='';$('paymentStatus').value='PAID';$('paymentMethod').value='Банк';$('paymentDate').value=new Date().toISOString().slice(0,16);fillCustomerOptions();if(customerId&&[...$('paymentCustomer').options].some(o=>o.value===customerId))$('paymentCustomer').value=customerId;refreshLinkedOptions();
  const d=docOf(documentId);if(d){$('paymentCustomer').value=d.customer_id||customerId||'';refreshLinkedOptions();$('paymentDocument').value=d.id;if(d.order_id)$('paymentOrder').value=d.order_id;$('paymentAmount').value=docOutstanding(d)}
  $('paymentDlg').showModal();
}
function autoOpenFromUrl(){if(state.autoOpened||!canManage())return;const p=new URLSearchParams(location.search),customer=p.get('customer')||'',documentId=p.get('document')||'';if(customer||documentId){state.autoOpened=true;openPayment(customer,documentId)}}

$('addPayment').addEventListener('click',()=>openPayment());$('closePaymentDlg').addEventListener('click',()=>$('paymentDlg').close());$('refresh').addEventListener('click',load);$('search').addEventListener('input',render);$('statusFilter').addEventListener('change',render);$('methodFilter').addEventListener('change',render);$('clearFilters').addEventListener('click',()=>{$('search').value='';$('statusFilter').value='';$('methodFilter').value='';render()});
$('paymentCustomer').addEventListener('change',refreshLinkedOptions);
$('paymentOrder').addEventListener('change',()=>{const o=orderOf($('paymentOrder').value);if(o?.customer_id&&$('paymentCustomer').value!==o.customer_id){$('paymentCustomer').value=o.customer_id;refreshLinkedOptions();$('paymentOrder').value=o.id}if(o&&!$('paymentAmount').value)$('paymentAmount').value=Number(o.total||0)});
$('paymentDocument').addEventListener('change',()=>{const d=docOf($('paymentDocument').value);if(!d)return;$('paymentCustomer').value=d.customer_id||'';refreshLinkedOptions();$('paymentDocument').value=d.id;if(d.order_id)$('paymentOrder').value=d.order_id;$('paymentAmount').value=docOutstanding(d)});
$('paymentForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!canManage())return;const b=$('savePayment');b.disabled=true;$('paymentError').textContent='';const status=$('paymentStatus').value;const amount=Number($('paymentAmount').value);
  if(!(amount>0)){$('paymentError').textContent='Сумма должна быть больше нуля.';b.disabled=false;return}
  const payload={organization_id:state.organizationId,customer_id:$('paymentCustomer').value||null,order_id:$('paymentOrder').value||null,customer_document_id:$('paymentDocument').value||null,payment_type:'INCOME',status,amount,currency:'RUB',payment_method:$('paymentMethod').value||null,paid_at:isSuccess({status})?new Date($('paymentDate').value||Date.now()).toISOString():null,note:$('paymentNote').value.trim()||null,created_by:state.profileId,updated_at:new Date().toISOString()};
  try{const {data,error}=await supabase.from('payments').insert(payload).select('id,payment_number').single();if(error)throw error;$('paymentDlg').close();await load();window.setTimeout(()=>{if(data?.payment_number)$('updatedAt').textContent=`создан ${data.payment_number}`},50)}catch(error){$('paymentError').textContent=error.message||String(error)}finally{b.disabled=false}
});
document.addEventListener('change',async e=>{const s=e.target.closest('[data-payment-status]');if(!s||!canManage())return;const p=state.payments.find(x=>x.id===s.dataset.paymentStatus);if(!p)return;const prev=p.status,next=s.value;s.disabled=true;const payload={status:next,updated_at:new Date().toISOString()};if(isSuccess({status:next})&&!p.paid_at)payload.paid_at=new Date().toISOString();try{const {error}=await supabase.from('payments').update(payload).eq('id',p.id);if(error)throw error;Object.assign(p,payload);await load()}catch(error){s.value=prev;window.alert(`Не удалось изменить статус: ${error.message||error}`)}finally{s.disabled=false}});
function initRealtime(){if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(load,650)};let ch=supabase.channel('payments-workspace-v2');for(const table of ['payments','customers','orders','customer_documents'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);state.channel=ch.subscribe();window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true})}
await initContext();await load();initRealtime();
