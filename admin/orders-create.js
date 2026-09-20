import { supabase } from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2});
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>m==='&'?'&amp;':m==='<'?'&lt;':m==='>'?'&gt;':m==='"'?'&quot;':'&#39;');
const MAX_FILE_SIZE=50*1024*1024;
const state={roles:[],customers:[],catalog:[],loaded:false,patchTimer:null,files:[],orderKind:'STANDARD'};
const canManage=()=>state.roles.includes('ADMIN')||state.roles.includes('MANAGER');

const ORDER_WORKFLOWS={
  STANDARD:{partner:null,title:'Обычный заказ',url:'',description:'Стандартный заказ А4-Принт или 3D-ARTPRINT.',presets:[]},
  MEMORIAL:{partner:'Сфера',title:'Памятники / фотокерамика',url:'https://sferazakaz.ru/katalog/fotokeramika',description:'Портреты и изделия для памятников. Фото и макеты прикрепляйте к заказу ниже.',presets:['Портрет для памятника','Ритуальная табличка','Портрет большого размера','Портрет под живопись / гризайль','Арка / композиция сложной формы','Нестандартная форма','Фото на стекле','Металлофото','Имитация гравировки','Икона в золотом обрамлении','Временная табличка','Вкладка в цветник'],labels:{material:'Материал',format:'Размер / форма',color:'Цветность',finishing:'Ретушь / отверстия'},placeholders:{material:'Металл, керамика, фарфор, керамогранит…',format:'Например 18×24, овал / прямоугольник',color:'Цветной / чёрно-белый / сепия',finishing:'Без ретуши, сложная ретушь; отверстия…'}},
  SOUVENIR:{partner:'Сфера',title:'Сувенирная продукция и знаки',url:'https://sferazakaz.ru/',description:'Заказы на сувенирные изделия, информационные знаки, таблички и нестандартную продукцию «Сферы».',presets:['Информационный знак','Табличка','Сувенирная продукция','Памятное изделие','Нестандартное изделие'],labels:{material:'Материал',format:'Размер / габариты',color:'Цвет / нанесение',finishing:'Обработка / крепление'},placeholders:{material:'Металл, пластик, керамика и т. п.',format:'Размер изделия',color:'Цвет, печать, гравировка…',finishing:'Отверстия, крепление, упаковка…'}},
  TYPOGRAPHY:{partner:'Группа М',title:'Типография',url:'https://gmprint.ru/',description:'Заказы на полиграфию через типографию «Группа М». Укажите тираж в количестве, а производственные параметры — ниже.',presets:['Визитки','Бирки','Листовки','Буклеты','Каталоги','Календари','Открытки','Другая полиграфия'],labels:{material:'Бумага / материал',format:'Формат',color:'Цветность / стороны',finishing:'Постпечатная обработка'},placeholders:{material:'Мелованная, дизайнерская, плотность…',format:'A6, A5, A4, 90×50 мм…',color:'4+0, 4+4, ч/б…',finishing:'Ламинация, скругление, фальцовка, сверление…'}}
};

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

function updatePartnerMargin(){
  const node=$('partnerMargin');if(!node)return;
  if(state.orderKind==='STANDARD'){node.textContent='';return}
  const qty=Math.max(0,Number($('newOrderQty')?.value||0));
  const price=Math.max(0,Number($('newOrderPrice')?.value||0));
  const cost=Math.max(0,Number($('partnerCost')?.value||0));
  if(!(cost>0)){node.textContent='Себестоимость партнёра можно указать для контроля маржи.';node.classList.remove('negative');return}
  const revenue=qty*price,costTotal=qty*cost,margin=revenue-costTotal;
  const percent=revenue>0?(margin/revenue)*100:0;
  node.textContent='Партнёр: '+money(costTotal)+' ₽ · клиент: '+money(revenue)+' ₽ · маржа: '+money(margin)+' ₽ ('+percent.toLocaleString('ru-RU',{maximumFractionDigits:1})+'%)';
  node.classList.toggle('negative',margin<0);
}

function recalc(){
  const qty=Math.max(0,Number($('newOrderQty')?.value||0));
  const price=Math.max(0,Number($('newOrderPrice')?.value||0));
  if($('newOrderTotal'))$('newOrderTotal').value=money(qty*price)+' ₽';
  updatePartnerMargin();
}

