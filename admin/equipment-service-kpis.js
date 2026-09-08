import {supabase} from './guard.js?v=20260905-netfix1';

if(!window.__A4_EQUIPMENT_SERVICE_KPIS__){
  window.__A4_EQUIPMENT_SERVICE_KPIS__=true;
  const fmt=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:0})+' ₽';
  let busy=false,channel=null,timer=null;

  function ensureCards(){
    const root=document.querySelector('.eq-kpis');
    if(!root)return null;
    if(!document.getElementById('serviceMonthCost')){
      const month=document.createElement('article');
      month.className='eq-kpi';
      month.innerHTML='<span>Сервис за месяц</span><strong id="serviceMonthCost">0 ₽</strong><small>ТО и ремонты текущего месяца</small>';
      const total=document.createElement('article');
      total.className='eq-kpi';
      total.innerHTML='<span>Затраты на сервис</span><strong id="serviceTotalCost">0 ₽</strong><small>за всё время по журналу ТО</small>';
      root.append(month,total);
      root.style.gridTemplateColumns='repeat(3,minmax(0,1fr))';
    }
    return root;
  }

  async function load(){
    if(busy)return;busy=true;
    try{
      ensureCards();
      const {data,error}=await supabase.from('equipment_service_log').select('cost,serviced_at');
      if(error)throw error;
      const now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),1).getTime();
      let month=0,total=0;
      for(const row of data||[]){
        const cost=Number(row.cost||0);total+=cost;
        const t=new Date(`${row.serviced_at}T00:00:00`).getTime();
        if(Number.isFinite(t)&&t>=start)month+=cost;
      }
      const m=document.getElementById('serviceMonthCost'),t=document.getElementById('serviceTotalCost');
      if(m)m.textContent=fmt(month);if(t)t.textContent=fmt(total);
    }catch(error){console.warn('Equipment service KPI unavailable',error)}finally{busy=false}
  }

  function realtime(){
    if(typeof supabase.channel!=='function')return;
    const reload=()=>{clearTimeout(timer);timer=setTimeout(load,350)};
    channel=supabase.channel('equipment-service-kpis-v1').on('postgres_changes',{event:'*',schema:'public',table:'equipment_service_log'},reload).subscribe();
    window.addEventListener('beforeunload',()=>{if(channel)supabase.removeChannel(channel)},{once:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{ensureCards();load();realtime()},{once:true});else{ensureCards();load();realtime()}
}
