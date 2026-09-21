(()=>{
  'use strict';
  if(window.__A4_KASSA_PARTNER_ORDERS__)return;
  window.__A4_KASSA_PARTNER_ORDERS__=true;

  const cfg=window.A4PRINT_CONFIG||{};
  const create=window.supabase?.createClient;
  if(!create)return;
  const supabase=window.__A4_KASSA_PARTNER_ORDER_SUPABASE__||(window.__A4_KASSA_PARTNER_ORDER_SUPABASE__=create(
    cfg.supabaseUrl,cfg.supabasePublishableKey,
    {global:{fetch:window.A4SupabaseFetch||fetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}
  ));
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})+' ₽';
  const MAX_FILE_SIZE=50*1024*1024;
  const FLOW={
    MEMORIAL:{title:'Памятники / фотокерамика',partner:'Сфера',url:'https://sferazakaz.ru/katalog/fotokeramika',presets:['Портрет для памятника','Ритуальная табличка','Портрет большого размера','Портрет под живопись / гризайль','Арка / сложная форма','Фото на стекле','Металлофото','Имитация гравировки','Икона','Временная табличка','Вкладка в цветник'],labels:['Материал','Размер / форма','Цветность','Ретушь / отверстия']},
    SOUVENIR:{title:'Сувениры и знаки',partner:'Сфера',url:'https://sferazakaz.ru/',presets:['Информационный знак','Табличка','Сувенирная продукция','Памятное изделие','Нестандартное изделие'],labels:['Материал','Размер / габариты','Цвет / нанесение','Обработка / крепление']},
    TYPOGRAPHY:{title:'Типография',partner:'Группа М',url:'https://gmprint.ru/',presets:['Визитки','Бирки','Листовки','Буклеты','Каталоги','Календари','Открытки','Другая полиграфия'],labels:['Бумага / материал','Формат','Цветность / стороны','Постпечатная обработка']},
    WIDE_FORMAT:{title:'Широкоформатная печать',department:'А4-Принт',url:null,presets:['Баннер','Плакат / постер','Самоклеящаяся плёнка','Холст','Фотообои','Roll-Up / X-banner','Чертёж / схема','Другое'],labels:['Материал','Размер / формат','Качество / цветность','Постпечатная обработка'],textLabel:'Монтаж / дополнительные требования',costLabel:'Плановая себестоимость за ед., ₽'},
    THREE_D:{title:'3D-печать',department:'3D-ARTPRINT',url:null,presets:['FDM-печать','Фотополимерная печать','Прототип','Деталь / запчасть','Макет / модель','Сувенир / фигурка','Серийная печать','Другое'],labels:['Технология / материал','Размер / габариты','Цвет / смола','Качество / постобработка'],textLabel:'Заполнение / поддержка / требования',costLabel:'Плановая себестоимость за ед., ₽'},
    OUTDOOR:{title:'Наружная реклама',department:'3D-ARTPRINT',url:null,presets:['Вывеска','Световой короб','Объёмные буквы','Табличка','Навигация / указатель','Оформление витрины','Брендирование фасада','Стенд','Другое'],labels:['Материал','Размер / габариты','Подсветка / цвет','Крепление / монтаж'],textLabel:'Адрес монтажа / дополнительные требования',costLabel:'Плановая себестоимость за ед., ₽'}
  };
  let overlay=null,flow='MEMORIAL',selectedCustomerId=null,files=[],searchTimer=null;

  function uid(){return crypto.randomUUID?crypto.randomUUID():`po-${Date.now()}-${Math.random().toString(36).slice(2)}`}
  function cleanFileName(name){return String(name||'file').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'-').replace(/\s+/g,' ').trim().slice(-150)||'file'}

  function ensureUi(){
    if(overlay)return;
    overlay=document.createElement('section');
    overlay.className='partner-order-overlay';overlay.hidden=true;
    overlay.innerHTML=`
      <div class="partner-order-shell" role="dialog" aria-modal="true" aria-label="Оформление заказа">
        <header class="partner-order-head"><div><h2>Оформление заказа</h2><p>Заполните клиента, параметры производства, стоимость, срок и приложите необходимые файлы.</p></div><button id="partnerOrderClose" type="button">×</button></header>
        <form id="partnerOrderForm">
          <div class="partner-order-scroll">
            <section class="partner-order-card">
              <div class="partner-flow-cards">
                <button type="button" data-partner-flow="MEMORIAL" class="active"><b>Памятники / фотокерамика</b><small>Сфера</small></button>
                <button type="button" data-partner-flow="SOUVENIR"><b>Сувениры и знаки</b><small>Сфера</small></button>
                <button type="button" data-partner-flow="TYPOGRAPHY"><b>Типография</b><small>Группа М</small></button>
                <button type="button" data-partner-flow="WIDE_FORMAT"><b>Широкоформатная печать</b><small>А4-Принт</small></button>
                <button type="button" data-partner-flow="THREE_D"><b>3D-печать</b><small>3D-ARTPRINT</small></button>
                <button type="button" data-partner-flow="OUTDOOR"><b>Наружная реклама</b><small>3D-ARTPRINT</small></button>
              </div>
              <div class="partner-flow-info"><div><span id="partnerFlowPartner">Сфера</span><b id="partnerFlowTitle"></b></div><a id="partnerFlowCatalog" target="_blank" rel="noopener noreferrer">Открыть каталог ↗</a></div>
              <div id="partnerPresetList" class="partner-preset-list"></div>
            </section>

            <section class="partner-order-card">
              <div class="partner-section-head"><div><h3>Клиент</h3><p>Найдите клиента HUB или заполните нового.</p></div><button id="partnerCustomerClear" type="button">Новый клиент</button></div>
              <input id="partnerCustomerSearch" class="partner-search" autocomplete="off" placeholder="Имя, компания, телефон, email или ИНН">
              <div id="partnerCustomerResults" class="partner-customer-results"></div>
              <div class="partner-form-grid">
                <label><span>Тип клиента</span><select id="partnerCustomerType"><option value="PERSON">Физлицо</option><option value="IP">ИП</option><option value="LEGAL">ООО / юрлицо</option></select></label>
                <label><span>ФИО / контактное лицо *</span><input id="partnerFullName" required></label>
                <label><span>Компания</span><input id="partnerCompanyName"></label>
                <label><span>Телефон</span><input id="partnerPhone" autocomplete="tel"></label>
                <label><span>Email</span><input id="partnerEmail" type="email" autocomplete="email"></label>
                <label><span>ИНН</span><input id="partnerInn" inputmode="numeric"></label>
              </div>
            </section>

            <section class="partner-order-card">
              <div class="partner-section-head"><div><h3>Параметры заказа</h3><p>Эти данные сразу попадут в карточку заказа HUB.</p></div></div>
              <div class="partner-form-grid">
                <label class="wide"><span>Изделие / услуга *</span><input id="partnerItemName" required placeholder="Выберите выше или введите вручную"></label>
                <label><span id="partnerMaterialLabel">Материал</span><input id="partnerMaterial"></label>
                <label><span id="partnerFormatLabel">Размер / форма</span><input id="partnerFormat"></label>
                <label><span id="partnerColorLabel">Цветность</span><input id="partnerColor"></label>
                <label><span id="partnerFinishingLabel">Обработка</span><input id="partnerFinishing"></label>
                <label class="wide"><span>Артикул / модель / ссылка</span><input id="partnerReference" placeholder="Артикул партнёра или ссылка на товар"></label>
                <label class="wide"><span id="partnerTextLabel">Текст / данные для макета</span><textarea id="partnerText" rows="3" placeholder="ФИО, даты, надпись, персонализация или примечания к макету"></textarea></label>
                <label><span>Количество / тираж *</span><input id="partnerQty" type="number" min="1" step="1" value="1"></label>
                <label><span>Цена клиенту за ед., ₽ *</span><input id="partnerPrice" type="number" min="0" step="0.01" value="0"></label>
                <label><span id="partnerCostLabel">Цена партнёра за ед., ₽</span><input id="partnerCost" type="number" min="0" step="0.01" value="0"></label>
                <label><span>Желаемый срок</span><input id="partnerDueAt" type="datetime-local"></label>
                <label class="wide"><span>Комментарий клиента</span><textarea id="partnerComment" rows="3"></textarea></label>
                <label class="wide"><span>Файлы заказа</span><input id="partnerFiles" type="file" multiple></label>
              </div>
              <div id="partnerFileList" class="partner-file-list"></div>
              <div id="partnerOrderEconomics" class="partner-economics"></div>
            </section>
          </div>
          <footer class="partner-order-foot"><div><span>Итого клиенту</span><strong id="partnerOrderTotal">0 ₽</strong><small id="partnerOrderError"></small></div><button id="partnerOrderSave" type="submit">Создать заказ в HUB</button></footer>
        </form>
      </div>`;
    document.body.appendChild(overlay);bind();setFlow('MEMORIAL');reset();
  }

  function addLaunchers(){
    const nav=document.querySelector('.nav-menu');
    if(nav&&!$('navPartnerOrder')){
      const b=document.createElement('button');b.id='navPartnerOrder';b.className='nav-item';b.type='button';
      b.innerHTML='<span class="nav-icon">◇</span><b>Памятники /<br>Типография</b>';
      b.onclick=()=>{document.getElementById('appView')?.classList.remove('nav-open');open()};
      const stamp=$('navStampOrder');if(stamp&&stamp.nextSibling)nav.insertBefore(b,stamp.nextSibling);else nav.insertBefore(b,nav.querySelector('[data-section="returns"]')||null);
    }
    // Быстрая кнопка каталога создаётся единым меню оформления заказов.
  }

  function open(nextFlow=flow){ensureUi();if(FLOW[nextFlow])setFlow(nextFlow);overlay.hidden=false;document.body.classList.add('partner-order-open');setTimeout(()=>$('partnerFullName')?.focus(),0)}
  function close(){if(!overlay)return;overlay.hidden=true;document.body.classList.remove('partner-order-open')}

  function reset(){
    selectedCustomerId=null;files=[];
    $('partnerOrderForm')?.reset();$('partnerQty').value='1';$('partnerPrice').value='0';$('partnerCost').value='0';
    $('partnerCustomerResults').innerHTML='';$('partnerOrderError').textContent='';renderFiles();recalc();setFlow(flow);
  }

  function setFlow(next){
    if(!FLOW[next])return;flow=next;const f=FLOW[flow];
    overlay?.querySelectorAll('[data-partner-flow]').forEach(b=>b.classList.toggle('active',b.dataset.partnerFlow===flow));
    $('partnerFlowPartner').textContent=f.partner||f.department||'A4PRINT';$('partnerFlowTitle').textContent=f.title;
    const catalog=$('partnerFlowCatalog');if(f.url){catalog.href=f.url;catalog.hidden=false}else{catalog.removeAttribute('href');catalog.hidden=true}
    [$('partnerMaterialLabel'),$('partnerFormatLabel'),$('partnerColorLabel'),$('partnerFinishingLabel')].forEach((el,i)=>{if(el)el.textContent=f.labels[i]});
    $('partnerTextLabel').textContent=f.textLabel||(flow==='MEMORIAL'?'ФИО / даты / текст на изделии':flow==='TYPOGRAPHY'?'Примечания к макету':'Текст / дополнительные данные');
  $('partnerCostLabel').textContent=f.costLabel||(f.partner?'Цена партнёра за ед., ₽':'Плановая себестоимость за ед., ₽');
    $('partnerPresetList').innerHTML=f.presets.map((x,i)=>'<button type="button" data-partner-preset="'+i+'">'+esc(x)+'</button>').join('');
    $('partnerItemName').value='';
  }

  function recalc(){
    const qty=Math.max(0,Number($('partnerQty')?.value||0)),price=Math.max(0,Number($('partnerPrice')?.value||0)),cost=Math.max(0,Number($('partnerCost')?.value||0));
    const total=qty*price,planned=qty*cost,profit=total-planned,margin=total>0?profit/total*100:0;
    const costTitle=FLOW[flow]?.partner?'Партнёр':'Себестоимость';
    $('partnerOrderTotal').textContent=money(total);
    $('partnerOrderEconomics').innerHTML='<div><span>Клиент</span><b>'+money(total)+'</b></div><div><span>'+costTitle+'</span><b>'+money(planned)+'</b></div><div><span>Плановая прибыль</span><b class="'+(profit<0?'negative':'')+'">'+money(profit)+'</b><small>'+margin.toLocaleString('ru-RU',{maximumFractionDigits:1})+'%</small></div>';
  }

  function clearCustomer(){selectedCustomerId=null;for(const id of ['partnerFullName','partnerCompanyName','partnerPhone','partnerEmail','partnerInn'])$(id).value='';$('partnerCustomerResults').innerHTML=''}
  function fillCustomer(c){selectedCustomerId=c.id;$('partnerCustomerType').value=c.customer_type||'PERSON';$('partnerFullName').value=c.full_name||'';$('partnerCompanyName').value=c.company_name||'';$('partnerPhone').value=c.phone||'';$('partnerEmail').value=c.email||'';$('partnerInn').value=c.inn||'';$('partnerCustomerResults').innerHTML='<div class="partner-selected-customer">✓ '+esc(c.company_name||c.full_name||'Клиент')+'</div>'}

  async function searchCustomers(q){
    const box=$('partnerCustomerResults');if(!q){box.innerHTML='';return}box.innerHTML='<div class="partner-search-state">Поиск…</div>';
    try{
      const {data,error}=await supabase.rpc('search_a4print_stamp_customers',{p_query:q,p_limit:20});if(error)throw error;
      const rows=data||[];box.innerHTML=rows.map(c=>'<button type="button" data-partner-customer="'+esc(c.id)+'"><b>'+esc(c.company_name||c.full_name||'Клиент')+'</b><small>'+esc([c.full_name&&c.company_name?c.full_name:'',c.phone,c.email,c.inn?'ИНН '+c.inn:''].filter(Boolean).join(' · '))+'</small></button>').join('')||'<div class="partner-search-state">Не найден — заполните нового клиента.</div>';
      box.querySelectorAll('[data-partner-customer]').forEach(btn=>btn.onclick=()=>{const c=rows.find(x=>x.id===btn.dataset.partnerCustomer);if(c)fillCustomer(c)});
    }catch(error){box.innerHTML='<div class="partner-search-state error">'+esc(error.message||error)+'</div>'}
  }

  function renderFiles(){$('partnerFileList').innerHTML=files.map((f,i)=>'<span><b>'+esc(f.name)+'</b><small>'+((f.size/1024/1024).toFixed(1))+' МБ</small><button type="button" data-remove-partner-file="'+i+'">×</button></span>').join('')}
  async function uploadFiles(orderId,save){
    const failures=[];
    for(let i=0;i<files.length;i++){
      const file=files[i];save.textContent='Загрузка файлов '+(i+1)+'/'+files.length+'…';const path=orderId+'/'+uid()+'-'+cleanFileName(file.name);
      try{
        const up=await supabase.storage.from('order-files').upload(path,file,{contentType:file.type||'application/octet-stream',cacheControl:'3600',upsert:false});if(up.error)throw up.error;
        const meta=await supabase.from('order_files').insert({order_id:orderId,file_name:file.name,file_url:path,mime_type:file.type||null});if(meta.error)throw meta.error;
      }catch(error){console.warn('Partner order file upload',error);failures.push(file.name)}
    }
    return failures;
  }

  async function submit(e){
    e.preventDefault();const err=$('partnerOrderError'),save=$('partnerOrderSave');err.textContent='';
    const fullName=$('partnerFullName').value.trim(),company=$('partnerCompanyName').value.trim(),item=$('partnerItemName').value.trim(),qty=Number($('partnerQty').value||0),price=Number($('partnerPrice').value||0),cost=Number($('partnerCost').value||0);
    if(!fullName&&!company){err.textContent='Укажите клиента.';return}if(!item){err.textContent='Укажите изделие или услугу.';return}if(!(qty>0)){err.textContent='Количество должно быть больше нуля.';return}if(price<0||cost<0){err.textContent='Цена не может быть отрицательной.';return}
    save.disabled=true;save.textContent='Создаём заказ…';
    try{
      const customer={id:selectedCustomerId,customer_type:$('partnerCustomerType').value,full_name:fullName,company_name:company,phone:$('partnerPhone').value.trim(),email:$('partnerEmail').value.trim(),inn:$('partnerInn').value.trim()};
      const current=FLOW[flow];
      const isPartner=Boolean(current.partner);
      const order={workflow:flow,item_name:item,material:$('partnerMaterial').value.trim(),format:$('partnerFormat').value.trim(),color:$('partnerColor').value.trim(),finishing:$('partnerFinishing').value.trim(),reference:$('partnerReference').value.trim(),text:$('partnerText').value.trim(),quantity:qty,unit_price:price};
      if(isPartner)order.partner_unit_cost=cost;else order.planned_unit_cost=cost;
      const raw=$('partnerDueAt').value,due=raw?new Date(raw).toISOString():null;
      const rpc=isPartner?'create_kassa_partner_order':'create_kassa_production_order';
      const {data,error}=await supabase.rpc(rpc,{p_customer:customer,p_order:order,p_comment:$('partnerComment').value.trim()||null,p_due_at:due});if(error)throw error;
      const result=Array.isArray(data)?data[0]:data;if(!result?.id)throw new Error('HUB не вернул ID заказа.');
      const failures=files.length?await uploadFiles(result.id,save):[];
      const current=FLOW[flow];const planned=result.partner_planned_cost??result.planned_total_cost??0;
      overlay.querySelector('.partner-order-scroll').innerHTML='<div class="partner-order-success"><div>✓</div><h3>Заказ №'+esc(result.order_number||'')+' создан</h3><p>'+esc(current.partner||current.department||'A4PRINT')+' · '+esc(current.title)+'. Плановая себестоимость '+money(planned)+'.'+(failures.length?' Не загрузились: '+esc(failures.join(', '))+'.':'')+'</p><div><a href="../admin/order.html?id='+encodeURIComponent(result.id)+'">Открыть заказ HUB</a><button id="partnerOrderAnother" type="button">Ещё заказ</button></div></div>';
      $('partnerOrderSave').hidden=true;$('partnerOrderAnother').onclick=()=>{close();location.reload()};
    }catch(error){err.textContent='Не удалось создать заказ: '+String(error.message||error)}
    finally{save.disabled=false;save.textContent='Создать заказ в HUB'}
  }

  function bind(){
    $('partnerOrderClose').onclick=close;overlay.onclick=e=>{if(e.target===overlay)close()};
    overlay.querySelectorAll('[data-partner-flow]').forEach(b=>b.onclick=()=>setFlow(b.dataset.partnerFlow));
    $('partnerPresetList').onclick=e=>{const b=e.target.closest('[data-partner-preset]');if(!b)return;const name=FLOW[flow].presets[Number(b.dataset.partnerPreset)];$('partnerItemName').value=name||'';overlay.querySelectorAll('[data-partner-preset]').forEach(x=>x.classList.toggle('active',x===b))};
    $('partnerCustomerClear').onclick=clearCustomer;$('partnerCustomerSearch').oninput=e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>searchCustomers(e.target.value.trim()),250)};
    for(const id of ['partnerQty','partnerPrice','partnerCost'])$(id).addEventListener('input',recalc);
    $('partnerFiles').onchange=e=>{for(const f of [...e.target.files]){if(f.size<=MAX_FILE_SIZE)files.push(f)}renderFiles();e.target.value=''};
    $('partnerFileList').onclick=e=>{const b=e.target.closest('[data-remove-partner-file]');if(!b)return;files.splice(Number(b.dataset.removePartnerFile),1);renderFiles()};
    $('partnerOrderForm').onsubmit=submit;
  }

  window.A4KassaPartnerOrders=Object.freeze({open,flows:Object.keys(FLOW)});
  function init(){ensureUi();addLaunchers();const app=$('appView');if(app)new MutationObserver(()=>{if(!app.hidden)addLaunchers()}).observe(app,{attributes:true,attributeFilter:['hidden']});setInterval(addLaunchers,3000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();