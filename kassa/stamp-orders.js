(()=>{
  'use strict';
  if(window.__A4_KASSA_STAMP_ORDERS__)return;
  window.__A4_KASSA_STAMP_ORDERS__=true;

  const cfg=window.A4PRINT_CONFIG||{};
  const create=window.supabase?.createClient;
  if(!create)return;
  const supabase=window.__A4_STAMP_ORDER_SUPABASE__||(window.__A4_STAMP_ORDER_SUPABASE__=create(
    cfg.supabaseUrl,cfg.supabasePublishableKey,
    {global:{fetch:window.A4SupabaseFetch||fetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}
  ));
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})+' ₽';
  const TYPES=[
    'Печать ИП',
    'Печать ООО',
    'Печать с логотипом',
    'Печать педагогу',
    'Печать врачу',
    'Факсимиле',
    'Дизайнерская печать',
    'Штамп',
    'Рамка для печати'
  ];
  const SHAPES=['Круглая','Овальная','Прямоугольная','Треугольная','Другая / по образцу'];
  const EQUIPMENT=['Без оснастки','Автоматическая оснастка','Ручная оснастка'];
  const COLORS=['Синяя','Чёрная','Красная','Фиолетовая','Зелёная','Другая'];
  const MAX_FILE_SIZE=50*1024*1024;
  let overlay=null,items=[],files=[],selectedCustomerId=null,searchTimer=null;

  function uid(){return crypto.randomUUID?crypto.randomUUID():`stamp-${Date.now()}-${Math.random().toString(36).slice(2)}`}
  function cleanFileName(name){return String(name||'file').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'-').replace(/\s+/g,' ').trim().slice(-150)||'file'}

  function typeOptions(value){return TYPES.map(x=>`<option ${x===value?'selected':''}>${esc(x)}</option>`).join('')}
  function shapeOptions(value){return SHAPES.map(x=>`<option ${x===value?'selected':''}>${esc(x)}</option>`).join('')}
  function equipmentOptions(value){return EQUIPMENT.map(x=>`<option ${x===value?'selected':''}>${esc(x)}</option>`).join('')}
  function colorOptions(value){return COLORS.map(x=>`<option ${x===value?'selected':''}>${esc(x)}</option>`).join('')}

  function blankItem(){
    return {key:uid(),type:'Печать ИП',sample_number:'',shape:'Круглая',size:'Ø 40 мм',equipment:'Автоматическая оснастка',ink_color:'Синяя',quantity:1,unit_price:0,stamp_text:'',details:''};
  }

  function ensureUi(){
    if(overlay)return;
    overlay=document.createElement('section');
    overlay.id='stampOrderOverlay';
    overlay.className='stamp-order-overlay';
    overlay.hidden=true;
    overlay.innerHTML=`
      <div class="stamp-order-shell" role="dialog" aria-modal="true" aria-label="Заказ печатей и штампов">
        <header class="stamp-order-head">
          <div><h2>Заказ печатей и штампов</h2><p>Клиент, реквизиты, образцы и параметры заказа · заказ сразу появится в A4PRINT HUB</p></div>
          <button id="stampOrderClose" type="button" aria-label="Закрыть">×</button>
        </header>
        <form id="stampOrderForm" class="stamp-order-form">
          <div class="stamp-order-scroll">
            <section class="stamp-card">
              <div class="stamp-section-head"><div><h3>Клиент</h3><p>Можно найти существующего клиента HUB или заполнить нового.</p></div><button id="stampCustomerClear" class="stamp-link" type="button">Новый клиент</button></div>
              <div class="stamp-customer-search">
                <input id="stampCustomerSearch" autocomplete="off" placeholder="Поиск по имени, компании, телефону, email или ИНН">
                <div id="stampCustomerResults" class="stamp-customer-results"></div>
              </div>
              <div class="stamp-grid">
                <label><span>Тип клиента *</span><select id="stampCustomerType"><option value="PERSON">Физлицо</option><option value="IP">ИП</option><option value="LEGAL">ООО / юрлицо</option></select></label>
                <label><span>Контактное лицо / ФИО *</span><input id="stampFullName" autocomplete="name" required></label>
                <label><span>Телефон</span><input id="stampPhone" autocomplete="tel" placeholder="+7 ..."></label>
                <label><span>Email</span><input id="stampEmail" autocomplete="email" type="email"></label>
              </div>
              <details id="stampRequisites" class="stamp-requisites">
                <summary>Реквизиты клиента</summary>
                <div class="stamp-grid requisites-grid">
                  <label><span>Краткое название / компания</span><input id="stampCompanyName" placeholder="ООО «Компания» / ИП Иванов И.И."></label>
                  <label><span>Полное юридическое наименование</span><input id="stampLegalName"></label>
                  <label><span>ИНН</span><input id="stampInn" inputmode="numeric"></label>
                  <label><span>КПП</span><input id="stampKpp" inputmode="numeric"></label>
                  <label><span>ОГРН / ОГРНИП</span><input id="stampOgrn" inputmode="numeric"></label>
                  <label class="wide"><span>Юридический адрес</span><input id="stampLegalAddress"></label>
                  <label class="wide"><span>Фактический адрес</span><input id="stampActualAddress"></label>
                  <label><span>Банк</span><input id="stampBankName"></label>
                  <label><span>БИК</span><input id="stampBik" inputmode="numeric"></label>
                  <label><span>Расчётный счёт</span><input id="stampSettlement" inputmode="numeric"></label>
                  <label><span>Корреспондентский счёт</span><input id="stampCorrespondent" inputmode="numeric"></label>
                  <label><span>Подписант</span><input id="stampSignatoryName"></label>
                  <label><span>Должность подписанта</span><input id="stampSignatoryTitle"></label>
                  <label class="wide"><span>Действует на основании</span><input id="stampSignatoryBasis" placeholder="Устава / доверенности / свидетельства"></label>
                </div>
              </details>
            </section>

            <section class="stamp-card">
              <div class="stamp-section-head"><div><h3>Печати и штампы</h3><p>Категории соответствуют разделу «Печати и штампы» А4-Принт. Для образца достаточно указать вид и номер.</p></div><button id="stampAddItem" class="stamp-add" type="button">＋ Добавить позицию</button></div>
              <div id="stampItems" class="stamp-items"></div>
            </section>

            <section class="stamp-card">
              <div class="stamp-section-head"><div><h3>Срок, файлы и комментарий</h3><p>Можно приложить логотип, подпись, реквизиты или готовый макет.</p></div></div>
              <div class="stamp-grid">
                <label><span>Желаемый срок</span><input id="stampDueAt" type="datetime-local"></label>
                <label><span>Файлы заказа</span><input id="stampFiles" type="file" multiple accept="image/*,.pdf,.svg,.cdr,.ai,.eps,.doc,.docx,.xls,.xlsx"></label>
                <label class="wide"><span>Комментарий клиента</span><textarea id="stampComment" rows="4" placeholder="Особые требования, срочность, где забрать, что проверить перед изготовлением…"></textarea></label>
              </div>
              <div id="stampFileList" class="stamp-file-list"></div>
            </section>
          </div>
          <footer class="stamp-order-foot">
            <div><span>Итого заказа</span><strong id="stampOrderTotal">0 ₽</strong><small id="stampOrderError"></small></div>
            <button id="stampOrderSave" type="submit">Создать заказ в HUB</button>
          </footer>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    bind();
    reset();
  }

  function open(){ensureUi();overlay.hidden=false;document.body.classList.add('stamp-order-open');setTimeout(()=>$('stampFullName')?.focus(),0)}
  function close(){if(!overlay)return;overlay.hidden=true;document.body.classList.remove('stamp-order-open')}

  function reset(){
    selectedCustomerId=null;items=[blankItem()];files=[];
    if(!$('stampOrderForm'))return;
    $('stampOrderForm').reset();
    $('stampCustomerType').value='PERSON';
    $('stampCustomerResults').innerHTML='';
    $('stampOrderError').textContent='';
    renderItems();renderFiles();recalc();
  }

  function renderItems(){
    const box=$('stampItems');if(!box)return;
    box.innerHTML=items.map((i,index)=>`
      <article class="stamp-item" data-stamp-key="${esc(i.key)}">
        <div class="stamp-item-top"><b>Позиция ${index+1}</b><button type="button" class="stamp-remove" data-remove-stamp="${esc(i.key)}" ${items.length===1?'disabled':''}>Удалить</button></div>
        <div class="stamp-grid stamp-item-grid">
          <label><span>Вид *</span><select data-field="type">${typeOptions(i.type)}</select></label>
          <label><span>№ образца</span><input data-field="sample_number" value="${esc(i.sample_number)}" placeholder="например 12"></label>
          <label><span>Форма</span><select data-field="shape">${shapeOptions(i.shape)}</select></label>
          <label><span>Размер</span><input data-field="size" value="${esc(i.size)}" placeholder="Ø 40 мм / 47×18 мм"></label>
          <label><span>Оснастка</span><select data-field="equipment">${equipmentOptions(i.equipment)}</select></label>
          <label><span>Цвет оттиска</span><select data-field="ink_color">${colorOptions(i.ink_color)}</select></label>
          <label><span>Количество</span><input data-field="quantity" type="number" min="1" step="1" value="${Number(i.quantity||1)}"></label>
          <label><span>Цена за 1 шт., ₽</span><input data-field="unit_price" type="number" min="0" step="0.01" value="${Number(i.unit_price||0)}"></label>
          <label class="wide"><span>Текст печати / штампа</span><textarea data-field="stamp_text" rows="2" placeholder="Текст по окружности, по центру, должность, ФИО и т. п.">${esc(i.stamp_text)}</textarea></label>
          <label class="wide"><span>Дополнительные параметры</span><textarea data-field="details" rows="2" placeholder="Логотип, рамка, особенности макета, пожелания клиента…">${esc(i.details)}</textarea></label>
        </div>
        <div class="stamp-item-total">Сумма позиции: <b>${money(Number(i.quantity||0)*Number(i.unit_price||0))}</b></div>
      </article>`).join('');
  }

  function captureItems(){
    document.querySelectorAll('[data-stamp-key]').forEach(card=>{
      const item=items.find(x=>x.key===card.dataset.stampKey);if(!item)return;
      card.querySelectorAll('[data-field]').forEach(el=>{item[el.dataset.field]=['quantity','unit_price'].includes(el.dataset.field)?Number(el.value||0):el.value});
    });
  }
  function recalc(){
    captureItems();
    const total=items.reduce((s,i)=>s+Math.max(0,Number(i.quantity||0))*Math.max(0,Number(i.unit_price||0)),0);
    if($('stampOrderTotal'))$('stampOrderTotal').textContent=money(total);
    document.querySelectorAll('[data-stamp-key]').forEach(card=>{
      const i=items.find(x=>x.key===card.dataset.stampKey);
      const b=card.querySelector('.stamp-item-total b');if(b&&i)b.textContent=money(Number(i.quantity||0)*Number(i.unit_price||0));
    });
    return total;
  }

  function renderFiles(){
    const node=$('stampFileList');if(!node)return;
    node.innerHTML=files.map((f,i)=>`<span><b>${esc(f.name)}</b><small>${(f.size/1024/1024).toFixed(1)} МБ</small><button type="button" data-remove-file="${i}">×</button></span>`).join('');
  }

  function customerPayload(){
    return {
      id:selectedCustomerId,
      customer_type:$('stampCustomerType').value,
      full_name:$('stampFullName').value.trim(),
      company_name:$('stampCompanyName').value.trim(),
      email:$('stampEmail').value.trim(),
      phone:$('stampPhone').value.trim(),
      legal_name:$('stampLegalName').value.trim(),
      inn:$('stampInn').value.trim(),
      kpp:$('stampKpp').value.trim(),
      ogrn:$('stampOgrn').value.trim(),
      legal_address:$('stampLegalAddress').value.trim(),
      actual_address:$('stampActualAddress').value.trim(),
      bank_name:$('stampBankName').value.trim(),
      bik:$('stampBik').value.trim(),
      settlement_account:$('stampSettlement').value.trim(),
      correspondent_account:$('stampCorrespondent').value.trim(),
      signatory_name:$('stampSignatoryName').value.trim(),
      signatory_title:$('stampSignatoryTitle').value.trim(),
      signatory_basis:$('stampSignatoryBasis').value.trim()
    };
  }

  function fillCustomer(c){
    selectedCustomerId=c.id||null;
    const map={
      stampCustomerType:'customer_type',stampFullName:'full_name',stampCompanyName:'company_name',
      stampEmail:'email',stampPhone:'phone',stampLegalName:'legal_name',stampInn:'inn',stampKpp:'kpp',
      stampOgrn:'ogrn',stampLegalAddress:'legal_address',stampActualAddress:'actual_address',
      stampBankName:'bank_name',stampBik:'bik',stampSettlement:'settlement_account',
      stampCorrespondent:'correspondent_account',stampSignatoryName:'signatory_name',
      stampSignatoryTitle:'signatory_title',stampSignatoryBasis:'signatory_basis'
    };
    Object.entries(map).forEach(([id,key])=>{if($(id))$(id).value=c[key]||''});
    $('stampCustomerResults').innerHTML=`<div class="stamp-selected-customer">✓ Выбран клиент HUB: <b>${esc(c.company_name||c.full_name||'Клиент')}</b></div>`;
    if(c.customer_type&&c.customer_type!=='PERSON')$('stampRequisites').open=true;
  }

  async function searchCustomers(q){
    const box=$('stampCustomerResults');if(!box)return;
    if(!q){box.innerHTML='';return}
    box.innerHTML='<div class="stamp-search-state">Поиск…</div>';
    try{
      const {data,error}=await supabase.rpc('search_a4print_stamp_customers',{p_query:q,p_limit:30});
      if(error)throw error;
      const rows=data||[];
      box.innerHTML=rows.map(c=>`<button type="button" data-stamp-customer="${esc(c.id)}"><b>${esc(c.company_name||c.full_name||'Клиент')}</b><small>${esc([c.full_name&&c.company_name?c.full_name:'',c.phone,c.email,c.inn?'ИНН '+c.inn:''].filter(Boolean).join(' · '))}</small></button>`).join('')||'<div class="stamp-search-state">Ничего не найдено — заполните нового клиента.</div>';
      box.querySelectorAll('[data-stamp-customer]').forEach(btn=>btn.onclick=()=>{const c=rows.find(x=>x.id===btn.dataset.stampCustomer);if(c)fillCustomer(c)});
    }catch(error){box.innerHTML=`<div class="stamp-search-state error">Ошибка поиска: ${esc(error.message||error)}</div>`}
  }

  async function uploadFiles(orderId,save){
    const failures=[];
    for(let n=0;n<files.length;n++){
      const file=files[n];save.textContent=`Загрузка файлов ${n+1}/${files.length}…`;
      const path=`${orderId}/${uid()}-${cleanFileName(file.name)}`;
      try{
        const up=await supabase.storage.from('order-files').upload(path,file,{contentType:file.type||'application/octet-stream',cacheControl:'3600',upsert:false});
        if(up.error)throw up.error;
        const meta=await supabase.from('order_files').insert({order_id:orderId,file_name:file.name,file_url:path,mime_type:file.type||null});
        if(meta.error){await supabase.storage.from('order-files').remove([path]).catch(()=>{});throw meta.error}
      }catch(error){console.warn('Stamp order file upload:',file.name,error);failures.push(file.name)}
    }
    return failures;
  }

  async function submit(event){
    event.preventDefault();
    captureItems();
    const err=$('stampOrderError'),save=$('stampOrderSave');err.textContent='';
    const customer=customerPayload();
    if(!customer.full_name&&!customer.company_name&&!customer.legal_name){err.textContent='Укажите ФИО или название клиента.';return}
    for(const [index,item] of items.entries()){
      if(!item.type){err.textContent=`Укажите вид в позиции ${index+1}.`;return}
      if(!(Number(item.quantity)>0)){err.textContent=`Количество в позиции ${index+1} должно быть больше нуля.`;return}
      if(Number(item.unit_price)<0){err.textContent=`Цена в позиции ${index+1} не может быть отрицательной.`;return}
    }
    save.disabled=true;save.textContent='Создаём заказ…';
    try{
      const raw=$('stampDueAt').value;
      const due=raw?new Date(raw).toISOString():null;
      const {data,error}=await supabase.rpc('create_kassa_stamp_order',{
        p_customer:customer,
        p_items:items.map(({key,...item})=>item),
        p_comment:$('stampComment').value.trim()||null,
        p_due_at:due
      });
      if(error)throw error;
      const result=Array.isArray(data)?data[0]:data;
      if(!result?.id)throw new Error('HUB не вернул ID созданного заказа.');
      const failures=files.length?await uploadFiles(result.id,save):[];
      overlay.querySelector('.stamp-order-scroll').innerHTML=`
        <div class="stamp-order-success">
          <div class="stamp-order-success-icon">✓</div>
          <h3>Заказ №${esc(result.order_number||'')} создан в HUB</h3>
          <p>Клиент и реквизиты сохранены. Позиции печатей/штампов переданы в заказ.${failures.length?` Не загрузились файлы: ${esc(failures.join(', '))}.`:''}</p>
          <div><a href="../admin/order.html?id=${encodeURIComponent(result.id)}" target="_blank" rel="noopener">Открыть заказ в HUB</a><button id="stampOrderAnother" type="button">Создать ещё один</button></div>
        </div>`;
      $('stampOrderAnother').onclick=()=>{overlay.remove();overlay=null;ensureUi();open()};
      overlay.querySelector('.stamp-order-foot').hidden=true;
      window.dispatchEvent(new CustomEvent('a4:kassa-stamp-order-created',{detail:result}));
    }catch(error){
      console.error('Kassa stamp order:',error);
      err.textContent=String(error?.message||error);
      save.disabled=false;save.textContent='Создать заказ в HUB';
    }
  }

  function bind(){
    $('stampOrderClose').onclick=close;
    overlay.onclick=e=>{if(e.target===overlay)close()};
    $('stampOrderForm').addEventListener('submit',submit);
    $('stampAddItem').onclick=()=>{captureItems();items.push(blankItem());renderItems();recalc()};
    $('stampItems').addEventListener('input',recalc);
    $('stampItems').addEventListener('change',recalc);
    $('stampItems').addEventListener('click',e=>{const b=e.target.closest('[data-remove-stamp]');if(!b||items.length===1)return;captureItems();items=items.filter(x=>x.key!==b.dataset.removeStamp);renderItems();recalc()});
    $('stampCustomerClear').onclick=()=>{selectedCustomerId=null;['stampFullName','stampPhone','stampEmail','stampCompanyName','stampLegalName','stampInn','stampKpp','stampOgrn','stampLegalAddress','stampActualAddress','stampBankName','stampBik','stampSettlement','stampCorrespondent','stampSignatoryName','stampSignatoryTitle','stampSignatoryBasis'].forEach(id=>{if($(id))$(id).value=''});$('stampCustomerType').value='PERSON';$('stampCustomerSearch').value='';$('stampCustomerResults').innerHTML=''};
    $('stampCustomerSearch').addEventListener('input',()=>{clearTimeout(searchTimer);const q=$('stampCustomerSearch').value.trim();searchTimer=setTimeout(()=>searchCustomers(q),300)});
    $('stampCustomerType').addEventListener('change',()=>{if($('stampCustomerType').value!=='PERSON')$('stampRequisites').open=true});
    $('stampFiles').addEventListener('change',e=>{
      const bad=[];
      for(const file of [...(e.target.files||[])]){if(file.size>MAX_FILE_SIZE)bad.push(file.name);else if(!files.some(x=>x.name===file.name&&x.size===file.size&&x.lastModified===file.lastModified))files.push(file)}
      e.target.value='';renderFiles();if(bad.length)$('stampOrderError').textContent='Не добавлены файлы больше 50 МБ: '+bad.join(', ');
    });
    $('stampFileList').addEventListener('click',e=>{const b=e.target.closest('[data-remove-file]');if(!b)return;files.splice(Number(b.dataset.removeFile),1);renderFiles()});
    window.addEventListener('keydown',e=>{if(e.key==='Escape'&&overlay&&!overlay.hidden)close()});
  }

  window.A4KassaStampOrders=Object.freeze({open});
  function init(){ensureUi()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();