import {supabase} from './guard.js?v=20260905-netfix1';

if(!window.__A4_EQUIPMENT_MAINTENANCE_BADGE__){
  window.__A4_EQUIPMENT_MAINTENANCE_BADGE__=true;
  let channel=null,reloadTimer=null,busy=false;

  const localDate=value=>{
    if(!value)return null;
    const d=new Date(`${value}T00:00:00`);
    return Number.isFinite(d.getTime())?d:null;
  };
  const todayStart=()=>{const d=new Date();d.setHours(0,0,0,0);return d};

  function installStyles(){
    if(document.getElementById('a4-equipment-nav-badge-style'))return;
    const style=document.createElement('style');
    style.id='a4-equipment-nav-badge-style';
    style.textContent=`
      #equipmentNavCount{display:none;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;margin-left:auto;border-radius:999px;font-size:10px;font-weight:900;line-height:1;color:#fff;background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.12)}
      #equipmentNavCount.danger{background:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.12)}
      #equipmentNavCount.visible{display:inline-flex!important}
      body.a4-sidebar-collapsed #equipmentNavCount{position:absolute;right:3px;top:3px;min-width:15px;width:15px;height:15px;padding:0;font-size:8px}
      .sidebar nav a[href$="equipment.html"]{position:relative}
    `;
    document.head.appendChild(style);
  }

  function findBadge(){return document.getElementById('equipmentNavCount')}
  function applyBadge(urgent,soon){
    installStyles();
    const badge=findBadge();
    if(!badge)return false;
    const count=urgent||soon;
    badge.textContent=String(count||0);
    badge.classList.toggle('visible',count>0);
    badge.classList.toggle('danger',urgent>0);
    badge.title=urgent>0?`Просрочено или на сегодня: ${urgent}`:soon>0?`Скоро обслуживание: ${soon}`:'Нет срочных работ';
    const link=badge.closest('a');
    if(link)link.title=urgent>0?`Оборудование · срочных работ: ${urgent}`:soon>0?`Оборудование · скоро работ: ${soon}`:'Оборудование';
    return true;
  }

  async function load(){
    if(busy)return;busy=true;
    try{
      const {data,error}=await supabase.from('equipment_maintenance_plans').select('next_due_date,reminder_days,is_active').eq('is_active',true);
      if(error)throw error;
      const today=todayStart();let urgent=0,soon=0;
      for(const plan of data||[]){
        const due=localDate(plan.next_due_date);if(!due)continue;
        if(due<=today){urgent++;continue}
        const remind=Math.max(0,Number(plan.reminder_days||0));
        const warn=new Date(today);warn.setDate(warn.getDate()+remind);
        if(due<=warn)soon++;
      }
      let tries=0;
      const paint=()=>{if(applyBadge(urgent,soon)||++tries>40)return;setTimeout(paint,100)};
      paint();
    }catch(error){console.warn('Equipment maintenance badge unavailable',error)}
    finally{busy=false}
  }

  function openCalendarFromHash(){
    if(!/\/admin\/equipment\.html$/.test(location.pathname)||location.hash!=='#calendar')return;
    let tries=0;
    const open=()=>{
      const button=document.getElementById('calendarTabButton');
      if(button){button.click();button.scrollIntoView({block:'nearest'});return}
      if(++tries<60)setTimeout(open,100);
    };
    open();
  }

  if(typeof supabase.channel==='function'){
    const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(load,400)};
    channel=supabase.channel('equipment-maintenance-badge-v1').on('postgres_changes',{event:'*',schema:'public',table:'equipment_maintenance_plans'},reload).subscribe();
    window.addEventListener('beforeunload',()=>{if(channel)supabase.removeChannel(channel)},{once:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{load();openCalendarFromHash()},{once:true});
  else{load();openCalendarFromHash()}
  window.addEventListener('hashchange',openCalendarFromHash);
  setInterval(()=>{if(!document.hidden)load()},60000);
}

// Sidebar order badge: total ordinary HUB/manager orders created in the current
// Moscow calendar month. POS receipts and partner-direction orders belong to
// their own workflows and are deliberately excluded from this counter.
if(!window.__A4_SIDEBAR_MONTH_ORDER_COUNT__){
  window.__A4_SIDEBAR_MONTH_ORDER_COUNT__=true;
  let orderBusy=false;

  function moscowMonthBounds(){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
      timeZone:'Europe/Moscow',year:'numeric',month:'2-digit'
    }).formatToParts(new Date()).map(x=>[x.type,x.value]));
    let year=Number(parts.year),month=Number(parts.month);
    const from=`${year}-${String(month).padStart(2,'0')}-01T00:00:00+03:00`;
    month+=1;
    if(month===13){month=1;year+=1}
    const to=`${year}-${String(month).padStart(2,'0')}-01T00:00:00+03:00`;
    return{from,to};
  }

  function monthCaption(){
    return new Intl.DateTimeFormat('ru-RU',{
      timeZone:'Europe/Moscow',month:'long',year:'numeric'
    }).format(new Date());
  }

  function applyOrderCount(count){
    const badge=document.getElementById('orderCount');
    if(!badge)return false;
    const value=Math.max(0,Number(count)||0);
    const caption=monthCaption();
    badge.textContent=String(value);
    badge.title=`Заказов за ${caption}: ${value}`;
    const link=badge.closest('a');
    if(link)link.title=`Заказы · за ${caption}: ${value}`;
    return true;
  }

  async function loadOrderCount(){
    if(orderBusy)return;
    orderBusy=true;
    try{
      const {from,to}=moscowMonthBounds();
      const {data,error}=await supabase
        .from('orders')
        .select('id,source,partner_direction,partner_id,fulfillment_partner_id,created_at')
        .gte('created_at',from)
        .lt('created_at',to)
        .limit(10000);
      if(error)throw error;
      const count=(data||[]).filter(order=>{
        const source=String(order.source||'').trim().toUpperCase();
        const direction=String(order.partner_direction||'NONE').trim().toUpperCase();
        return source!=='KASSA'
          && (direction===''||direction==='NONE')
          && !order.partner_id
          && !order.fulfillment_partner_id;
      }).length;
      let tries=0;
      const paint=()=>{
        if(applyOrderCount(count)||++tries>50)return;
        setTimeout(paint,100);
      };
      paint();
    }catch(error){
      console.warn('Sidebar monthly order count unavailable',error);
    }finally{
      orderBusy=false;
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadOrderCount,{once:true});
  else loadOrderCount();
  window.addEventListener('focus',loadOrderCount);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadOrderCount()});
  setInterval(()=>{if(!document.hidden)loadOrderCount()},60000);
}
