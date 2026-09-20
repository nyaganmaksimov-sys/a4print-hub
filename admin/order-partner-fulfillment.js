import {supabase} from './guard.js?v=20260905-netfix1';

const orderId=new URLSearchParams(location.search).get('id');
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c==='"'?'&quot;':'&#39;');
const stages=[
  ['NOT_SENT','Не отправлен'],
  ['SENT','Отправлен'],
  ['CONFIRMED','Подтверждён'],
  ['IN_PRODUCTION','В производстве'],
  ['SHIPPED','Отгружен'],
  ['RECEIVED','Получен']
];
const workflowLabels={MEMORIAL:'Памятники / фотокерамика',SOUVENIR:'Сувениры и знаки',TYPOGRAPHY:'Типография'};
const workflowUrls={MEMORIAL:'https://sferazakaz.ru/katalog/fotokeramika',SOUVENIR:'https://sferazakaz.ru/',TYPOGRAPHY:'https://gmprint.ru/'};
const timestampFields={SENT:'partner_sent_at',CONFIRMED:'partner_confirmed_at',IN_PRODUCTION:'partner_production_at',SHIPPED:'partner_shipped_at',RECEIVED:'partner_received_at'};
let roles=[],order=null,channel=null;

const canManage=()=>roles.includes('ADMIN')||roles.includes('MANAGER');
const fmt=v=>{if(!v)return'—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit'}):'—'};

function ensureCard(){
  let card=document.getElementById('partnerFulfillmentCard');
  if(card)return card;
  const aside=document.querySelector('.order-grid > aside.order-stack');
  if(!aside)return null;
  card=document.createElement('section');
  card.id='partnerFulfillmentCard';
  card.className='order-card partner-fulfillment-card';
  card.hidden=true;
  card.dataset.a4Popup='off';
  card.innerHTML='<div class="order-card-head"><div><h2>Выполнение партнёром</h2><p id="partnerFulfillmentSubtitle">Контроль заказа у поставщика</p></div><span id="partnerFulfillmentBadge" class="order-badge gray">ПАРТНЁР</span></div><div class="order-card-body" id="partnerFulfillmentBody"></div>';
  aside.prepend(card);
  return card;
}

function render(){
  const card=ensureCard();if(!card||!order)return;
  const isPartner=String(order.partner_direction||'').toUpperCase()==='OUTBOUND'&&order.fulfillment_partner_id;
  card.hidden=!isPartner;if(!isPartner)return;

  const partner=order.executor?.name||'Партнёр';
  const workflow=workflowLabels[order.partner_workflow]||'Партнёрский заказ';
  const status=String(order.partner_fulfillment_status||'NOT_SENT').toUpperCase();
  const planned=Number(order.partner_planned_cost||0);
  const actual=order.partner_actual_cost==null?null:Number(order.partner_actual_cost);
  const cost=actual==null?planned:actual;
  const revenue=Number(order.total||0);
  const profit=revenue-cost;
  const margin=revenue>0?profit/revenue*100:0;
  const url=workflowUrls[order.partner_workflow]||'';

  document.getElementById('partnerFulfillmentSubtitle').textContent=partner+' · '+workflow;
  const badge=document.getElementById('partnerFulfillmentBadge');
  badge.textContent=stages.find(([k])=>k===status)?.[1]||(status==='CANCELLED'?'Отменён':status);
  badge.className='order-badge '+(status==='RECEIVED'?'green':status==='CANCELLED'?'red':status==='SHIPPED'?'orange':'gray');

  const stageButtons=stages.map(([key,label])=>'<button type="button" data-partner-stage="'+key+'" class="'+(key===status?'active':'')+'" '+(!canManage()?'disabled':'')+'><span>'+esc(label)+'</span><small>'+esc(fmt(order[timestampFields[key]]))+'</small></button>').join('');

  const body=document.getElementById('partnerFulfillmentBody');
  body.innerHTML=
    '<div class="partner-fulfillment-top"><div><b>'+esc(partner)+'</b><small>'+esc(workflow)+'</small></div>'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Каталог партнёра ↗</a>':'')+'</div>'+
    '<div class="partner-stage-strip">'+stageButtons+'</div>'+
    '<div class="partner-profit-grid">'+
      '<div><span>Заказ клиенту</span><b>'+money(revenue)+'</b></div>'+
      '<div><span>Плановая себестоимость</span><b>'+money(planned)+'</b></div>'+
      '<div><span>'+(actual==null?'Плановая прибыль':'Фактическая прибыль')+'</span><b class="'+(profit<0?'negative':'positive')+'">'+money(profit)+'</b><small>'+margin.toLocaleString('ru-RU',{maximumFractionDigits:1})+'%</small></div>'+
    '</div>'+
    '<div class="partner-fulfillment-form">'+
      '<label><span>№ заказа у партнёра</span><input id="partnerExternalRef" value="'+esc(order.partner_external_ref||'')+'" placeholder="Номер / ID заказа" '+(!canManage()?'disabled':'')+'></label>'+
      '<label><span>Фактическая себестоимость, ₽</span><input id="partnerActualCost" type="number" min="0" step="0.01" value="'+(actual==null?'':actual)+'" placeholder="'+planned+'" '+(!canManage()?'disabled':'')+'></label>'+
      '<label class="wide"><span>Трек / отгрузка / примечание</span><input id="partnerTracking" value="'+esc(order.partner_tracking||'')+'" placeholder="Трек-номер, ТК или данные отгрузки" '+(!canManage()?'disabled':'')+'></label>'+
    '</div>'+
    '<div class="partner-fulfillment-actions">'+
      '<small>Последнее изменение: '+esc(fmt(order.partner_fulfillment_updated_at))+'</small>'+
      (canManage()?'<div><button type="button" id="partnerCancelBtn" class="danger">Отменён у партнёра</button><button type="button" id="partnerSaveBtn" class="primary">Сохранить</button></div>':'')+
    '</div>';

  body.querySelectorAll('[data-partner-stage]').forEach(button=>button.addEventListener('click',()=>save(button.dataset.partnerStage,button)));
  document.getElementById('partnerSaveBtn')?.addEventListener('click',event=>save(status,event.currentTarget));
  document.getElementById('partnerCancelBtn')?.addEventListener('click',event=>{if(confirm('Отметить заказ отменённым у партнёра?'))save('CANCELLED',event.currentTarget)});
}

