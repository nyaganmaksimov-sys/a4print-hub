import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg=window.A4PRINT_CONFIG||{};
const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
const rub=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})+' ₽';
const dt=v=>v?new Date(v).toLocaleString('ru-RU'):'—';
const pct=(v,max)=>max>0?Math.max(4,Math.round(Number(v||0)/max*100)):0;
const setText=(id,text)=>{const e=$(id);if(e)e.textContent=text};

let session=null,profile=null,isAdmin=false,isOperator=false,org=null;
let goods=[],accounts=[],operators=[],selectedOperatorId='',shift=null,stock={},cart=[],customer=null;
let type='ALL',installPrompt=null,reportPeriod='today',searchTimer=null,favorites=new Set();

function note(text,error=false){const n=$('notice');if(!n)return;n.textContent=text;n.className='notice'+(error?' error':'');n.style.display='block';clearTimeout(note.t);note.t=setTimeout(()=>n.style.display='none',3800)}
async function api(path,opt={}){const r=await fetch((cfg.apiBaseUrl||'')+path,{...opt,headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json',...(opt.headers||{})}});const text=await r.text();let d={};try{d=text?JSON.parse(text):{}}catch{}if(!r.ok)throw new Error(d.message||d.error||`HTTP ${r.status}`);return d}
function favKey(){return `a4_pos_favorites_v2_${profile?.id||session?.user?.id||'default'}`}
function loadFavorites(){try{favorites=new Set(JSON.parse(localStorage.getItem(favKey())||'[]'))}catch{favorites=new Set()}}
function saveFavorites(){try{localStorage.setItem(favKey(),JSON.stringify([...favorites]))}catch{}}

function setupShell(){
  const navLabels={sale:'Продажа',reports:'Отчёты',sync:'МойСклад'};
  document.querySelectorAll('[data-view]').forEach(b=>{if(navLabels[b.dataset.view])b.textContent=navLabels[b.dataset.view]});
  const nav=document.querySelector('.pos-nav');
  if(nav){
    [...nav.querySelectorAll('a')].forEach(a=>{
      if(a.getAttribute('href')==='./returns.html')a.textContent='Возвраты';
      if(a.getAttribute('href')?.includes('customers.html'))a.textContent='Клиенты';
      if(a.getAttribute('href')?.includes('operators.html'))a.textContent='Операторы';
      if(a.getAttribute('href')?.includes('index.html')&&a.closest('#adminLinks'))a.textContent='Панель управления';
    });
  }
  const filters=document.querySelector('.filters');
  if(filters&&!$('favoriteFilter')){
    const fav=document.createElement('button');fav.id='favoriteFilter';fav.className='filter';fav.type='button';fav.textContent='★ Избранное';fav.onclick=()=>{type='FAVORITES';syncFilterButtons();renderGoods()};filters.appendChild(fav);
    const custom=document.createElement('button');custom.id='customItemBtn';custom.className='filter custom-filter';custom.type='button';custom.textContent='+ Своя позиция';custom.onclick=openCustomDialog;filters.appendChild(custom);
  }
  setupClientCollapse();
  setupCustomDialog();
}

function setupClientCollapse(){
  const box=document.querySelector('.client-box');if(!box||box.dataset.ready)return;box.dataset.ready='1';
  const title=box.querySelector(':scope > b');
  const body=document.createElement('div');body.className='client-body';
  [...box.children].forEach(el=>{if(el!==title)body.appendChild(el)});
  const toggle=document.createElement('button');toggle.type='button';toggle.className='client-toggle';toggle.innerHTML='<span>Клиент</span><small>добавить / выбрать</small><b>⌄</b>';
  if(title)title.replaceWith(toggle);else box.prepend(toggle);box.appendChild(body);box.classList.add('client-collapsed');
  toggle.onclick=()=>box.classList.toggle('client-collapsed');
}

function setupCustomDialog(){
  if($('customDialog'))return;
  const wrap=document.createElement('div');wrap.id='customDialog';wrap.className='custom-dialog';wrap.setAttribute('aria-hidden','true');
  wrap.innerHTML=`<div class="custom-dialog-card"><div class="custom-dialog-head"><div><b>Своя позиция</b><small>Название и цена для текущего чека</small></div><button id="customClose" type="button">×</button></div><label>Название<input id="customName" placeholder="Например: дизайн по макету"></label><div class="custom-row"><label>Цена, ₽<input id="customPrice" type="number" min="0.01" step="0.01" inputmode="decimal"></label><label>Количество<input id="customQty" type="number" min="1" step="1" value="1"></label></div><label>Позиция для синхронизации с МойСклад<select id="customBase"></select><small>В МойСклад продажа пройдет по выбранной базовой услуге, а в отчётах HUB сохранится ваше название.</small></label><div class="custom-actions"><button id="customCancel" class="btn light" type="button">Отмена</button><button id="customAdd" class="btn primary" type="button">Добавить в чек</button></div></div>`;
  document.body.appendChild(wrap);
  $('customClose').onclick=closeCustomDialog;$('customCancel').onclick=closeCustomDialog;$('customAdd').onclick=addCustomItem;
  wrap.onclick=e=>{if(e.target===wrap)closeCustomDialog()};
}
function customBases(){const services=goods.filter(g=>g.item_type==='SERVICE');return services.length?services:goods}
function openCustomDialog(){
  const bases=customBases();if(!bases.length)return note('Сначала синхронизируйте каталог МойСклад',true);
  $('customBase').innerHTML=bases.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join('');
  $('customName').value='';$('customPrice').value='';$('customQty').value='1';
  $('customDialog').classList.add('open');$('customDialog').setAttribute('aria-hidden','false');setTimeout(()=>$('customName')?.focus(),40);
}
function closeCustomDialog(){$('customDialog')?.classList.remove('open');$('customDialog')?.setAttribute('aria-hidden','true')}
function addCustomItem(){
  const name=$('customName').value.trim(),price=Number($('customPrice').value),qty=Math.max(1,Number($('customQty').value||1)),base=goods.find(g=>g.id===$('customBase').value);
  if(!name)return note('Укажите название своей позиции',true);if(!(price>0))return note('Укажите цену больше нуля',true);if(!base)return note('Выберите базовую услугу МойСклад',true);
  cart.push({key:`custom-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,id:base.id,name,price,qty,custom:true,base_name:base.name});
  closeCustomDialog();renderCart();note('Своя позиция добавлена в чек');
}

async function init(){
  const s=await supabase.auth.getSession();session=s.data.session;
  if(!session){location.replace('./login.html?next='+encodeURIComponent(location.pathname));return}
  const [a,o,p]=await Promise.all([
    supabase.rpc('has_role',{required_role:'ADMIN'}),supabase.rpc('has_role',{required_role:'POS_OPERATOR'}),
    supabase.from('users').select('id,full_name,email,is_active').eq('auth_user_id',session.user.id).maybeSingle()
  ]);
  isAdmin=!!a.data;isOperator=!!o.data;profile=p.data;
  if(!isAdmin&&!isOperator){location.replace('./login.html');return}
  if(profile?.is_active===false){await supabase.auth.signOut();location.replace('./login.html');return}
  loadFavorites();setupShell();setText('accountUser',profile?.full_name||session.user.email||'Сотрудник');
  $('adminLinks').style.display=isAdmin?'grid':'none';$('syncCatalog').style.display=isAdmin?'inline-flex':'none';
  await loadCore();bind();fillReportOperators();showView('sale');await Promise.allSettled([loadStock(),loadReport('today')]);
}

async function loadCore(){
  const oo=await supabase.from('organizations').select('id,name').eq('code','A4PRINT').single();if(oo.error)throw oo.error;org=oo.data;
  const [g,ac,op]=await Promise.all([
    supabase.from('catalog_items').select('id,name,sku,article,barcode,item_type,category,unit,sale_price,external_id,external_source,last_synced_at').eq('organization_id',org.id).eq('is_active',true).order('name'),
    supabase.from('cash_accounts').select('id,name,account_type,is_active').eq('organization_id',org.id).eq('is_active',true).order('name'),supabase.rpc('get_pos_operators')
  ]);
  if(g.error)throw g.error;if(ac.error)throw ac.error;if(op.error)throw op.error;
  goods=g.data||[];accounts=ac.data||[];operators=op.data||[];
  selectedOperatorId=operators.find(x=>x.is_self)?.id||operators[0]?.id||profile?.id||'';
  $('operatorSelect').innerHTML=operators.map(x=>`<option value="${x.id}">${esc(x.full_name)}${x.is_self?' · вы':''}</option>`).join('');$('operatorSelect').value=selectedOperatorId;$('operatorSelect').disabled=!isAdmin||operators.length<2;
  $('account').innerHTML=accounts.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');
  fillReportOperators();renderGoods();renderCart();await loadShift();
}
function fillReportOperators(){const el=$('reportOperator');if(!el)return;const prev=el.value;el.innerHTML='<option value="">Все операторы</option>'+operators.map(x=>`<option value="${x.id}">${esc(x.full_name)}</option>`).join('');el.style.display=isAdmin?'block':'none';if([...el.options].some(x=>x.value===prev))el.value=prev}

async function loadShift(){
  try{
    const d=await api('/api/v1/pos/shift');shift=d.shift||null;
    if(shift){const saved=await supabase.rpc('record_pos_shift',{p_moysklad_shift_id:shift.id,p_moysklad_shift_name:shift.name||null,p_store_id:d.store?.id||null,p_store_name:d.store?.name||null,p_opened_at:shift.openDate||new Date().toISOString(),p_closed_at:shift.closeDate||null,p_status:shift.closeDate?'CLOSED':'OPEN',p_operator_id:selectedOperatorId||null});if(saved.error)console.warn('POS shift local sync:',saved.error)}
    $('shiftDot').className='dot '+(shift?'ok':'');setText('shiftText',shift?'Смена открыта':'Смена не начата');
    const meta=shift?`${d.store?.name||'Точка'} · с ${dt(shift.openDate)}`:'Оператор открывает смену вручную';setText('shiftMetaSide',meta);setText('shiftMetaSync',meta);setText('shiftStatusSync',shift?'Смена открыта':'Ожидает оператора');
    $('shiftBtn').textContent=shift?'Закрыть смену':'Открыть смену';$('shiftBtn').className='btn '+(shift?'danger':'success');setText('topShift',shift?'Смена открыта':'Смена не начата');$('topShiftDot').className='dot '+(shift?'ok':'');renderCart();
  }catch(e){shift=null;$('shiftDot').className='dot bad';setText('shiftText','МойСклад недоступен');setText('shiftMetaSide',e.message);setText('shiftMetaSync',e.message);setText('shiftStatusSync','Нет связи');setText('topShift','Нет связи');$('topShiftDot').className='dot bad';note(e.message,true);renderCart()}
}
async function toggleShift(){
  $('shiftBtn').disabled=true;try{
    if(shift){const d=await api('/api/v1/pos/shift/close',{method:'POST',body:JSON.stringify({operator_id:selectedOperatorId||null})});const r=await supabase.rpc('record_pos_shift',{p_moysklad_shift_id:d.shift?.id||shift.id,p_moysklad_shift_name:d.shift?.name||shift.name||null,p_store_id:d.store?.id||null,p_store_name:d.store?.name||null,p_opened_at:shift.openDate||new Date().toISOString(),p_closed_at:d.shift?.closeDate||new Date().toISOString(),p_status:'CLOSED',p_operator_id:selectedOperatorId||null});if(r.error)throw r.error;note('Смена закрыта')}
    else{const d=await api('/api/v1/pos/shift/open',{method:'POST',body:JSON.stringify({operator_id:selectedOperatorId||null})});const r=await supabase.rpc('record_pos_shift',{p_moysklad_shift_id:d.shift?.id,p_moysklad_shift_name:d.shift?.name||null,p_store_id:d.store?.id||null,p_store_name:d.store?.name||null,p_opened_at:d.shift?.openDate||new Date().toISOString(),p_closed_at:null,p_status:'OPEN',p_operator_id:selectedOperatorId||null});if(r.error)throw r.error;note(d.alreadyOpen?'Оператор подключён к открытой смене':'Смена открыта')}
    await loadShift();await loadReport(reportPeriod);
  }catch(e){note(e.message,true)}finally{$('shiftBtn').disabled=false}
}

function syncFilterButtons(){document.querySelectorAll('[data-type]').forEach(b=>b.classList.toggle('on',type!=='FAVORITES'&&b.dataset.type===type));$('favoriteFilter')?.classList.toggle('on',type==='FAVORITES')}
function toggleFavorite(id){if(favorites.has(id))favorites.delete(id);else favorites.add(id);saveFavorites();renderGoods()}
function renderGoods(){
  const q=$('search').value.trim().toLowerCase();
  const rows=goods.filter(g=>Number(g.sale_price||0)>0&&(type==='FAVORITES'?favorites.has(g.id):(type==='ALL'||g.item_type===type))&&`${g.name} ${g.sku||''} ${g.article||''} ${g.barcode||''} ${g.category||''}`.toLowerCase().includes(q));
  $('goods').innerHTML=rows.map(g=>`<article class="good" data-good="${g.id}"><button class="fav-star ${favorites.has(g.id)?'on':''}" data-fav="${g.id}" type="button" title="${favorites.has(g.id)?'Убрать из избранного':'В избранное'}">★</button><div><div class="name">${esc(g.name)}</div><div class="meta">${esc(g.article||g.sku||g.category||'')}${stock[g.external_id]!=null?` · остаток ${stock[g.external_id]}`:''}</div></div><div class="price">${rub(g.sale_price)}</div></article>`).join('')||`<div class="empty">${type==='FAVORITES'?'В избранном пока ничего нет. Нажмите ★ на нужных товарах и услугах.':'Ничего не найдено или у позиций не заполнена цена'}</div>`;
  document.querySelectorAll('[data-good]').forEach(x=>x.onclick=()=>add(x.dataset.good));document.querySelectorAll('[data-fav]').forEach(x=>x.onclick=e=>{e.stopPropagation();toggleFavorite(x.dataset.fav)});
}
function add(id){const g=goods.find(x=>x.id===id);if(!g)return;const row=cart.find(x=>!x.custom&&x.id===id);if(row)row.qty++;else cart.push({key:id,id:g.id,name:g.name,price:Number(g.sale_price||0),qty:1});renderCart()}
function renderCart(){
  const total=cart.reduce((s,x)=>s+x.price*x.qty,0),count=cart.reduce((s,x)=>s+x.qty,0),received=Number($('received')?.value||0);setText('cartCount',count+' поз.');setText('total',rub(total));setText('change',rub(Math.max(0,received-total)));
  $('pay').disabled=!cart.length||!shift||!accounts.length;$('pay').textContent=!shift?'Откройте смену для оформления':`Оформить · ${rub(total)}`;
  $('cart').innerHTML=cart.map((x,i)=>`<div class="cart-item ${x.custom?'custom-cart-item':''}"><div class="cart-line"><div><b>${esc(x.name)}</b>${x.custom?`<small>Своя позиция · ${esc(x.base_name||'МойСклад')}</small>`:''}</div><strong>${rub(x.price*x.qty)}</strong></div><div class="qty"><button data-minus="${i}">−</button><span>${x.qty}</span><button data-plus="${i}">+</button><button data-remove="${i}" class="remove-item">Удалить</button></div></div>`).join('')||'<div class="empty cart-empty">Добавьте товары или услуги</div>';
  document.querySelectorAll('[data-minus]').forEach(b=>b.onclick=()=>{const i=+b.dataset.minus;if(--cart[i].qty<1)cart.splice(i,1);renderCart()});document.querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>{cart[+b.dataset.plus].qty++;renderCart()});document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{cart.splice(+b.dataset.remove,1);renderCart()});
}

async function pay(){
  if(!cart.length||!shift)return;const total=cart.reduce((s,x)=>s+x.price*x.qty,0),items=cart.map(({key,...x})=>({...x}));$('pay').disabled=true;$('pay').textContent='Оформляем продажу…';
  try{const d=await api('/api/v1/pos/sale',{method:'POST',body:JSON.stringify({items,payment_method:$('method').value,customer_id:customer?.id||null,operator_id:selectedOperatorId||null})});const recorded=await supabase.rpc('record_pos_sale',{p_moysklad_sale_id:d.moysklad?.id,p_moysklad_sale_name:d.moysklad?.name||null,p_moysklad_shift_id:shift.id,p_operator_id:selectedOperatorId||null,p_customer_id:customer?.id||null,p_cash_account_id:$('account').value,p_payment_method:$('method').value,p_total:Number(d.sum??total),p_items:items});if(recorded.error)throw new Error('Продажа создана в МойСклад, но локальная запись не сохранилась: '+recorded.error.message);note(`Продажа ${d.moysklad?.name||''} оформлена`);cart=[];customer=null;['clientName','clientPhone','clientComment','clientSearch','received'].forEach(id=>{if($(id))$(id).value=''});$('clientResults').innerHTML='';renderCart();await Promise.allSettled([loadStock(),loadReport(reportPeriod)])}catch(e){note(e.message,true)}finally{renderCart()}
}

async function searchClient(q){if(q.trim().length<2){$('clientResults').innerHTML='';return}try{const d=await api('/api/v1/pos/customers?q='+encodeURIComponent(q));$('clientResults').innerHTML=(d.customers||[]).slice(0,6).map(c=>`<button data-client="${c.id}"><b>${esc(c.full_name)}</b><div class="small muted">${esc(c.phone||c.email||'')}</div></button>`).join('');document.querySelectorAll('[data-client]').forEach(b=>b.onclick=()=>{customer=(d.customers||[]).find(x=>x.id===b.dataset.client);$('clientName').value=customer?.full_name||'';$('clientPhone').value=customer?.phone||'';$('clientResults').innerHTML='';document.querySelector('.client-box')?.classList.remove('client-collapsed');note('Клиент выбран')})}catch(e){note(e.message,true)}}
async function saveClient(){const name=$('clientName').value.trim();if(!name)return note('Укажите имя клиента',true);try{const d=await api('/api/v1/pos/customers',{method:'POST',body:JSON.stringify({id:customer?.id||null,full_name:name,phone:$('clientPhone').value.trim(),manager_comment:$('clientComment').value.trim()})});customer=d.customer;note('Клиент сохранён')}catch(e){note(e.message,true)}}
async function loadStock(){try{const d=await api('/api/v1/integrations/moysklad/stock');stock=d.stock||{};$('msDot').className='dot ok';setText('msStatusSide','МойСклад подключён');setText('msStatusSync','МойСклад подключён');const stamp='Обновлено '+new Date().toLocaleTimeString('ru-RU');setText('stockStampSide',stamp);setText('stockStampSync',stamp);renderGoods()}catch(e){$('msDot').className='dot bad';setText('msStatusSide','Ошибка связи');setText('msStatusSync','Ошибка связи');setText('stockStampSide',e.message);setText('stockStampSync',e.message)}}
async function syncCatalog(){if(!isAdmin)return;$('syncCatalog').disabled=true;try{const d=await api('/api/v1/integrations/moysklad/sync',{method:'POST',body:'{}'});note(`Каталог: ${d.received||0} получено, ${d.updated||0} обновлено, ${d.created||0} добавлено`);await loadCore();await loadStock();await loadReport(reportPeriod)}catch(e){note(e.message,true)}finally{$('syncCatalog').disabled=false}}

function rangeFor(key){const now=new Date(),end=new Date(now.getTime()+1000);let start;if(key==='shift'&&shift?.openDate)start=new Date(shift.openDate);else if(key==='today'){start=new Date(now);start.setHours(0,0,0,0)}else if(key==='7d'){start=new Date(now);start.setDate(start.getDate()-7)}else if(key==='30d'){start=new Date(now);start.setDate(start.getDate()-30)}else{start=new Date(now);start.setFullYear(start.getFullYear()-1)}return{start,end}}
async function loadReport(key=reportPeriod){reportPeriod=key;document.querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('on',b.dataset.period===key));const {start,end}=rangeFor(key);setText('reportRange',`${start.toLocaleDateString('ru-RU')} — ${end.toLocaleDateString('ru-RU')}`);const r=await supabase.rpc('pos_dashboard',{p_from:start.toISOString(),p_to:end.toISOString(),p_operator_id:isAdmin&&$('reportOperator')?.value?$('reportOperator').value:null});if(r.error){note(r.error.message,true);return}renderReport(r.data||{})}
function renderReport(d){setText('statSales',rub(d.sales_total));setText('statCount',Number(d.sales_count||0).toLocaleString('ru-RU'));setText('statAvg',rub(d.avg_check));setText('statReturns',rub(d.returns_total));setText('statNet',rub(d.net_total));const pay=d.payment_methods||[],maxPay=Math.max(0,...pay.map(x=>Number(x.amount||0)));$('paymentBars').innerHTML=pay.map(x=>`<div class="bar-row"><span>${esc(x.name)}</span><div class="bar"><i style="width:${pct(x.amount,maxPay)}%"></i></div><b>${rub(x.amount)}</b></div>`).join('')||'<div class="empty">Продаж за период нет</div>';const ops=d.operators||[],maxOps=Math.max(0,...ops.map(x=>Number(x.amount||0)));$('operatorBars').innerHTML=ops.map(x=>`<div class="bar-row"><span>${esc(x.name)}</span><div class="bar"><i style="width:${pct(x.amount,maxOps)}%"></i></div><b>${rub(x.amount)}</b></div>`).join('')||'<div class="empty">Нет данных</div>';$('topItems').innerHTML=(d.top_items||[]).map(x=>`<tr><td>${esc(x.name)}</td><td>${Number(x.qty||0).toLocaleString('ru-RU')}</td><td><b>${rub(x.amount)}</b></td></tr>`).join('')||'<tr><td colspan="3" class="muted">Нет данных</td></tr>';$('recentSales').innerHTML=(d.recent_sales||[]).map(x=>`<tr><td>${dt(x.sold_at)}</td><td>${esc(x.operator||'—')}</td><td>${esc(x.payment_method||'—')}</td><td><b>${rub(x.total)}</b></td></tr>`).join('')||'<tr><td colspan="4" class="muted">Нет продаж</td></tr>';const c=d.catalog||{};setText('catalogActive',Number(c.active||0).toLocaleString('ru-RU'));setText('catalogLinked',Number(c.linked||0).toLocaleString('ru-RU'));setText('catalogLastSync',c.last_sync?dt(c.last_sync):'Нет данных')}

function showView(name){document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+name));document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===name));const titles={sale:'Касса A4-Принт',reports:'Отчёты и статистика',sync:'МойСклад и синхронизация'};setText('pageTitle',titles[name]||'Касса');document.body.classList.remove('nav-open');if(name==='reports')loadReport(reportPeriod).catch(e=>note(e.message,true));if(name==='sync')Promise.allSettled([loadStock(),loadReport(reportPeriod),loadShift()])}
async function installApp(){if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;setInstallState('Касса установлена',true)}else note('В меню Chrome или Edge выберите «Установить приложение».')}
function setInstallState(text,disabled=false){['installBtnTop','installBtnSync'].forEach(id=>{const b=$(id);if(b){b.textContent=text;b.disabled=disabled}})}
function bind(){document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{type=b.dataset.type;syncFilterButtons();renderGoods()});$('search').oninput=renderGoods;$('received').oninput=renderCart;$('clearCart').onclick=()=>{cart=[];renderCart()};$('pay').onclick=pay;$('shiftBtn').onclick=toggleShift;$('refreshStock').onclick=loadStock;$('refreshStockSync').onclick=loadStock;$('syncCatalog').onclick=syncCatalog;$('operatorSelect').onchange=async()=>{selectedOperatorId=$('operatorSelect').value;await loadShift();note('Рабочий оператор: '+($('operatorSelect').selectedOptions[0]?.textContent||''))};$('reportOperator').onchange=()=>loadReport(reportPeriod);$('clientSearch').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>searchClient($('clientSearch').value),220)};$('saveClient').onclick=saveClient;$('logout').onclick=async()=>{await supabase.auth.signOut();location.replace('./login.html')};$('mobileMenu').onclick=()=>document.body.classList.toggle('nav-open');$('installBtnTop').onclick=installApp;$('installBtnSync').onclick=installApp;document.querySelectorAll('.pos-nav a').forEach(a=>a.addEventListener('click',()=>document.body.classList.remove('nav-open')))}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;setInstallState('Установить на ПК',false)});window.addEventListener('appinstalled',()=>{installPrompt=null;setInstallState('Касса установлена',true);note('Касса установлена на этот компьютер')});if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{}),{once:true});
init().catch(e=>{console.error(e);note(e.message||'Ошибка запуска кассы',true)});
