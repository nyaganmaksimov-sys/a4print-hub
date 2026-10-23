const printerPictures={
 'A4-EQ-00054':'./assets/3d-artprint/kobra-x.png?v=hq20261023',
 'A4-EQ-00055':'./assets/3d-artprint/kobra-2-max.png?v=hq20261023',
 'A4-EQ-00056':'./assets/3d-artprint/ender-v3-se.png?v=hq20261023',
 'A4-EQ-00057':'./assets/3d-artprint/ad5x.png?v=hq20261023'
};
const active=new Set(['NEW','QUEUED','PAUSED','IN_PROGRESS']);
const labels={NEW:'Новый',QUEUED:'Очередь',IN_PROGRESS:'Печать',PAUSED:'Пауза',DONE:'Готово',CANCELLED:'Отменён'};
const link=(href,label)=>{const a=document.createElement('a');a.href=href;a.textContent=label;return a};
export async function renderEquipment({supabase,root,mode='printers'}){
 root.replaceChildren();
 const intro=document.createElement('p');intro.className='studio-equipment-intro';
 intro.textContent='Единый реестр оборудования производства. Принтеры и другие станки выбираются при планировании изготовления заказа. Никаких дублирующих записей.';
 const tools=document.createElement('div');tools.className='studio-equipment-toolbar';
 const query=document.createElement('input');query.type='search';query.placeholder='Поиск по названию, модели или номеру';query.setAttribute('aria-label','Поиск оборудования');
 const filter=document.createElement('select');filter.setAttribute('aria-label','Тип оборудования');
 for(const [value,text] of [['all','Все устройства'],['3d','3D-принтеры'],['other','Другое оборудование']])filter.add(new Option(text,value));
 filter.value=mode==='printers'?'3d':'all';
 tools.append(query,filter,link('./3d-artprint-workspace.html?section=orders&new=1','+ Создать заказ'),link('./3d-artprint-workspace.html?section=production','Производственная очередь'));
 const grid=document.createElement('div');grid.className='studio-equipment-grid';
 const status=document.createElement('p');status.className='studio-equipment-status';status.textContent='Загружаем реестр оборудования…';
 root.append(intro,tools,status,grid);
 let assets=[],jobs=[];
 try{
  const {data:org,error:oe}=await supabase.from('organizations').select('id').eq('code','3DARTPRINT').maybeSingle();
  if(oe||!org?.id)throw oe||Error('Организация 3D-ARTPRINT не найдена или не доступна');
  const [inventory,queue]=await Promise.all([
   supabase.from('equipment_assets').select('id,name,inventory_number,status,category,brand,model,next_service_date').eq('organization_id',org.id).order('name'),
   supabase.rpc('get_production_workspace_jobs',{p_query:'',p_unit:'3D_ARTPRINT',p_assignee:null,p_priority:'',p_done_limit:30,p_cancelled_limit:0})
  ]);
  if(inventory.error)throw inventory.error;
  assets=inventory.data||[];
  if(!queue.error)jobs=(Array.isArray(queue.data)?queue.data:[]).filter(j=>j.order_business_unit==='3D_ARTPRINT');
  else status.textContent='Загрузка производственных заданий недоступна; реестр оборудования открыт.';
 }catch(err){status.textContent='Не удалось открыть оборудование: '+(err?.message||String(err));return}
 const render=()=>{
  const term=query.value.trim().toLocaleLowerCase('ru');
  const visible=assets.filter(a=>{
   const isPrinter=a.category==='3D_PRINTER';
   if(filter.value==='3d'&&!isPrinter||filter.value==='other'&&isPrinter)return false;
   return [a.name,a.inventory_number,a.model,a.brand,a.category].some(v=>String(v||'').toLocaleLowerCase('ru').includes(term));
  });
  grid.replaceChildren();
  status.textContent='Устройств в реестре: '+assets.length+' · показано: '+visible.length+'. Статусы печати — по заданиям, не по телеметрии принтера.';
  if(!visible.length){const p=document.createElement('p');p.textContent=filter.value==='other'?'Другого оборудования в реестре пока нет. Добавление новых станков настроим следующим этапом.':'Устройств по фильтру не найдено.';grid.append(p);return}
  for(const machine of visible){
   const card=document.createElement('article');card.className='studio-machine';
   const art=document.createElement('div');art.className='studio-machine-art';
   if(printerPictures[machine.inventory_number]){const img=document.createElement('img');img.src=printerPictures[machine.inventory_number];img.alt=machine.name;img.loading='lazy';art.append(img)}
   else{const placeholder=document.createElement('div');placeholder.textContent='Оборудование';placeholder.className='studio-machine-placeholder';art.append(placeholder)}
   const h=document.createElement('h3');h.textContent=machine.name||machine.model||'Устройство';
   const info=document.createElement('p');info.textContent=(machine.inventory_number||'Без номера')+' · '+(machine.category==='3D_PRINTER'?'3D-принтер':machine.category||'Оборудование');
   const assigned=jobs.filter(j=>j.equipment_id===machine.id),current=assigned.filter(j=>active.has(j.status));
   const headline=document.createElement('p');headline.className='studio-machine-load';
   headline.textContent=machine.status==='ACTIVE'?'В реестре: активно':'В реестре: '+(machine.status||'неизвестно');
   const queueTitle=document.createElement('strong');queueTitle.textContent='Задания: '+current.length+' активных';
   const taskList=document.createElement('div');taskList.className='studio-machine-jobs';
   if(!current.length){const empty=document.createElement('small');empty.textContent='Нет назначенных активных заданий';taskList.append(empty)}
   for(const j of current.slice(0,4)){const a=link('./3d-artprint-workspace.html?section=production','№'+(j.order_number||'—')+' · '+(labels[j.status]||j.status)+' · '+(j.title||'Задание'));taskList.append(a)}
   const actions=document.createElement('div');actions.className='studio-machine-actions';
   actions.append(link('./3d-artprint-workspace.html?section=production','Назначить в производстве'),link('./3d-artprint-workspace.html?section=orders&new=1','Новый заказ'));
   card.append(art,h,info,headline,queueTitle,taskList,actions);grid.append(card);
  }
 };
 query.addEventListener('input',render);filter.addEventListener('change',render);render();
}