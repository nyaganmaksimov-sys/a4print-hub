import { supabase } from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2});
const state={roles:[],customers:[],catalog:[],loaded:false,patchTimer:null};
const canManage=()=>state.roles.includes('ADMIN')||state.roles.includes('MANAGER');

function normalizeRoles(data){
  if(Array.isArray(data))return data.map(String);
  if(Array.isArray(window.__A4_CURRENT_ROLES__))return window.__A4_CURRENT_ROLES__.map(String);
  return [];
}

async function loadRoles(){
  const note=$('roleNote'),btn=$('newOrderBtn');
  try{
    const {data,error}=await supabase.rpc('get_my_roles');
    if(error)throw error;
    state.roles=normalizeRoles(data);
  }catch(error){
    console.warn('Orders roles unavailable',error);
    state.roles=normalizeRoles(null);
  }
  const allowed=canManage();
  if(btn)btn.hidden=!allowed;
  if(note)note.innerHTML=allowed?'<b>ADMIN / MANAGER</b> · можно создавать и менять заказы':'Только просмотр заказов';
  syncStatusControls();
}

function syncStatusControls(){
  const allowed=canManage();
  document.querySelectorAll('[data-order-status]').forEach(select=>{
    select.disabled=!allowed;
    select.title=allowed?'Изменить статус заказа':'Изменение статуса доступно ADMIN / MANAGER';
  });
}

async function loadReferenceData(){
  if(state.loaded)return;
  const [customersR,catalogR]=await Promise.all([
    supabase.from('customers').select('id,full_name,company_name,phone,email').order('full_name',{ascending:true}).limit(1000),
    supabase.from('catalog_items').select('id,name,sku,category,item_type,sale_price,is_active').eq('is_active',true).order('name',{ascending:true}).limit(1500)
  ]);
  if(customersR.error)throw customersR.error;
  if(catalogR.error)console.warn('Catalog for order creation unavailable',catalogR.error);
  state.customers=customersR.data||[];
  state.catalog=catalogR.data||[];
  state.loaded=true;
  renderCustomerOptions();
  renderCatalogOptions();
}

function renderCustomerOptions(){
  const select=$('newOrderCustomer');if(!select)return;
  select.innerHTML='<option value="">Без привязки к клиенту</option><option value="__NEW__">＋ Новый клиент</option>'+state.customers.map(c=>{
    const name=c.company_name||c.full_name||'Клиент';
    const meta=c.phone||c.email||'';
    return `<option value="${c.id}">${name}${meta?' · '+meta:''}</option>`;
  }).join('');
}

function renderCatalogOptions(){
  const list=$('orderCatalogList');if(!list)return;
  list.innerHTML=state.catalog.map(item=>`<option value="${String(item.name||'').replace(/"/g,'&quot;')}">${item.category||item.item_type||''}${item.sale_price!=null?' · '+money(item.sale_price)+' ₽':''}</option>`).join('');
}

function toggleNewCustomer(){
  const wrap=$('newOrderCustomerFields');
  if(wrap)wrap.hidden=$('newOrderCustomer')?.value!=='__NEW__';
}

function recalc(){
  const qty=Math.max(0,Number($('newOrderQty')?.value||0));
  const price=Math.max(0,Number($('newOrderPrice')?.value||0));
  if($('newOrderTotal'))$('newOrderTotal').value=`${money(qty*price)} ₽`;
}

function applyCatalogPrice(){
  const value=$('newOrderItem')?.value.trim().toLowerCase();
  if(!value)return;
  const item=state.catalog.find(x=>String(x.name||'').trim().toLowerCase()===value);
  if(item&&$('newOrderPrice')){
    $('newOrderPrice').value=Number(item.sale_price||0);
    recalc();
  }
}

async function openDialog(){
  if(!canManage())return;
  const dlg=$('newOrderDlg');if(!dlg)return;
  $('newOrderError').textContent='';
  try{
    await loadReferenceData();
    $('newOrderCustomer').value='';
    $('newOrderCustomerName').value='';
    $('newOrderCustomerPhone').value='';
    $('newOrderUnit').value='A4_PRINT';
    $('newOrderItem').value='';
    $('newOrderQty').value='1';
    $('newOrderPrice').value='0';
    $('newOrderSource').value='Офис';
    $('newOrderComment').value='';
    toggleNewCustomer();recalc();
    dlg.showModal();
    setTimeout(()=>$('newOrderCustomer')?.focus(),0);
  }catch(error){
    console.error(error);
    alert(`Не удалось подготовить форму заказа: ${error.message||error}`);
  }
}

