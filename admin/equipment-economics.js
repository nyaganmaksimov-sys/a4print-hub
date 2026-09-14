import {supabase} from './guard.js?v=20260905-netfix1';

if(!window.__A4_EQUIPMENT_ECONOMICS__){
  window.__A4_EQUIPMENT_ECONOMICS__=true;
  const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:0})+' ₽';
  const num=(v,d=0)=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:d});
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  let busy=false,channel=null,timer=null;

  function startFor(days){
    if(!days)return null;
    const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-days+1);
    return d.toISOString().slice(0,10);
  }
  function businessDays(days){
    if(!days)return null;
    let count=0,d=new Date();d.setHours(0,0,0,0);
    for(let i=0;i<days;i++){const n=d.getDay();if(n!==0&&n!==6)count++;d.setDate(d.getDate()-1)}
    return count;
  }
  function aggregate(rows){
    const map=new Map();
    for(const r of rows||[]){
      const id=r.equipment_id;if(!id)continue;
      const x=map.get(id)||{equipment_id:id,completed_jobs:0,machine_minutes:0,operation_revenue:0,machine_cost:0,electricity_cost:0,material_cost:0,production_cost:0,production_margin:0,waste_quantity:0,service_events:0,repair_events:0,service_cost:0,net_margin_after_service:0,active_days:new Set()};
      for(const k of ['completed_jobs','machine_minutes','operation_revenue','machine_cost','electricity_cost','material_cost','production_cost','production_margin','waste_quantity','service_events','repair_events','service_cost','net_margin_after_service'])x[k]+=Number(r[k]||0);
      if(Number(r.completed_jobs||0)>0)x.active_days.add(r.metric_date);
      map.set(id,x);
    }
    return map;
  }
  function ensure(){
    let root=document.getElementById('equipmentEconomics');if(root)return root;
    const shell=document.querySelector('.eq-shell');if(!shell)return null;
    root=document.createElement('section');root.id='equipmentEconomics';root.className='eq-card econ-card';
    root.innerHTML=`<div class="eq-head econ-head"><div><h2>📊 Экономика производственной фермы</h2><p>Выручка, себестоимость, маржа, машинное время, сервис, окупаемость и обязательства владельцам.</p></div><div class="econ-controls"><select id="econPeriod"><option value="30">30 дней</option><option value="90">90 дней</option><option value="365">365 дней</option><option value="0">Всё время</option></select><button id="econRefresh" type="button">↻ Обновить</button></div></div><div class="econ-note">Условная загрузка считается по модели <b>8 часов × рабочий день</b>. Это управленческий ориентир, а не календарь доступности станка.</div><div id="econSummary" class="econ-summary"><div class="eq-empty">Загрузка…</div></div><div id="econTable" class="econ-table-wrap"><div class="eq-empty">Загрузка аналитики…</div></div>`;
    const tabs=shell.querySelector('.eq-tabs');tabs?shell.insertBefore(root,tabs):shell.prepend(root);
    root.querySelector('#econPeriod')?.addEventListener('change',load);
    root.querySelector('#econRefresh')?.addEventListener('click',load);
    return root;
  }
  function kpi(label,value,sub,cls=''){return `<article class="econ-kpi ${cls}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></article>`}
  function replacement(asset,year){
    const analogue=Number(asset.analogue_purchase_price||0),pct=Number(asset.buy_replacement_warning_percent||0),service=Number(year?.service_cost||0);
    if(!analogue||!pct)return {text:'Нет порога',cls:'muted',detail:'Укажите цену аналога и порог замены'};
    const threshold=analogue*pct/100;
    if(service>=threshold)return {text:'Проверить замену',cls:'danger',detail:`Сервис 12 мес. ${money(service)} ≥ ${money(threshold)}`};
    return {text:'Эксплуатировать',cls:'ok',detail:`Сервис 12 мес. ${money(service)} из порога ${money(threshold)}`};
  }
  async function getEconomics(from){
    let q=supabase.from('equipment_economics_daily').select('*').order('metric_date',{ascending:false});
    if(from)q=q.gte('metric_date',from);
    const {data,error}=await q;if(error)throw error;return data||[];
  }
  async function load(){
    if(busy)return;busy=true;ensure();
    const summary=document.getElementById('econSummary'),table=document.getElementById('econTable');
    try{
      const days=Number(document.getElementById('econPeriod')?.value||30),from=startFor(days),yearFrom=startFor(365);
      const [periodRows,yearRows,allRows,assetsR,obligationsR]=await Promise.all([
        getEconomics(from),getEconomics(yearFrom),getEconomics(null),
        supabase.from('equipment_assets').select('id,inventory_number,name,status,ownership_type,market_value,analogue_purchase_price,buy_replacement_warning_percent').neq('status','WRITTEN_OFF').order('inventory_number'),
        supabase.from('equipment_owner_obligations').select('*')
      ]);
      if(assetsR.error)throw assetsR.error;if(obligationsR.error)throw obligationsR.error;
      const period=aggregate(periodRows),year=aggregate(yearRows),all=aggregate(allRows),ob=new Map((obligationsR.data||[]).map(x=>[x.equipment_id,x]));
      const assets=assetsR.data||[],tot={revenue:0,cost:0,margin:0,minutes:0,outstanding:0,service:0};
      for(const a of assets){const p=period.get(a.id);tot.revenue+=p?.operation_revenue||0;tot.cost+=p?.production_cost||0;tot.margin+=p?.net_margin_after_service||0;tot.minutes+=p?.machine_minutes||0;tot.service+=p?.service_cost||0;tot.outstanding+=Number(ob.get(a.id)?.total_outstanding_amount||0)}
      const marginPct=tot.revenue?tot.margin/tot.revenue*100:0;
      if(summary)summary.innerHTML=[kpi('Выручка',money(tot.revenue),days?`за ${days} дней`:'за всё время'),kpi('Производственная себестоимость',money(tot.cost),`сервис отдельно: ${money(tot.service)}`),kpi('Маржа после сервиса',money(tot.margin),`${num(marginPct,1)}% от выручки`,tot.margin<0?'danger':'ok'),kpi('Машинное время',`${num(tot.minutes/60,1)} ч`,`выполненные операции`),kpi('К выплате владельцам',money(tot.outstanding),'согласованные невыплаченные суммы',tot.outstanding>0?'warn':'')].join('');
      const bd=businessDays(days),capacity=bd?bd*8*60:null;
      const rows=assets.map(a=>{
        const p=period.get(a.id)||{},y=year.get(a.id)||{},life=all.get(a.id)||{},o=ob.get(a.id)||{};
        const revenue=Number(p.operation_revenue||0),prod=Number(p.production_cost||0),net=Number(p.net_margin_after_service||0),minutes=Number(p.machine_minutes||0);
        const util=capacity?Math.min(999,minutes/capacity*100):null;
        const investment=Number(a.market_value||a.analogue_purchase_price||0),lifeNet=Number(life.net_margin_after_service||0),coverage=investment>0?lifeNet/investment*100:null;
        const rep=replacement(a,y);
        return `<tr><td><b>${esc(a.inventory_number||'—')} · ${esc(a.name||'Без названия')}</b><small>${esc(a.ownership_type||'—')} · ${esc(a.status||'—')}</small></td><td>${money(revenue)}<small>${Number(p.completed_jobs||0)} заданий</small></td><td>${money(prod)}<small>сервис ${money(p.service_cost||0)}</small></td><td class="${net<0?'neg':'pos'}">${money(net)}<small>${revenue?num(net/revenue*100,1)+'%':'—'}</small></td><td>${num(minutes/60,1)} ч<small>${util==null?'за всё время':`условная загрузка ${num(util,1)}%`}</small></td><td>${coverage==null?'—':num(coverage,1)+'%'}<small>${investment?`база ${money(investment)}`:'нет базы стоимости'}</small></td><td><span class="econ-state ${rep.cls}">${esc(rep.text)}</span><small>${esc(rep.detail)}</small></td><td>${money(o.total_outstanding_amount||0)}<small>доля ${money(o.owner_outstanding_amount||0)} · аренда ${money(o.approved_lease_due||0)}</small></td></tr>`;
      });
      if(table)table.innerHTML=`<table class="econ-table"><thead><tr><th>Оборудование</th><th>Выручка</th><th>Затраты</th><th>Маржа</th><th>Загрузка</th><th>Окупаемость*</th><th>Ремонт / замена</th><th>Обязательства</th></tr></thead><tbody>${rows.join('')||'<tr><td colspan="8">Нет оборудования</td></tr>'}</tbody></table><div class="econ-foot">* Простая окупаемость: накопленная маржа после сервиса / текущая рыночная стоимость (или цена аналога, если рыночная не задана). Не является бухгалтерской амортизацией.</div>`;
    }catch(error){console.warn('Equipment economics unavailable',error);if(summary)summary.innerHTML='<div class="eq-empty">Не удалось загрузить экономику фермы</div>';if(table)table.innerHTML=`<div class="eq-empty">${esc(error?.message||'Ошибка загрузки')}</div>`}finally{busy=false}
  }
  function realtime(){
    if(typeof supabase.channel!=='function')return;
    const reload=()=>{clearTimeout(timer);timer=setTimeout(load,500)};
    let ch=supabase.channel('equipment-economics-v1');
    for(const table of ['production_jobs','equipment_service_log','equipment_assets','equipment_owner_settlements','equipment_lease_charges'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);
    channel=ch.subscribe();window.addEventListener('beforeunload',()=>{if(channel)supabase.removeChannel(channel)},{once:true});
  }
  const boot=()=>{ensure();load();realtime()};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
}
