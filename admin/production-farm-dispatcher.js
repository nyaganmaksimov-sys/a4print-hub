import {supabase} from './guard.js?v=20260905-netfix1';

if(!window.__A4_PRODUCTION_DISPATCHER__){
  window.__A4_PRODUCTION_DISPATCHER__=true;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const unavailable=new Set(['MAINTENANCE','REPAIR','FAULT','WAITING_PARTS','OFFLINE','RETIRED']);
  const activeStatuses=new Set(['NEW','QUEUED','IN_PROGRESS','PAUSED']);
  const movableStatuses=new Set(['NEW','QUEUED','PAUSED']);
  const state={
    permissions:[],equipment:[],jobs:[],orders:[],capabilities:[],days:14,channel:null,busy:false,
    settings:{timezone:'Asia/Yekaterinburg',workday_start:'09:00:00',planning_horizon_days:30,setup_gap_minutes:10}
  };
  let reloadTimer=null;
  let draggedJobId='';

  const canManage=()=>state.permissions.includes('production.manage');
  const orderOf=id=>state.orders.find(x=>x.id===id)||null;
  const machineOf=id=>state.equipment.find(x=>x.id===id)||null;
  const deadlineOf=job=>job.deadline_at||orderOf(job.order_id)?.due_at||null;
  const scheduled=job=>Boolean(job.equipment_id&&job.planned_start&&job.planned_end);
  const unscheduledJobs=()=>state.jobs.filter(j=>movableStatuses.has(j.status)&&!scheduled(j));
  const pad=n=>String(n).padStart(2,'0');

  function dateKey(value,tz=state.settings.timezone){
    const d=value instanceof Date?value:new Date(value);
    if(!Number.isFinite(d.getTime()))return'';
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
    const obj=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    return `${obj.year}-${obj.month}-${obj.day}`;
  }
  function todayKey(){return dateKey(new Date())}
  function addDateKey(key,days){const [y,m,d]=key.split('-').map(Number);const x=new Date(Date.UTC(y,m-1,d+days,12));return `${x.getUTCFullYear()}-${pad(x.getUTCMonth()+1)}-${pad(x.getUTCDate())}`}
  function dateLabel(key){const [y,m,d]=key.split('-').map(Number);return new Date(Date.UTC(y,m-1,d,12)).toLocaleDateString('ru-RU',{timeZone:'UTC',day:'2-digit',month:'2-digit',weekday:'short'})}
  function timeLabel(value){if(!value)return'—';const d=new Date(value);if(!Number.isFinite(d.getTime()))return'—';return new Intl.DateTimeFormat('ru-RU',{timeZone:state.settings.timezone,hour:'2-digit',minute:'2-digit'}).format(d)}
  function fullDate(value){if(!value)return'—';const d=new Date(value);if(!Number.isFinite(d.getTime()))return'—';return new Intl.DateTimeFormat('ru-RU',{timeZone:state.settings.timezone,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d)}
  function isLate(job){const deadline=deadlineOf(job);return Boolean(deadline&&job.planned_end&&new Date(job.planned_end)>new Date(deadline))}
  function machineUnavailable(job){const m=machineOf(job.equipment_id);return Boolean(m&&(m.status==='WRITTEN_OFF'||unavailable.has(m.operational_status)))}
  function sourceLabel(v){return {AUTO:'авто',MANUAL:'вручную',FAULT_REPLAN:'после сбоя',LEGACY:'старый план'}[v]||'без метки'}
  function durationLabel(v){const n=Math.max(0,Math.round(Number(v||0)));if(!n)return'60 мин по умолчанию';const h=Math.floor(n/60),m=n%60;return h?`${h} ч${m?` ${m} мин`:''}`:`${m} мин`}

  function installButton(){
    if($('farmDispatcherBtn'))return;
    const actions=document.querySelector('.production-top-actions');if(!actions)return;
    const b=document.createElement('button');b.id='farmDispatcherBtn';b.type='button';b.className='farm-dispatcher-top-btn';b.textContent='🧠 Диспетчер';
    b.addEventListener('click',async()=>{ensureUi();$('farmDispatcherDlg').showModal();await load()});
    actions.insertBefore(b,$('farmCapacityBtn')||$('refresh')||null);
  }

  function ensureUi(){
    if(!$('farmDispatcherDlg')){
      const d=document.createElement('dialog');d.id='farmDispatcherDlg';d.className='farm-dispatcher-dialog';d.innerHTML=`
        <div class="farm-dispatcher-head"><div><h2>🧠 Диспетчер производства</h2><p>Автоматический подбор станка, прогноз срока и ручное перетаскивание заданий по календарю.</p></div><button type="button" data-dispatch-close="farmDispatcherDlg">×</button></div>
        <div class="farm-dispatcher-toolbar">
          <select id="farmDispatcherDays"><option value="7">7 дней</option><option value="14" selected>14 дней</option><option value="30">30 дней</option></select>
          <button id="farmDispatcherRefresh" type="button">↻ Обновить</button>
          <button id="farmDispatcherAuto" class="farm-dispatcher-primary" type="button">⚡ Автоплан очереди</button>
          <button id="farmDispatcherSettings" type="button">⚙ Настройки</button>
        </div>
        <div class="farm-dispatcher-kpis">
          <article><span>Без плана</span><strong id="farmDispatcherUnscheduled">0</strong></article>
          <article class="danger"><span>Прогноз опоздания</span><strong id="farmDispatcherLate">0</strong></article>
          <article class="warn"><span>На недоступном станке</span><strong id="farmDispatcherUnavailable">0</strong></article>
          <article><span>Автопланируемых</span><strong id="farmDispatcherAutoReady">0</strong></article>
        </div>
        <div class="farm-dispatcher-content">
          <section class="farm-dispatcher-section"><div class="farm-dispatcher-section-head"><div><h3>Календарь станков</h3><p>Перетащите задание на нужный станок и день — сервер сам найдёт первое свободное окно внутри мощности этого дня.</p></div></div><div id="farmDispatcherBoard" class="farm-dispatcher-board"><div class="farm-dispatcher-empty">Загрузка…</div></div></section>
          <section class="farm-dispatcher-section"><div class="farm-dispatcher-section-head"><div><h3>Нераспределённая очередь</h3><p>При автопланировании первыми идут ближайшие сроки, затем более высокий приоритет.</p></div></div><div id="farmDispatcherQueue" class="farm-dispatcher-queue"><div class="farm-dispatcher-empty">Загрузка…</div></div></section>
        </div>`;
      document.body.appendChild(d);
      $('farmDispatcherDays').addEventListener('change',()=>{state.days=Number($('farmDispatcherDays').value||14);render()});
      $('farmDispatcherRefresh').addEventListener('click',load);
      $('farmDispatcherAuto').addEventListener('click',autoQueue);
      $('farmDispatcherSettings').addEventListener('click',openSettings);
    }
    if(!$('farmDispatcherSettingsDlg')){
      const d=document.createElement('dialog');d.id='farmDispatcherSettingsDlg';d.className='farm-dispatcher-modal';d.innerHTML=`
        <form id="farmDispatcherSettingsForm">
          <div class="farm-dispatcher-head"><div><h3>Настройки диспетчера</h3><p>Рабочее окно строится от времени начала на длительность, заданную в мощности каждого станка.</p></div><button type="button" data-dispatch-close="farmDispatcherSettingsDlg">×</button></div>
          <div class="farm-dispatcher-form">
            <div class="farm-dispatcher-grid">
              <label><span>Часовой пояс</span><input id="farmDispatcherTimezone" required placeholder="Asia/Yekaterinburg"></label>
              <label><span>Начало рабочего окна</span><input id="farmDispatcherStart" type="time" required></label>
              <label><span>Горизонт автоплана, дней</span><input id="farmDispatcherHorizon" type="number" min="1" max="120" required></label>
              <label><span>Зазор между заданиями, мин</span><input id="farmDispatcherGap" type="number" min="0" max="240" required></label>
            </div>
            <div class="farm-dispatcher-route-title"><b>Маршруты оборудования</b><span>Типы операций через запятую. Пусто = без ограничения, пока для этого типа не настроен явный маршрут.</span></div>
            <div id="farmDispatcherCapabilities" class="farm-dispatcher-capabilities"></div>
            <div id="farmDispatcherSettingsError" class="farm-dispatcher-error"></div>
          </div>
          <div class="farm-dispatcher-foot"><button type="button" data-dispatch-close="farmDispatcherSettingsDlg">Отмена</button><button class="farm-dispatcher-primary" type="submit">Сохранить</button></div>
        </form>`;
      document.body.appendChild(d);$('farmDispatcherSettingsForm').addEventListener('submit',saveSettings);
    }
    document.querySelectorAll('[data-dispatch-close]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',()=>$(b.dataset.dispatchClose)?.close())});
  }

  async function load(){
    if(state.busy)return;state.busy=true;ensureUi();
    const refresh=$('farmDispatcherRefresh');if(refresh)refresh.disabled=true;
    try{
      const permissionPromise=state.permissions.length?Promise.resolve({data:state.permissions,error:null}):supabase.rpc('get_my_permissions');
      const [permissions,settings,equipment,jobs,orders,capabilities]=await Promise.all([
        permissionPromise,
        supabase.from('production_dispatch_settings').select('timezone,workday_start,planning_horizon_days,setup_gap_minutes').eq('id',1).maybeSingle(),
        supabase.from('equipment_assets').select('id,inventory_number,name,status,operational_status,category').neq('status','WRITTEN_OFF').order('inventory_number'),
        supabase.from('production_jobs').select('id,title,status,priority,order_id,equipment_id,planned_start,planned_end,planned_machine_minutes,deadline_at,dispatch_locked,dispatch_source,dispatch_note,operation_type,created_at').in('status',['NEW','QUEUED','IN_PROGRESS','PAUSED']).order('priority',{ascending:false}).order('created_at'),
        supabase.from('orders').select('id,order_number,due_at').limit(1000),
        supabase.from('production_equipment_capabilities').select('equipment_id,operation_type,is_active').eq('is_active',true).order('operation_type')
      ]);
      for(const r of [permissions,settings,equipment,jobs,orders,capabilities])if(r.error)throw r.error;
      state.permissions=Array.isArray(permissions.data)?permissions.data:state.permissions;
      if(settings.data)state.settings={...state.settings,...settings.data};
      state.equipment=equipment.data||[];state.jobs=jobs.data||[];state.orders=orders.data||[];state.capabilities=capabilities.data||[];
      $('farmDispatcherAuto').hidden=!canManage();$('farmDispatcherSettings').hidden=!canManage();
      render();
    }catch(error){console.warn('Production dispatcher unavailable',error);$('farmDispatcherBoard').innerHTML=`<div class="farm-dispatcher-empty danger-text">${esc(humanError(error))}</div>`}
    finally{state.busy=false;if(refresh)refresh.disabled=false}
  }

  function render(){
    if(!$('farmDispatcherDlg'))return;
    const unscheduled=unscheduledJobs();
    $('farmDispatcherUnscheduled').textContent=unscheduled.length;
    $('farmDispatcherLate').textContent=state.jobs.filter(j=>activeStatuses.has(j.status)&&isLate(j)).length;
    $('farmDispatcherUnavailable').textContent=state.jobs.filter(j=>scheduled(j)&&machineUnavailable(j)).length;
    $('farmDispatcherAutoReady').textContent=unscheduled.filter(j=>!j.dispatch_locked).length;
    renderBoard();renderQueue();
  }

  function renderBoard(){
    const start=todayKey();const dates=Array.from({length:state.days},(_,i)=>addDateKey(start,i));
    const jobs=state.jobs.filter(j=>activeStatuses.has(j.status)&&scheduled(j));
    const head=`<div class="farm-dispatcher-gridrow farm-dispatcher-gridhead" style="--days:${dates.length}"><div class="farm-dispatcher-machine-head">Станок</div>${dates.map(d=>`<div class="farm-dispatcher-day-head ${d===start?'today':''}">${esc(dateLabel(d))}</div>`).join('')}</div>`;
    const rows=state.equipment.map(machine=>{
      const isDown=machine.status==='WRITTEN_OFF'||unavailable.has(machine.operational_status);
      const cells=dates.map(date=>{
        const cellJobs=jobs.filter(j=>j.equipment_id===machine.id&&dateKey(j.planned_start)===date).sort((a,b)=>new Date(a.planned_start)-new Date(b.planned_start));
        return `<div class="farm-dispatcher-cell ${isDown?'unavailable':''}" data-dispatch-drop data-equipment="${machine.id}" data-date="${date}">${cellJobs.map(jobCard).join('')}</div>`;
      }).join('');
      return `<div class="farm-dispatcher-gridrow" style="--days:${dates.length}"><div class="farm-dispatcher-machine ${isDown?'unavailable':''}"><b>${esc(machine.inventory_number||'—')}</b><span>${esc(machine.name||'Без названия')}</span><small>${isDown?`Недоступен · ${esc(machine.operational_status||machine.status)}`:esc(machine.category||'оборудование')}</small></div>${cells}</div>`;
    }).join('');
    $('farmDispatcherBoard').innerHTML=`<div class="farm-dispatcher-grid">${head}${rows||'<div class="farm-dispatcher-empty">Нет оборудования.</div>'}</div>`;
    bindDragDrop();
  }

  function jobCard(job){
    const deadline=deadlineOf(job),late=isLate(job),canMove=canManage()&&movableStatuses.has(job.status),down=machineUnavailable(job);
    const lock=job.dispatch_locked?'🔒':'🔓';
    return `<article class="farm-dispatcher-job ${late?'late':''} ${down?'down':''}" draggable="${canMove?'true':'false'}" data-dispatch-job="${job.id}" title="${esc(job.dispatch_note||'')}">
      <div class="farm-dispatcher-job-title"><b>${esc(job.title||'Задание')}</b><span>${esc(lock)}</span></div>
      <small>${esc(timeLabel(job.planned_start))}–${esc(timeLabel(job.planned_end))} · ${esc(durationLabel(job.planned_machine_minutes))}</small>
      <small>${deadline?`срок ${esc(fullDate(deadline))}`:'срок не задан'} · ${esc(sourceLabel(job.dispatch_source))}</small>
      ${job.dispatch_note?`<em>${esc(job.dispatch_note)}</em>`:''}
      ${canManage()&&movableStatuses.has(job.status)?`<div class="farm-dispatcher-job-actions"><button type="button" data-dispatch-lock="${job.id}" data-next="${job.dispatch_locked?'0':'1'}">${job.dispatch_locked?'Разблокировать':'Закрепить'}</button>${!job.dispatch_locked?`<button type="button" data-dispatch-auto="${job.id}" data-force="1">Авто ↻</button>`:''}</div>`:''}
    </article>`;
  }

  function renderQueue(){
    const jobs=unscheduledJobs().sort((a,b)=>{
      const ad=deadlineOf(a),bd=deadlineOf(b);if(ad&&bd&&ad!==bd)return new Date(ad)-new Date(bd);if(ad&&!bd)return-1;if(!ad&&bd)return 1;return Number(b.priority||0)-Number(a.priority||0)||new Date(a.created_at)-new Date(b.created_at)
    });
    $('farmDispatcherQueue').innerHTML=jobs.map(j=>{
      const deadline=deadlineOf(j),locked=j.dispatch_locked;
      return `<article class="farm-dispatcher-queue-job" draggable="${canManage()&&!locked?'true':'false'}" data-dispatch-job="${j.id}"><div><b>${esc(j.title||'Задание')}</b><small>${j.operation_type?`операция: ${esc(j.operation_type)} · `:''}${esc(durationLabel(j.planned_machine_minutes))} · приоритет ${Number(j.priority||0)}</small><small>${deadline?`срок ${esc(fullDate(deadline))}`:'⚠ срок не задан'}${j.dispatch_note?` · ${esc(j.dispatch_note)}`:''}</small></div>${canManage()?`<button class="farm-dispatcher-primary" type="button" data-dispatch-auto="${j.id}" data-force="0" ${locked?'disabled':''}>⚡ Авто</button>`:''}</article>`
    }).join('')||'<div class="farm-dispatcher-empty">Очередь распределена: у всех открытых заданий есть станок и временное окно.</div>';
    bindDragDrop();
  }

  function bindDragDrop(){
    document.querySelectorAll('[data-dispatch-job]').forEach(card=>{
      card.addEventListener('dragstart',e=>{if(card.getAttribute('draggable')!=='true'){e.preventDefault();return}draggedJobId=card.dataset.dispatchJob;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedJobId);card.classList.add('dragging')});
      card.addEventListener('dragend',()=>{draggedJobId='';card.classList.remove('dragging');document.querySelectorAll('[data-dispatch-drop]').forEach(x=>x.classList.remove('dragover'))});
    });
    document.querySelectorAll('[data-dispatch-drop]').forEach(cell=>{
      cell.addEventListener('dragover',e=>{if(!draggedJobId||cell.classList.contains('unavailable'))return;e.preventDefault();e.dataTransfer.dropEffect='move';cell.classList.add('dragover')});
      cell.addEventListener('dragleave',()=>cell.classList.remove('dragover'));
      cell.addEventListener('drop',async e=>{e.preventDefault();cell.classList.remove('dragover');const id=draggedJobId||e.dataTransfer.getData('text/plain');if(!id)return;await scheduleIntoDay(id,cell.dataset.equipment,cell.dataset.date)});
    });
    document.querySelectorAll('[data-dispatch-auto]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',()=>autoJob(b.dataset.dispatchAuto,b.dataset.force==='1'))});
    document.querySelectorAll('[data-dispatch-lock]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',()=>setLock(b.dataset.dispatchLock,b.dataset.next==='1'))});
  }

  async function autoJob(id,force=false){
    if(!canManage())return;
    try{const r=await supabase.rpc('auto_dispatch_production_job',{p_job_id:id,p_force:force});if(r.error)throw r.error;await load()}catch(error){window.alert(humanError(error))}
  }
  async function autoQueue(){
    if(!canManage())return;const b=$('farmDispatcherAuto');b.disabled=true;b.textContent='Планирую…';
    try{const r=await supabase.rpc('auto_dispatch_production_queue',{p_limit:100});if(r.error)throw r.error;const x=Array.isArray(r.data)?r.data[0]:r.data;await load();window.alert(`Автоплан готов. Распределено: ${Number(x?.scheduled_count||0)}, требуют внимания: ${Number(x?.failed_count||0)}.`)}catch(error){window.alert(humanError(error))}finally{b.disabled=false;b.textContent='⚡ Автоплан очереди'}
  }
  async function scheduleIntoDay(id,equipmentId,date){
    if(!canManage())return;
    try{const r=await supabase.rpc('schedule_production_job_into_day',{p_job_id:id,p_equipment_id:equipmentId,p_work_date:date});if(r.error)throw r.error;await load()}catch(error){window.alert(humanError(error))}
  }
  async function setLock(id,locked){
    if(!canManage())return;
    try{const r=await supabase.rpc('set_production_dispatch_lock',{p_job_id:id,p_locked:locked});if(r.error)throw r.error;await load()}catch(error){window.alert(humanError(error))}
  }

  function openSettings(){
    if(!canManage())return;ensureUi();$('farmDispatcherSettingsError').textContent='';
    $('farmDispatcherTimezone').value=state.settings.timezone||'Asia/Yekaterinburg';$('farmDispatcherStart').value=String(state.settings.workday_start||'09:00').slice(0,5);$('farmDispatcherHorizon').value=Number(state.settings.planning_horizon_days||30);$('farmDispatcherGap').value=Number(state.settings.setup_gap_minutes||10);
    $('farmDispatcherCapabilities').innerHTML=state.equipment.map(e=>{const ops=state.capabilities.filter(c=>c.equipment_id===e.id&&c.is_active).map(c=>c.operation_type).join(', ');return `<label class="farm-dispatcher-capability"><span><b>${esc(e.inventory_number||'—')} · ${esc(e.name)}</b><small>${esc(e.category||'')}</small></span><input data-capability-equipment="${e.id}" value="${esc(ops)}" placeholder="например: 3D_PRINT, LASER_CUT"></label>`}).join('')||'<div class="farm-dispatcher-empty">Нет оборудования.</div>';
    $('farmDispatcherSettingsDlg').showModal();
  }
  async function saveSettings(event){
    event.preventDefault();if(!canManage())return;const errorBox=$('farmDispatcherSettingsError');errorBox.textContent='';
    const payload={p_timezone:$('farmDispatcherTimezone').value.trim(),p_workday_start:$('farmDispatcherStart').value,p_planning_horizon_days:Number($('farmDispatcherHorizon').value),p_setup_gap_minutes:Number($('farmDispatcherGap').value)};
    try{
      const settings=await supabase.rpc('save_production_dispatch_settings',payload);if(settings.error)throw settings.error;
      for(const input of $('farmDispatcherCapabilities').querySelectorAll('[data-capability-equipment]')){
        const types=[...new Set(input.value.split(',').map(x=>x.trim()).filter(Boolean))];
        const r=await supabase.rpc('save_production_equipment_capabilities',{p_equipment_id:input.dataset.capabilityEquipment,p_operation_types:types});if(r.error)throw r.error;
      }
      $('farmDispatcherSettingsDlg').close();await load();
    }catch(error){errorBox.textContent=humanError(error)}
  }

  function humanError(error){
    const m=String(error?.message||error||'Ошибка');
    if(m.includes('NO_DISPATCH_SLOT'))return'Свободного окна в заданном горизонте нет. Проверьте длительность задания, мощность станков и маршруты операций.';
    if(m.includes('JOB_DISPATCH_LOCKED'))return'Задание закреплено вручную. Сначала разблокируйте его.';
    if(m.includes('JOB_CANNOT_BE_SCHEDULED'))return'Это задание уже выполняется или закрыто и не может быть перепланировано.';
    if(m.includes('EQUIPMENT_PLAN_OVERLAP'))return'На выбранном станке возникло пересечение. Диспетчер не записал конфликтующий план.';
    if(m.includes('INVALID_TIMEZONE'))return'Неизвестный часовой пояс. Используйте IANA-имя, например Asia/Yekaterinburg.';
    if(m.includes('PERMISSION_DENIED'))return'Недостаточно прав для управления производственным планом.';
    return m;
  }

  function realtime(){
    if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(load,500)};
    state.channel=supabase.channel('production-dispatcher-v1')
      .on('postgres_changes',{event:'*',schema:'public',table:'production_jobs'},reload)
      .on('postgres_changes',{event:'*',schema:'public',table:'equipment_assets'},reload)
      .on('postgres_changes',{event:'*',schema:'public',table:'production_dispatch_settings'},reload)
      .on('postgres_changes',{event:'*',schema:'public',table:'production_equipment_capabilities'},reload)
      .subscribe();
    window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true});
  }

  const boot=async()=>{installButton();ensureUi();await load();realtime()};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
}