async function save(nextStatus,button){
  if(!canManage()||!orderId)return;
  const actualRaw=document.getElementById('partnerActualCost')?.value.trim()||'';
  const actual=actualRaw===''?null:Number(actualRaw);
  if(actual!=null&&(!Number.isFinite(actual)||actual<0)){alert('Укажите корректную фактическую себестоимость.');return}
  const externalRef=document.getElementById('partnerExternalRef')?.value.trim()||null;
  const tracking=document.getElementById('partnerTracking')?.value.trim()||null;
  if(button){button.disabled=true;button.classList.add('saving')}
  try{
    const {error}=await supabase.rpc('save_partner_order_fulfillment',{
      p_order_id:orderId,
      p_status:nextStatus,
      p_actual_cost:actual,
      p_external_ref:externalRef,
      p_tracking:tracking
    });
    if(error)throw error;
    await load();
  }catch(error){
    alert('Не удалось сохранить данные партнёра: '+(error.message||error));
  }finally{
    if(button){button.disabled=false;button.classList.remove('saving')}
  }
}

async function load(){
  if(!orderId)return;
  const {data,error}=await supabase.from('orders')
    .select('id,order_number,total,partner_direction,fulfillment_partner_id,partner_workflow,partner_fulfillment_status,partner_planned_cost,partner_actual_cost,partner_external_ref,partner_tracking,partner_fulfillment_updated_at,partner_sent_at,partner_confirmed_at,partner_production_at,partner_shipped_at,partner_received_at,executor:partners!orders_fulfillment_partner_id_fkey(id,name)')
    .eq('id',orderId)
    .single();
  if(error){console.warn('Partner fulfillment unavailable',error);return}
  order=data;render();
}

async function init(){
  ensureCard();
  const {data}=await supabase.rpc('get_my_roles');
  roles=Array.isArray(data)?data:[];
  await load();
  document.getElementById('refresh')?.addEventListener('click',()=>setTimeout(load,50));
  if(typeof supabase.channel==='function'){
    channel=supabase.channel('partner-fulfillment-'+orderId)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'orders',filter:'id=eq.'+orderId},()=>setTimeout(load,120))
      .subscribe();
    window.addEventListener('beforeunload',()=>{if(channel)supabase.removeChannel(channel)},{once:true});
  }
}

init().catch(console.warn);
