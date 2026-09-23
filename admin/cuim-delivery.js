import {supabase} from './guard.js?v=20260923-delivery1';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>new Intl.NumberFormat('ru-RU').format(Number(value||0))+' ₽';
const labels={
  OPEN:'Ищем курьера',
  ASSIGNED:'Курьер назначен',
  GOING_TO_PICKUP:'Едет за заказом',
  PICKED_UP:'Забрал',
  IN_TRANSIT:'В пути',
  DELIVERED:'Доставлено',
  CANCELLED:'Отменено'
};

const state={loading:false,channel:null,realtimeTimer:null,authorized:false};

function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}
function setMessage(text,tone=''){
  const el=$('msg');
  if(!el)return;
  el.textContent=text||'';
  el.className=`msg${tone?' '+tone:''}`;
}
function renderLoading(){
  $('list').innerHTML='<div class="delivery-loading-list"><div class="a4-skeleton"></div><div class="a4-skeleton"></div><div class="a4-skeleton"></div></div>';
}
function renderError(error){
  const message=error?.message||String(error);
  $('list').innerHTML=`<div class="delivery-error"><b>Не удалось загрузить заявки</b><div style="margin-top:5px">${esc(message)}</div><button id="deliveryRetry" class="btn secondary" type="button">Повторить</button></div>`;
  $('deliveryRetry')?.addEventListener('click',()=>void loadOffers());
}
function offerCard(offer){
  const courier=offer.courier_name
    ?`<br><b>Курьер: ${esc(offer.courier_name)} · ${esc(offer.courier_phone||'')}</b>`
    :'';
  return `<article class="delivery">
    <div style="display:flex;justify-content:space-between;gap:10px">
      <span class="badge">${esc(labels[offer.status]||offer.status)}</span>
      <span class="price">${money(offer.price)}</span>
    </div>
    <div class="route" style="margin-top:8px">${esc(offer.pickup_address)} → ${esc(offer.delivery_address)}</div>
    <div class="meta">${esc(offer.package_description||'Посылка')}<br>Получатель: ${esc(offer.recipient_name||'—')} · ${esc(offer.recipient_phone||'—')}${courier}</div>
  </article>`;
}
function renderOffers(rows){
  $('list').innerHTML=(rows||[]).map(offerCard).join('')||'<div class="meta">Вы ещё не создавали заявок на доставку.</div>';
}
async function loadOffers(){
  if(!state.authorized||state.loading)return;
  state.loading=true;
  $('refresh').disabled=true;
  renderLoading();
  try{
    const {data,error}=await supabase.rpc('manager_delivery_offers');
    if(error)throw error;
    renderOffers(data||[]);
  }catch(error){
    console.error('CUIM delivery offers load failed',error);
    renderError(error);
  }finally{
    state.loading=false;
    $('refresh').disabled=false;
  }
}
function toIso(id){
  const value=$(id)?.value;
  if(!value)return null;
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toISOString():null;
}
async function sendCourierPush(offerId){
  try{
    const {data,error}=await supabase.functions.invoke('courier-push-notify',{body:{offer_id:offerId}});
    if(error)throw error;
    const sent=Number(data?.sent||0);
    if(sent>0)notify('success','Курьеры уведомлены',`Push отправлен: ${sent}.`);
  }catch(error){
    console.warn('Courier push notification failed',error);
    notify('warning','Заявка создана без push','Курьеры увидят её на бирже. Push-уведомление отправить не удалось.');
  }
}
async function submitOffer(event){
  event.preventDefault();
  const button=$('submit');
  if(button.disabled)return;
  button.disabled=true;
  setMessage('Публикуем…');
  try{
    const {data,error}=await supabase.rpc('manager_create_courier_offer',{
      p_pickup_address:$('pickup').value.trim(),
      p_pickup_hint:$('pickupHint').value.trim()||null,
      p_delivery_address:$('delivery').value.trim(),
      p_delivery_hint:$('deliveryHint').value.trim()||null,
      p_recipient_name:$('recipient').value.trim()||null,
      p_recipient_phone:$('phone').value.trim()||null,
      p_package_description:$('package').value.trim()||null,
      p_price:Number($('price').value||0),
      p_weight_kg:$('weight').value?Number($('weight').value):null,
      p_dimensions_text:$('dims').value.trim()||null,
      p_vehicle_required:$('vehicle').value||null,
      p_pickup_until:toIso('pickupUntil'),
      p_deliver_until:toIso('deliverUntil')
    });
    if(error)throw error;

    $('form').reset();
    setMessage('Заявка опубликована. Курьеры увидят её на бирже.','ok');
    notify('success','Доставка опубликована','Заявка появилась на бирже курьеров.');
    await loadOffers();
    void sendCourierPush(data);
  }catch(error){
    console.error('CUIM delivery create failed',error);
    setMessage(error?.message||String(error),'error');
    notify('error','Не удалось опубликовать доставку',error?.message||String(error));
  }finally{
    button.disabled=false;
  }
}
function scheduleReload(){
  clearTimeout(state.realtimeTimer);
  state.realtimeTimer=setTimeout(()=>{
    if(!document.hidden)void loadOffers();
  },250);
}
function initRealtime(){
  if(typeof supabase.channel!=='function'||state.channel)return;
  state.channel=supabase.channel('manager-delivery-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'courier_delivery_offers'},scheduleReload)
    .subscribe();
}
async function init(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){location.replace('./login.html');return}
  $('userEmail').textContent=session.user.email||'';

  const [adminResult,managerResult]=await Promise.all([
    supabase.rpc('has_role',{required_role:'ADMIN'}),
    supabase.rpc('has_role',{required_role:'MANAGER'})
  ]);
  if(adminResult.error)throw adminResult.error;
  if(managerResult.error)throw managerResult.error;

  state.authorized=Boolean(adminResult.data||managerResult.data);
  if(!state.authorized){
    document.querySelector('.main').innerHTML='<div class="a4-error" style="margin:24px"><b>Нет доступа</b><div style="margin-top:5px">Раздел доступен только администратору или менеджеру.</div></div>';
    return;
  }

  await loadOffers();
  initRealtime();
}

$('refresh')?.addEventListener('click',()=>void loadOffers());
$('form')?.addEventListener('submit',submitOffer);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.authorized)void loadOffers()});
window.addEventListener('beforeunload',()=>{
  if(state.realtimeTimer)clearTimeout(state.realtimeTimer);
  if(state.channel)supabase.removeChannel(state.channel).catch(()=>{});
});

void init().catch(error=>{
  console.error('CUIM delivery init failed',error);
  renderError(error);
  notify('error','Не удалось открыть ЦУИМ Доставку',error?.message||String(error),{duration:0,actionLabel:'Повторить',onAction:()=>location.reload()});
});
