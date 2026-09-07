(()=>{
  'use strict';
  if(window.__A4_KASSA_SALE_FINISH__)return;
  window.__A4_KASSA_SALE_FINISH__=true;

  const DB=window.A4KassaDB;
  const cfg=window.A4PRINT_CONFIG||{};
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  if(!DB)return;

  let currentSale=null;
  let overlay=null;
  let card=null;
  let statusTitle=null;
  let statusText=null;
  let receiptBody=null;
  let syncNote=null;
  let printButton=null;

  function ensureReceiptUi(){
    if(overlay)return;
    overlay=document.createElement('section');
    overlay.className='sale-finish-overlay';
    overlay.hidden=true;
    overlay.innerHTML=`<div class="sale-finish-card" role="dialog" aria-modal="true" aria-labelledby="saleFinishTitle">
      <div class="sale-finish-head"><div class="sale-finish-state">✓</div><div><h2 id="saleFinishTitle">Продажа сохранена</h2><p id="saleFinishText">Подготавливаем чек…</p></div></div>
      <div class="sale-finish-body" id="saleReceiptBody"></div>
      <div class="sale-finish-actions"><button class="sale-finish-print" type="button">Печать чека</button><button class="sale-finish-next" type="button">Новая продажа</button></div>
    </div>`;
    document.body.appendChild(overlay);
    card=overlay.querySelector('.sale-finish-card');
    statusTitle=overlay.querySelector('#saleFinishTitle');
    statusText=overlay.querySelector('#saleFinishText');
    receiptBody=overlay.querySelector('#saleReceiptBody');
    printButton=overlay.querySelector('.sale-finish-print');
    overlay.querySelector('.sale-finish-next').onclick=closeReceipt;
    printButton.onclick=printReceipt;
  }

  function saleNumber(sale){return sale?.backend_result?.moysklad?.name||sale?.backend_result?.moysklad?.id||'—'}
  function saleStatus(sale){
    if(sale?.stage==='done')return{mode:'done',title:'Продажа проведена',text:`Чек ${saleNumber(sale)} сохранён в МойСклад и A4PRINT HUB.`};
    if(sale?.stage==='backend_done')return{mode:'waiting',title:'Продажа создана в МойСклад',text:'Сохраняем чек в A4PRINT HUB…'};
    if(sale?.last_error)return{mode:'waiting',title:'Чек сохранён локально',text:'Не удалось синхронизировать сейчас. Чек останется в очереди и уйдёт автоматически.'};
    return{mode:'waiting',title:'Продажа сохранена',text:'Чек сохранён на этом компьютере. Синхронизируем с МойСклад…'};
  }

  function itemRows(sale){return (sale?.items||[]).map(x=>`<div class="sale-receipt-row"><div><b>${esc(x.name||'Позиция')}</b><small>${Number(x.qty||0)} × ${money(x.price)}</small></div><strong>${money(Number(x.qty||0)*Number(x.price||0))}</strong></div>`).join('')}
  function renderReceipt(sale){
    ensureReceiptUi();
    currentSale=sale;
    const st=saleStatus(sale);
    card.className='sale-finish-card '+(st.mode==='done'?'':st.mode);
    statusTitle.textContent=st.title;
    statusText.textContent=st.text;
    const date=sale?.synced_at||sale?.created_at||new Date().toISOString();
    receiptBody.innerHTML=`<div class="sale-receipt-meta">
      <div><span>Чек МойСклад</span><b>${esc(saleNumber(sale))}</b></div>
      <div><span>Дата и время</span><b>${new Date(date).toLocaleString('ru-RU')}</b></div>
      <div><span>Оператор</span><b>${esc(sale?.operator_name||'Оператор')}</b></div>
      <div><span>Оплата</span><b>${esc(sale?.payment_method||'—')}</b></div>
      <div><span>Покупатель</span><b>${esc(sale?.customer_name||'Не указан')}</b></div>
      <div><span>Смена</span><b>${esc(sale?.shift?.name||'—')}</b></div>
    </div><div class="sale-receipt-items">${itemRows(sale)}</div><div class="sale-receipt-total"><span>Итого</span><strong>${money(sale?.backend_result?.sum??sale?.total)}</strong></div><div class="sale-sync-note">${st.mode==='done'?'✓ Чек синхронизирован.':'↻ Чек находится в очереди синхронизации.'}</div>`;
    printButton.disabled=false;
  }

  function showReceipt(sale){renderReceipt(sale);overlay.hidden=false;document.body.classList.add('sale-finish-open')}
  function closeReceipt(){if(!overlay)return;overlay.hidden=true;document.body.classList.remove('sale-finish-open');currentSale=null;setTimeout(()=>{$('search')?.focus();$('search')?.select?.()},0)}

  function printReceipt(){
    if(!currentSale)return;
    const sale=currentSale;
    const rows=(sale.items||[]).map(x=>`<tr><td>${esc(x.name||'Позиция')}</td><td>${Number(x.qty||0)}</td><td>${money(x.price)}</td><td>${money(Number(x.qty||0)*Number(x.price||0))}</td></tr>`).join('');
    const w=window.open('','_blank','width=520,height=760');
    if(!w)return;
    w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Чек ${esc(saleNumber(sale))}</title><style>body{font:14px Arial,sans-serif;color:#111;margin:24px}h1{font-size:22px;margin:0 0 4px}.muted{color:#666}.meta{margin:18px 0;line-height:1.55}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{padding:7px 4px;border-bottom:1px solid #ddd;text-align:left}th:nth-child(n+2),td:nth-child(n+2){text-align:right}.total{font-size:20px;font-weight:700;text-align:right;margin-top:14px}.foot{margin-top:28px;text-align:center;color:#666}@media print{body{margin:0}}</style></head><body><h1>A4PRINT KASSA</h1><div class="muted">А4-Принт · A4PRINT HUB</div><div class="meta"><b>Чек:</b> ${esc(saleNumber(sale))}<br><b>Дата:</b> ${new Date(sale.synced_at||sale.created_at||Date.now()).toLocaleString('ru-RU')}<br><b>Оператор:</b> ${esc(sale.operator_name||'Оператор')}<br><b>Оплата:</b> ${esc(sale.payment_method||'—')}<br><b>Покупатель:</b> ${esc(sale.customer_name||'Не указан')}</div><table><thead><tr><th>Позиция</th><th>Кол.</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${rows}</tbody></table><div class="total">Итого: ${money(sale.backend_result?.sum??sale.total)}</div><div class="foot">Спасибо за покупку!</div><script>window.onload=()=>setTimeout(()=>window.print(),120)<\/script></body></html>`);
    w.document.close();
  }

  // Observe the same IndexedDB writes the cash register already uses. This
  // keeps the receipt UI in sync without duplicating sale submission logic.
  const nativePut=DB.put.bind(DB);
  DB.put=async function(name,value){
    const result=await nativePut(name,value);
    try{
      if(name==='queue'&&value?.stage==='queued')showReceipt(value);
      else if(name==='queue'&&currentSale?.id===value?.id)renderReceipt(value);
      else if(name==='receipts'&&currentSale?.id===value?.id)renderReceipt(value);
    }catch(error){console.warn('Sale finish UI:',error)}
    return result;
  };

  function ensureCustomerCreateUi(){
    const panel=$('customerPanel');
    if(!panel||panel.querySelector('.customer-create-button'))return;
    const button=document.createElement('button');button.type='button';button.className='customer-create-button';button.textContent='＋ Новый покупатель';panel.appendChild(button);
    button.onclick=openCustomerCreate;
  }

  let customerOverlay=null;
  function openCustomerCreate(){
    if(!customerOverlay){
      customerOverlay=document.createElement('section');customerOverlay.className='customer-create-overlay';customerOverlay.hidden=true;
      customerOverlay.innerHTML=`<form class="customer-create-card"><h2>Новый покупатель</h2><p>Сохраним клиента в A4PRINT HUB и сразу добавим в чек.</p><div class="customer-create-grid"><label class="wide">Имя / ФИО<input name="full_name" required autocomplete="name"></label><label>Телефон<input name="phone" autocomplete="tel"></label><label>Email<input name="email" type="email" autocomplete="email"></label><label class="wide">Компания<input name="company_name" autocomplete="organization"></label></div><div class="customer-create-error"></div><div class="customer-create-actions"><button class="customer-create-cancel" type="button">Отмена</button><button class="customer-create-save" type="submit">Сохранить</button></div></form>`;
      document.body.appendChild(customerOverlay);
      customerOverlay.querySelector('.customer-create-cancel').onclick=()=>customerOverlay.hidden=true;
      customerOverlay.onclick=e=>{if(e.target===customerOverlay)customerOverlay.hidden=true};
      customerOverlay.querySelector('form').onsubmit=saveCustomer;
    }
    customerOverlay.hidden=false;customerOverlay.querySelector('[name="full_name"]').focus();
  }

  async function authToken(){
    const create=window.supabase?.createClient;if(!create)return null;
    const client=create(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
    const {data}=await client.auth.getSession();return data?.session?.access_token||null;
  }
  async function saveCustomer(event){
    event.preventDefault();
    const form=event.currentTarget;const err=form.querySelector('.customer-create-error');const save=form.querySelector('.customer-create-save');err.textContent='';save.disabled=true;save.textContent='Сохраняем…';
    try{
      const data=Object.fromEntries(new FormData(form).entries());const token=await authToken();if(!token)throw new Error('Сессия кассы не найдена.');
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
      let response;
      try{response=await fetch(String(cfg.apiBaseUrl||'').replace(/\/$/,'')+'/api/v1/pos/customers',{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(data)})}finally{clearTimeout(timer)}
      const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||body.error||`HTTP ${response.status}`);
      customerOverlay.hidden=true;form.reset();
      const input=$('customerSearch');if(input){input.value=body.customer?.full_name||data.full_name;input.dispatchEvent(new Event('input',{bubbles:true}));setTimeout(()=>{const choice=document.querySelector(`[data-customer="${CSS.escape(String(body.customer?.id||''))}"]`);choice?.click()},500)}
    }catch(error){err.textContent=/abort/i.test(String(error?.name||error?.message||''))?'Сервер долго отвечает. Попробуйте ещё раз.':String(error?.message||error)}
    finally{save.disabled=false;save.textContent='Сохранить'}
  }

  function init(){ensureReceiptUi();ensureCustomerCreateUi();const observer=new MutationObserver(ensureCustomerCreateUi);const panel=$('customerPanel');if(panel)observer.observe(panel,{childList:true})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