async function submitOrder(event){
  event.preventDefault();
  if(!canManage())return;
  const save=$('saveNewOrder'),errorNode=$('newOrderError');
  errorNode.textContent='';
  const customerChoice=$('newOrderCustomer').value;
  const itemName=$('newOrderItem').value.trim();
  const qty=Number($('newOrderQty').value||0);
  const price=Number($('newOrderPrice').value||0);
  if(!itemName){errorNode.textContent='Укажите услугу или товар.';return}
  if(!(qty>0)){errorNode.textContent='Количество должно быть больше нуля.';return}
  if(price<0){errorNode.textContent='Цена не может быть отрицательной.';return}
  const newCustomer=customerChoice==='__NEW__';
  const customerName=newCustomer?$('newOrderCustomerName').value.trim():'';
  if(newCustomer&&!customerName){errorNode.textContent='Укажите имя нового клиента.';return}

  save.disabled=true;save.textContent='Создание…';
  try{
    const {data,error}=await supabase.rpc('create_hub_manual_order',{
      p_customer_id:customerChoice&&customerChoice!=='__NEW__'?customerChoice:null,
      p_customer_name:newCustomer?customerName:null,
      p_customer_phone:newCustomer?($('newOrderCustomerPhone').value.trim()||null):null,
      p_business_unit:$('newOrderUnit').value,
      p_item_name:itemName,
      p_quantity:qty,
      p_unit_price:price,
      p_comment:$('newOrderComment').value.trim()||null,
      p_source:$('newOrderSource').value||'Офис'
    });
    if(error)throw error;
    const result=Array.isArray(data)?data[0]:data;
    $('newOrderDlg').close();
    if(result?.id){location.href=`./order.html?id=${encodeURIComponent(result.id)}`;return}
    location.reload();
  }catch(error){
    console.error(error);
    const msg=String(error.message||error);
    errorNode.textContent=msg.includes('ACCESS_DENIED')?'Недостаточно прав для создания заказа.':`Не удалось создать заказ: ${msg}`;
  }finally{
    save.disabled=false;save.textContent='Создать заказ';
  }
}

async function patchVisibleItemTitles(){
  clearTimeout(state.patchTimer);
  state.patchTimer=setTimeout(async()=>{
    const rows=[...document.querySelectorAll('[data-order-id]')];
    const ids=[...new Set(rows.map(r=>r.dataset.orderId).filter(Boolean))];
    if(!ids.length)return;
    try{
      const {data,error}=await supabase.from('order_items').select('order_id,name,created_at').in('order_id',ids).order('created_at',{ascending:true});
      if(error)throw error;
      const first=new Map();
      for(const item of data||[])if(!first.has(item.order_id))first.set(item.order_id,item.name);
      for(const row of rows){
        const name=first.get(row.dataset.orderId);
        const node=row.querySelector('.order-service b');
        if(name&&node)node.textContent=name;
      }
    }catch(error){console.warn('Order item titles unavailable',error)}
  },120);
}

function bind(){
  $('newOrderBtn')?.addEventListener('click',openDialog);
  $('newOrderForm')?.addEventListener('submit',submitOrder);
  $('closeNewOrder')?.addEventListener('click',()=>$('newOrderDlg')?.close());
  $('cancelNewOrder')?.addEventListener('click',()=>$('newOrderDlg')?.close());
  $('newOrderCustomer')?.addEventListener('change',toggleNewCustomer);
  $('newOrderItem')?.addEventListener('change',applyCatalogPrice);
  $('newOrderItem')?.addEventListener('blur',applyCatalogPrice);
  $('newOrderQty')?.addEventListener('input',recalc);
  $('newOrderPrice')?.addEventListener('input',recalc);
  const list=$('list');
  if(list){
    const observer=new MutationObserver(()=>{syncStatusControls();patchVisibleItemTitles()});
    observer.observe(list,{childList:true,subtree:true});
  }
}

bind();
await loadRoles();
patchVisibleItemTitles();
if(new URLSearchParams(location.search).get('new')==='1'&&canManage())openDialog();
