import { supabase } from './guard.js?v=20260905-netfix1';

if (!window.__A4_ORDER_DELETE_REQUEST__) {
  window.__A4_ORDER_DELETE_REQUEST__ = true;

  const isManager = /\/admin\/manager\.html$/.test(location.pathname);
  const isOrders = /\/admin\/orders\.html$/.test(location.pathname);
  const eligible = new Map();
  const pending = new Set();
  let currentUserId = null;
  let isAdmin = false;
  let decorateTimer = null;

  function injectStyles(){
    if(document.getElementById('a4-order-delete-request-style')) return;
    const style=document.createElement('style');
    style.id='a4-order-delete-request-style';
    style.textContent=`
      .a4-delete-request-btn{appearance:none;border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:9px;padding:7px 10px;font:800 11px/1.1 Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap;transition:.15s ease}
      .a4-delete-request-btn:hover{background:#fff1f2;border-color:#fca5a5}.a4-delete-request-btn:disabled{cursor:default;color:#92400e;background:#fffbeb;border-color:#fde68a;opacity:1}
      .order-mini{position:relative}.order-mini>.a4-delete-request-btn{position:absolute;right:8px;top:50%;transform:translateY(-50%);z-index:3}.order-mini.a4-has-delete-request{padding-right:164px!important}
      .order-actions .a4-delete-request-btn{margin-left:6px}
      @media(max-width:700px){.order-mini>.a4-delete-request-btn{position:static;transform:none;margin-top:7px;justify-self:start}.order-mini.a4-has-delete-request{padding-right:12px!important}.order-actions .a4-delete-request-btn{margin-left:0;margin-top:6px;width:100%}}
    `;
    document.head.appendChild(style);
  }

  function friendlyError(error){
    const text=String(error?.message||error||'');
    if(text.includes('ONLY_OWN_ORDER_CAN_BE_REQUESTED')) return 'Можно отправить на удаление только свой заказ.';
    if(text.includes('POS_ORDER_DELETE_FORBIDDEN')) return 'Кассовые чеки нельзя удалять через менеджерские заказы.';
    if(text.includes('PARTNER_ORDER_DELETE_FORBIDDEN')) return 'Партнёрские заказы удаляются в своём разделе.';
    if(text.includes('ORDER_NOT_FOUND')) return 'Заказ уже отсутствует.';
    if(text.includes('ACCESS_DENIED')) return 'Недостаточно прав для запроса удаления.';
    return text || 'Не удалось отправить запрос на удаление.';
  }

  function isManagerOrder(order){
    if(!order) return false;
    if(String(order.source||'').toUpperCase()==='KASSA') return false;
    if(String(order.partner_direction||'NONE').toUpperCase()!=='NONE') return false;
    if(order.partner_id||order.fulfillment_partner_id) return false;
    return true;
  }

  async function loadState(){
    const profileResult=await supabase.rpc('get_my_staff_profile');
    if(profileResult.error) throw profileResult.error;
    const profile=Array.isArray(profileResult.data)?profileResult.data[0]:profileResult.data;
    currentUserId=profile?.user?.id||profile?.id||null;
    const roles=Array.isArray(profile?.roles)?profile.roles:[];
    isAdmin=roles.some(role=>String(role?.name||role).toUpperCase()==='ADMIN');
    if(!currentUserId) return;

    const [ordersResult,requestsResult]=await Promise.all([
      supabase.from('orders').select('id,order_number,created_by,source,partner_direction,partner_id,fulfillment_partner_id,created_at').order('created_at',{ascending:false}).limit(1000),
      supabase.from('order_deletion_requests').select('id,order_id,status').eq('status','NEW').order('created_at',{ascending:false}).limit(500)
    ]);
    if(ordersResult.error) throw ordersResult.error;
    if(requestsResult.error) throw requestsResult.error;

    eligible.clear();
    for(const order of ordersResult.data||[]){
      if(!isManagerOrder(order)) continue;
      const mine=order.created_by===currentUserId;
      const legacy=!order.created_by;
      if(mine||legacy||isAdmin) eligible.set(order.id,{...order,legacy});
    }
    pending.clear();
    for(const request of requestsResult.data||[]) if(request.order_id) pending.add(request.order_id);
  }

  function buttonFor(orderId){
    const order=eligible.get(orderId);
    const button=document.createElement('button');
    button.type='button';
    button.className='a4-delete-request-btn';
    button.dataset.orderDeleteRequest=orderId;
    if(pending.has(orderId)){
      button.disabled=true;
      button.textContent='На модерации';
      button.title='Запрос на удаление уже отправлен';
    }else{
      button.textContent='Запросить удаление';
      button.title=order?.legacy
        ? 'Старый заказ без сохранённого автора: удаление выполнит администратор после проверки'
        : 'Заказ останется в системе до решения администратора';
    }
    return button;
  }

  function decorateManager(){
    const root=document.getElementById('orders');
    if(!root) return;
    root.querySelectorAll('a.order-mini[href*="order.html?id="]').forEach(link=>{
      if(link.querySelector('[data-order-delete-request]')) return;
      let id='';
      try{id=new URL(link.href,location.href).searchParams.get('id')||''}catch{}
      if(!id||!eligible.has(id)) return;
      link.classList.add('a4-has-delete-request');
      link.appendChild(buttonFor(id));
    });
  }

  function decorateOrders(){
    document.querySelectorAll('.order-work-row[data-order-id]').forEach(row=>{
      const id=row.dataset.orderId||'';
      if(!id||!eligible.has(id)) return;
      const actions=row.querySelector('.order-actions');
      if(!actions||actions.querySelector('[data-order-delete-request]')) return;
      actions.appendChild(buttonFor(id));
    });
  }

  function decorate(){
    clearTimeout(decorateTimer);
    decorateTimer=setTimeout(()=>{
      if(isManager) decorateManager();
      if(isOrders) decorateOrders();
    },40);
  }

  async function sendRequest(orderId,button){
    const order=eligible.get(orderId);
    if(!order) return;
    const legacyNote=order.legacy?'\n\nУ этого старого заказа автор не был сохранён. Администратор проверит запрос вручную.':'';
    const reason=window.prompt(`Причина удаления заказа №${order.order_number||''}:\n\nЗапрос уйдёт администратору на модерацию.${legacyNote}`,'');
    if(reason===null) return;
    if(!reason.trim()){
      window.alert('Укажите причину удаления — она нужна администратору для модерации.');
      return;
    }
    if(!window.confirm(`Отправить запрос на удаление заказа №${order.order_number||''}?\n\nДо одобрения заказ останется в системе.`)) return;

    button.disabled=true;
    const previous=button.textContent;
    button.textContent='Отправляем…';
    const result=await supabase.rpc('request_order_deletion',{p_order_id:orderId,p_reason:reason.trim()});
    if(result.error){
      button.disabled=false;
      button.textContent=previous;
      window.alert(friendlyError(result.error));
      return;
    }
    pending.add(orderId);
    button.disabled=true;
    button.textContent='На модерации';
    button.title='Запрос отправлен администратору';
  }

  function bindClicks(){
    document.addEventListener('click',(event)=>{
      const button=event.target.closest('[data-order-delete-request]');
      if(!button) return;
      event.preventDefault();
      event.stopPropagation();
      if(button.disabled) return;
      sendRequest(button.dataset.orderDeleteRequest,button).catch(error=>{
        console.error('Order delete request failed',error);
        button.disabled=false;
        button.textContent='Запросить удаление';
        window.alert(friendlyError(error));
      });
    },true);
  }

  async function start(){
    if(!isManager&&!isOrders) return;
    injectStyles();
    bindClicks();
    try{
      await loadState();
      decorate();
      const target=isManager?document.getElementById('orders'):document.getElementById('list');
      if(target){
        const observer=new MutationObserver(decorate);
        observer.observe(target,{childList:true,subtree:true});
      }
    }catch(error){console.warn('Order delete request UI unavailable',error)}
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
}
