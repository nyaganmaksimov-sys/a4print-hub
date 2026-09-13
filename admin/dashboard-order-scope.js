import { supabase } from './guard.js?v=20260905-netfix1';

(()=>{
  if(window.__A4_DASHBOARD_ORDER_SCOPE__)return;
  window.__A4_DASHBOARD_ORDER_SCOPE__=true;

  const esc=value=>String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=value=>Number(value||0).toLocaleString('ru-RU',{maximumFractionDigits:0});
  const statusNames={NEW:'Новый',CONFIRMED:'Подтверждён',IN_PROGRESS:'В работе',READY:'Готов',COMPLETED:'Завершён',ON_HOLD:'Приостановлен',CANCELLED:'Отменён'};

  let managerOrders=[];
  let monthCount=0;
  let badgeObserver=null;
  let recentObserver=null;

  function isManagerOrder(order){
    const source=String(order?.source||'').trim().toUpperCase();
    const direction=String(order?.partner_direction||'').trim().toUpperCase();
    if(source==='KASSA'||source==='POS'||source==='PARTNER_OUTBOUND')return false;
    if(direction==='OUTBOUND')return false;
    return true;
  }

  function customerName(order){
    const customer=order?.customers||{};
    return customer.full_name||customer.company_name||order?.customer_name||order?.client_name||'Клиент не указан';
  }
  function customerMeta(order){
    const customer=order?.customers||{};
    return customer.phone||customer.email||customer.company_name||'';
  }
  function orderTitle(order){
    return order?.model_name||order?.service_name||(order?.business_unit==='3D_ARTPRINT'?'3D-заказ':'Печать / услуга');
  }
  function orderDate(value){
    if(!value)return'';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return'';
    return date.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})+' · '+date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  }
  function unitLabel(unit){return unit==='3D_ARTPRINT'?'3D-ARTPRINT':unit==='A4_PRINT'?'А4-Принт':'Общий'}
  function unitClass(unit){return unit==='3D_ARTPRINT'?'unit-3d':unit==='A4_PRINT'?'':'unit-common'}
  function statusClass(status){if(status==='NEW')return'status-new';if(['CONFIRMED','IN_PROGRESS'].includes(status))return'status-work';if(status==='READY')return'status-ready';if(status==='COMPLETED')return'status-completed';if(['ON_HOLD','CANCELLED'].includes(status))return'status-cancelled';return''}

  function monthRange(){
    const now=new Date();
    const start=new Date(now.getFullYear(),now.getMonth(),1);
    const end=new Date(now.getFullYear(),now.getMonth()+1,1);
    return {start:start.toISOString(),end:end.toISOString()};
  }

  function enforceBadge(){
    const badge=document.getElementById('orderCount');
    if(!badge)return;
    const value=String(monthCount);
    if(badge.textContent!==value)badge.textContent=value;
    badge.title=`Заказов менеджеров за текущий месяц: ${value}`;
  }

  function watchBadge(){
    badgeObserver?.disconnect();
    const badge=document.getElementById('orderCount');
    if(!badge)return;
    badgeObserver=new MutationObserver(enforceBadge);
    badgeObserver.observe(badge,{childList:true,subtree:true,characterData:true});
    enforceBadge();
  }

  function renderRecent(){
    const root=document.getElementById('recentOrders');
    if(!root)return;
    recentObserver?.disconnect();
    const rows=managerOrders.slice(0,5);
    root.innerHTML=rows.map(order=>`<a class="dash-order-row" href="./order.html?id=${encodeURIComponent(order.id)}"><span class="dash-order-number">№${esc((order.order_number??String(order.id||'').slice(0,8))||'—')}</span><span class="dash-order-customer"><b>${esc(customerName(order))}</b><small>${esc(customerMeta(order)||orderDate(order.created_at))}</small></span><span class="dash-order-service"><b>${esc(orderTitle(order))}</b><small>${esc(orderDate(order.created_at))}</small></span><span class="dash-unit ${unitClass(order.business_unit)}">${esc(unitLabel(order.business_unit))}</span><span class="dash-order-total">${money(order.total||order.total_amount)} ₽</span><span class="dash-status ${statusClass(order.status)}">${esc(statusNames[order.status]||order.status||'—')}</span></a>`).join('')||'<div class="dash-empty">Клиентских заказов пока нет</div>';
    recentObserver=new MutationObserver(()=>{
      clearTimeout(recentObserver._timer);
      recentObserver._timer=setTimeout(renderRecent,0);
    });
    recentObserver.observe(root,{childList:true,subtree:true});
  }

  async function loadRecent(){
    let result=await supabase.from('orders').select('*,customers(full_name,company_name,phone,email)').order('created_at',{ascending:false}).limit(80);
    if(result.error)result=await supabase.from('orders').select('*').order('created_at',{ascending:false}).limit(80);
    if(result.error)throw result.error;
    managerOrders=(result.data||[]).filter(isManagerOrder);
  }

  async function loadMonthCount(){
    const {start,end}=monthRange();
    let result=await supabase.from('orders').select('id,source,partner_direction,created_at').gte('created_at',start).lt('created_at',end).limit(2000);
    if(result.error){
      result=await supabase.from('orders').select('*').gte('created_at',start).lt('created_at',end).limit(2000);
    }
    if(result.error)throw result.error;
    monthCount=(result.data||[]).filter(isManagerOrder).length;
  }

  async function refresh(){
    try{
      await Promise.all([loadRecent(),loadMonthCount()]);
      watchBadge();
      renderRecent();
    }catch(error){
      console.warn('Dashboard manager order scope:',error);
    }
  }

  function init(){
    refresh();
    setTimeout(refresh,1500);
    setInterval(refresh,60000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
