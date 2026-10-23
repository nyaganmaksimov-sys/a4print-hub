// Production cards use the existing tenant-scoped production RPC.
const actions={NEW:[['Начать','START']],QUEUED:[['Начать','START']],IN_PROGRESS:[['Приостановить','PAUSE'],['Завершить','COMPLETE']],PAUSED:[['Продолжить','RESUME']]};
const names={NEW:'Новое',QUEUED:'В очереди',IN_PROGRESS:'Печать',PAUSED:'Приостановлено',DONE:'Готово',CANCELLED:'Отменено'};
const rub=value=>Number(value||0).toLocaleString('ru-RU',{style:'currency',currency:'RUB'});
export async function renderProduction({supabase,root,notify}){
 root.replaceChildren();
 const top=document.createElement('div');top.className='production-toolbar';
 const heading=document.createElement('h2');heading.textContent='Производственная очередь';
 const reload=document.createElement('button');reload.type='button';reload.textContent='↻ Обновить';
 top.append(heading,reload);root.append(top);
 const list=document.createElement('div');root.append(list);
 let printers=[];
 try{
  const {data:org,error:oe}=await supabase.from('organizations').select('id').eq('code','3DARTPRINT').maybeSingle();
  if(oe)throw oe;
  if(org?.id){
   const {data,error}=await supabase.from('equipment_assets').select('id,name,inventory_number,status').eq('organization_id',org.id).in('inventory_number',['A4-EQ-00054','A4-EQ-00055','A4-EQ-00056','A4-EQ-00057']);
   if(error)throw error;
   printers=(data||[]).filter(a=>a.status==='ACTIVE');
  }
 }catch(error){notify('Принтеры не загружены: '+(error?.message||String(error)))}
 const load=async()=>{
  reload.disabled=true;list.textContent='Загружаем задания…';
  try{
   const {data,error}=await supabase.rpc('get_production_workspace_jobs',{p_query:'',p_unit:'3D_ARTPRINT',p_assignee:null,p_priority:'',p_done_limit:50,p_cancelled_limit:10});
   if(error)throw error;
   const jobs=(Array.isArray(data)?data:[]).filter(j=>j.order_business_unit==='3D_ARTPRINT');
   list.replaceChildren();
   if(!jobs.length){list.textContent='Производственных заданий пока нет. Они появляются после создания и назначения работ по заказу.';return}
   for(const job of jobs){
    const card=document.createElement('article');card.className='production-job-card';
    const h=document.createElement('h3');h.textContent=(job.title||'Производственное задание')+' · заказ №'+(job.order_number||'—');
    const status=document.createElement('p');status.textContent='Этап: '+(names[job.status]||job.status||'—');
    const detail=document.createElement('p');detail.textContent='Оборудование: '+(job.equipment_name||job.equipment_inventory_number||'не назначено')+' · Исполнитель: '+(job.assignee_name||'не назначен');
    const numeric=document.createElement('p');numeric.textContent='План: '+(job.planned_machine_minutes??'—')+' мин · Факт: '+(job.actual_machine_minutes??'—')+' мин · Годных: '+(job.good_quantity??'—')+' · Брак: '+(job.scrap_quantity??'—')+' · Себестоимость: '+(job.production_cost==null?'—':rub(job.production_cost));
    card.append(h,status,detail,numeric);
    if(printers.length&&['NEW','QUEUED','PAUSED'].includes(job.status)){
     const assign=document.createElement('div');assign.className='row-controls';
     const choice=document.createElement('select');choice.setAttribute('aria-label','Принтер для задания '+(job.title||''));
     choice.add(new Option('Выберите принтер',''));
     for(const machine of printers)choice.add(new Option((machine.inventory_number||'')+' · '+machine.name,machine.id));
     if(printers.some(a=>a.id===job.equipment_id))choice.value=job.equipment_id;
     const save=document.createElement('button');save.type='button';save.textContent='Назначить принтер';
     save.disabled=!choice.value||choice.value===job.equipment_id;
     choice.addEventListener('change',()=>{save.disabled=!choice.value||choice.value===job.equipment_id});
     save.addEventListener('click',async()=>{
      if(!choice.value||!printers.some(a=>a.id===choice.value))return;
      if(!confirm('Назначить выбранный принтер этому заданию?'))return;
      save.disabled=true;
      try{
       const {data:current,error:readError}=await supabase.from('production_jobs')
        .select('id,order_item_id,operation_type,quantity,planned_machine_minutes,operation_amount,primary_material_id,production_cost')
        .eq('id',job.id).single();
       if(readError||!current)throw readError||Error('Карточка задания недоступна');
       const {error}=await supabase.rpc('configure_production_job',{
        p_job_id:job.id,p_equipment_id:choice.value,p_order_item_id:current.order_item_id,
        p_operation_type:current.operation_type,p_quantity:current.quantity,
        p_planned_machine_minutes:current.planned_machine_minutes,p_operation_amount:current.operation_amount,
        p_primary_material_id:current.primary_material_id,p_production_cost:current.production_cost
       });
       if(error)throw error;
       notify('Принтер назначен');await load();
      }catch(error){notify('Не удалось назначить принтер: '+(error?.message||String(error)));save.disabled=false}
     });
     assign.append(choice,save);card.append(assign);
    }
    const controls=document.createElement('div');controls.className='row-controls';
    for(const [label,action] of actions[job.status]||[]){
     const btn=document.createElement('button');btn.type='button';btn.textContent=label;
     btn.addEventListener('click',async()=>{
      if(!confirm('Подтвердить действие «'+label+'» для '+(job.title||'задания')+'?'))return;
      btn.disabled=true;
      try{
       const {error}=await supabase.rpc('transition_production_job',{p_job_id:job.id,p_action:action});
       if(error)throw error;
       notify('Статус задания обновлён');await load();
      }catch(err){notify('Ошибка изменения статуса: '+(err?.message||String(err)));btn.disabled=false}
     });controls.append(btn);
    }
    card.append(controls);list.append(card);
   }
  }catch(err){list.textContent='Не удалось загрузить производственные задания: '+(err?.message||String(err))}
  finally{reload.disabled=false}
 };
 reload.addEventListener('click',load);await load();
}
