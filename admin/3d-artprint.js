import {supabase} from './guard.js?v=20260905-netfix1';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={NEW:'Новый',CONFIRMED:'Подтверждён',IN_PROGRESS:'В работе',READY:'Готов',COMPLETED:'Завершён',ON_HOLD:'Приостановлен',CANCELLED:'Отменён',QUEUED:'Очередь',PAUSED:'Пауза',DONE:'Готово'};
let busy=false;
const errorText=e=>e?.message||String(e);
function line(href,title,subtitle,badge){const a=document.createElement('a');a.className='line';a.href=href;a.innerHTML='<span><b>'+esc(title)+'</b><small>'+esc(subtitle)+'</small></span><span class="pill">'+esc(badge)+'</span>';return a}
function draw(id,rows,fn){const root=$(id);root.replaceChildren();if(!rows.length){const el=document.createElement('div');el.className='empty';el.textContent='Записей пока нет';root.append(el);return}rows.forEach(r=>root.append(fn(r)))}
const orderArgs=(status='',pageSize=1)=>({p_query:'',p_status:status,p_unit:'3D_ARTPRINT',p_attention:'',p_page:1,p_page_size:pageSize});
async function orderPage(status='',pageSize=1){
 const {data,error}=await supabase.rpc('get_orders_workspace_page',orderArgs(status,pageSize));
 if(error)throw error;
 const rows=Array.isArray(data)?data:[];
 return {rows:rows.filter(o=>o.business_unit==='3D_ARTPRINT'),total:rows.length?Number(rows[0].total_count||0):0};
}
async function orders(){
 const [recent,newCount,workCount,readyCount]=await Promise.all([
   orderPage('',8),orderPage('NEW'),orderPage('WORK'),orderPage('READY')
 ]);
 $('newOrders').textContent=newCount.total;
 $('activeOrders').textContent=workCount.total;
 $('readyOrders').textContent=readyCount.total;
 draw('orderList',recent.rows,o=>line('./order.html?id='+encodeURIComponent(o.id),'№'+(o.order_number||String(o.id).slice(0,8))+' · '+(o.item_name||o.model_name||'Заказ'),o.customer_full_name||o.customer_company_name||'Клиент не указан',labels[o.status]||o.status||'—'));
 ['newOrders','activeOrders','readyOrders'].forEach(id=>$(id).title='Количество по всем доступным заказам 3D-ARTPRINT, рассчитанное на сервере');
}
async function jobs(){
  const {data,error}=await supabase.rpc('get_production_workspace_jobs',{p_query:'',p_unit:'3D_ARTPRINT',p_assignee:null,p_priority:'',p_done_limit:20,p_cancelled_limit:0});
  if(error)throw error;
  const rows=(Array.isArray(data)?data:[]).filter(j=>j.order_business_unit==='3D_ARTPRINT');
  $('queuedJobs').textContent=rows.filter(j=>['NEW','QUEUED'].includes(j.status)).length;
  await machines(rows);
  draw('jobList',rows.filter(j=>!['DONE','CANCELLED'].includes(j.status)).slice(0,8),j=>line('./production.html?unit=3D_ARTPRINT',j.title||'Производственное задание','Заказ '+(j.order_number||'—')+' · '+(j.assignee_name||'Исполнитель не назначен'),labels[j.status]||j.status||'—'));
  $('queuedJobs').title='Счётчик по возвращённым производственным заданиям';
}
async function machines(jobs){
 const root=$('machineList');
 const {data:org,error:orgError}=await supabase.from('organizations').select('id').eq('code','3DARTPRINT').maybeSingle();
 if(orgError||!org?.id){root.textContent='Организация 3D-ARTPRINT недоступна для вашей учётной записи.';refreshCalcEquipment([]);return;}
 const assetsResult=await supabase.from('equipment_assets').select('id,name,inventory_number,status,category,brand,model,next_service_date,purchase_price').eq('organization_id',org.id).order('name');
 if(assetsResult.error){root.textContent='Не удалось загрузить станки: '+errorText(assetsResult.error);return;}
 const assets=assetsResult.data||[];
 const ids=assets.map(a=>a.id);
 const economicsResult=ids.length?await supabase.from('equipment_economics_daily').select('equipment_id,metric_date,machine_minutes,operation_revenue,production_cost,service_cost,net_margin_after_service').in('equipment_id',ids).gte('metric_date',new Date(Date.now()-30*86400000).toISOString().slice(0,10)):{data:[],error:null};
 refreshCalcEquipment(assets);
 document.dispatchEvent(new CustomEvent("a4:3d-equipment-loaded",{detail:{orgId:org.id,assets}}));
 const status={ACTIVE:'В эксплуатации',REPAIR:'В ремонте',RESERVE:'Резерв',STORAGE:'На хранении',WRITTEN_OFF:'Списано'};
 const counts=new Map();jobs.forEach(j=>{if(j.equipment_id&&['NEW','QUEUED','IN_PROGRESS','PAUSED'].includes(j.status))counts.set(j.equipment_id,(counts.get(j.equipment_id)||0)+1)});
 const rub=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:0})+' ₽';
 const metrics=new Map();
 if(!economicsResult.error){
  for(const item of economicsResult.data||[]){
   const m=metrics.get(item.equipment_id)||{minutes:0,revenue:0,cost:0,service:0,margin:0};
   m.minutes+=Number(item.machine_minutes||0);m.revenue+=Number(item.operation_revenue||0);
   m.cost+=Number(item.production_cost||0);m.service+=Number(item.service_cost||0);
   m.margin+=Number(item.net_margin_after_service||0);metrics.set(item.equipment_id,m);
  }
 }
 root.replaceChildren();
 if(!assets.length){root.textContent='В реестре организации 3D-ARTPRINT пока нет оборудования.';return;}
 for(const a of assets){
  const m=metrics.get(a.id),link=line('./equipment.html?equipment='+encodeURIComponent(a.id),'№'+(a.inventory_number||'—')+' · '+(a.name||a.model||'Оборудование'),[a.brand,a.model].filter(Boolean).join(' ')+' · '+(status[a.status]||a.status||'—'),'Активных: '+(counts.get(a.id)||0));
  root.append(link);
  const meta=document.createElement('div');meta.className='machine-economics';
  const purchase=a.purchase_price==null?'не указана':rub(a.purchase_price);
  const serviceDate=a.next_service_date?new Date(a.next_service_date+'T00:00:00'):null;
  const today=new Date();today.setHours(0,0,0,0);
  const daysToService=serviceDate&&Number.isFinite(serviceDate.getTime())?Math.ceil((serviceDate.getTime()-today.getTime())/86400000):null;
  const serviceLabel=daysToService===null?'ТО не запланировано':daysToService<0?'ТО просрочено на '+Math.abs(daysToService)+' дн.':daysToService===0?'ТО сегодня':'До ТО '+daysToService+' дн.';
  const base='Закупочная цена: '+purchase+' · '+serviceLabel;
  if(economicsResult.error)meta.textContent=base+' · Экономика за 30 дней недоступна';
  else meta.textContent=base+' · Машинные часы (30 дней): '+((m?.minutes||0)/60).toFixed(1)+' · Выручка операций: '+rub(m?.revenue)+' · Затраты с сервисом: '+rub((m?.cost||0)+(m?.service||0))+' · Маржа после сервиса: '+rub(m?.margin);
  root.append(meta);
 }
}
async function load(){
 if(busy)return;busy=true;$('reload').disabled=true;$('notice').hidden=true;$('syncLabel').textContent='Проверка доступа…';
 try {
   const {data:{session},error:authError}=await supabase.auth.getSession();
   if(authError||!session){location.replace('./login.html');return}
   const {data:profile,error:profileError}=await supabase.rpc('get_my_staff_profile');
   if(profileError||profile?.status!=='ACTIVE')throw new Error('Нет подтверждённого доступа сотрудника к HUB');
 } catch(error){
   $('notice').hidden=false;$('notice').textContent='Доступ не подтверждён: '+errorText(error);
   $('syncLabel').textContent='Нет доступа';$('reload').disabled=false;busy=false;return;
 }
 $('syncLabel').textContent='Обновление…';
 const results=await Promise.allSettled([orders(),jobs()]);
 const errors=results.filter(r=>r.status==='rejected').map(r=>errorText(r.reason));
 $('notice').hidden=!errors.length;
 if(errors.length)$('notice').textContent='Не все данные загрузились: '+errors.join('; ')+'. Повторите обновление.';
 $('syncLabel').textContent=errors.length?'Есть ошибки':'Данные HUB · '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
 $('reload').disabled=false;busy=false;
}
$('reload').addEventListener('click',load);
load();
const calcIds=['calcGrams','calcKg','calcHours','calcPurchase','calcLife','calcRunning','calcLabor','calcOther','calcMarkup'];
function refreshCalcEquipment(assets){
 const select=$('calcEquipment'),current=select.value;
 select.replaceChildren(new Option('Ручной расчёт',''));
 for(const a of assets)select.add(new Option((a.inventory_number||'—')+' · '+(a.name||a.model||'Станок'),a.id));
 if(assets.some(a=>a.id===current))select.value=current;
 const map=new Map(assets.map(a=>[a.id,a]));
 if(select.value)loadMachinePreset();
 select.onchange=()=>{
  const item=map.get(select.value);
  if(item&&item.purchase_price!=null)$('calcPurchase').value=String(Math.max(0,Number(item.purchase_price)||0));
  loadMachinePreset();
  calculate();
 };
}

