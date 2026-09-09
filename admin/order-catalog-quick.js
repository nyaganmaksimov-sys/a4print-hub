import {supabase} from './guard.js?v=20260905-netfix1';

const money=value=>Number(value||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
let activeRow=null;

function ensureStyle(){
  if(document.getElementById('orderCatalogQuickStyle'))return;
  const style=document.createElement('style');
  style.id='orderCatalogQuickStyle';
  style.textContent=`
    .order-edit-name-wrap{position:relative;min-width:0}.order-edit-name-wrap>[data-edit-name]{padding-right:94px!important}
    .order-catalog-quick-btn{position:absolute;right:5px;top:5px;height:28px;padding:0 8px;border:1px solid #bfdbfe;border-radius:7px;background:#eff6ff;color:#1d4ed8;font-size:9px;font-weight:850;cursor:pointer;white-space:nowrap}
    .order-catalog-quick-btn:hover{background:#dbeafe}.order-catalog-quick-btn[hidden]{display:none!important}
    .order-catalog-dialog{width:min(520px,calc(100vw - 28px));border:0;border-radius:18px;padding:0;background:#fff;box-shadow:0 30px 90px rgba(15,23,42,.35)}
    .order-catalog-dialog::backdrop{background:rgba(15,23,42,.56)}
    .order-catalog-form{display:grid}.order-catalog-head{padding:17px 19px 12px;border-bottom:1px solid #e8edf4}.order-catalog-head h3{margin:0;font-size:18px}.order-catalog-head p{margin:5px 0 0;color:#64748b;font-size:11px}
    .order-catalog-body{padding:15px 19px;display:grid;grid-template-columns:1fr 1fr;gap:11px}.order-catalog-field{display:grid;gap:5px}.order-catalog-field.full{grid-column:1/-1}.order-catalog-field span{font-size:10px;font-weight:850;color:#475569;text-transform:uppercase}.order-catalog-field input,.order-catalog-field select{width:100%;box-sizing:border-box;min-height:40px;padding:9px 10px;border:1px solid #d7dee9;border-radius:10px;background:#fff;color:#172033;font:inherit;font-size:12px}
    .order-catalog-hint{grid-column:1/-1;padding:9px 10px;border-radius:10px;background:#eff6ff;color:#1d4ed8;font-size:10px;line-height:1.45}.order-catalog-error{grid-column:1/-1;min-height:16px;color:#b91c1c;font-size:10px}
    .order-catalog-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 19px 17px;border-top:1px solid #e8edf4}.order-catalog-foot button{min-height:38px;padding:0 14px;border:1px solid #d7dee9;border-radius:10px;background:#fff;color:#334155;font-weight:850;cursor:pointer}.order-catalog-foot .primary{background:#2563eb;border-color:#2563eb;color:#fff}.order-catalog-foot button:disabled{opacity:.55;cursor:wait}
    @media(max-width:620px){.order-catalog-body{grid-template-columns:1fr}.order-catalog-field.full,.order-catalog-hint,.order-catalog-error{grid-column:auto}.order-edit-name-wrap>[data-edit-name]{padding-right:78px!important}.order-catalog-quick-btn{font-size:0;width:34px}.order-catalog-quick-btn::after{content:'+';font-size:15px}}
  `;
  document.head.appendChild(style);
}

function catalogNames(){
  return new Set([...document.querySelectorAll('#orderEditCatalogList option')].map(o=>String(o.value||'').trim().toLowerCase()).filter(Boolean));
}

function refreshQuickButton(row){
  const input=row?.querySelector('[data-edit-name]');
  const button=row?.querySelector('.order-catalog-quick-btn');
  if(!input||!button)return;
  const name=input.value.trim();
  button.hidden=!name||catalogNames().has(name.toLowerCase());
}

function enhanceRows(){
  document.querySelectorAll('#editOrderItems .order-edit-item').forEach(row=>{
    const input=row.querySelector('[data-edit-name]');
    if(!input||input.closest('.order-edit-name-wrap')){refreshQuickButton(row);return}
    const wrap=document.createElement('div');wrap.className='order-edit-name-wrap';
    input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);
    const button=document.createElement('button');
    button.type='button';button.className='order-catalog-quick-btn';button.textContent='+ В каталог';button.title='Добавить эту позицию в каталог';
    wrap.appendChild(button);refreshQuickButton(row);
  });
}