function applyCatalogPrice(){
  if(state.orderKind!=='STANDARD')return;
  const value=$('newOrderItem')?.value.trim().toLowerCase();
  if(!value)return;
  const item=state.catalog.find(x=>String(x.name||'').trim().toLowerCase()===value);
  if(item&&$('newOrderPrice')){
    $('newOrderPrice').value=Number(item.sale_price||0);
    recalc();
  }
}

function clearPartnerFields(){
  for(const id of ['partnerMaterial','partnerFormat','partnerColor','partnerFinishing','partnerReference','partnerText'])if($(id))$(id).value='';
  if($('partnerCost'))$('partnerCost').value='0';
}

function setOrderKind(kind){
  const next=ORDER_WORKFLOWS[kind]?kind:'STANDARD';
  state.orderKind=next;
  document.querySelectorAll('[data-order-kind]').forEach(button=>button.classList.toggle('active',button.dataset.orderKind===next));
  const panel=$('partnerOrderPanel'),flow=ORDER_WORKFLOWS[next];
  if(next==='STANDARD'){
    if(panel)panel.hidden=true;
    updatePartnerMargin();
    return;
  }
  if(panel)panel.hidden=false;
  $('partnerOrderEyebrow').textContent='Партнёр · '+flow.partner;
  $('partnerOrderTitle').textContent=flow.title;
  $('partnerOrderDescription').textContent=flow.description;
  const link=$('partnerCatalogLink');link.href=flow.url;link.textContent='Открыть каталог «'+flow.partner+'» ↗';
  const labels=flow.labels||{},placeholders=flow.placeholders||{};
  $('partnerMaterialLabel').textContent=labels.material||'Материал';$('partnerMaterial').placeholder=placeholders.material||'';
  $('partnerFormatLabel').textContent=labels.format||'Размер / формат';$('partnerFormat').placeholder=placeholders.format||'';
  $('partnerColorLabel').textContent=labels.color||'Цветность';$('partnerColor').placeholder=placeholders.color||'';
  $('partnerFinishingLabel').textContent=labels.finishing||'Обработка';$('partnerFinishing').placeholder=placeholders.finishing||'';
  const textLabel=$('partnerTextLabel'),textInput=$('partnerText');
  if(textLabel&&textInput){
    if(next==='MEMORIAL'){textLabel.textContent='ФИО / даты / текст на изделии';textInput.placeholder='ФИО, даты жизни, эпитафия или подпись'}
    else if(next==='TYPOGRAPHY'){textLabel.textContent='Примечания к макету';textInput.placeholder='Текст, персонализация, нумерация и другие данные'}
    else{textLabel.textContent='Текст / дополнительные данные';textInput.placeholder='Текст, надпись или данные для изготовления'}
  }
  $('partnerOrderPresets').innerHTML=(flow.presets||[]).map((name,index)=>'<button type="button" data-partner-preset="'+index+'">'+esc(name)+'</button>').join('');
  $('newOrderUnit').value='A4_PRINT';
  updatePartnerMargin();
}

function choosePartnerPreset(index){
  const flow=ORDER_WORKFLOWS[state.orderKind];const name=flow?.presets?.[Number(index)];
  if(!name)return;
  $('newOrderItem').value=name;
  $('partnerOrderPresets')?.querySelectorAll('[data-partner-preset]').forEach(button=>button.classList.toggle('active',Number(button.dataset.partnerPreset)===Number(index)));
  $('newOrderPrice')?.focus();
}

function persistedItemName(raw){
  const name=String(raw||'').trim();
  if(state.orderKind==='STANDARD')return name;
  const flow=ORDER_WORKFLOWS[state.orderKind];
  return flow?.partner?flow.partner+' · '+name:name;
}

