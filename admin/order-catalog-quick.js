import {supabase} from './guard.js?v=20260905-netfix1';

const money=value=>Number(value||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const API=String(window.A4PRINT_CONFIG?.apiBaseUrl||'').replace(/\/$/,'');
let activeContext=null;

function ensureStyle(){
  if(document.getElementById('orderCatalogQuickStyle'))return;
  const style=document.createElement('style');
  style.id='orderCatalogQuickStyle';
  style.textContent=`
    .order-edit-name-wrap,.order-create-quick-wrap{position:relative;min-width:0;width:100%}
    .order-edit-name-wrap>[data-edit-name],.order-create-quick-wrap>#newOrderItem{padding-right:94px!important}
    .order-catalog-quick-btn{position:absolute;right:5px;top:5px;height:28px;padding:0 8px;border:1px solid #bfdbfe;border-radius:7px;background:#eff6ff;color:#1d4ed8;font-size:9px;font-weight:850;cursor:pointer;white-space:nowrap;z-index:2}
    .order-catalog-quick-btn:hover{background:#dbeafe}.order-catalog-quick-btn[hidden]{display:none!important}
    .order-catalog-dialog{width:min(520px,calc(100vw - 28px));border:0;border-radius:18px;padding:0;background:#fff;box-shadow:0 30px 90px rgba(15,23,42,.35)}
    .order-catalog-dialog::backdrop{background:rgba(15,23,42,.56)}
    .order-catalog-form{display:grid}.order-catalog-head{padding:17px 19px 12px;border-bottom:1px solid #e8edf4}.order-catalog-head h3{margin:0;font-size:18px}.order-catalog-head p{margin:5px 0 0;color:#64748b;font-size:11px}
    .order-catalog-body{padding:15px 19px;display:grid;grid-template-columns:1fr 1fr;gap:11px}.order-catalog-field{display:grid;gap:5px}.order-catalog-field.full{grid-column:1/-1}.order-catalog-field span{font-size:10px;font-weight:850;color:#475569;text-transform:uppercase}.order-catalog-field input,.order-catalog-field select{width:100%;box-sizing:border-box;min-height:40px;padding:9px 10px;border:1px solid #d7dee9;border-radius:10px;background:#fff;color:#172033;font:inherit;font-size:12px}
    .order-catalog-hint{grid-column:1/-1;padding:9px 10px;border-radius:10px;background:#eff6ff;color:#1d4ed8;font-size:10px;line-height:1.45}.order-catalog-error{grid-column:1/-1;min-height:16px;color:#b91c1c;font-size:10px}
    .order-catalog-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 19px 17px;border-top:1px solid #e8edf4}.order-catalog-foot button{min-height:38px;padding:0 14px;border:1px solid #d7dee9;border-radius:10px;background:#fff;color:#334155;font-weight:850;cursor:pointer}.order-catalog-foot .primary{background:#2563eb;border-color:#2563eb;color:#fff}.order-catalog-foot button:disabled{opacity:.55;cursor:wait}
    @media(max-width:620px){.order-catalog-body{grid-template-columns:1fr}.order-catalog-field.full,.order-catalog-hint,.order-catalog-error{grid-column:auto}.order-edit-name-wrap>[data-edit-name],.order-create-quick-wrap>#newOrderItem{padding-right:78px!important}.order-catalog-quick-btn{font-size:0;width:34px}.order-catalog-quick-btn::after{content:'+';font-size:15px}}
  `;
  document.head.appendChild(style);
}

function catalogNames(){
  return new Set([...document.querySelectorAll('#orderEditCatalogList option,#orderCatalogList option')].map(o=>String(o.value||'').trim().toLowerCase()).filter(Boolean));
}

function nameExists(name){return catalogNames().has(String(name||'').trim().toLowerCase())}

function refreshQuickButton(row){
  const input=row?.querySelector('[data-edit-name]');
  const button=row?.querySelector('.order-catalog-quick-btn');
  if(!input||!button)return;
  const name=input.value.trim();button.hidden=!name||nameExists(name);
}

function enhanceRows(){
  document.querySelectorAll('#editOrderItems .order-edit-item').forEach(row=>{
    const input=row.querySelector('[data-edit-name]');
    if(!input)return;
    if(!input.closest('.order-edit-name-wrap')){
      const wrap=document.createElement('div');wrap.className='order-edit-name-wrap';
      input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);
      const button=document.createElement('button');button.type='button';button.className='order-catalog-quick-btn';button.textContent='+ В каталог';button.title='Добавить эту позицию в МойСклад и каталог HUB';wrap.appendChild(button);
    }
    refreshQuickButton(row);
  });
}

