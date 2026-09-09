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
