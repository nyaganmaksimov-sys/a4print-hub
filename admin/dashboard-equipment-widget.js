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
    calendar:icon('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>'),
    stock:icon('<path d="m3 9 9-5 9 5v11H3z"/><path d="M8 20v-7h8v7"/>'),
    money:icon('<path d="M4 7h16v10H4z"/><path d="M8 12h8M12 9v6"/>')
  };

  function row({tone='info',iconName='equipment',title,text,count,attention=false,calendar=false}){
    const href=calendar?'./equipment.html#calendar':'./equipment.html';
    return `<a class="dash-attention-item ${tone}" href="${href}"${attention?' data-equipment-attention="1"':''}><span class="dash-attention-icon">${icons[iconName]||icons.equipment}</span><span class="dash-attention-copy"><b>${esc(title)}</b><span>${esc(text)}</span></span><span class="dash-attention-count">${esc(count)}</span></a>`;
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
    section.innerHTML=`<article class="dash-card" id="equipmentDashboardCard"><div class="dash-card-head"><div><h2>Оборудование и обслуживание</h2><p>Сегодняшние регламенты, ТО и расходники</p></div><a href="./equipment.html#calendar">Календарь →</a></div><div id="equipmentDashboardSummary" class="dash-attention-list"><div class="dash-empty">Загрузка оборудования…</div></div></article></section>`;
    anchor.insertAdjacentElement('afterend',section);
    return section.querySelector('#equipmentDashboardCard');
  }

  function injectAttention({planOverdue,planToday,planWeek,assetOverdue,low}){
    const root=document.getElementById('attention');
    if(!root)return;
    root.querySelectorAll('[data-equipment-attention]').forEach(x=>x.remove());
    if(planOverdue){
      root.insertAdjacentHTML('afterbegin',row({tone:'danger',iconName:'calendar',title:`Просрочены регламентные работы: ${planOverdue}`,text:'Есть невыполненная прочистка, проверка или другое обслуживание',count:planOverdue,attention:true,calendar:true}));
      return;
    }
    if(planToday){
      root.insertAdjacentHTML('afterbegin',row({tone:'warn',iconName:'calendar',title:`Сегодня обслуживание: ${planToday}`,text:'Откройте календарь и отметьте работу после выполнения',count:planToday,attention:true,calendar:true}));
      return;
    }
    if(assetOverdue){
      root.insertAdjacentHTML('afterbegin',row({tone:'danger',iconName:'service',title:`Просрочено ТО оборудования: ${assetOverdue}`,text:'Есть оборудование с просроченной датой общего ТО',count:assetOverdue,attention:true}));
      return;
    }
    if(low){
      root.insertAdjacentHTML('afterbegin',row({tone:'warn',iconName:'stock',title:`Расходники оборудования: ${low}`,text:'Есть материалы ниже минимального запаса',count:low,attention:true}));
      return;
    }
    if(planWeek){
      root.insertAdjacentHTML('afterbegin',row({tone:'warn',iconName:'calendar',title:`Работы на ближайшие 7 дней: ${planWeek}`,text:'Профилактику можно запланировать заранее',count:planWeek,attention:true,calendar:true}));
    }
  }

  async function load(){
    if(busy)return;busy=true;
    try{
      ensureCard();
      const [assetsR,balancesR,servicesR,plansR]=await Promise.all([
        supabase.from('equipment_assets').select('id,name,inventory_number,status,next_service_date'),
        supabase.from('equipment_consumable_balances').select('consumable_id,name,current_stock,min_stock,low_stock,is_active'),
        supabase.from('equipment_service_log').select('cost,serviced_at'),
        supabase.from('equipment_maintenance_plans').select('id,equipment_id,title,task_type,next_due_date,reminder_days,is_active').eq('is_active',true)
      ]);
      for(const r of [assetsR,balancesR,servicesR,plansR])if(r.error)throw r.error;
      const assets=assetsR.data||[],balances=balancesR.data||[],services=servicesR.data||[],plans=plansR.data||[];
      const now=new Date();
      const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
      const todayMs=today.getTime(),tomorrowMs=todayMs+86400000,weekMs=todayMs+7*86400000,soon14=todayMs+14*86400000;
      const live=assets.filter(a=>a.status!=='WRITTEN_OFF');
      let assetOverdue=0,assetSoon=0;
      for(const a of live){
        if(!a.next_service_date)continue;
        const due=new Date(`${a.next_service_date}T00:00:00`).getTime();
        if(!Number.isFinite(due))continue;
        if(due<todayMs)assetOverdue++;else if(due<=soon14)assetSoon++;
      }

      let planOverdue=0,planToday=0,planWeek=0;
      for(const p of plans){
        if(!p.next_due_date)continue;
        const due=new Date(`${p.next_due_date}T00:00:00`).getTime();
        if(!Number.isFinite(due))continue;
        if(due<todayMs)planOverdue++;
        else if(due<tomorrowMs)planToday++;
        else if(due<=weekMs)planWeek++;
      }

      const low=balances.filter(b=>b.is_active!==false&&b.low_stock).length;
      const monthStart=new Date(now.getFullYear(),now.getMonth(),1).getTime();
      const monthCost=services.filter(s=>{const d=new Date(`${s.serviced_at}T00:00:00`).getTime();return Number.isFinite(d)&&d>=monthStart}).reduce((sum,s)=>sum+Number(s.cost||0),0);
      const totalCost=services.reduce((sum,s)=>sum+Number(s.cost||0),0);
      const root=document.getElementById('equipmentDashboardSummary');
      if(root)root.innerHTML=[
        row({tone:planOverdue?'danger':planToday?'warn':'good',iconName:'calendar',title:'Сегодня нужно сделать',text:planOverdue?`Просрочено ${planOverdue} · сегодня ${planToday}`:planToday?`Регламентных работ на сегодня: ${planToday}`:'На сегодня регламентных работ нет',count:planOverdue+planToday,calendar:true}),
        row({tone:planWeek?'warn':'good',iconName:'calendar',title:'Ближайшие 7 дней',text:planWeek?'Запланируйте профилактику заранее':'Регламентных работ нет',count:planWeek,calendar:true}),
        row({tone:assetOverdue?'danger':assetSoon?'warn':'good',iconName:'service',title:'Общее ТО оборудования',text:assetOverdue?`Просрочено ${assetOverdue} · скоро ${assetSoon}`:assetSoon?`В ближайшие 14 дней: ${assetSoon}`:'ТО по срокам в норме',count:assetOverdue+assetSoon}),
        row({tone:low?'danger':'good',iconName:'stock',title:'Низкий запас расходников',text:low?'Нужно пополнить материалы':'Запасы оборудования в норме',count:low}),
        row({tone:'info',iconName:'money',title:'Затраты на обслуживание',text:`За всё время ${money(totalCost)}`,count:money(monthCost)})
      ].join('');
      injectAttention({planOverdue,planToday,planWeek,assetOverdue,low});
    }catch(error){
      console.warn('Equipment dashboard unavailable',error);
      const root=document.getElementById('equipmentDashboardSummary');
      if(root)root.innerHTML='<div class="dash-empty">Не удалось получить данные оборудования</div>';
    }finally{busy=false}
  }

  function initRealtime(){
    if(typeof supabase.channel!=='function')return;
    const reload=()=>{clearTimeout(timer);timer=setTimeout(load,500)};
    let ch=supabase.channel('dashboard-equipment-v2');
    for(const table of ['equipment_assets','equipment_consumables','equipment_consumable_movements','equipment_service_log','equipment_maintenance_plans'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);
    channel=ch.subscribe();
    window.addEventListener('beforeunload',()=>{if(channel)supabase.removeChannel(channel)},{once:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{load();initRealtime()},{once:true});else{load();initRealtime()}
  setInterval(()=>{if(!document.hidden)load()},60000);
}
