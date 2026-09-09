(()=>{
  'use strict';
  if(window.__A4_KASSA_ORDER_BRIDGE__)return;
  window.__A4_KASSA_ORDER_BRIDGE__=true;

  const cfg=window.A4PRINT_CONFIG||{};
  const create=window.supabase?.createClient;
  if(!create)return;
  const supabase=create(cfg.supabaseUrl,cfg.supabasePublishableKey,{global:{fetch:window.A4SupabaseFetch||fetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})+' ₽';
  const labels={NEW:'Новый',CONFIRMED:'Подтверждён',IN_PROGRESS:'В работе',READY:'Готов',COMPLETED:'Завершён',ON_HOLD:'Пауза'};
  let overlay=null,listEl=null,detailEl=null,searchEl=null,current=null,loading=false,serviceItem=null;

  async function token(){const {data,error}=await supabase.auth.getSession();if(error)throw error;const t=data?.session?.access_token;if(!t)throw new Error('Сессия кассы завершена. Войдите снова.');return t}
  async function api(path,opt={}){const t=await token();const r=await fetch(API+path,{...opt,cache:'no-store',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json',Accept:'application/json',...(opt.headers||{})}});const text=await r.text();let d={};try{d=text?JSON.parse(text):{}}catch{}if(!r.ok)throw new Error(d.message||d.error||`HTTP ${r.status}`);return d}
  function uuid(){return crypto.randomUUID?crypto.randomUUID():`hub-${Date.now()}-${Math.random().toString(36).slice(2)}`}

  function ensureUi(){
    if(overlay)return;
    overlay=document.createElement('section');overlay.className='hub-orders-overlay';overlay.hidden=true;
    overlay.innerHTML=`<div class="hub-orders-card" role="dialog" aria-modal="true" aria-label="Заказы HUB">
      <header class="hub-orders-head"><div><h2>Заказы HUB</h2><p>Выберите заказ и проведите оплату через кассу</p></div><button type="button" class="hub-orders-close">×</button></header>
      <div class="hub-orders-search"><input id="hubOrdersSearch" autocomplete="off" placeholder="Номер заказа, клиент или телефон"><button type="button" id="hubOrdersRefresh">↻</button></div>
      <div class="hub-orders-layout"><div id="hubOrdersList" class="hub-orders-list"></div><div id="hubOrderDetail" class="hub-order-detail"><div class="hub-orders-empty">Выберите заказ слева</div></div></div>
    </div>`;
    document.body.appendChild(overlay);listEl=$('hubOrdersList');detailEl=$('hubOrderDetail');searchEl=$('hubOrdersSearch');
    overlay.querySelector('.hub-orders-close').onclick=close;
    overlay.onclick=e=>{if(e.target===overlay)close()};
    $('hubOrdersRefresh').onclick=()=>loadOrders(searchEl.value);
    let timer=null;searchEl.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>loadOrders(searchEl.value),280)};
  }

  function addLaunchers(){
    const toolbar=document.querySelector('.catalog-toolbar .toolbar-actions');
    if(toolbar&&!$('hubOrdersOpen')){const b=document.createElement('button');b.id='hubOrdersOpen';b.className='btn hub-orders-open';b.type='button';b.textContent='Заказы HUB';b.onclick=open;toolbar.prepend(b)}
    const nav=document.querySelector('.nav-menu');
    if(nav&&!$('navHubOrders')){const b=document.createElement('button');b.id='navHubOrders';b.className='nav-item';b.type='button';b.innerHTML='<span class="nav-icon">₽</span><b>Заказы HUB</b>';b.onclick=()=>{document.getElementById('appView')?.classList.remove('nav-open');open()};nav.insertBefore(b,nav.querySelector('[data-section="returns"]')||null)}
  }

  async function open(){ensureUi();overlay.hidden=false;document.body.classList.add('hub-orders-opened');searchEl.focus();await loadOrders(searchEl.value)}
  function close(){if(!overlay)return;overlay.hidden=true;document.body.classList.remove('hub-orders-opened')}

  async function loadOrders(q=''){
    if(loading)return;loading=true;listEl.innerHTML='<div class="hub-orders-empty">Загрузка заказов…</div>';
    try{
      const {data,error}=await supabase.rpc('get_pos_hub_orders',{p_query:String(q||'').trim(),p_limit:60});if(error)throw error;
      const rows=Array.isArray(data)?data:[];
      listEl.innerHTML=rows.map(o=>`<button class="hub-order-row" type="button" data-hub-order="${esc(o.id)}"><span><b>№${esc(o.order_number)} · ${esc(o.customer_name||'Клиент не указан')}</b><small>${esc(labels[o.status]||o.status||'')} · ${new Date(o.created_at).toLocaleDateString('ru-RU')}</small></span><span class="hub-order-money"><strong>${money(o.debt)}</strong><small>из ${money(o.total)}</small></span></button>`).join('')||'<div class="hub-orders-empty">Неоплаченных заказов не найдено</div>';
      listEl.querySelectorAll('[data-hub-order]').forEach(b=>b.onclick=()=>selectOrder(b.dataset.hubOrder,b));
    }catch(error){listEl.innerHTML=`<div class="hub-orders-error">Не удалось загрузить заказы: ${esc(error.message||error)}</div>`}
    finally{loading=false}
  }

  async function selectOrder(id,button){
    listEl.querySelectorAll('.hub-order-row').forEach(x=>x.classList.toggle('active',x===button));detailEl.innerHTML='<div class="hub-orders-empty">Загрузка заказа…</div>';
    try{const {data,error}=await supabase.rpc('get_pos_hub_order',{p_order_id:id});if(error)throw error;current=data;renderDetail()}catch(error){detailEl.innerHTML=`<div class="hub-orders-error">${esc(error.message||error)}</div>`}
  }

  function renderDetail(){
    const o=current;if(!o)return;const paid=Number(o.paid||0),total=Number(o.total||0),debt=Math.max(0,total-paid);const c=o.customer||{};
    detailEl.innerHTML=`<div class="hub-order-title"><div><span>Заказ HUB</span><h3>№${esc(o.order_number)}</h3><p>${esc(c.company_name||c.full_name||'Клиент не указан')}${c.phone?' · '+esc(c.phone):''}</p></div><span class="hub-order-status">${esc(labels[o.status]||o.status||'')}</span></div>
      <div class="hub-order-kpis"><div><span>Сумма</span><b>${money(total)}</b></div><div><span>Оплачено</span><b>${money(paid)}</b></div><div class="debt"><span>К оплате</span><b>${money(debt)}</b></div></div>
      <div class="hub-order-items">${(o.items||[]).map(i=>`<div><span>${esc(i.name||'Позиция')} × ${Number(i.quantity||0).toLocaleString('ru-RU')}</span><b>${money(i.total_price)}</b></div>`).join('')||'<div class="hub-orders-empty">Позиции заказа не указаны</div>'}</div>
      ${debt>0?`<div class="hub-order-pay"><label><span>Сумма оплаты</span><input id="hubOrderPayAmount" type="number" min="0.01" max="${debt}" step="0.01" value="${debt.toFixed(2)}"></label><label><span>Способ оплаты</span><select id="hubOrderPayMethod"><option>Наличные</option><option>Карта</option><option>СБП</option></select></label><div id="hubOrderPayError" class="hub-orders-error"></div><button id="hubOrderPayBtn" type="button">Провести через кассу · ${money(debt)}</button><small>Будет создан настоящий чек МойСклад и подтверждённая оплата в HUB.</small></div>`:'<div class="hub-order-paid">✓ Заказ полностью оплачен</div>'}`;
    const amount=$('hubOrderPayAmount'),btn=$('hubOrderPayBtn');if(amount&&btn)amount.oninput=()=>{const n=Number(amount.value||0);btn.textContent=`Провести через кассу · ${money(n)}`};if(btn)btn.onclick=checkout;
  }

  async function ensureOrderService(){
    if(serviceItem?.id)return serviceItem;
    const {data:existing,error:lookupError}=await supabase.from('catalog_items').select('id,name,article,item_type,sale_price,external_id,external_href').eq('article','A4HUB-ORDER').eq('is_active',true).limit(1).maybeSingle();
    if(lookupError)console.warn('A4PRINT KASSA HUB order service lookup:',lookupError);
    if(existing?.id){serviceItem=existing;return serviceItem}
    const d=await api('/api/v1/pos/catalog/items',{method:'POST',body:JSON.stringify({name:'Заказ A4PRINT HUB',item_type:'SERVICE',sale_price:0,category:'Заказы HUB',unit:'шт',article:'A4HUB-ORDER',description:'Служебная кассовая позиция для оплаты заказов A4PRINT HUB'})});
    if(!d?.item?.id)throw new Error('Не удалось подготовить кассовую позицию для заказа.');serviceItem=d.item;return serviceItem;
  }

  async function checkout(){
    const o=current;if(!o)return;const err=$('hubOrderPayError'),btn=$('hubOrderPayBtn');err.textContent='';
    const paid=Number(o.paid||0),debt=Math.max(0,Number(o.total||0)-paid),amount=Number($('hubOrderPayAmount')?.value||0),method=$('hubOrderPayMethod')?.value||'Наличные';
    if(!(amount>0)||amount>debt+0.001){err.textContent=`Введите сумму от 0,01 ₽ до ${money(debt)}.`;return}
    const accountId=$('cashAccount')?.value||'';if(!accountId){err.textContent='В кассе не выбран счёт оплаты.';return}
    btn.disabled=true;btn.textContent='Проводим заказ…';
    try{
      const [item,shift]=await Promise.all([ensureOrderService(),api('/api/v1/pos/shift')]);
      if(!shift?.shift?.id)throw new Error('Кассовая смена закрыта. Сначала откройте смену.');
      const opId=uuid();const operatorId=$('operatorSelect')?.value||null;
      const sale=await api('/api/v1/pos/sale',{method:'POST',body:JSON.stringify({items:[{id:item.id,qty:1,price:amount}],payment_method:method,customer_id:o.customer_id||null,operator_id:operatorId,client_operation_id:opId,order_id:o.id})});
      const items=[{key:opId,id:item.id,name:`Заказ A4PRINT HUB №${o.order_number}`,article:'A4HUB-ORDER',qty:1,price:Number(sale.sum??amount)}];
      const {data:record,error:recordError}=await supabase.rpc('record_pos_sale_v2',{p_moysklad_sale_id:sale.moysklad?.id,p_moysklad_sale_name:sale.moysklad?.name||null,p_moysklad_shift_id:shift.shift.id,p_operator_id:operatorId,p_customer_id:o.customer_id||null,p_cash_account_id:accountId,p_payment_method:method,p_total:Number(sale.sum??amount),p_items:items,p_order_id:o.id});
      if(recordError)throw recordError;
      detailEl.innerHTML=`<div class="hub-order-success"><div>✓</div><h3>Заказ №${esc(o.order_number)} проведён</h3><p>Чек ${esc(sale.moysklad?.name||sale.moysklad?.id||'МойСклад')} создан. Оплата ${money(sale.sum??amount)} записана в HUB.</p><button id="hubOrderDone" type="button">Готово</button></div>`;
      $('hubOrderDone').onclick=async()=>{current=null;await loadOrders(searchEl.value);detailEl.innerHTML='<div class="hub-orders-empty">Выберите заказ слева</div>'};
      window.dispatchEvent(new CustomEvent('a4:kassa-order-paid',{detail:{order_id:o.id,record}}));
    }catch(error){err.textContent=String(error?.message||error);btn.disabled=false;btn.textContent=`Провести через кассу · ${money(amount)}`}
  }

  async function openFromQuery(){const id=new URLSearchParams(location.search).get('order');if(!id)return;ensureUi();overlay.hidden=false;document.body.classList.add('hub-orders-opened');await loadOrders('');await selectOrder(id,null);history.replaceState({},'',location.pathname)}
  function ready(){return !$('appView')?.hidden}
  function init(){ensureUi();addLaunchers();const app=$('appView');if(app)new MutationObserver(()=>{if(ready()){addLaunchers();openFromQuery().catch(console.warn)}}).observe(app,{attributes:true,attributeFilter:['hidden']});if(ready())openFromQuery().catch(console.warn);setInterval(addLaunchers,3000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