function refreshCreateQuickButton(){
  const input=document.getElementById('newOrderItem');const button=document.getElementById('newOrderCatalogQuickBtn');
  if(!input||!button)return;const name=input.value.trim();button.hidden=!name||nameExists(name);
}

function enhanceCreateField(){
  const input=document.getElementById('newOrderItem');if(!input)return;
  if(!input.closest('.order-create-quick-wrap')){
    const wrap=document.createElement('div');wrap.className='order-create-quick-wrap';
    input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);
    const button=document.createElement('button');button.id='newOrderCatalogQuickBtn';button.type='button';button.className='order-catalog-quick-btn';button.textContent='+ В каталог';button.title='Добавить эту услугу или товар в МойСклад и каталог HUB';wrap.appendChild(button);
  }
  refreshCreateQuickButton();
}

function ensureDialog(){
  if(document.getElementById('orderCatalogQuickDlg'))return;
  const dialog=document.createElement('dialog');dialog.id='orderCatalogQuickDlg';dialog.className='order-catalog-dialog';
  dialog.innerHTML=`<form id="orderCatalogQuickForm" class="order-catalog-form">
    <div class="order-catalog-head"><h3>Быстро добавить в каталог</h3><p>Позиция сначала создаётся в МойСклад, затем автоматически появляется в HUB и KASSA.</p></div>
    <div class="order-catalog-body">
      <label class="order-catalog-field"><span>Тип</span><select id="orderCatalogQuickType"><option value="SERVICE">Услуга</option><option value="PRODUCT">Товар</option></select></label>
      <label class="order-catalog-field"><span>Цена продажи, ₽</span><input id="orderCatalogQuickPrice" type="number" min="0" step="0.01" value="0"></label>
      <label class="order-catalog-field full"><span>Название</span><input id="orderCatalogQuickName" required placeholder="Название услуги или товара"></label>
      <label class="order-catalog-field"><span>Единица</span><select id="orderCatalogQuickUnit"><option value="шт">шт</option><option value="лист">лист</option><option value="м">м</option><option value="м²">м²</option><option value="мин">мин</option><option value="час">час</option></select></label>
      <label class="order-catalog-field"><span>Категория</span><input id="orderCatalogQuickCategory" placeholder="Например: Копирование"></label>
      <div class="order-catalog-hint"><b>МойСклад → HUB → KASSA.</b> В текущем заказе название и цена подставятся автоматически.</div>
      <div id="orderCatalogQuickError" class="order-catalog-error"></div>
    </div>
    <div class="order-catalog-foot"><button id="orderCatalogQuickCancel" type="button">Отмена</button><button id="orderCatalogQuickSave" class="primary" type="submit">Добавить в МойСклад</button></div>
  </form>`;
  document.body.appendChild(dialog);
  document.getElementById('orderCatalogQuickCancel').addEventListener('click',()=>dialog.close());
  document.getElementById('orderCatalogQuickForm').addEventListener('submit',saveCatalogItem);
}

function openQuickDialog(context){
  activeContext=context;ensureDialog();
  const name=context?.nameInput?.value.trim()||'';const price=Number(context?.priceInput?.value||0);
  document.getElementById('orderCatalogQuickName').value=name;
  document.getElementById('orderCatalogQuickPrice').value=String(Math.max(0,price));
  document.getElementById('orderCatalogQuickType').value='SERVICE';
  document.getElementById('orderCatalogQuickUnit').value='шт';
  document.getElementById('orderCatalogQuickCategory').value='';
  document.getElementById('orderCatalogQuickError').textContent='';
  document.getElementById('orderCatalogQuickDlg').showModal();
  setTimeout(()=>document.getElementById('orderCatalogQuickName')?.focus(),0);
}