const calcRub=n=>n.toLocaleString('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2});
function calculate(){
 const read=id=>{const value=$(id).value.trim();const n=value===''?0:Number(value);return Number.isFinite(n)?Math.max(0,n):0};
 const grams=read('calcGrams'),kg=read('calcKg'),hours=read('calcHours'),machine=read('calcMachine'),labor=read('calcLabor'),other=read('calcOther'),markup=read('calcMarkup');
 const hourly=(read('calcLife')>0?read('calcPurchase')/read('calcLife'):0)+read('calcRunning');
 $('calcMachine').value=hourly.toFixed(2);
 const cost=grams*kg/1000+hours*hourly+labor+other;
 const price=cost*(1+markup/100);
 $('calcCost').textContent=calcRub(cost);
 $('calcPrice').textContent=calcRub(price);
 $('calcProfit').textContent=calcRub(price-cost);
}
calcIds.forEach(id=>$(id).addEventListener('input',calculate));
calculate();

const presetKey=id=>'a4print:3d-artprint:machine-cost:v1:'+id;
function readPreset(id){
 try{const value=JSON.parse(localStorage.getItem(presetKey(id))||'null');return value&&typeof value==='object'?value:null;}catch{return null}
}
function loadMachinePreset(){
 const id=$('calcEquipment').value,info=$('calcPresetStatus');
 info.textContent='';
 if(!id){info.textContent='Для сохранения выберите станок';return;}
 const preset=readPreset(id);
 if(!preset){$('calcLife').value='5000';$('calcRunning').value='30';info.textContent='Для станка нет сохранённого профиля';return;}
 for(const key of ['calcLife','calcRunning']){
  const n=Number(preset[key]);if(Number.isFinite(n)&&n>=0)$(key).value=String(n);
 }
 info.textContent='Параметры загружены из этого браузера';
}
$('calcSavePreset').addEventListener('click',()=>{
 const id=$('calcEquipment').value,info=$('calcPresetStatus');
 if(!id){info.textContent='Выберите станок для сохранения';return;}
 const life=Number($('calcLife').value),running=Number($('calcRunning').value);
 if(!Number.isFinite(life)||life<=0||!Number.isFinite(running)||running<0){info.textContent='Проверьте ресурс и расходы';return;}
 try{localStorage.setItem(presetKey(id),JSON.stringify({calcLife:life,calcRunning:running}));info.textContent='Сохранено только в этом браузере';}
 catch{info.textContent='Не удалось сохранить параметры браузера';}
});
$('calcClearPreset').addEventListener('click',()=>{
 const id=$('calcEquipment').value,info=$('calcPresetStatus');
 if(!id){info.textContent='Выберите станок';return;}
 try{localStorage.removeItem(presetKey(id));info.textContent='Локальный профиль сброшен';}
 catch{info.textContent='Не удалось сбросить профиль';}
});