function buildOrderComment(){
  const note=$('newOrderComment')?.value.trim()||'';
  if(state.orderKind==='STANDARD')return note||null;
  const flow=ORDER_WORKFLOWS[state.orderKind];
  const fields=[
    'Партнёрский заказ: '+flow.partner+' — '+flow.title,
    $('partnerMaterial')?.value.trim()?$('partnerMaterialLabel').textContent+': '+$('partnerMaterial').value.trim():'',
    $('partnerFormat')?.value.trim()?$('partnerFormatLabel').textContent+': '+$('partnerFormat').value.trim():'',
    $('partnerColor')?.value.trim()?$('partnerColorLabel').textContent+': '+$('partnerColor').value.trim():'',
    $('partnerFinishing')?.value.trim()?$('partnerFinishingLabel').textContent+': '+$('partnerFinishing').value.trim():'',
    $('partnerReference')?.value.trim()?'Артикул / модель / ссылка: '+$('partnerReference').value.trim():'',
    $('partnerText')?.value.trim()?$('partnerTextLabel').textContent+': '+$('partnerText').value.trim():'',
    Number($('partnerCost')?.value||0)>0?'Себестоимость партнёра: '+money(Number($('partnerCost').value||0))+' ₽ / ед.':'',
    'Каталог партнёра: '+flow.url,
    note?'Комментарий клиента: '+note:''
  ].filter(Boolean);
  return fields.join('\n');
}

function fileSize(bytes){
  const value=Number(bytes||0);
  if(value<1024)return `${value} Б`;
  if(value<1024*1024)return `${(value/1024).toFixed(value<10*1024?1:0)} КБ`;
  return `${(value/(1024*1024)).toFixed(value<10*1024*1024?1:0)} МБ`;
}

function fileKey(file){return `${file.name}\u0000${file.size}\u0000${file.lastModified}`}

function renderFiles(){
  const node=$('newOrderFilesList');if(!node)return;
  if(!state.files.length){node.innerHTML='<span>Файлы не выбраны</span>';return}
  node.innerHTML=state.files.map((file,index)=>`<div class="order-create-file-row"><b title="${String(file.name).replace(/"/g,'&quot;')}">${String(file.name).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}</b><small>${fileSize(file.size)}</small><button class="order-create-file-remove" type="button" data-remove-file="${index}" aria-label="Убрать файл">×</button></div>`).join('');
}

function addFiles(list){
  const errorNode=$('newOrderError');
  const incoming=[...(list||[])];
  if(!incoming.length)return;
  const existing=new Set(state.files.map(fileKey));
  const tooLarge=[];
  for(const file of incoming){
    if(file.size>MAX_FILE_SIZE){tooLarge.push(file.name);continue}
    const key=fileKey(file);
    if(existing.has(key))continue;
    existing.add(key);state.files.push(file);
  }
  renderFiles();
  if(errorNode){
    errorNode.classList.remove('ok');
    errorNode.textContent=tooLarge.length?`Не добавлены файлы больше 50 МБ: ${tooLarge.join(', ')}`:'';
  }
}

function resetFiles(){
  state.files=[];
  const input=$('newOrderFiles');if(input)input.value='';
  renderFiles();
}

function safeStorageName(name){
  const clean=String(name||'file').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'-').replace(/\s+/g,' ').trim().slice(-150);
  return clean||'file';
}

function uniquePart(){
  if(globalThis.crypto?.randomUUID)return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
}

async function uploadOrderFiles(orderId,saveButton){
  const failures=[];
  for(let index=0;index<state.files.length;index++){
    const file=state.files[index];
    if(saveButton)saveButton.textContent=`Загрузка файлов ${index+1}/${state.files.length}…`;
    const path=`${orderId}/${uniquePart()}-${safeStorageName(file.name)}`;
    try{
      const upload=await supabase.storage.from('order-files').upload(path,file,{contentType:file.type||'application/octet-stream',cacheControl:'3600',upsert:false});
      if(upload.error)throw upload.error;
      const meta=await supabase.from('order_files').insert({order_id:orderId,file_name:file.name,file_url:path,mime_type:file.type||null});
      if(meta.error){
        await supabase.storage.from('order-files').remove([path]).catch(()=>{});
        throw meta.error;
      }
    }catch(error){
      console.error('Order attachment upload failed',file.name,error);
      failures.push({name:file.name,error:String(error?.message||error)});
    }
  }
  return failures;
}

