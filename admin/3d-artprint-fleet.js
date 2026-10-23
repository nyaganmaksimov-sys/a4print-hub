// Presentation-only mapping of confirmed physical printers to existing HUB assets.
// No INSERT or UPDATE of equipment_assets. All choices are drawn from RLS-visible assets.
const fleet=[
 {key:'kobra-x',inventory:'A4-EQ-00054',name:'Anycubic Kobra X',image:'./assets/3d-artprint/kobra-x.png?v=hq20261023',profiles:['Anycubic Kobra X · 0,4 мм (профиль из OrcaSlicer)','Anycubic Kobra X']},
 {key:'kobra-2-max',inventory:'A4-EQ-00055',name:'Anycubic Kobra 2 Max',image:'./assets/3d-artprint/kobra-2-max.png?v=hq20261023',profiles:['Anycubic Kobra 2 Max']},
 {key:'ender-v3-se',inventory:'A4-EQ-00056',name:'Creality Ender-3 V3 SE',image:'./assets/3d-artprint/ender-v3-se.png?v=hq20261023',profiles:['Creality Ender-3 V3 SE']},
 {key:'ad5x',inventory:'A4-EQ-00057',name:'Flashforge AD5X',image:'./assets/3d-artprint/ad5x.png?v=hq20261023',profiles:['Flashforge AD5X']}
];
const root=document.getElementById('printerFleet');
let assets=[],orgId='',jobs=[];
const activeStatuses=new Set(['NEW','QUEUED','IN_PROGRESS','PAUSED']);
const stageLabel={NEW:'Новое',QUEUED:'В очереди',IN_PROGRESS:'Печать',PAUSED:'Пауза',DONE:'Готово',CANCELLED:'Отменено'};
function addJobLine(parent,job){
 const link=document.createElement('a');link.className='fleet-job';link.href='./3d-artprint-workspace.html?section=production';
 const title=document.createElement('strong');title.textContent=(job.order_number?'Заказ №'+job.order_number+' · ':'')+(job.title||'Производственное задание');
 const state=document.createElement('span');state.className='fleet-job-state';state.textContent=stageLabel[job.status]||job.status||'—';
 link.append(title,state);
 const parts=[];
 if(job.planned_machine_minutes!=null)parts.push('План '+Number(job.planned_machine_minutes).toLocaleString('ru-RU')+' мин');
 if(job.actual_machine_minutes!=null)parts.push('Факт '+Number(job.actual_machine_minutes).toLocaleString('ru-RU')+' мин');
 if(job.assignee_name)parts.push(job.assignee_name);
 if(parts.length){const sub=document.createElement('small');sub.textContent=parts.join(' · ');link.append(sub)}
 parent.append(link)
}
const storeKey=()=> 'a4:3dartprint:fleet-mapping:v1:'+orgId;
function readMap(){try{const obj=JSON.parse(localStorage.getItem(storeKey())||'{}');return obj&&typeof obj==='object'?obj:{}}catch{return {}}}
function writeMap(value){try{localStorage.setItem(storeKey(),JSON.stringify(value));return true}catch{return false}}
function render(){
 if(!root)return;
 const saved=orgId?readMap():{};
 root.replaceChildren();
 for(const device of fleet){
  const card=document.createElement('article');card.className='fleet-card';
  const art=document.createElement('div');art.className='fleet-art';const img=document.createElement('img');img.src=device.image;img.alt='Иллюстрация принтера '+device.name;img.loading='lazy';img.decoding='async';img.onerror=()=>{img.hidden=true;art.classList.add('missing-art')};art.append(img);card.append(art);
  const title=document.createElement('h3');title.textContent=device.name;card.append(title);
  const note=document.createElement('p');note.textContent=device.profiles.length+' профиль(я) OrcaSlicer · одно физическое устройство';card.append(note);
  const profiles=document.createElement('ul');profiles.className='fleet-profiles';
  for(const profile of device.profiles){const li=document.createElement('li');li.textContent=profile;profiles.append(li)}
  card.append(profiles);
  const label=document.createElement('label');label.textContent='Привязать к оборудованию HUB';
  const select=document.createElement('select');select.setAttribute('aria-label','Оборудование для '+device.name);
  select.add(new Option(orgId?'Не привязано':'Загрузка реестра…',''));
  for(const a of assets)select.add(new Option((a.inventory_number||'Без номера')+' · '+(a.name||a.model||'Станок'),a.id));
  const mapped=assets.find(a=>a.id===saved[device.key]&&a.inventory_number===device.inventory)||assets.find(a=>a.inventory_number===device.inventory&&a.name===device.name);
  if(mapped)select.value=mapped.id;
  else if(saved[device.key]){const warning=document.createElement('small');warning.textContent='Прежняя привязка не найдена или недоступна';card.append(warning)}
  select.disabled=!orgId;
  const status=document.createElement('small');status.className='fleet-status';
  status.textContent=mapped?'Связано с реестром этого кабинета':'Требуется сопоставление';
  select.addEventListener('change',()=>{
    const next=readMap();
    if(select.value&&Object.entries(next).some(([key,val])=>key!==device.key&&val===select.value)){
      status.textContent='Этот станок уже назначен другому устройству. Выберите другой.';select.value=next[device.key]||'';return;
    }
    if(select.value)next[device.key]=select.value;else delete next[device.key];
    if(!writeMap(next)){status.textContent='Не удалось сохранить привязку в браузере';return;}
    status.textContent=select.value?'Привязка сохранена в этом браузере':'Привязка очищена';
  });
  label.append(select);card.append(label,status);
  const jobsBox=document.createElement('section');jobsBox.className='fleet-work';
  const assigned=mapped?jobs.filter(j=>j.equipment_id===mapped.id):[];
  const active=assigned.filter(j=>activeStatuses.has(j.status));
  const running=active.filter(j=>j.status==='IN_PROGRESS');
  const paused=active.filter(j=>j.status==='PAUSED');
  const queue=active.filter(j=>j.status==='QUEUED'||j.status==='NEW');
  const head=document.createElement('div');head.className='fleet-work-head';
  const labelJobs=document.createElement('strong');labelJobs.textContent='Работа и заказы';
  const count=document.createElement('span');count.textContent=active.length+' активных · '+queue.length+' в очереди';
  head.append(labelJobs,count);jobsBox.append(head);
  if(!mapped){const empty=document.createElement('p');empty.textContent='Принтер не привязан к доступной инвентарной записи';jobsBox.append(empty)}
  else if(!active.length){const empty=document.createElement('p');empty.textContent='Нет текущих заданий. Данные о работе появятся после назначения заказа на принтер.';jobsBox.append(empty)}
  else {
   const ordered=[...running,...paused,...queue];
   for(const job of ordered.slice(0,4))addJobLine(jobsBox,job);
   if(ordered.length>4){const more=document.createElement('a');more.href='./3d-artprint-workspace.html?section=production';more.textContent='Все задания ('+ordered.length+')';jobsBox.append(more)}
  }
  const history=assigned.filter(j=>j.status==='DONE').sort((a,b)=>new Date(b.completed_at||b.updated_at||0)-new Date(a.completed_at||a.updated_at||0)).slice(0,3);
  if(history.length){const historyHead=document.createElement('strong');historyHead.className='fleet-history-head';historyHead.textContent='Завершённые заказы';jobsBox.append(historyHead);for(const finished of history)addJobLine(jobsBox,finished)}
  card.append(jobsBox);root.append(card);
 }
}
document.addEventListener('a4:3d-equipment-loaded',event=>{
 const detail=event.detail||{};
 if(typeof detail.orgId!=='string'||!Array.isArray(detail.assets))return;
 orgId=detail.orgId;
 assets=detail.assets.filter(a=>a&&typeof a.id==='string');
 render();
});
document.addEventListener('a4:3d-production-jobs-loaded',event=>{
 const incoming=event.detail?.jobs;
 if(!Array.isArray(incoming))return;
 jobs=incoming.filter(j=>j&&typeof j.equipment_id==='string'&&j.order_business_unit==='3D_ARTPRINT');
 render();
});
render();
