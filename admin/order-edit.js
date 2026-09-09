import {supabase} from './guard.js?v=20260905-netfix1';

const orderId=new URLSearchParams(location.search).get('id');
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=value=>Number(value||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const state={roles:[],order:null,customers:[],catalog:[],items:[],saving:false};
const canManage=()=>state.roles.includes('ADMIN')||state.roles.includes('MANAGER');

function createDialog(){
  if($('editOrderDlg'))return;
  const dialog=document.createElement('dialog');
  dialog.id='editOrderDlg';
  dialog.className='order-edit-dialog';
  dialog.innerHTML=`
    <form id="editOrderForm" class="order-edit-form">
      <div class="order-edit-head">
        <div><h3>Редактировать заказ</h3><p id="editOrderSubtitle">Изменение заказчика, параметров и позиций заказа</p></div>
        <button id="closeEditOrder" class="order-edit-close" type="button" aria-label="Закрыть">×</button>
      </div>
      <div class="order-edit-body">
        <div class="order-edit-grid">
          <label class="order-edit-field"><span>Клиент</span><select id="editOrderCustomer"></select></label>
          <label class="order-edit-field"><span>Направление</span><select id="editOrderUnit"><option value="A4_PRINT">А4-Принт</option><option value="3D_ARTPRINT">3D-ARTPRINT</option><option value="COMMON">Общее</option></select></label>
          <label class="order-edit-field"><span>Источник</span><input id="editOrderSource" placeholder="Офис, телефон, сайт..."></label>
          <label class="order-edit-field"><span>Работа / модель</span><input id="editOrderModel" placeholder="Название работы или модели"></label>
          <label class="order-edit-field full"><span>Комментарий заказчика</span><textarea id="editOrderCustomerComment" placeholder="Пожелания, параметры, срок"></textarea></label>
          <label class="order-edit-field full"><span>Внутренний комментарий</span><textarea id="editOrderInternalComment" placeholder="Комментарий только для сотрудников HUB"></textarea></label>
        </div>
        <div id="editOrderFinanceWarning" class="order-edit-finance-warning"></div>
        <div class="order-edit-items-section">
          <div class="order-edit-items-head"><b>Позиции заказа</b><button id="addEditOrderItem" class="order-edit-add-item" type="button">+ Добавить позицию</button></div>
          <div class="order-edit-items-columns"><span>Наименование</span><span>Количество</span><span>Цена, ₽</span><span>Сумма</span><span></span></div>
          <div id="editOrderItems" class="order-edit-items"></div>
          <datalist id="orderEditCatalogList"></datalist>
          <div class="order-edit-total"><span>Итого по заказу</span><b id="editOrderTotal">0 ₽</b></div>
        </div>
        <div id="editOrderError" class="order-edit-error"></div>
      </div>
      <div class="order-edit-foot">
        <small>Статус заказа меняется отдельными кнопками в карточке. Файлы заказа сохраняются без изменений.</small>
        <div class="order-edit-foot-actions"><button id="cancelEditOrder" type="button">Отмена</button><button id="saveEditOrder" class="primary" type="submit">Сохранить изменения</button></div>
      </div>
    </form>`;
  document.body.appendChild(dialog);

  $('closeEditOrder').addEventListener('click',()=>dialog.close());
  $('cancelEditOrder').addEventListener('click',()=>dialog.close());
  $('addEditOrderItem').addEventListener('click',()=>{state.items.push({name:'',quantity:1,unit_price:0,product_id:null,service_id:null,parameters:{}});renderItems();focusLastItem()});
  $('editOrderItems').addEventListener('input',onItemInput);
  $('editOrderItems').addEventListener('change',onItemChange);
  $('editOrderItems').addEventListener('click',onItemClick);
  $('editOrderForm').addEventListener('submit',saveOrder);
}

function addEditButton(){
  if($('editOrderBtn'))return;
  const direction=$('orderDirection');
  const head=direction?.closest('.order-card-head');
  if(!head)return;
  const wrap=document.createElement('div');
  wrap.className='order-card-head-actions';
  direction.parentNode.insertBefore(wrap,direction);
  wrap.appendChild(direction);
  const button=document.createElement('button');
  button.id='editOrderBtn';
  button.type='button';
  button.className='order-edit-open';
  button.textContent='✎ Редактировать заказ';
  wrap.insertBefore(button,direction);
  button.addEventListener('click',openEditor);
}

async function loadRoles(){
  try{
    const {data,error}=await supabase.rpc('get_my_roles');
    if(error)throw error;
    state.roles=Array.isArray(data)?data.map(String):[];
  }catch(error){
    console.warn('Order editor roles unavailable',error);
    state.roles=Array.isArray(window.__A4_CURRENT_ROLES__)?window.__A4_CURRENT_ROLES__.map(String):[];
  }
}

async function loadEditorData(){
  const [orderR,customersR,catalogR,docsR,paymentsR]=await Promise.all([
    supabase.from('orders').select('id,order_number,business_unit,customer_id,status,total,customer_comment,internal_comment,source,model_name,partner_id,fulfillment_partner_id,order_items(id,product_id,service_id,name,quantity,unit_price,total_price,parameters)').eq('id',orderId).single(),
    supabase.from('customers').select('id,full_name,company_name,phone,email').order('full_name',{ascending:true}).limit(2000),
    supabase.from('catalog_items').select('id,name,sale_price,is_active').eq('is_active',true).order('name',{ascending:true}).limit(2000),
    supabase.from('customer_documents').select('id',{count:'exact',head:true}).eq('order_id',orderId),
    supabase.from('payments').select('id',{count:'exact',head:true}).eq('order_id',orderId)
  ]);
  if(orderR.error)throw orderR.error;
  if(customersR.error)throw customersR.error;
  if(catalogR.error)console.warn('Order editor catalog unavailable',catalogR.error);
  state.order=orderR.data;
  state.customers=customersR.data||[];
  state.catalog=catalogR.data||[];
  state.items=(state.order.order_items||[]).map(item=>({
    id:item.id,
    product_id:item.product_id||null,
    service_id:item.service_id||null,
    name:item.name||'',
    quantity:Number(item.quantity||1),
    unit_price:Number(item.unit_price||0),
    parameters:item.parameters&&typeof item.parameters==='object'?item.parameters:{}
  }));
  if(!state.items.length)state.items=[{name:'',quantity:1,unit_price:0,product_id:null,service_id:null,parameters:{}}];
  return {docs:Number(docsR.count||0),payments:Number(paymentsR.count||0)};
}

function renderCustomerOptions(){
  const select=$('editOrderCustomer');
  const partner=Boolean(state.order?.partner_id||state.order?.fulfillment_partner_id);
  select.innerHTML=`<option value="">${partner?'Партнёрский заказ — клиент не используется':'Без привязки к клиенту'}</option>`+state.customers.map(customer=>{
    const name=customer.company_name||customer.full_name||'Клиент';
    const meta=customer.phone||customer.email||'';
    return `<option value="${esc(customer.id)}">${esc(name)}${meta?' · '+esc(meta):''}</option>`;
  }).join('');
  select.value=state.order?.customer_id||'';
  select.disabled=partner;
  select.title=partner?'У партнёрского заказа контрагент задаётся партнёрским контуром':'';
}

function renderCatalog(){
  $('orderEditCatalogList').innerHTML=state.catalog.map(item=>`<option value="${esc(item.name)}">${item.sale_price!=null?money(item.sale_price):''}</option>`).join('');
}

function renderItems(){
  const node=$('editOrderItems');
  node.innerHTML=state.items.map((item,index)=>{
    const line=Number(item.quantity||0)*Number(item.unit_price||0);
    return `<div class="order-edit-item" data-edit-index="${index}">
      <input data-edit-name list="orderEditCatalogList" value="${esc(item.name)}" placeholder="Услуга или товар" aria-label="Наименование позиции ${index+1}">
      <input data-edit-qty type="number" min="0.001" step="0.001" value="${Number(item.quantity||0)}" aria-label="Количество позиции ${index+1}">
      <input data-edit-price type="number" min="0" step="0.01" value="${Number(item.unit_price||0)}" aria-label="Цена позиции ${index+1}">
      <div class="order-edit-item-total" data-edit-line-total>${money(line)}</div>
      <button data-remove-edit-item class="order-edit-remove-item" type="button" aria-label="Удалить позицию" ${state.items.length<=1?'disabled':''}>×</button>
    </div>`;
  }).join('');
  recalcTotal();
}

function recalcTotal(){
  let total=0;
  document.querySelectorAll('#editOrderItems .order-edit-item').forEach((row,index)=>{
    const qty=Math.max(0,Number(row.querySelector('[data-edit-qty]')?.value||0));
    const price=Math.max(0,Number(row.querySelector('[data-edit-price]')?.value||0));
    total+=qty*price;
    const line=row.querySelector('[data-edit-line-total]');if(line)line.textContent=money(qty*price);
    if(state.items[index]){state.items[index].quantity=qty;state.items[index].unit_price=price}
  });
  $('editOrderTotal').textContent=money(total);
}

function onItemInput(event){
  const row=event.target.closest('[data-edit-index]');if(!row)return;
  const index=Number(row.dataset.editIndex);const item=state.items[index];if(!item)return;
  if(event.target.matches('[data-edit-name]'))item.name=event.target.value;
  if(event.target.matches('[data-edit-qty]'))item.quantity=Number(event.target.value||0);
  if(event.target.matches('[data-edit-price]'))item.unit_price=Number(event.target.value||0);
  recalcTotal();
}

function onItemChange(event){
  if(!event.target.matches('[data-edit-name]'))return;
  const row=event.target.closest('[data-edit-index]');if(!row)return;
  const index=Number(row.dataset.editIndex);const item=state.items[index];if(!item)return;
  const value=event.target.value.trim().toLowerCase();
  const match=state.catalog.find(entry=>String(entry.name||'').trim().toLowerCase()===value);
  if(match){
    item.name=match.name;
    item.unit_price=Number(match.sale_price||0);
    event.target.value=match.name;
    const price=row.querySelector('[data-edit-price]');if(price)price.value=String(item.unit_price);
    recalcTotal();
  }
}

function onItemClick(event){
  const button=event.target.closest('[data-remove-edit-item]');if(!button||state.items.length<=1)return;
  const row=button.closest('[data-edit-index]');if(!row)return;
  state.items.splice(Number(row.dataset.editIndex),1);renderItems();
}

function focusLastItem(){
  requestAnimationFrame(()=>document.querySelector('#editOrderItems .order-edit-item:last-child [data-edit-name]')?.focus());
}

async function openEditor(){
  if(!canManage()||!orderId||state.saving)return;
  const button=$('editOrderBtn');button.disabled=true;const old=button.textContent;button.textContent='Загрузка…';
  $('editOrderError').textContent='';$('editOrderError').classList.remove('ok');
  try{
    const financial=await loadEditorData();
    const order=state.order;
    renderCustomerOptions();renderCatalog();renderItems();
    $('editOrderUnit').value=order.business_unit||'COMMON';
    $('editOrderSource').value=order.source||'';
    $('editOrderModel').value=order.model_name||'';
    $('editOrderCustomerComment').value=order.customer_comment||'';
    $('editOrderInternalComment').value=order.internal_comment||'';
    $('editOrderSubtitle').textContent=`Заказ №${order.order_number??'—'} · ${order.status||'—'}`;
    const warning=$('editOrderFinanceWarning');
    if(financial.docs||financial.payments){
      warning.classList.add('show');
      warning.textContent=`У заказа уже есть финансовые операции: счетов — ${financial.docs}, оплат — ${financial.payments}. Изменение стоимости заказа не меняет уже созданные счета и платежи.`;
    }else{warning.classList.remove('show');warning.textContent=''}
    $('editOrderDlg').showModal();
  }catch(error){
    console.error('Order editor load failed',error);
    alert(`Не удалось открыть редактирование заказа: ${error.message||error}`);
  }finally{button.disabled=false;button.textContent=old}
}

function collectItems(){
  return [...document.querySelectorAll('#editOrderItems .order-edit-item')].map((row,index)=>{
    const original=state.items[index]||{};
    return {
      product_id:original.product_id||null,
      service_id:original.service_id||null,
      name:row.querySelector('[data-edit-name]')?.value.trim()||'',
      quantity:Number(row.querySelector('[data-edit-qty]')?.value||0),
      unit_price:Number(row.querySelector('[data-edit-price]')?.value||0),
      parameters:original.parameters&&typeof original.parameters==='object'?original.parameters:{}
    };
  });
}

async function saveOrder(event){
  event.preventDefault();
  if(!canManage()||state.saving||!state.order)return;
  const errorNode=$('editOrderError');errorNode.textContent='';errorNode.classList.remove('ok');
  const items=collectItems();
  if(!items.length){errorNode.textContent='Добавьте хотя бы одну позицию.';return}
  for(let index=0;index<items.length;index++){
    const item=items[index];
    if(!item.name){errorNode.textContent=`Укажите наименование позиции ${index+1}.`;return}
    if(!(item.quantity>0)){errorNode.textContent=`Количество в позиции ${index+1} должно быть больше нуля.`;return}
    if(item.unit_price<0){errorNode.textContent=`Цена в позиции ${index+1} не может быть отрицательной.`;return}
  }

  const button=$('saveEditOrder');state.saving=true;button.disabled=true;button.textContent='Сохранение…';
  try{
    const partner=Boolean(state.order.partner_id||state.order.fulfillment_partner_id);
    const {error}=await supabase.rpc('update_hub_order_details',{
      p_order_id:orderId,
      p_customer_id:partner?(state.order.customer_id||null):($('editOrderCustomer').value||null),
      p_business_unit:$('editOrderUnit').value,
      p_source:$('editOrderSource').value.trim()||null,
      p_model_name:$('editOrderModel').value.trim()||null,
      p_customer_comment:$('editOrderCustomerComment').value.trim()||null,
      p_internal_comment:$('editOrderInternalComment').value.trim()||null,
      p_items:items
    });
    if(error)throw error;
    errorNode.classList.add('ok');errorNode.textContent='Изменения сохранены.';
    button.textContent='Сохранено ✓';
    setTimeout(()=>location.reload(),350);
  }catch(error){
    console.error('Order save failed',error);
    const msg=String(error?.message||error);
    errorNode.textContent=msg.includes('ACCESS_DENIED')?'Недостаточно прав для редактирования заказа.':`Не удалось сохранить заказ: ${msg}`;
    button.disabled=false;button.textContent='Сохранить изменения';state.saving=false;
  }
}

async function init(){
  if(!orderId)return;
  createDialog();
  await loadRoles();
  if(!canManage())return;
  addEditButton();
}

init();
