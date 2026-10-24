// Production cards use the existing tenant-scoped production RPC.
const actions={NEW:[['Начать','START'],['Отменить','CANCEL']],QUEUED:[['Начать','START'],['Отменить','CANCEL']],IN_PROGRESS:[['Приостановить','PAUSE'],['Завершить','COMPLETE'],['Отменить','CANCEL']],PAUSED:[['Продолжить','RESUME'],['Отменить','CANCEL']]};
const names={NEW:'Новое',QUEUED:'В очереди',IN_PROGRESS:'Печать',PAUSED:'Приостановлено',DONE:'Готово',CANCELLED:'Отменено'};
const rub=value=>Number(value||0).toLocaleString('ru-RU',{style:'currency',currency:'RUB'});
export async function renderProduction({supabase,root,notify}){
 root.replaceChildren();
 const top=document.createElement('div');top.className='production-toolbar';
 const heading=document.createElement('h2');heading.textContent='Производственная очередь';
 const reload=document.createElement('button');reload.type='button';reload.textContent='↻ Обновить';
 const newOrder=document.createElement('a');newOrder.href='./3d-artprint-workspace.html?section=orders&new=1';newOrder.textContent='+ Новый заказ';top.append(heading,newOrder,reload);root.append(top);
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
   const ids=jobs.map(j=>j.id).filter(Boolean);
   let runs=[];
   if(ids.length){const rr=await supabase.from('production_job_runs').select('production_job_id,operator_user_id,started_at,ended_at,elapsed_seconds').in('production_job_id',ids);if(!rr.error)runs=rr.data||[]}
   const operatorIds=[...new Set(runs.map(r=>r.operator_user_id).filter(Boolean))];
   let operators=new Map();
   if(operatorIds.length){const ur=await supabase.from('users').select('id,full_name').in('id',operatorIds);if(!ur.error)operators=new Map((ur.data||[]).map(u=>[u.id,u.full_name||'Сотрудник']))}
   const totalSeconds=jobId=>runs.filter(r=>r.production_job_id===jobId).reduce((acc,r)=>{
     const start=Date.parse(r.started_at),end=r.ended_at?Date.parse(r.ended_at):Date.now();
     if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return acc;
     return acc+(r.ended_at&&r.elapsed_seconds!=null?Number(r.elapsed_seconds):(end-start)/1000)
   },0);
   list.replaceChildren();
   if(!jobs.length){list.textContent='Производственных заданий пока нет. Они появляются после создания и назначения работ по заказу.';return}
   for(const job of jobs){
    const card=document.createElement('article');card.className='production-job-card';
    const h=document.createElement('h3');h.textContent=(job.title||'Производственное задание')+' · заказ №'+(job.order_number||'—');
    const status=document.createElement('p');status.textContent='Этап: '+(names[job.status]||job.status||'—');
    const detail=document.createElement('p');detail.textContent='Оборудование: '+(job.equipment_name||job.equipment_inventory_number||'не назначено')+' · Исполнитель: '+(job.assignee_name||'не назначен');
    const numeric=document.createElement('p');numeric.textContent='План: '+(job.planned_machine_minutes??'—')+' мин · Факт: '+(job.actual_machine_minutes??'—')+' мин · Годных: '+(job.good_quantity??'—')+' · Брак: '+(job.scrap_quantity??'—')+' · Себестоимость: '+(job.production_cost==null?'—':rub(job.production_cost));
    card.append(h,status,detail,numeric);
    const firstRun=runs.filter(r=>r.production_job_id===job.id).sort((a,b)=>Date.parse(a.started_at)-Date.parse(b.started_at))[0];
    const operator=document.createElement('p');operator.className='production-operator';
    operator.textContent=firstRun?.operator_user_id?'Запустил печать: '+(operators.get(firstRun.operator_user_id)||'Сотрудник · '+firstRun.operator_user_id.slice(0,8)):'Оператор запуска ещё не зафиксирован';
    card.append(operator);
    const planned=Number(job.planned_machine_minutes);
    const overrun=Number.isFinite(planned)&&planned>0?totalSeconds(job.id)-planned*60:0;
    if(job.status==='IN_PROGRESS'&&overrun>0){const alert=document.createElement('p');alert.className='production-overdue';alert.textContent='Плановое время превышено на '+Math.ceil(overrun/60)+' мин. Для завершения или отмены обязательно опишите задержку.';card.append(alert)}
    if(job.notes){const note=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Комментарии и причины остановок';const content=document.createElement('p');content.className='production-note-history';content.textContent=job.notes;note.append(summary,content);card.append(note)}
    if(['DONE','CANCELLED'].includes(job.status)){
     const explanation=document.createElement('p');explanation.className='production-job-note';
     explanation.textContent=job.status==='DONE'?'Задание завершено. Назначение принтера и управление печатью недоступны для закрытого задания.':'Задание отменено. Для запуска работы оформите новое задание.';
     card.append(explanation);
    }
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
    if(['NEW','QUEUED','PAUSED','IN_PROGRESS'].includes(job.status)){
     const timeRow=document.createElement('div');timeRow.className='production-gcode-time';
     const fileLabel=document.createElement('label');fileLabel.textContent='Время по G-code';
     const file=document.createElement('input');file.type='file';file.accept='.gcode,.gco,.gc,.3mf';
     fileLabel.append(file);
     const minutes=document.createElement('input');minutes.type='number';minutes.min='0.01';minutes.step='0.01';minutes.placeholder='Минуты из G-code';minutes.setAttribute('aria-label','Плановое время печати, мин');
     if(job.planned_machine_minutes!=null)minutes.value=String(job.planned_machine_minutes);
     const save=document.createElement('button');save.type='button';save.textContent='Сохранить время';save.disabled=true;
     const hint=document.createElement('small');hint.textContent='Загрузите нарезанный G-code или укажите время вручную. Файл не отправляется на сервер.';
     file.addEventListener('change',async()=>{
      const selected=file.files?.[0];if(!selected)return;
      if(selected.size>50*1024*1024){hint.textContent='Файл больше 50 МБ';return}
      try{
       const {parseGcodeMetadata}=await import('./3d-artprint-gcode-estimator.js?v=1');
       const source=/\.gcode\.3mf$/i.test(selected.name)?await (await import('./3d-artprint-3mf-reader.js?v=1')).unpackGcode3mf(selected):await selected.text();
       const meta=parseGcodeMetadata(source);
       if(!Number.isFinite(meta.hours)||meta.hours<=0)throw Error('В файле нет времени печати. Укажите минуты вручную.');
       minutes.value=(meta.hours*60).toFixed(3);save.disabled=false;
       hint.textContent='OrcaSlicer: '+(meta.hours*60).toFixed(2)+' мин. Проверьте и сохраните.';
      }catch(err){hint.textContent='Не удалось определить время: '+(err?.message||String(err))}
     });
     minutes.addEventListener('input',()=>{save.disabled=!(Number(minutes.value)>0)});
     save.addEventListener('click',async()=>{
      const planned=Number(minutes.value);
      if(!Number.isFinite(planned)||planned<=0||planned>100000){hint.textContent='Укажите корректное время в минутах';return}
      save.disabled=true;
      try{
       const {data:current,error:readError}=await supabase.from('production_jobs').select('id,equipment_id,order_item_id,operation_type,quantity,operation_amount,primary_material_id,production_cost').eq('id',job.id).single();
       if(readError||!current)throw readError||Error('Задание недоступно');
       const {error}=await supabase.rpc('configure_production_job',{p_job_id:job.id,p_equipment_id:current.equipment_id,p_order_item_id:current.order_item_id,p_operation_type:current.operation_type,p_quantity:current.quantity,p_planned_machine_minutes:planned,p_operation_amount:current.operation_amount,p_primary_material_id:current.primary_material_id,p_production_cost:current.production_cost});
       if(error)throw error;
       notify('Время печати сохранено: '+planned.toFixed(2)+' мин');await load();
      }catch(err){hint.textContent='Ошибка сохранения: '+(err?.message||String(err));save.disabled=false}
     });
     timeRow.append(fileLabel,minutes,save,hint);card.append(timeRow);
    }
    const controls=document.createElement('div');controls.className='row-controls';
    for(const [label,action] of actions[job.status]||[]){
     const btn=document.createElement('button');btn.type='button';btn.textContent=label;
     btn.addEventListener('click',async()=>{
      if(action==='START'){
       // Re-read immediately before start: dropdown selection alone does not save an assignment.
       const {data:assigned,error:assignmentError}=await supabase.from('production_jobs')
        .select('equipment_id,status').eq('id',job.id).single();
       if(assignmentError||!assigned){notify('Не удалось проверить назначение принтера');return}
       if(!['NEW','QUEUED'].includes(assigned.status)){notify('Статус задания изменился. Обновите производство.');await load();return}
       const machine=printers.find(p=>p.id===assigned.equipment_id);
       if(!machine){notify('Перед запуском назначьте принтер и сохраните выбор кнопкой «Назначить принтер».');return}
       if(!confirm('Запустить печать задания «'+(job.title||'Без названия')+'» именно на '+machine.name+' ('+machine.inventory_number+')?\\nЕсли выбрали другой принтер, сначала сохраните назначение.'))return;
      }
      const currentlyOverdue=Number.isFinite(Number(job.planned_machine_minutes))&&Number(job.planned_machine_minutes)>0&&totalSeconds(job.id)>Number(job.planned_machine_minutes)*60;
      const requiresNote=action==='PAUSE'||action==='CANCEL'||(action==='COMPLETE'&&currentlyOverdue);
      let reason='',comment='';
      if(requiresNote){
       const input=prompt(action==='PAUSE'?'Причина паузы (например, замена материала):':action==='CANCEL'?'Причина отмены задания:':'Плановое время превышено. Обязательно опишите причину задержки:');
       if(input===null)return;
       reason=input.trim();
       if(!reason){notify('Укажите причину остановки');return}
       const extra=prompt('Комментарий оператора (необязательно):','');
       if(extra===null)return;
       comment=extra.trim();
      }else if(!confirm('Подтвердить действие «'+label+'» для '+(job.title||'задания')+'?'))return;
      btn.disabled=true;
      try{
       if(requiresNote){
        // Persist explanation before transition; never silently change status if the note fails to save.
        const stamp=new Date().toLocaleString('ru-RU');
        const entry='['+stamp+'] '+(action==='PAUSE'?'Пауза':action==='CANCEL'?'Отмена':'Превышение срока перед завершением')+': '+reason+(comment?' — '+comment:'');
        const original=String(job.notes||'');
        const next=(original?original+'\n':'')+entry;
        const {data:updated,error:noteError}=await supabase.from('production_jobs')
         .update({notes:next}).eq('id',job.id).eq('status',job.status).select('id');
        if(noteError)throw noteError;
        if(!updated?.length)throw Error('Причина не сохранена: недостаточно прав или статус изменился');
       }
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
