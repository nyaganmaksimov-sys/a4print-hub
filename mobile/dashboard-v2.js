const SUPABASE_URL='https://qgakliolffnwkymoqvzn.supabase.co';
const SUPABASE_KEY='sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu';
const API_BASE='https://a4print-hub-api.onrender.com';
const ACCESS_KEY='a4print_mobile_access';
const SESSION_KEY='sb-qgakliolffnwkymoqvzn-auth-token';
const $=id=>document.getElementById(id);
const money=value=>`${Number(value||0).toLocaleString('ru-RU',{maximumFractionDigits:0})} ₽`;
const esc=value=>String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let loading=false;
let timer=null;

function token(){
  const direct=localStorage.getItem(ACCESS_KEY);if(direct)return direct;
  try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')?.access_token||''}catch{return ''}
}
function dayStartIso(){const d=new Date();d.setHours(0,0,0,0);return d.toISOString()}
function setText(id,value){const el=$(id);if(el)el.textContent=value}
async function sb(path){
  const t=token();if(!t)throw new Error('Нет активной сессии');
  const r=await fetch(SUPABASE_URL+path,{headers:{Accept:'application/json',apikey:SUPABASE_KEY,Authorization:`Bearer ${t}`},cache:'no-store'});
  const text=await r.text();let data;try{data=text?JSON.parse(text):[]}catch{data=[]}
  if(!r.ok){const e=new Error(data?.message||data?.error||`HTTP ${r.status}`);e.status=r.status;throw e}return data;
}
async function api(path){
  const t=token();if(!t)throw new Error('Нет активной сессии');
  const r=await fetch(API_BASE+path,{headers:{Accept:'application/json',Authorization:`Bearer ${t}`},cache:'no-store'});
  const text=await r.text();let data;try{data=text?JSON.parse(text):{}}catch{data={}}
  if(!r.ok){const e=new Error(data?.message||data?.error||`HTTP ${r.status}`);e.status=r.status;e.payload=data;throw e}return data;
}
function control({href,tone='good',title,text,value}){
  return `<a class="mobile-control ${tone}" href="${href}"><span><b>${esc(title)}</b><span>${esc(text)}</span></span><strong>${esc(value)}</strong></a>`;
}
function ordersFromDom(){
  return [...document.querySelectorAll('#recentOrders .order')].length;
}
async function load(){
  if(loading||!token()||$('appView')?.classList.contains('hidden'))return;
  loading=true;
  try{
    const start=encodeURIComponent(dayStartIso());
    const [ordersR,itemsR,movesR,productionR,salesR,returnsR,salesIssuesR,returnIssuesR,shiftR,cashR,healthR]=await Promise.allSettled([
      sb('/rest/v1/orders?select=id,status,business_unit&order=created_at.desc&limit=200'),
      sb('/rest/v1/catalog_items?select=id,name,sku,item_type,min_stock&is_active=eq.true&limit=1000'),
      sb('/rest/v1/inventory_transactions?select=catalog_item_id,transaction_type,quantity&limit=5000'),
      sb('/rest/v1/production_jobs?select=id,title,status,priority,created_at&order=created_at.desc&limit=500'),
      sb(`/rest/v1/pos_sales?select=id,total,payment_method,sold_at,sync_status&sold_at=gte.${start}&order=sold_at.desc&limit=1000`),
      sb(`/rest/v1/pos_returns?select=id,amount,payment_method,returned_at,sync_status&returned_at=gte.${start}&order=returned_at.desc&limit=1000`),
      sb('/rest/v1/pos_sales?select=id&sync_status=in.(FAILED,WARNING)&limit=1000'),
      sb('/rest/v1/pos_returns?select=id&sync_status=in.(FAILED,WARNING)&limit=1000'),
      api('/api/v1/pos/shift'),
      api('/api/v1/pos/cash-balance'),
      fetch(`${API_BASE}/api/v1/health`,{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()})
    ]);

    const orders=ordersR.status==='fulfilled'&&Array.isArray(ordersR.value)?ordersR.value:[];
    const items=itemsR.status==='fulfilled'&&Array.isArray(itemsR.value)?itemsR.value:[];
    const moves=movesR.status==='fulfilled'&&Array.isArray(movesR.value)?movesR.value:[];
    const production=productionR.status==='fulfilled'&&Array.isArray(productionR.value)?productionR.value:[];
    const sales=salesR.status==='fulfilled'&&Array.isArray(salesR.value)?salesR.value:[];
    const returns=returnsR.status==='fulfilled'&&Array.isArray(returnsR.value)?returnsR.value:[];
    const syncIssues=(salesIssuesR.status==='fulfilled'?salesIssuesR.value.length:0)+(returnIssuesR.status==='fulfilled'?returnIssuesR.value.length:0);

    const salesTotal=sales.reduce((s,r)=>s+Number(r.total||0),0);
    const returnsTotal=returns.reduce((s,r)=>s+Number(r.amount||0),0);
    const revenue=salesTotal-returnsTotal;
    const cashSales=sales.filter(r=>String(r.payment_method||'').toUpperCase().includes('CASH')).reduce((s,r)=>s+Number(r.total||0),0);
    const cardSales=salesTotal-cashSales;

    setText('mobileRevenue',money(revenue));
    setText('mobileRevenueMeta',`Продажи ${money(salesTotal)} · возвраты ${money(returnsTotal)}`);
    setText('mobileSalesCount',String(sales.length));
    setText('mobileSalesMeta',`Наличные ${money(cashSales)} · безнал ${money(cardSales)}`);
    setText('mobileReturns',money(returnsTotal));
    setText('mobileReturnsMeta',`${returns.length} возврат${returns.length===1?'':'а/ов'} за сегодня`);

    const shift=shiftR.status==='fulfilled'?shiftR.value?.shift:null;
    const cashPayload=cashR.status==='fulfilled'?cashR.value:(cashR.reason?.payload||null);
    const cashKnown=cashPayload?.available===true&&Number.isFinite(Number(cashPayload?.cash));
    setText('mobileCash',cashKnown?money(cashPayload.cash):'—');
    setText('mobileShift',shift?`Смена открыта${shift.opened_at?' · с '+new Date(shift.opened_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):''}`:'Смена закрыта');

    const qty=new Map();
    for(const move of moves){const current=qty.get(move.catalog_item_id)||0;const q=Number(move.quantity||0);const plus=['RECEIPT','TRANSFER_IN','PRODUCTION_IN','ADJUSTMENT'].includes(move.transaction_type);qty.set(move.catalog_item_id,current+(plus?q:-q))}
    const low=items.filter(item=>(qty.get(item.id)||0)<=Number(item.min_stock||0));
    const prodQueued=production.filter(x=>['NEW','QUEUED'].includes(x.status)).length;
    const prodWork=production.filter(x=>['IN_PROGRESS','PAUSED'].includes(x.status)).length;
    const apiOk=healthR.status==='fulfilled';

    const active=['NEW','CONFIRMED','IN_PROGRESS'];
    const a4=orders.filter(x=>x.business_unit==='A4_PRINT');
    const d3=orders.filter(x=>x.business_unit==='3D_ARTPRINT');
    setText('mobileA4Active',a4.filter(x=>active.includes(x.status)).length);
    setText('mobileA4Ready',a4.filter(x=>x.status==='READY').length);
    setText('mobile3DActive',d3.filter(x=>active.includes(x.status)).length);
    setText('mobile3DReady',d3.filter(x=>x.status==='READY').length);

    const attention=$('mobileAttention');
    if(attention)attention.innerHTML=[
      control({href:'/admin/warehouse.html?mobile=1',tone:low.length?'danger':'good',title:low.length?'Заканчиваются материалы':'Склад в норме',text:low.length?(low.slice(0,3).map(x=>x.name).filter(Boolean).join(', ')||'Проверьте остатки'):'Критических остатков нет',value:String(low.length)}),
      control({href:'/admin/production.html?mobile=1',tone:prodWork?'warn':'good',title:'Производство',text:prodWork?`${prodWork} в работе · ${prodQueued} в очереди`:'Активных заданий нет',value:String(prodWork+prodQueued)}),
      control({href:'/kassa/',tone:syncIssues?'danger':'good',title:syncIssues?'Ошибки синхронизации кассы':'Касса синхронизирована',text:syncIssues?'Есть продажи/возвраты с предупреждениями':'Ошибок продаж и возвратов нет',value:String(syncIssues)}),
      control({href:'/kassa/',tone:shift?'good':'warn',title:shift?'Кассовая смена открыта':'Кассовая смена закрыта',text:cashKnown?`Наличных ${money(cashPayload.cash)}`:'Остаток наличных недоступен',value:shift?'OPEN':'—'}),
      control({href:'/admin/production.html?mobile=1',tone:apiOk?'good':'danger',title:apiOk?'HUB API работает':'HUB API недоступен',text:apiOk?'Сервисы отвечают штатно':'Часть кассовых данных может быть недоступна',value:apiOk?'OK':'!'}),
      control({href:'/admin/orders.html?mobile=1',tone:'good',title:'Всего загружено заказов',text:'Оперативная выборка мобильного HUB',value:String(orders.length||ordersFromDom())})
    ].join('');

    setText('mobileUpdated',`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`);
  }catch(error){
    console.warn('Mobile dashboard extras failed',error);
    setText('mobileUpdated','часть данных недоступна');
    const attention=$('mobileAttention');if(attention&&!attention.children.length)attention.innerHTML='<div class="empty">Не удалось загрузить расширенную сводку</div>';
  }finally{loading=false}
}
function start(){
  const app=$('appView');if(!app)return;
  const run=()=>{if(!app.classList.contains('hidden')){load();clearInterval(timer);timer=setInterval(load,30000)}};
  new MutationObserver(run).observe(app,{attributes:true,attributeFilter:['class']});
  run();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
