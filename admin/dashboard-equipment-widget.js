import {supabase} from './guard.js?v=20260905-netfix1';

if(!window.__A4_DASH_EQUIPMENT_WIDGET__){
  window.__A4_DASH_EQUIPMENT_WIDGET__=true;

  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:0})+' ₽';
  let busy=false,timer=null,channel=null;

  const icon=body=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const icons={
    equipment:icon('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h8M9 17h6"/>'),
    service:icon('<path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L4 17l3 3 5.1-5.1a4 4 0 0 0 5.6-5.6l-2.4 2.4-3-3z"/>'),
    stock:icon('<path d="m3 9 9-5 9 5v11H3z"/><path d="M8 20v-7h8v7"/>'),
    money:icon('<path d="M4 7h16v10H4z"/><path d="M8 12h8M12 9v6"/>')
  };

  function row({tone='info',iconName='equipment',title,text,count}){
    return `<a class="dash-attention-item ${tone}" href="./equipment.html"><span class="dash-attention-icon">${icons[iconName]||icons.equipment}</span><span class="dash-attention-copy"><b>${esc(title)}</b><span>${esc(text)}</span></span><span class="dash-attention-count">${esc(count)}</span></a>`;
  }

  function ensureCard(){
    let card=document.getElementById('equipmentDashboardCard');
    if(card)return card;
    const grids=[...document.querySelectorAll('.dash-grid')];
    const anchor=grids[grids.length-1];
    if(!anchor)return null;
    const section=document.createElement('section');
    section.className='dash-grid';
    section.setAttribute('aria-label','Оборудование и обслуживание');
    section.innerHTML=`<article class="dash-card" id="equipmentDashboardCard"><div class="dash-card-head"><div><h2>Оборудование и ТО</h2><p>Сервис, расходники и затраты</p></div><a href="./equipment.html">Открыть →</a></div><div id="equipmentDashboardSummary" class="dash-attention-list"><div class="dash-empty">Загрузка оборудования…</div></div></article></section>`;
    anchor.insertAdjacentElement('afterend',section);
    return section.querySelector('#equipmentDashboardCard');
  }

  function injectAttention(overdue,soon,low){
    const root=document.getElementById('attention');
    if(!root)return;
    root.querySelectorAll('[data-equipment-attention]').forEach(x=>x.remove());
    if(!overdue&&!soon&&!low)return;
    const wrap=document.createElement('div');
    wrap.dataset.equipmentAttention='1';
    wrap.style.display='contents';
    const title=overdue?`Просрочено ТО: ${overdue}`:(soon?`Скоро ТО: ${soon}`:`Расходники оборудования: ${low}`);
    const text=overdue?'Есть оборудование с просроченной датой обслуживания':soon?'ТО требуется в ближайшие 14 дней':'Есть расходники ниже минимального запаса';
    const count=overdue||soon||low;
    wrap.innerHTML=row({tone:overdue?'danger':'warn',iconName:overdue||soon?'service':'stock',title,text,count});
    root.prepend(...wrap.children);
  }

  async function load(){
    if(busy)return;busy=true;
    try{
      ensureCard();
      const [assetsR,balancesR,servicesR]=await Promise.all([
        supabase.from('equipment_assets').select('id,name,inventory_number,status,next_service_date'),
        supabase.from('equipment_consumable_balances').select('consumable_id,name,current_stock,min_stock,low_stock,is_active'),
        supabase.from('equipment_service_log').select('cost,serviced_at')
      ]);
      for(const r of [assetsR,balancesR,servicesR])if(r.error)throw r.error;
      const assets=assetsR.data||[],balances=balancesR.data||[],services=servicesR.data||[];
      const now=new Date();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();const soonLimit=today+14*86400000;
      const live=assets.filter(a=>a.status!=='WRITTEN_OFF');
      let overdue=0,soon=0;
      for(const a of live){
        if(!a.next_service_date)continue;
        const due=new Date(`${a.next_service_date}T23:59:59`).getTime();
        if(!Number.isFinite(due))continue;
        if(due<today)overdue++;else if(due<=soonLimit)soon++;
      }
      const low=balances.filter(b=>b.is_active!==false&&b.low_stock).length;
      const monthStart=new Date(now.getFullYear(),now.getMonth(),1).getTime();
      const monthCost=services.filter(s=>{const d=new Date(`${s.serviced_at}T00:00:00`).getTime();return Number.isFinite(d)&&d>=monthStart}).reduce((sum,s)=>sum+Number(s.cost||0),0);
      const totalCost=services.reduce((sum,s)=>sum+Number(s.cost||0),0);
      const root=document.getElementById('equipmentDashboardSummary');
      if(root)root.innerHTML=[
        row({tone:overdue?'danger':'good',iconName:'service',title:'Просроченное ТО',text:overdue?'Требуется обслуживание':'Просроченного обслуживания нет',count:overdue}),
        row({tone:soon?'warn':'good',iconName:'service',title:'ТО в ближайшие 14 дней',text:soon?'Запланируйте сервис заранее':'Ближайших ТО нет',count:soon}),
        row({tone:low?'danger':'good',iconName:'stock',title:'Низкий запас расходников',text:low?'Нужно пополнить материалы':'Запасы оборудования в норме',count:low}),
        row({tone:'info',iconName:'money',title:'Затраты на сервис',text:`За всё время ${money(totalCost)}`,count:money(monthCost)})
      ].join('');
      injectAttention(overdue,soon,low);
    }catch(error){
      console.warn('Equipment dashboard unavailable',error);
      const root=document.getElementById('equipmentDashboardSummary');
      if(root)root.innerHTML='<div class="dash-empty">Не удалось получить данные оборудования</div>';
    }finally{busy=false}
  }

  function initRealtime(){
    if(typeof supabase.channel!=='function')return;
    const reload=()=>{clearTimeout(timer);timer=setTimeout(load,500)};
    let ch=supabase.channel('dashboard-equipment-v1');
    for(const table of ['equipment_assets','equipment_consumables','equipment_consumable_movements','equipment_service_log'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);
    channel=ch.subscribe();
    window.addEventListener('beforeunload',()=>{if(channel)supabase.removeChannel(channel)},{once:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{load();initRealtime()},{once:true});else{load();initRealtime()}
  setInterval(()=>{if(!document.hidden)load()},60000);
}
