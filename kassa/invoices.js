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
  const d=await request('/'+encodeURIComponent(id)),x=d.invoice;
  $('invoicesContent').innerHTML='<h3>Счёт №'+esc(x.name)+'</h3><p>Контрагент: <b>'+esc(x.agent_name)+'</b> · Организация: '+esc(x.organization_name)+'</p><p>Дата: '+esc(x.moment||'')+' · Статус: '+esc(x.state||'—')+'</p><div class="invoices-table-wrap"><table class="invoices-table"><thead><tr><th>Товар / услуга</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>'+d.positions.map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+esc(p.quantity)+'</td><td>'+money(p.price)+'</td><td>'+money(p.sum)+'</td></tr>').join('')+'</tbody></table></div><h3>К оплате '+money(x.sum)+' · Оплачено '+money(x.payed_sum)+'</h3>'+(x.href?'<a href="'+esc(x.href)+'" target="_blank" rel="noopener noreferrer">Открыть документ в МойСклад ↗</a>':'');
 }catch(e){$('invoicesContent').innerHTML='<p class="invoices-error">'+esc(e.message)+'</p>'}
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