async function openDialog(){
  if(!canManage())return;
  const dlg=$('newOrderDlg');if(!dlg)return;
  $('newOrderError').textContent='';$('newOrderError').classList.remove('ok');
  try{
    await loadReferenceData();
    $('newOrderCustomer').value='';
    state.orderKind='STANDARD';
    clearPartnerFields();
    setOrderKind('STANDARD');
    $('newOrderCustomerName').value='';
    $('newOrderCustomerPhone').value='';
    $('newOrderUnit').value='A4_PRINT';
    $('newOrderItem').value='';
    $('newOrderQty').value='1';
    $('newOrderPrice').value='0';
    $('newOrderSource').value='Офис';
    $('newOrderComment').value='';
    resetFiles();
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
  errorNode.textContent='';errorNode.classList.remove('ok');
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
    const commonArgs={
      p_customer_id:customerChoice&&customerChoice!=='__NEW__'?customerChoice:null,
      p_customer_name:newCustomer?customerName:null,
      p_customer_phone:newCustomer?($('newOrderCustomerPhone').value.trim()||null):null,
      p_business_unit:$('newOrderUnit').value,
      p_item_name:persistedItemName(itemName),
      p_quantity:qty,
      p_unit_price:price,
      p_comment:buildOrderComment(),
      p_source:$('newOrderSource').value||'Офис'
    };
    const isPartner=state.orderKind!=='STANDARD';
    const flow=ORDER_WORKFLOWS[state.orderKind];
    const rpc=isPartner?'create_hub_partner_manual_order':'create_hub_manual_order';
    const args=isPartner?{...commonArgs,p_partner_name:flow.partner,p_partner_workflow:state.orderKind,p_partner_unit_cost:Number($('partnerCost')?.value||0)}:commonArgs;
    const {data,error}=await supabase.rpc(rpc,args);
    if(error)throw error;
    const result=Array.isArray(data)?data[0]:data;
    if(result?.id){
      const failures=state.files.length?await uploadOrderFiles(result.id,save):[];
      if(failures.length){
        const names=failures.map(x=>x.name).join(', ');
        window.alert(`Заказ создан, но не удалось прикрепить ${failures.length} файл(а): ${names}. Их можно добавить позже из карточки заказа.`);
      }
      $('newOrderDlg').close();
      location.href=`./order.html?id=${encodeURIComponent(result.id)}`;
      return;
    }
    $('newOrderDlg').close();
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
      const {data,error}=await supabase.from('order_items').select('id,order_id,name').in('order_id',ids);
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
  document.querySelectorAll('[data-order-kind]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.orderKind!==state.orderKind){$('newOrderItem').value='';$('newOrderPrice').value='0'}clearPartnerFields();setOrderKind(button.dataset.orderKind);recalc()}));
  $('partnerOrderPresets')?.addEventListener('click',event=>{const button=event.target.closest('[data-partner-preset]');if(button)choosePartnerPreset(button.dataset.partnerPreset)});
  $('partnerCost')?.addEventListener('input',updatePartnerMargin);
  $('newOrderItem')?.addEventListener('change',applyCatalogPrice);
  $('newOrderItem')?.addEventListener('blur',applyCatalogPrice);
  $('newOrderQty')?.addEventListener('input',recalc);
  $('newOrderPrice')?.addEventListener('input',recalc);

  const fileInput=$('newOrderFiles'),drop=$('newOrderFileDrop'),filesList=$('newOrderFilesList');
  fileInput?.addEventListener('change',()=>{addFiles(fileInput.files);fileInput.value=''});
  drop?.addEventListener('click',()=>fileInput?.click());
  drop?.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();fileInput?.click()}});
  for(const name of ['dragenter','dragover'])drop?.addEventListener(name,event=>{event.preventDefault();event.stopPropagation();drop.classList.add('drag')});
  for(const name of ['dragleave','drop'])drop?.addEventListener(name,event=>{event.preventDefault();event.stopPropagation();drop.classList.remove('drag')});
  drop?.addEventListener('drop',event=>addFiles(event.dataTransfer?.files));
  filesList?.addEventListener('click',event=>{
    const button=event.target.closest('[data-remove-file]');if(!button)return;
    const index=Number(button.dataset.removeFile);if(!Number.isInteger(index))return;
    state.files.splice(index,1);renderFiles();
  });

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