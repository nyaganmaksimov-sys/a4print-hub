import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const pct=v=>v==null||!Number.isFinite(Number(v))?'—':`${Number(v).toFixed(1)}%`;
const num=(v,d=1)=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:d});
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:0})+' ₽';
const reasonLabels={EQUIPMENT:'Поломка / станок',MATERIAL:'Материал',QUALITY:'Качество',OPERATOR:'Оператор',MAINTENANCE:'ТО / обслуживание',WAITING_APPROVAL:'Ожидание согласования',BREAK:'Перерыв',POWER:'Электричество',SOFTWARE:'ПО / файл',OTHER:'Другое'};
const state={loading:false,channel:null,reloadTimer:null};

function injectStyle(){if(document.querySelector('link[data-production-analytics]'))return;const l=document.createElement('link');l.rel='stylesheet';l.href='./production-farm-analytics.css?v=20260914-1';l.dataset.productionAnalytics='1';document.head.appendChild(l)}
function isoDate(d){return d.toISOString().slice(0,10)}
function range(days){const to=new Date(),from=new Date();from.setHours(0,0,0,0);from.setDate(from.getDate()-days+1);return{from:isoDate(from),to:isoDate(to)}}
function sum(rows,key){return(rows||[]).reduce((s,r)=>s+Number(r[key]||0),0)}
function ratio(n,d){return d>0?n/d*100:null}
function oeeParts(x){
  const availability=ratio(x.runtime,x.runtime+x.downtime);
  const performance=x.actual>0&&x.planned>0?Math.min(100,x.planned/x.actual*100):null;
  const quality=ratio(x.good,x.good+x.scrap+x.rework);
  const oee=availability!=null&&performance!=null&&quality!=null?availability/100*performance/100*quality/100*100:null;
  return{availability,performance,quality,oee};
}
function aggregate(rows){
  const map=new Map();
  for(const r of rows||[]){const id=r.equipment_id;if(!id)continue;const x=map.get(id)||{id,inventory_number:r.inventory_number,equipment_name:r.equipment_name,runtime:0,downtime:0,pause_events:0,good:0,scrap:0,rework:0,completed:0,planned:0,actual:0,revenue:0,cost:0};x.runtime+=Number(r.runtime_minutes||0);x.downtime+=Number(r.downtime_minutes||0);x.pause_events+=Number(r.pause_events||0);x.good+=Number(r.good_quantity||0);x.scrap+=Number(r.scrap_quantity||0);x.rework+=Number(r.rework_quantity||0);x.completed+=Number(r.completed_jobs||0);x.planned+=Number(r.planned_machine_minutes||0);x.actual+=Number(r.actual_machine_minutes||0);x.revenue+=Number(r.operation_revenue||0);x.cost+=Number(r.production_cost||0);map.set(id,x)}
  return map;
}
function aggregateCapacity(rows){const map=new Map();for(const r of rows||[])map.set(r.equipment_id,Number(map.get(r.equipment_id)||0)+Number(r.available_minutes||0));return map}
function ensureUi(){
  injectStyle();
  if(!$('productionAnalyticsBtn')){const actions=document.querySelector('.production-top-actions');if(actions){const b=document.createElement('button');b.id='productionAnalyticsBtn';b.type='button';b.className='prod-an-open';b.textContent='📈 Аналитика';b.addEventListener('click',open);actions.insertBefore(b,actions.firstChild)}}
  if(!$('productionAnalyticsDlg')){const d=document.createElement('dialog');d.id='productionAnalyticsDlg';d.className='prod-an-dialog';d.innerHTML=`
    <div class="prod-an-head"><div><h2>📈 Производственная аналитика / OEE</h2><p>Доступность, выполнение плана, качество, загрузка мощности и причины простоев</p></div><div class="prod-an-head-actions"><select id="prodAnPeriod"><option value="7">7 дней</option><option value="30" selected>30 дней</option><option value="90">90 дней</option><option value="365">365 дней</option></select><button id="prodAnRefresh" type="button">↻</button><button data-prod-an-close type="button">×</button></div></div>
    <div class="prod-an-body"><div class="prod-an-note"><b>Управленческий OEE:</b> доступность = работа / (работа + зафиксированный простой); производительность = плановое / фактическое машинное время, максимум 100%; качество = годно / (годно + брак + переделка). Загрузка мощности считается отдельно по календарю доступности станков.</div><section id="prodAnKpis" class="prod-an-kpis"><div class="prod-an-empty">Загрузка…</div></section><section class="prod-an-grid"><article class="prod-an-panel"><div class="prod-an-title"><b>Станки и узкие места</b><small>Сортировка по загрузке мощности и потерям</small></div><div id="prodAnEquipment" class="prod-an-table-wrap"><div class="prod-an-empty">Загрузка…</div></div></article><article class="prod-an-panel"><div class="prod-an-title"><b>Pareto простоев</b><small>Какие причины съедают больше всего времени</small></div><div id="prodAnPareto"><div class="prod-an-empty">Загрузка…</div></div></article></section><div class="prod-an-foot">OEE появляется только когда есть все три компонента. Если выпуска/брака или планового времени ещё нет, система показывает «—», а не выдумывает 100%.</div></div>`;document.body.appendChild(d);$('prodAnRefresh').addEventListener('click',load);$('prodAnPeriod').addEventListener('change',load);d.querySelector('[data-prod-an-close]').addEventListener('click',()=>d.close())}
}
function kpi(label,value,sub,cls=''){return`<article class="prod-an-kpi ${cls}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></article>`}
function renderPareto(rows){
  const grouped=new Map();for(const r of rows||[]){const key=r.reason_code||'OTHER',x=grouped.get(key)||{reason:key,minutes:0,events:0};x.minutes+=Number(r.downtime_minutes||0);x.events+=Number(r.pause_events||0);grouped.set(key,x)}
  const data=[...grouped.values()].sort((a,b)=>b.minutes-a.minutes),max=Math.max(1,...data.map(x=>x.minutes));
  $('prodAnPareto').innerHTML=data.length?data.map((x,i)=>`<div class="prod-an-pareto"><div class="prod-an-pareto-head"><b>${i+1}. ${esc(reasonLabels[x.reason]||x.reason)}</b><span>${num(x.minutes,1)} мин · ${x.events} останов.</span></div><div class="prod-an-bar"><i style="width:${Math.min(100,x.minutes/max*100).toFixed(1)}%"></i></div></div>`).join(''):'<div class="prod-an-empty">За период закрытых простоев нет</div>';
}
async function load(){
  if(state.loading)return;state.loading=true;ensureUi();
  try{
    const days=Math.max(1,Number($('prodAnPeriod')?.value||30)),{from,to}=range(days);
    const [oeeR,paretoR,capacityR]=await Promise.all([
      supabase.from('production_oee_daily').select('*').gte('metric_date',from).lte('metric_date',to),
      supabase.from('production_downtime_pareto_daily').select('*').gte('metric_date',from).lte('metric_date',to),
      supabase.rpc('production_capacity_between',{p_from:from,p_to:to})
    ]);
    if(oeeR.error)throw oeeR.error;if(paretoR.error)throw paretoR.error;if(capacityR.error)throw capacityR.error;
    const byEq=aggregate(oeeR.data||[]),cap=aggregateCapacity(capacityR.data||[]);const all={runtime:sum(oeeR.data,'runtime_minutes'),downtime:sum(oeeR.data,'downtime_minutes'),good:sum(oeeR.data,'good_quantity'),scrap:sum(oeeR.data,'scrap_quantity'),rework:sum(oeeR.data,'rework_quantity'),planned:sum(oeeR.data,'planned_machine_minutes'),actual:sum(oeeR.data,'actual_machine_minutes'),revenue:sum(oeeR.data,'operation_revenue'),cost:sum(oeeR.data,'production_cost')};const parts=oeeParts(all),available=sum(capacityR.data,'available_minutes'),util=ratio(all.runtime,available),margin=all.revenue-all.cost;
    $('prodAnKpis').innerHTML=[kpi('OEE',pct(parts.oee),'доступность × производительность × качество',parts.oee!=null&&parts.oee<60?'danger':'ok'),kpi('Доступность',pct(parts.availability),`${num(all.downtime,1)} мин простоя`),kpi('Производительность',pct(parts.performance),`план ${num(all.planned,0)} / факт ${num(all.actual,0)} мин`),kpi('Качество',pct(parts.quality),`годно ${num(all.good,1)} · брак ${num(all.scrap,1)} · переделка ${num(all.rework,1)}`),kpi('Загрузка мощности',pct(util),`${num(all.runtime/60,1)} ч работы из ${num(available/60,1)} ч доступности`),kpi('Маржа производства',money(margin),`выручка ${money(all.revenue)} · себестоимость ${money(all.cost)}`,margin<0?'danger':'')].join('');
    const rows=[...byEq.values()].map(x=>{const p=oeeParts(x),availableEq=Number(cap.get(x.id)||0),utilEq=ratio(x.runtime,availableEq),loss=x.downtime+(x.scrap+x.rework)*10;return{...x,...p,availableEq,utilEq,loss}}).sort((a,b)=>(b.utilEq||0)-(a.utilEq||0)||b.loss-a.loss);
    $('prodAnEquipment').innerHTML=`<table class="prod-an-table"><thead><tr><th>Оборудование</th><th>OEE</th><th>Доступ.</th><th>Произв.</th><th>Качество</th><th>Загрузка</th><th>Простой</th><th>План / факт</th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td><b>${esc(x.inventory_number||'—')} · ${esc(x.equipment_name||'Без названия')}</b><small>${i===0&&x.utilEq!=null&&x.utilEq>=80?'⚠ возможное узкое место по загрузке':''}</small></td><td><strong>${pct(x.oee)}</strong></td><td>${pct(x.availability)}</td><td>${pct(x.performance)}</td><td>${pct(x.quality)}</td><td>${pct(x.utilEq)}<small>${num(x.runtime/60,1)} / ${num(x.availableEq/60,1)} ч</small></td><td>${num(x.downtime,1)} мин<small>${x.pause_events} останов.</small></td><td>${num(x.planned,0)} / ${num(x.actual,0)} мин</td></tr>`).join('')||'<tr><td colspan="8">За период производственных фактов нет</td></tr>'}</tbody></table>`;
    renderPareto(paretoR.data||[]);
  }catch(error){console.warn('Production analytics unavailable',error);$('prodAnKpis').innerHTML=`<div class="prod-an-empty">Не удалось загрузить аналитику: ${esc(error?.message||'ошибка')}</div>`;$('prodAnEquipment').innerHTML='<div class="prod-an-empty">Нет данных</div>';$('prodAnPareto').innerHTML='<div class="prod-an-empty">Нет данных</div>'}finally{state.loading=false}
}
function open(){ensureUi();const d=$('productionAnalyticsDlg');if(!d)return;typeof d.showModal==='function'?d.showModal():d.setAttribute('open','');load()}
function realtime(){if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(state.reloadTimer);state.reloadTimer=setTimeout(()=>{if($('productionAnalyticsDlg')?.open)load()},600)};let ch=supabase.channel('production-analytics-v1');for(const table of ['production_job_runs','production_job_events','production_jobs','equipment_capacity_rules'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);state.channel=ch.subscribe();window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true})}
function boot(){ensureUi();realtime()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
