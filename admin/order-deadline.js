import {supabase} from './guard.js?v=20260905-netfix1';

const orderId=new URLSearchParams(location.search).get('id');
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const finished=new Set(['COMPLETED','CANCELLED']);
let channel=null;

function fmt(value){
  if(!value)return'—';
  const d=new Date(value);if(Number.isNaN(d.getTime()))return'—';
  return d.toLocaleString('ru-RU',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

function duration(ms){
  const abs=Math.max(0,Math.abs(ms));
  const hours=Math.ceil(abs/3600000);
  if(hours<24)return `${hours} ч`;
  const days=Math.ceil(hours/24);
  return `${days} дн.`;
}

function classify(order){
  if(!order?.due_at)return{tone:'empty',label:'Срок не установлен',detail:'Укажите дату выполнения через «Редактировать заказ»'};
  const due=new Date(order.due_at).getTime();
  if(!Number.isFinite(due))return{tone:'empty',label:'Срок не установлен',detail:'Дата срока некорректна'};
  if(finished.has(String(order.status||'').toUpperCase()))return{tone:'done',label:'Заказ завершён',detail:`Срок был установлен на ${fmt(order.due_at)}`};
  const diff=due-Date.now();
  if(diff<0)return{tone:'danger',label:`Просрочено на ${duration(diff)}`,detail:'Срок выполнения уже прошёл'};
  if(diff<=24*3600000)return{tone:'danger',label:`Осталось ${duration(diff)}`,detail:'Заказ нужно выполнить в ближайшие 24 часа'};
  const remind=Math.max(0,Number(order.deadline_remind_before_hours??48));
  if(diff<=remind*3600000)return{tone:'warn',label:`Осталось ${duration(diff)}`,detail:`Включено напоминание за ${remind} ч`};
  return{tone:'ok',label:`До срока ${duration(diff)}`,detail:`Напоминание за ${remind} ч`};
}

function ensureNode(){
  let node=$('orderDeadlineCard');
  if(node)return node;
  const info=$('orderInfo');if(!info)return null;
  node=document.createElement('div');
  node.id='orderDeadlineCard';
  node.className='order-deadline-card empty';
  info.insertAdjacentElement('beforebegin',node);
  return node;
}

function render(order){
  const node=ensureNode();if(!node)return;
  const state=classify(order);
  node.className=`order-deadline-card ${state.tone}`;
  const note=String(order?.deadline_note||'').trim();
  node.innerHTML=`
    <div class="order-deadline-icon" aria-hidden="true">◷</div>
    <div class="order-deadline-main">
      <span>Срок выполнения заказа</span>
      <b>${order?.due_at?esc(fmt(order.due_at)):'Не установлен'}</b>
      <small>${esc(note||state.detail)}</small>
    </div>
    <div class="order-deadline-state"><b>${esc(state.label)}</b>${note?`<small>${esc(state.detail)}</small>`:''}</div>`;
}

async function load(){
  if(!orderId)return;
  try{
    const {data,error}=await supabase.from('orders').select('id,status,due_at,deadline_remind_before_hours,deadline_note').eq('id',orderId).single();
    if(error)throw error;
    render(data);
  }catch(error){
    console.warn('Order deadline unavailable',error);
  }
}

function realtime(){
  if(!orderId||typeof supabase.channel!=='function')return;
  channel=supabase.channel(`order-deadline-${orderId}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'orders',filter:`id=eq.${orderId}`},()=>load()).subscribe();
  window.addEventListener('beforeunload',()=>{if(channel)supabase.removeChannel(channel)},{once:true});
}

await load();
realtime();
setInterval(()=>{const node=$('orderDeadlineCard');if(node&&document.visibilityState==='visible')load()},60000);
