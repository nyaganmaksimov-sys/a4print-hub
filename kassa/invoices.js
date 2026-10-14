(()=>{
'use strict';
if(window.__A4_KASSA_INVOICES__)return;
window.__A4_KASSA_INVOICES__=true;
const cfg=window.A4PRINT_CONFIG||{},API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
const client=window.supabase?.createClient?.(cfg.supabaseUrl,cfg.supabasePublishableKey,{global:{fetch:window.A4SupabaseFetch||fetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
if(!client)return;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
const uid=()=>crypto.randomUUID();
let modal=null,view='list',rows=[],offset=0,more=false,busy=false,items=[],organizations=[],counterparties=[],catalog=[],operationId=null,selectedAgent=null;
async function request(path,options={}){
 const {data,error}=await client.auth.getSession();
 if(error||!data?.session?.access_token)throw Error('Необходимо войти в кассу заново.');
 const r=await fetch(API+'/api/v1/pos/invoices'+path,{method:options.method||'GET',cache:'no-store',headers:{'Authorization':'Bearer '+data.session.access_token,'Content-Type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{})});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(d.message||d.error||'Ошибка МойСклад '+r.status);
 return d;
}
function layout(){
 if(modal)return;
 modal=document.createElement('section');modal.className='invoices-overlay';modal.hidden=true;
 modal.innerHTML='<div class="invoices-shell" role="dialog" aria-modal="true" aria-label="Счета МойСклад"><header class="invoices-head"><div><h2>Счета покупателям</h2><p>МойСклад · все счета, контрагенты и создание новых документов</p></div><button type="button" id="invoicesClose" aria-label="Закрыть">×</button></header><div class="invoices-toolbar"><button id="invoicesBack" hidden type="button">← Назад к списку</button><input id="invoicesFilter" placeholder="Поиск по номеру или контрагенту на загруженной странице"><button id="invoicesReload" type="button">↻ Обновить</button><button id="invoicesNew" class="primary" type="button">+ Новый счёт</button></div><div id="invoicesContent" class="invoices-content"></div><footer class="invoices-footer"><span id="invoicesNotice">Данные загружаются непосредственно из МоегоСклада</span><div id="invoicesPages"></div></footer></div>';
 document.body.appendChild(modal);
 $('invoicesClose').onclick=close;
 $('invoicesBack').onclick=()=>showList();
 $('invoicesReload').onclick=()=>load(offset);
 $('invoicesNew').onclick=()=>newForm();
 $('invoicesFilter').oninput=renderRows;
 modal.addEventListener('click',e=>{if(e.target===modal)close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden&&view==='list')close()});
}
function inform(s,err=false){const x=$('invoicesNotice');if(x){x.textContent=s;x.style.color=err?'#b42318':''}}
function setView(v){view=v;$('invoicesBack').hidden=v==='list';$('invoicesFilter').hidden=v!=='list';$('invoicesReload').hidden=v!=='list';$('invoicesNew').hidden=v!=='list';$('invoicesPages').hidden=v!=='list'}
function open(){layout();modal.hidden=false;document.body.classList.add('invoices-open');showList()}
function close(){if(!modal)return;modal.hidden=true;document.body.classList.remove('invoices-open')}
function showList(){setView('list');$('invoicesContent').innerHTML='<div class="invoices-loading">Загружаем счета из МоегоСклада…</div>';load(0)}
async function load(nextOffset){
 if(busy)return;busy=true;offset=nextOffset;
 inform('Синхронизация списка…');
 try{const d=await request('?offset='+offset);rows=d.invoices||[];more=d.has_more;renderRows();inform('Данные МоегоСклада · '+(d.total==null?'загружено '+rows.length:'всего '+d.total)+' счетов')}
 catch(e){$('invoicesContent').innerHTML='<div class="invoices-error">'+esc(e.message)+'</div>';inform('Ошибка соединения',true)}
 finally{busy=false}
}
function renderRows(){
 if(view!=='list')return;
 const q=String($('invoicesFilter').value||'').trim().toLowerCase();
 const filtered=rows.filter(x=>!q||[x.name,x.agent_name,x.organization_name,x.description].some(v=>String(v||'').toLowerCase().includes(q)));
 $('invoicesContent').innerHTML='<div class="invoices-table-wrap"><table class="invoices-table"><thead><tr><th>№ / Дата</th><th>Контрагент</th><th>Организация</th><th>Сумма</th><th>Оплачено</th><th>Статус</th><th></th></tr></thead><tbody>'+filtered.map(x=>'<tr><td><b>'+esc(x.name)+'</b><small>'+esc(x.moment?.slice(0,16)||'')+'</small></td><td>'+esc(x.agent_name)+'</td><td>'+esc(x.organization_name)+'</td><td><b>'+money(x.sum)+'</b></td><td>'+money(x.payed_sum)+'</td><td>'+esc(x.state||((x.payed_sum>=x.sum&&x.sum>0)?'Оплачен':'—'))+'</td><td><button type="button" data-invoice-id="'+esc(x.id)+'">Открыть</button></td></tr>').join('')+'</tbody></table></div>'+(filtered.length?'':'<p class="invoices-loading">Счета не найдены</p>');
 $('invoicesContent').querySelectorAll('[data-invoice-id]').forEach(b=>b.onclick=()=>details(b.dataset.invoiceId));
 const pages=$('invoicesPages');pages.innerHTML='<button id="invoicesPrev" '+(offset<=0?'disabled':'')+'>← Ранее</button><span>Страница '+(Math.floor(offset/100)+1)+'</span><button id="invoicesNext" '+(!more?'disabled':'')+'>Далее →</button>';
 $('invoicesPrev').onclick=()=>load(Math.max(0,offset-100));$('invoicesNext').onclick=()=>load(offset+100);
}
async function details(id){
 setView('detail');$('invoicesContent').innerHTML='<p class="invoices-loading">Открываем счёт…</p>';
 try{
  const [d,closing]=await Promise.all([request('/'+encodeURIComponent(id)),request('/'+encodeURIComponent(id)+'/closing')]),x=d.invoice;
  const state=closing.fully_paid?'Оплата полностью отражена в МойСклад':'Ожидается оплата / оплата частичная';
  $('invoicesContent').innerHTML='<h3>Счёт №'+esc(x.name)+'</h3><p>Контрагент: <b>'+esc(x.agent_name)+'</b> · Организация: '+esc(x.organization_name)+'</p><p>Дата: '+esc(x.moment||'')+' · Статус: '+esc(x.state||'—')+'</p><div class="invoices-table-wrap"><table class="invoices-table"><thead><tr><th>Товар / услуга</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>'+d.positions.map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+esc(p.quantity)+'</td><td>'+money(p.price)+'</td><td>'+money(p.sum)+'</td></tr>').join('')+'</tbody></table></div><h3>К оплате '+money(x.sum)+' · Оплачено '+money(x.payed_sum)+'</h3>'+
   '<section class="invoice-section" id="invoiceClosingSection"><h3>Оплата и закрывающие документы</h3><p id="invoicePaymentStatus">'+esc(state)+'</p><p>Остаток оплаты: <strong>'+money(closing.outstanding)+'</strong></p>'+
   '<p class="invoices-note">Подтверждение оплаты берётся из документов МоегоСклада. Кнопка проверки не создаёт фиктивное поступление денег.</p>'+
   '<div class="invoice-actions"><button id="invoiceRefreshPayment" type="button">↻ Проверить оплату</button><button id="invoiceConfirmPayment" type="button" '+(closing.fully_paid?'disabled':'')+'>Подтвердить поступление оплаты</button><button id="invoicePrepare" class="primary" type="button" '+(!closing.fully_paid?'disabled':'')+'>Подготовить документы в МойСклад</button></div><div id="invoicePaymentForm"></div>'+
   '<div id="invoiceStoreChooser" hidden></div><div id="invoiceClosingResult"></div><div id="invoicePrintArea"></div><p id="invoiceClosingError" class="invoices-error"></p></section>'+
   (x.href?'<p><a href="'+esc(x.href)+'" target="_blank" rel="noopener noreferrer">Открыть счёт в МойСклад ↗</a></p>':'');
  $('invoiceRefreshPayment').onclick=()=>details(id);
  $('invoiceConfirmPayment').onclick=()=>showPaymentForm(id,closing);
  $('invoicePrepare').onclick=()=>prepareClosing(id,closing);
  renderClosingSummary(id,closing);
 }catch(e){$('invoicesContent').innerHTML='<p class="invoices-error">'+esc(e.message)+'</p>'}
}

let paymentOperationId=null;
async function showPaymentForm(id,closing){
 const box=$('invoicePaymentForm'),notice=$('invoiceClosingError');
 if(!box)return;
 notice.textContent='';
 box.innerHTML='<p class="invoices-loading">Загружаем варианты оплаты…</p>';
 try{
  const d=await request('/'+encodeURIComponent(id)+'/payment-options');
  if(!(d.remaining>0)){await details(id);return}
  paymentOperationId=uid();
  box.innerHTML='<div class="invoice-section"><h4>Подтвердить фактически полученную оплату</h4>'+
   '<p class="invoices-note">Операция создаст реальный финансовый документ в МойСклад. Нажимайте только после получения денег. Частичная оплата допускается.</p>'+
   '<label>Способ поступления<select id="invoicePaymentMethod"><option value="CASH">Наличные в кассу</option><option value="BANK">Банковский перевод на расчётный счёт организации</option></select></label>'+
   '<div id="invoiceBankAccountField" hidden><label>Расчётный счёт организации<select id="invoicePaymentAccount"><option value="">Выберите счёт</option>'+d.bank_accounts.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>').join('')+'</select></label></div>'+
   '<label>Фактически полученная сумма, ₽<input id="invoicePaymentAmount" type="number" min="0.01" step="0.01" max="'+esc(d.remaining)+'" value="'+esc(d.remaining)+'"></label>'+
   '<div class="invoice-actions"><button type="button" id="invoicePaymentCancel">Отмена</button><button type="button" class="primary" id="invoicePaymentSubmit">Подтвердить поступление и записать в МойСклад</button></div><p id="invoicePaymentError" class="invoices-error"></p></div>';
  $('invoicePaymentCancel').onclick=()=>{box.innerHTML='';paymentOperationId=null};
  $('invoicePaymentMethod').onchange=()=>{$('invoiceBankAccountField').hidden=$('invoicePaymentMethod').value!=='BANK'};
  $('invoicePaymentSubmit').onclick=async()=>{
   const method=$('invoicePaymentMethod').value,amount=Number($('invoicePaymentAmount').value),account_id=$('invoicePaymentAccount').value;
   const error=$('invoicePaymentError');error.textContent='';
   if(!Number.isFinite(amount)||amount<=0||amount>d.remaining){error.textContent='Проверьте сумму поступления.';return}
   if(method==='BANK'&&!account_id){error.textContent='Выберите расчётный счёт организации.';return}
   const message=method==='CASH'?'Подтверждаете фактическое получение наличных '+money(amount)+'?':'Подтверждаете зачисление '+money(amount)+' на расчётный счёт организации?';
   if(!window.confirm(message+'\nВ МойСклад будет создан финансовый документ.'))return;
   const button=$('invoicePaymentSubmit');button.disabled=true;button.textContent='Сохраняем платёж…';
   try{
    const result=await request('/'+encodeURIComponent(id)+'/confirm-payment',{method:'POST',body:{operation_id:paymentOperationId,method,account_id,amount}});
    inform(result.message||'Оплата зарегистрирована в МойСклад.');
    await details(id);
   }catch(e){
    error.textContent=e.message+'. Если запрос оборвался, не меняйте идентификатор и не создавайте новый платёж без проверки.';
    button.disabled=false;button.textContent='Повторить с тем же идентификатором';
   }
  };
 }catch(e){box.innerHTML='<p class="invoices-error">'+esc(e.message)+'</p>'}
}

function renderClosingSummary(id,closing){
 const box=$('invoiceClosingResult');if(!box)return;
 box.innerHTML='<div class="invoice-closing-links">'+
  (closing.demand?'<a href="'+esc(closing.demand.url||'#')+'" target="_blank" rel="noopener noreferrer">Отгрузка / реализация №'+esc(closing.demand.name)+' ↗</a>':'<span>Реализация ещё не создана</span>')+
  (closing.facture?'<a href="'+esc(closing.facture.url||'#')+'" target="_blank" rel="noopener noreferrer">Счёт-фактура №'+esc(closing.facture.name)+' ↗</a>':
  '<span>'+((closing.vat_enabled&&closing.vat_sum>0)?'Счёт-фактура ещё не создан':'Счёт-фактура не требуется по данным НДС в счёте')+'</span>')+
  '</div>';
 if(closing.demand){
  $('invoicePrepare').disabled=!(closing.vat_enabled&&closing.vat_sum>0&&!closing.facture);
  const print=$('invoicePrintArea');print.innerHTML='<button id="invoiceLoadPrintForms" type="button">Подобрать печатные формы и распечатать пакет</button><div id="invoicePrintChoices"></div>';
  $('invoiceLoadPrintForms').onclick=()=>loadPrintForms(id);
 }
}
async function prepareClosing(id,closing){
 const button=$('invoicePrepare'),err=$('invoiceClosingError');err.textContent='';
 if(!closing.fully_paid){err.textContent='Оплата ещё не подтверждена МойСклад.';return}
 let storeId=null;
 if(!closing.demand){
   const chooser=$('invoiceStoreChooser');
   if(chooser.hidden){
    try{
     const d=await request('/lookup/stores');
     chooser.hidden=false;
     chooser.innerHTML='<label>Склад фактической отгрузки<select id="invoiceClosingStore"><option value="">Выберите склад</option>'+d.stores.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('')+'</select></label>';
     err.textContent='Выберите склад оформления реализации и снова нажмите «Подготовить документы».';
    }catch(e){err.textContent=e.message}
    return;
   }
   storeId=$('invoiceClosingStore')?.value;
   if(!storeId){err.textContent='Выберите склад оформления реализации.';return}
 }
 if(!window.confirm(closing.items.some(x=>x.type!=='service')?'Подтвердите фактическую отгрузку товара. Создание отгрузки в МойСклад может изменить складские остатки. Продолжить?':'Подтвердите, что услуги оказаны и можно оформить акт/реализацию. Продолжить?'))return;
 button.disabled=true;button.textContent='Создаём документы…';
 try{
  const d=await request('/'+encodeURIComponent(id)+'/closing/prepare',{method:'POST',body:{store_id:storeId}});
  renderClosingSummary(id,d);
  inform('Документы созданы в МойСклад');
  $('invoicePaymentStatus').textContent='Оплата подтверждена данными МоегоСклада';
 }catch(e){err.textContent=e.message;button.disabled=false}
 finally{button.textContent='Подготовить документы в МойСклад'}
}
async function loadPrintForms(id){
 const box=$('invoicePrintChoices');box.textContent='Загружаем формы МойСклад…';
 try{
  const d=await request('/'+encodeURIComponent(id)+'/closing/templates');
  if(!d.documents?.length)throw Error('Печатные формы пока отсутствуют.');
  box.innerHTML='<p>Выберите официальный шаблон для каждого документа. Акт доступен среди шаблонов реализации услуг.</p>'+
   d.documents.map(doc=>'<label>'+esc(doc.type==='invoiceout'?'Счёт покупателю':doc.type==='demand'?'Акт / накладная / УПД':'Счёт-фактура')+
   '<select data-print-document="'+esc(doc.type)+'"><option value="">Выберите форму</option>'+
   doc.templates.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('')+'</select></label>').join('')+
   '<button type="button" id="invoicePrintPack" class="primary">Открыть все выбранные PDF для печати</button><p id="invoicePrintError" class="invoices-error"></p>';
  $('invoicePrintPack').onclick=()=>printPack(id);
 }catch(e){box.textContent=e.message}
}
async function printPack(id){
 const selects=[...document.querySelectorAll('[data-print-document]')].filter(x=>x.value);
 const error=$('invoicePrintError');error.textContent='';
 if(!selects.length){error.textContent='Выберите хотя бы одну печатную форму.';return}
 // Windows must open synchronously on the user gesture so the popup blocker permits them.
 const tabs=selects.map(()=>window.open('about:blank','_blank'));
 if(tabs.some(t=>!t)){tabs.forEach(t=>t?.close());error.textContent='Браузер заблокировал вкладки. Разрешите всплывающие окна для кассы.';return}
 try{
  const {data}=await client.auth.getSession(),token=data?.session?.access_token;
  if(!token)throw Error('Сессия истекла.');
  for(let i=0;i<selects.length;i++){
   const select=selects[i],url=API+'/api/v1/pos/invoices/'+encodeURIComponent(id)+'/closing/pdf?type='+encodeURIComponent(select.dataset.printDocument)+'&template='+encodeURIComponent(select.value);
   const response=await fetch(url,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
   if(!response.ok){const d=await response.json().catch(()=>({}));throw Error(d.message||'Не удалось получить PDF');}
   const blob=await response.blob(),objectUrl=URL.createObjectURL(blob);
   tabs[i].location.href=objectUrl;
  }
  inform('PDF открыты в отдельных вкладках. Для печати используйте Ctrl+P в каждой вкладке.');
 }catch(e){tabs.forEach(t=>{try{t.close()}catch{}});error.textContent=e.message}
}
async function newForm(){
 setView('new');selectedAgent=null;items=[];operationId=uid();catalog=[];counterparties=[];
 $('invoicesContent').innerHTML='<p class="invoices-loading">Получаем юридические лица…</p>';
 try{
  const d=await request('/lookup/organizations');organizations=d.organizations||[];
  if(!organizations.length)throw Error('В МойСклад нет доступных организаций.');
  $('invoicesContent').innerHTML='<form id="invoiceCreateForm" class="invoice-form"><div class="invoice-section"><h3>Новый счёт</h3><label>Наша организация<select id="invoiceOrg">'+organizations.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+(x.inn?' · '+esc(x.inn):'')+'</option>').join('')+'</select></label><label>Контрагент *<input id="invoiceAgentSearch" placeholder="Найти по названию" autocomplete="off"></label><div id="invoiceAgentMatches" class="invoice-suggestions"></div><button id="invoiceAddAgent" type="button">+ Добавить нового контрагента</button><div id="invoiceSelectedAgent"></div><label>Комментарий<input id="invoiceDescription" maxlength="500" placeholder="Например: счёт на печать документов"></label></div><div class="invoice-section"><h3>Товары и услуги</h3><label>Поиск в каталоге МойСклад<input id="invoiceCatalogSearch" autocomplete="off" placeholder="Начните вводить название"></label><div id="invoiceCatalogMatches" class="invoice-suggestions"></div><div id="invoiceLines"></div><div id="invoiceTotal"></div></div><div class="invoice-actions"><button type="button" id="invoiceCancel">Отмена</button><button class="primary" id="invoiceSubmit" type="submit">Создать счёт в МойСклад</button></div><div id="invoiceError"></div></form>';
  $('invoiceCancel').onclick=showList;
  $('invoiceAgentSearch').oninput=debounce(findAgents,300);
  $('invoiceCatalogSearch').oninput=debounce(findCatalog,300);
  $('invoiceAddAgent').onclick=addAgentForm;
  $('invoiceCreateForm').onsubmit=createInvoice;
  drawLines();
 }catch(e){$('invoicesContent').innerHTML='<p class="invoices-error">'+esc(e.message)+'</p>'}
}
function debounce(fn,delay){let id;return()=>{clearTimeout(id);id=setTimeout(fn,delay)}}
async function findAgents(){
 const q=$('invoiceAgentSearch').value.trim();if(!q)return $('invoiceAgentMatches').innerHTML='';
 try{
  const d=await request('/lookup/counterparties?q='+encodeURIComponent(q));counterparties=d.counterparties||[];
  $('invoiceAgentMatches').innerHTML=counterparties.map((c,i)=>'<button type="button" data-select-agent="'+i+'">'+esc(c.name)+(c.inn?' · '+esc(c.inn):'')+'</button>').join('')||'Не найдено — можно создать нового контрагента';
  $('invoiceAgentMatches').querySelectorAll('[data-select-agent]').forEach(b=>b.onclick=()=>chooseAgent(counterparties[Number(b.dataset.selectAgent)]));
 }catch(e){$('invoiceAgentMatches').textContent=e.message}
}
function chooseAgent(c){selectedAgent=c;$('invoiceSelectedAgent').innerHTML='<b>Выбран: '+esc(c.name)+'</b>';$('invoiceAgentMatches').innerHTML='';$('invoiceAgentSearch').value=c.name;$('invoiceNewAgentFields')?.remove()}
function addAgentForm(){
 if($('invoiceNewAgentFields'))return;
 const el=document.createElement('div');el.id='invoiceNewAgentFields';el.className='invoice-new-agent';
 el.innerHTML='<h4>Новый контрагент в МойСклад</h4><label>Название / ФИО *<input id="invoiceNewAgentName" maxlength="200"></label><label>ИНН (если есть)<input id="invoiceNewAgentInn" maxlength="12" inputmode="numeric"></label><label>Телефон<input id="invoiceNewAgentPhone" maxlength="50"></label><label>Email<input id="invoiceNewAgentEmail" type="email"></label><button type="button" id="invoiceSaveAgent" class="primary">Сохранить контрагента</button><span id="invoiceAgentError"></span>';
 $('invoiceAddAgent').after(el);$('invoiceSaveAgent').onclick=saveAgent;
}
async function saveAgent(){
 const b=$('invoiceSaveAgent');b.disabled=true;$('invoiceAgentError').textContent='';
 try{
  const d=await request('/lookup/counterparties',{method:'POST',body:{name:$('invoiceNewAgentName').value,inn:$('invoiceNewAgentInn').value,phone:$('invoiceNewAgentPhone').value,email:$('invoiceNewAgentEmail').value}});
  chooseAgent(d.counterparty);
 }catch(e){$('invoiceAgentError').textContent=e.message}finally{b.disabled=false}
}
async function findCatalog(){
 const q=$('invoiceCatalogSearch').value.trim();if(!q)return $('invoiceCatalogMatches').innerHTML='';
 try{
  const d=await request('/lookup/assortment?q='+encodeURIComponent(q));catalog=d.items||[];
  $('invoiceCatalogMatches').innerHTML=catalog.map((c,i)=>'<button type="button" data-pick-item="'+i+'">'+esc(c.name)+' · '+money(c.price)+'</button>').join('')||'Нет совпадений в каталоге';
  $('invoiceCatalogMatches').querySelectorAll('[data-pick-item]').forEach(b=>b.onclick=()=>{
   const x=catalog[Number(b.dataset.pickItem)];items.push({...x,quantity:1});$('invoiceCatalogSearch').value='';$('invoiceCatalogMatches').innerHTML='';drawLines();
  });
 }catch(e){$('invoiceCatalogMatches').textContent=e.message}
}
function drawLines(){
 const box=$('invoiceLines');if(!box)return;
 box.innerHTML=items.map((x,i)=>'<div class="invoice-line"><span>'+esc(x.name)+'</span><label>Количество<input type="number" min="0.001" step="any" data-line-qty="'+i+'" value="'+x.quantity+'"></label><label>Цена, ₽<input type="number" min="0" step="0.01" data-line-price="'+i+'" value="'+x.price+'"></label><button type="button" data-line-remove="'+i+'">×</button></div>').join('');
 box.querySelectorAll('[data-line-qty]').forEach(b=>b.onchange=()=>{const n=Number(b.value);if(n>0&&Number.isFinite(n))items[Number(b.dataset.lineQty)].quantity=n;else b.value=items[Number(b.dataset.lineQty)].quantity;drawTotal()});
 box.querySelectorAll('[data-line-price]').forEach(b=>b.onchange=()=>{const n=Number(b.value);if(n>=0&&Number.isFinite(n))items[Number(b.dataset.linePrice)].price=n;else b.value=items[Number(b.dataset.linePrice)].price;drawTotal()});
 box.querySelectorAll('[data-line-remove]').forEach(b=>b.onclick=()=>{items.splice(Number(b.dataset.lineRemove),1);drawLines()});
 drawTotal();
}
function drawTotal(){$('invoiceTotal').textContent='Итого по счёту: '+money(items.reduce((a,x)=>a+x.price*x.quantity,0))}
async function createInvoice(e){
 e.preventDefault();const error=$('invoiceError'),button=$('invoiceSubmit');error.textContent='';
 if(!selectedAgent)return error.textContent='Выберите или создайте контрагента.';
 if(!items.length)return error.textContent='Добавьте товар или услугу.';
 button.disabled=true;button.textContent='Создаём счёт…';
 try{
  const d=await request('',{method:'POST',body:{operation_id:operationId,agent_id:selectedAgent.id,organization_id:$('invoiceOrg').value,description:$('invoiceDescription').value,items:items.map(({id,type,quantity,price})=>({id,type,quantity,price}))}});
  $('invoicesContent').innerHTML='<div class="invoices-success"><h3>Счёт №'+esc(d.invoice.name)+' создан в МойСклад</h3><p>Контрагент: '+esc(selectedAgent.name)+'</p><p>Сумма: '+money(d.invoice.sum)+'</p><button id="invoiceReturn" type="button">Перейти к счетам</button></div>';
  $('invoiceReturn').onclick=showList;inform('Документ сохранён в МойСклад');
 }catch(ex){error.textContent=ex.message;button.disabled=false;button.textContent='Создать счёт в МойСклад'}
}
function nav(){
 const menu=document.querySelector('.nav-menu');
 if(menu&&!$('navInvoices')){
  const b=document.createElement('button');b.id='navInvoices';b.className='nav-item';b.type='button';b.innerHTML='<span class="nav-icon">▤</span><b>Счета</b>';b.onclick=()=>{document.getElementById('appView')?.classList.remove('nav-open');open()};
  const orders=$('navHubOrders')||$('navCreateOrder');if(orders?.nextSibling)menu.insertBefore(b,orders.nextSibling);else menu.insertBefore(b,menu.querySelector('[data-section="returns"]')||null);
 }
}
function init(){layout();nav();const app=$('appView');if(app)new MutationObserver(nav).observe(app,{attributes:true,attributeFilter:['hidden']});setInterval(nav,3500)}
window.A4KassaInvoices=Object.freeze({open});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();