function ensureDialog(){
  if(document.getElementById('orderCatalogQuickDlg'))return;
  const dialog=document.createElement('dialog');dialog.id='orderCatalogQuickDlg';dialog.className='order-catalog-dialog';
  dialog.innerHTML=`<form id="orderCatalogQuickForm" class="order-catalog-form">
    <div class="order-catalog-head"><h3>Быстро добавить в каталог</h3><p>Новая услуга или товар сразу станет доступна в заказах и кассе после обновления каталога.</p></div>
    <div class="order-catalog-body">
      <label class="order-catalog-field"><span>Тип</span><select id="orderCatalogQuickType"><option value="SERVICE">Услуга</option><option value="PRODUCT">Товар</option></select></label>
      <label class="order-catalog-field"><span>Цена продажи, ₽</span><input id="orderCatalogQuickPrice" type="number" min="0" step="0.01" value="0"></label>
      <label class="order-catalog-field full"><span>Название</span><input id="orderCatalogQuickName" required placeholder="Название услуги или товара"></label>
      <label class="order-catalog-field"><span>Единица</span><select id="orderCatalogQuickUnit"><option value="шт">шт</option><option value="лист">лист</option><option value="м">м</option><option value="м²">м²</option><option value="мин">мин</option><option value="час">час</option></select></label>
      <label class="order-catalog-field"><span>Категория</span><input id="orderCatalogQuickCategory" placeholder="Например: Копирование"></label>
      <div class="order-catalog-hint">Если позиции нет в базе, нажмите «+ В каталог» прямо возле её названия. После сохранения цена и название останутся в текущем заказе.</div>
      <div id="orderCatalogQuickError" class="order-catalog-error"></div>
    </div>
    <div class="order-catalog-foot"><button id="orderCatalogQuickCancel" type="button">Отмена</button><button id="orderCatalogQuickSave" class="primary" type="submit">Добавить в каталог</button></div>
  </form>`;
  document.body.appendChild(dialog);
  document.getElementById('orderCatalogQuickCancel').addEventListener('click',()=>dialog.close());
  document.getElementById('orderCatalogQuickForm').addEventListener('submit',saveCatalogItem);
}

function openQuickDialog(row){
  activeRow=row;ensureDialog();
  const name=row.querySelector('[data-edit-name]')?.value.trim()||'';
  const price=Number(row.querySelector('[data-edit-price]')?.value||0);
  document.getElementById('orderCatalogQuickName').value=name;
  document.getElementById('orderCatalogQuickPrice').value=String(Math.max(0,price));
  document.getElementById('orderCatalogQuickType').value='SERVICE';
  document.getElementById('orderCatalogQuickUnit').value='шт';
  document.getElementById('orderCatalogQuickCategory').value='';
  document.getElementById('orderCatalogQuickError').textContent='';
  document.getElementById('orderCatalogQuickDlg').showModal();
  setTimeout(()=>document.getElementById('orderCatalogQuickName')?.focus(),0);
}

function makeSku(type){
  const prefix=type==='SERVICE'?'SRV':'PRD';
  const rnd=(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)).replace(/-/g,'').slice(0,8).toUpperCase();
  return `HUB-${prefix}-${Date.now().toString(36).toUpperCase()}-${rnd}`;
}

async function saveCatalogItem(event){
  event.preventDefault();
  const name=document.getElementById('orderCatalogQuickName').value.trim();
  const type=document.getElementById('orderCatalogQuickType').value;
  const price=Math.max(0,Number(document.getElementById('orderCatalogQuickPrice').value||0));
  const unit=document.getElementById('orderCatalogQuickUnit').value||'шт';
  const category=document.getElementById('orderCatalogQuickCategory').value.trim()||null;
  const errorNode=document.getElementById('orderCatalogQuickError');
  const save=document.getElementById('orderCatalogQuickSave');
  if(!name){errorNode.textContent='Укажите название.';return}
  if(catalogNames().has(name.toLowerCase())){errorNode.textContent='Такая позиция уже есть в каталоге.';return}
  save.disabled=true;save.textContent='Добавление…';errorNode.textContent='';
  try{
    const {data,error}=await supabase.from('catalog_items').insert({sku:makeSku(type),name,item_type:type,category,unit,sale_price:price,cost_price:0,min_stock:0,is_active:true,external_source:'HUB_MANUAL'}).select('id,name,sale_price,item_type').single();
    if(error)throw error;
    const list=document.getElementById('orderEditCatalogList');
    if(list){const option=document.createElement('option');option.value=data.name;option.label=money(data.sale_price);list.appendChild(option)}
    if(activeRow){
      const nameInput=activeRow.querySelector('[data-edit-name]');const priceInput=activeRow.querySelector('[data-edit-price]');
      if(nameInput){nameInput.value=data.name;nameInput.dispatchEvent(new Event('input',{bubbles:true}))}
      if(priceInput){priceInput.value=String(Number(data.sale_price||0));priceInput.dispatchEvent(new Event('input',{bubbles:true}))}
      refreshQuickButton(activeRow);
    }
    document.getElementById('orderCatalogQuickDlg').close();
  }catch(error){
    console.error('Quick catalog insert failed',error);
    const msg=String(error?.message||error);
    errorNode.textContent=msg.includes('duplicate key')?'Позиция с таким кодом уже существует. Повторите попытку.':`Не удалось добавить: ${msg}`;
  }finally{save.disabled=false;save.textContent='Добавить в каталог'}
}

function bind(){
  ensureStyle();ensureDialog();enhanceRows();
  document.addEventListener('input',event=>{const row=event.target?.closest?.('#editOrderItems .order-edit-item');if(row&&event.target.matches('[data-edit-name]'))refreshQuickButton(row)});
  document.addEventListener('click',event=>{const button=event.target?.closest?.('.order-catalog-quick-btn');if(button){const row=button.closest('.order-edit-item');if(row)openQuickDialog(row)}});
  const observer=new MutationObserver(()=>enhanceRows());observer.observe(document.body,{childList:true,subtree:true});
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