function addOptionToLists(data){
  for(const id of ['orderEditCatalogList','orderCatalogList']){
    const list=document.getElementById(id);if(!list)continue;
    if([...list.options].some(option=>String(option.value||'').trim().toLowerCase()===String(data.name||'').trim().toLowerCase()))continue;
    const option=document.createElement('option');option.value=data.name;option.label=money(data.sale_price);list.appendChild(option);
  }
}

async function apiCreateCatalogItem(payload){
  if(!API)throw new Error('API HUB не настроен.');
  let {data,error}=await supabase.auth.getSession();
  if(error)throw error;
  let session=data?.session;
  if(!session?.access_token){const refreshed=await supabase.auth.refreshSession();if(refreshed.error)throw refreshed.error;session=refreshed.data?.session}
  if(!session?.access_token)throw new Error('Сессия истекла. Войдите в HUB заново.');
  const response=await fetch(`${API}/api/v1/pos/catalog/items`,{method:'POST',cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)});
  const text=await response.text();let body={};try{body=text?JSON.parse(text):{}}catch{}
  if(!response.ok)throw new Error(body.message||body.error||`HTTP ${response.status}`);
  return body;
}

async function saveCatalogItem(event){
  event.preventDefault();
  const name=document.getElementById('orderCatalogQuickName').value.trim();const type=document.getElementById('orderCatalogQuickType').value;
  const price=Math.max(0,Number(document.getElementById('orderCatalogQuickPrice').value||0));const unit=document.getElementById('orderCatalogQuickUnit').value||'шт';
  const category=document.getElementById('orderCatalogQuickCategory').value.trim()||null;const errorNode=document.getElementById('orderCatalogQuickError');const save=document.getElementById('orderCatalogQuickSave');
  if(!name){errorNode.textContent='Укажите название.';return}if(nameExists(name)){errorNode.textContent='Такая позиция уже есть в каталоге.';return}
  save.disabled=true;save.textContent='Создание в МойСклад…';errorNode.textContent='';
  try{
    const result=await apiCreateCatalogItem({name,item_type:type,category,unit,sale_price:price});
    const data=result?.item;if(!data?.name)throw new Error('Сервер не вернул созданную позицию.');
    addOptionToLists(data);
    if(activeContext?.nameInput){activeContext.nameInput.value=data.name;activeContext.nameInput.dispatchEvent(new Event('input',{bubbles:true}))}
    if(activeContext?.priceInput){activeContext.priceInput.value=String(Number(data.sale_price||0));activeContext.priceInput.dispatchEvent(new Event('input',{bubbles:true}));activeContext.priceInput.dispatchEvent(new Event('change',{bubbles:true}))}
    activeContext?.refresh?.();document.getElementById('orderCatalogQuickDlg').close();
  }catch(error){console.error('Quick MoySklad catalog create failed',error);errorNode.textContent=`Не удалось добавить: ${error?.message||error}`}
  finally{save.disabled=false;save.textContent='Добавить в МойСклад'}
}

function bind(){
  ensureStyle();ensureDialog();enhanceRows();enhanceCreateField();
  document.addEventListener('input',event=>{
    const row=event.target?.closest?.('#editOrderItems .order-edit-item');if(row&&event.target.matches('[data-edit-name]'))refreshQuickButton(row);
    if(event.target?.id==='newOrderItem')refreshCreateQuickButton();
  });
  document.addEventListener('change',event=>{if(event.target?.id==='newOrderItem')refreshCreateQuickButton()});
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('.order-catalog-quick-btn');if(!button)return;
    const row=button.closest('.order-edit-item');
    if(row){openQuickDialog({nameInput:row.querySelector('[data-edit-name]'),priceInput:row.querySelector('[data-edit-price]'),refresh:()=>refreshQuickButton(row)});return}
    if(button.id==='newOrderCatalogQuickBtn')openQuickDialog({nameInput:document.getElementById('newOrderItem'),priceInput:document.getElementById('newOrderPrice'),refresh:refreshCreateQuickButton});
  });
  const observer=new MutationObserver(()=>{enhanceRows();enhanceCreateField()});observer.observe(document.body,{childList:true,subtree:true});
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
