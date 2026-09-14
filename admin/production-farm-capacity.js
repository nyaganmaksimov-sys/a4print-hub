import {supabase} from './guard.js?v=20260905-netfix1';

if(!window.__A4_PRODUCTION_CAPACITY__){
  window.__A4_PRODUCTION_CAPACITY__=true;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const unavailable=new Set(['MAINTENANCE','REPAIR','FAULT','WAITING_PARTS','OFFLINE','RETIRED']);
  const state={permissions:[],equipment:[],jobs:[],rules:[],capacity:[],days:14,channel:null,busy:false};
  let reloadTimer=null;

  const canManage=()=>state.permissions.includes('production.manage');
  const pad=n=>String(n).padStart(2,'0');
  const isoDate=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const addDays=(date,days)=>{const d=new Date(date);d.setDate(d.getDate()+days);return d};
  const fmtDate=v=>{if(!v)return'—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',weekday:'short'}):'—'};
  const fmtMinutes=v=>{const n=Math.max(0,Math.round(Number(v||0)));const h=Math.floor(n/60),m=n%60;return h?`${h} ч${m?` ${m} мин`:''}`:`${m} мин`};
  const inputDate=v=>{if(!v)return'';const d=new Date(v);if(!Number.isFinite(d.getTime()))return'';const off=d.getTimezoneOffset();return new Date(d.getTime()-off*60000).toISOString().slice(0,16)};
  const machine=id=>state.equipment.find(x=>x.id===id)||null;
  const openJobs=()=>state.jobs.filter(j=>['NEW','QUEUED','PAUSED'].includes(j.status));
  const unscheduledJobs=()=>openJobs().filter(j=>!j.equipment_id||!j.planned_start||!j.planned_end);

  function installButton(){
    if($('farmCapacityBtn'))return;
    const actions=document.querySelector('.production-top-actions');if(!actions)return;
    const b=document.createElement('button');b.id='farmCapacityBtn';b.type='button';b.className='farm-capacity-top-btn';b.textContent='📅 План загрузки';
    b.addEventListener('click',async()=>{ensureUi();$('farmCapacityDlg').showModal();await load()});
    actions.insertBefore(b,$('refresh')||null);
  }

  function ensureUi(){
    if(!$('farmCapacityDlg')){
      const d=document.createElement('dialog');d.id='farmCapacityDlg';d.className='farm-capacity-dialog';d.innerHTML=`
        <div class="farm-capacity-head"><div><h2>📅 План загрузки производства</h2><p>Реальная доступная мощность станков, запланированные окна и предупреждения о перегрузе.</p></div><button type="button" data-cap-close="farmCapacityDlg">×</button></div>
        <div class="farm-capacity-toolbar"><select id="farmCapacityDays"><option value="7">7 дней</option><option value="14" selected>14 дней</option><option value="30">30 дней</option></select><button id="farmCapacityRefresh" type="button">↻ Обновить</button><button id="farmCapacityConfigure" class="farm-capacity-primary" type="button">⚙ Мощность станков</button></div>
        <div class="farm-capacity-kpis"><article class="farm-capacity-kpi"><span>Загрузка сегодня</span><strong id="farmCapacityToday">0%</strong></article><article class="farm-capacity-kpi danger"><span>Перегруженных дней</span><strong id="farmCapacityOverloaded">0</strong></article><article class="farm-capacity-kpi warn"><span>Без полного плана</span><strong id="farmCapacityUnscheduled">0</strong></article><article class="farm-capacity-kpi"><span>Станков в плане</span><strong id="farmCapacityMachines">0</strong></article></div>
        <div class="farm-capacity-body"><section class="farm-capacity-section"><h3>Календарь мощности</h3><div id="farmCapacityTable" class="farm-capacity-table-wrap"><div class="farm-capacity-empty">Загрузка…</div></div></section><section class="farm-capacity-section"><h3>Задания без полного плана</h3><div id="farmCapacityJobs" class="farm-capacity-jobs"><div class="farm-capacity-empty">Загрузка…</div></div></section></div>`;
      document.body.appendChild(d);
      $('farmCapacityDays').addEventListener('change',()=>{state.days=Number($('farmCapacityDays').value||14);load()});
      $('farmCapacityRefresh').addEventListener('click',load);
      $('farmCapacityConfigure').addEventListener('click',openCapacitySettings);
    }
    if(!$('farmCapacitySettingsDlg')){
      const d=document.createElement('dialog');d.id='farmCapacitySettingsDlg';d.className='farm-capacity-modal';d.innerHTML=`<form id="farmCapacitySettingsForm"><div class="farm-capacity-head"><div><h3>Мощность оборудования</h3><p>Часы доступной работы на каждый день недели. По умолчанию: 8 часов Пн–Пт.</p></div><button type="button" data-cap-close="farmCapacitySettingsDlg">×</button></div><div class="farm-capacity-form"><div class="farm-capacity-grid"><label class="farm-capacity-field full"><span>Оборудование</span><select id="farmCapacityEquipment" required></select></label><div class="farm-capacity-field full"><span>Доступно часов в день</span><div id="farmCapacityWeek" class="farm-capacity-week"></div></div><div class="farm-capacity-note">Значение 0 означает выходной или отсутствие доступной мощности. Этот календарь используется и в планировании, и в расчёте загрузки оборудования.</div></div><div id="farmCapacitySettingsError" class="farm-capacity-error"></div></div><div class="farm-capacity-foot"><button type="button" data-cap-close="farmCapacitySettingsDlg">Отмена</button><button class="farm-capacity-primary" type="submit">Сохранить</button></div></form>`;
      document.body.appendChild(d);$('farmCapacitySettingsForm').addEventListener('submit',saveCapacity);$('farmCapacityEquipment').addEventListener('change',fillCapacityWeek);
    }
    if(!$('farmScheduleDlg')){
      const d=document.createElement('dialog');d.id='farmScheduleDlg';d.className='farm-capacity-modal';d.innerHTML=`<form id="farmScheduleForm"><div class="farm-capacity-head"><div><h3>Запланировать задание</h3><p>Выберите станок и зарезервируйте временное окно. Пересечения на одном станке блокируются базой.</p></div><button type="button" data-cap-close="farmScheduleDlg">×</button></div><div class="farm-capacity-form"><div class="farm-capacity-grid"><label class="farm-capacity-field full"><span>Задание</span><select id="farmScheduleJob" required></select></label><label class="farm-capacity-field full"><span>Оборудование</span><select id="farmScheduleEquipment" required></select></label><label class="farm-capacity-field"><span>Начало</span><input id="farmScheduleStart" type="datetime-local" required></label><label class="farm-capacity-field"><span>Окончание</span><input id="farmScheduleEnd" type="datetime-local" required></label><div class="farm-capacity-note">Если плановое машинное время в задании ещё не задано, оно будет рассчитано по длительности выбранного окна.</div></div><div id="farmScheduleError" class="farm-capacity-error"></div></div><div class="farm-capacity-foot"><button type="button" data-cap-close="farmScheduleDlg">Отмена</button><button class="farm-capacity-primary" type="submit">Запланировать</button></div></form>`;
      document.body.appendChild(d);$('farmScheduleForm').addEventListener('submit',saveSchedule);$('farmScheduleJob').addEventListener('change',()=>fillSchedule($('farmScheduleJob').value));$('farmScheduleStart').addEventListener('change',suggestScheduleEnd);
    }
    document.querySelectorAll('[data-cap-close]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',()=>$(b.dataset.capClose)?.close())});
  }

  async function load(){
    if(state.busy)return;state.busy=true;ensureUi();
    const refresh=$('farmCapacityRefresh');if(refresh)refresh.disabled=true;
    try{
      if(!state.permissions.length){const p=await supabase.rpc('get_my_permissions');if(p.error)throw p.error;state.permissions=Array.isArray(p.data)?p.data:[]}
      const from=isoDate(new Date()),to=isoDate(addDays(new Date(),state.days-1));
      const [cap,equipment,jobs,rules]=await Promise.all([
        supabase.rpc('production_capacity_between',{p_from:from,p_to:to}),
        supabase.from('equipment_assets').select('id,inventory_number,name,status,operational_status').neq('status','WRITTEN_OFF').order('inventory_number'),
        supabase.from('production_jobs').select('id,title,status,equipment_id,planned_start,planned_end,planned_machine_minutes,priority').in('status',['NEW','QUEUED','IN_PROGRESS','PAUSED']).order('priority',{ascending:false}).order('created_at',{ascending:true}),
        supabase.from('equipment_capacity_rules').select('equipment_id,weekday,available_minutes,is_active').order('weekday')
      ]);
      for(const r of [cap,equipment,jobs,rules])if(r.error)throw r.error;
      state.capacity=cap.data||[];state.equipment=equipment.data||[];state.jobs=jobs.data||[];state.rules=rules.data||[];
      render();
    }catch(error){console.warn('Production capacity unavailable',error);$('farmCapacityTable').innerHTML=`<div class="farm-capacity-empty">${esc(error?.message||'Не удалось загрузить план')}</div>`}
    finally{state.busy=false;if(refresh)refresh.disabled=false}
  }

  function render(){
    const today=isoDate(new Date()),todayRows=state.capacity.filter(r=>r.work_date===today),available=todayRows.reduce((s,r)=>s+Number(r.available_minutes||0),0),planned=todayRows.reduce((s,r)=>s+Number(r.planned_minutes||0),0),util=available?planned/available*100:(planned?999:0);
    $('farmCapacityToday').textContent=`${Math.min(999,Math.round(util))}%`;$('farmCapacityOverloaded').textContent=state.capacity.filter(r=>r.overloaded).length;$('farmCapacityUnscheduled').textContent=unscheduledJobs().length;$('farmCapacityMachines').textContent=state.equipment.length;$('farmCapacityConfigure').hidden=!canManage();
    const visible=state.capacity.filter(r=>Number(r.available_minutes||0)>0||Number(r.planned_minutes||0)>0);
    $('farmCapacityTable').innerHTML=`<table class="farm-capacity-table"><thead><tr><th>Дата</th><th>Оборудование</th><th>План / мощность</th><th>Загрузка</th><th>Заданий</th><th>Состояние</th></tr></thead><tbody>${visible.map(r=>{
      const pct=Number(r.load_percent||0),cls=r.overloaded?'danger':pct>=85?'warn':'',width=Math.min(100,Math.max(0,pct));
      return `<tr><td><b>${esc(fmtDate(r.work_date))}</b></td><td class="farm-capacity-machine"><b>${esc(r.inventory_number||'—')} · ${esc(r.equipment_name||'Без названия')}</b></td><td>${esc(fmtMinutes(r.planned_minutes))} / ${esc(fmtMinutes(r.available_minutes))}</td><td><div class="farm-capacity-load ${cls}"><div class="farm-capacity-bar"><i style="width:${width}%"></i></div><b>${esc(Math.round(pct))}%</b></div></td><td>${Number(r.planned_jobs||0)}</td><td><span class="farm-capacity-state ${cls}">${r.overloaded?'Перегруз':pct>=85?'Почти заполнено':'Норма'}</span></td></tr>`
    }).join('')||'<tr><td colspan="6"><div class="farm-capacity-empty">На выбранный период мощность не задана и заданий нет.</div></td></tr>'}</tbody></table>`;
    const jobs=unscheduledJobs();$('farmCapacityJobs').innerHTML=jobs.map(j=>{const e=machine(j.equipment_id),parts=[j.status,e?`${e.inventory_number} · ${e.name}`:'станок не назначен',j.planned_start&&j.planned_end?`${fmtDate(j.planned_start)} — ${fmtDate(j.planned_end)}`:'время не задано'];return `<div class="farm-capacity-job"><div><b>${esc(j.title||'Задание')}</b><small>${esc(parts.join(' · '))}</small></div>${canManage()&&['NEW','QUEUED','PAUSED'].includes(j.status)?`<button type="button" data-cap-schedule="${j.id}">📅 Запланировать</button>`:''}</div>`}).join('')||'<div class="farm-capacity-empty">Все открытые задания имеют станок и временное окно.</div>';
    $('farmCapacityJobs').querySelectorAll('[data-cap-schedule]').forEach(b=>b.addEventListener('click',()=>openSchedule(b.dataset.capSchedule)));
  }

  function capacityRulesFor(id){return weekdays.map((_,i)=>state.rules.find(r=>r.equipment_id===id&&Number(r.weekday)===i+1)||{equipment_id:id,weekday:i+1,available_minutes:i<5?480:0,is_active:true})}
  function openCapacitySettings(){
    if(!canManage())return;ensureUi();$('farmCapacitySettingsError').textContent='';$('farmCapacityEquipment').innerHTML=state.equipment.map(e=>`<option value="${e.id}">${esc(e.inventory_number||'—')} · ${esc(e.name)}</option>`).join('');fillCapacityWeek();$('farmCapacitySettingsDlg').showModal();
  }
  function fillCapacityWeek(){
    const id=$('farmCapacityEquipment').value;const rows=capacityRulesFor(id);$('farmCapacityWeek').innerHTML=rows.map((r,i)=>`<div class="farm-capacity-day"><label>${weekdays[i]}</label><input data-cap-day="${i+1}" type="number" min="0" max="24" step="0.25" value="${Number(r.is_active===false?0:r.available_minutes||0)/60}"></div>`).join('');
  }
  async function saveCapacity(event){
    event.preventDefault();if(!canManage())return;const id=$('farmCapacityEquipment').value,errorBox=$('farmCapacitySettingsError');errorBox.textContent='';
    const rules=[...$('farmCapacityWeek').querySelectorAll('[data-cap-day]')].map(input=>({weekday:Number(input.dataset.capDay),available_minutes:Math.round(Math.max(0,Math.min(24,Number(input.value||0)))*60),is_active:true}));
    try{const r=await supabase.rpc('save_equipment_capacity',{p_equipment_id:id,p_rules:rules});if(r.error)throw r.error;$('farmCapacitySettingsDlg').close();await load()}catch(error){errorBox.textContent=humanError(error)}
  }

  function openSchedule(id){
    if(!canManage())return;ensureUi();const jobs=openJobs().filter(j=>j.status!=='IN_PROGRESS');$('farmScheduleJob').innerHTML=jobs.map(j=>`<option value="${j.id}">${esc(j.title||'Задание')}</option>`).join('');$('farmScheduleEquipment').innerHTML=state.equipment.map(e=>`<option value="${e.id}"${unavailable.has(e.operational_status)?' disabled':''}>${esc(e.inventory_number||'—')} · ${esc(e.name)}${unavailable.has(e.operational_status)?' — недоступен':''}</option>`).join('');$('farmScheduleJob').value=id||jobs[0]?.id||'';$('farmScheduleError').textContent='';fillSchedule($('farmScheduleJob').value);$('farmScheduleDlg').showModal();
  }
  function fillSchedule(id){
    const j=state.jobs.find(x=>x.id===id);if(!j)return;if(j.equipment_id&&[...$('farmScheduleEquipment').options].some(o=>o.value===j.equipment_id&&!o.disabled))$('farmScheduleEquipment').value=j.equipment_id;$('farmScheduleStart').value=inputDate(j.planned_start);$('farmScheduleEnd').value=inputDate(j.planned_end);if(!$('farmScheduleStart').value){const d=new Date();d.setMinutes(Math.ceil(d.getMinutes()/15)*15,0,0);$('farmScheduleStart').value=inputDate(d)}if(!$('farmScheduleEnd').value)suggestScheduleEnd();
  }
  function suggestScheduleEnd(){
    const j=state.jobs.find(x=>x.id===$('farmScheduleJob').value),start=$('farmScheduleStart').value;if(!start)return;const d=new Date(start);if(!Number.isFinite(d.getTime()))return;d.setMinutes(d.getMinutes()+Math.max(30,Number(j?.planned_machine_minutes||60)));$('farmScheduleEnd').value=inputDate(d);
  }
  async function saveSchedule(event){
    event.preventDefault();if(!canManage())return;const errorBox=$('farmScheduleError');errorBox.textContent='';const start=new Date($('farmScheduleStart').value),end=new Date($('farmScheduleEnd').value);if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start){errorBox.textContent='Проверьте время начала и окончания.';return}
    try{const r=await supabase.rpc('schedule_production_job',{p_job_id:$('farmScheduleJob').value,p_equipment_id:$('farmScheduleEquipment').value,p_planned_start:start.toISOString(),p_planned_end:end.toISOString()});if(r.error)throw r.error;$('farmScheduleDlg').close();await load()}catch(error){errorBox.textContent=humanError(error)}
  }
  function humanError(error){const m=String(error?.message||error||'Ошибка');if(m.includes('EQUIPMENT_PLAN_OVERLAP'))return'На этом станке уже есть задание в выбранное время. Выберите другое окно.';if(m.includes('EQUIPMENT_UNAVAILABLE'))return'Выбранный станок сейчас недоступен.';if(m.includes('JOB_CANNOT_BE_SCHEDULED'))return'Это задание уже выполняется или закрыто и не может быть перепланировано.';if(m.includes('PERMISSION_DENIED'))return'Недостаточно прав для изменения производственного плана.';return m}

  function realtime(){
    if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(load,500)};
    state.channel=supabase.channel('production-capacity-v1').on('postgres_changes',{event:'*',schema:'public',table:'production_jobs'},reload).on('postgres_changes',{event:'*',schema:'public',table:'equipment_capacity_rules'},reload).on('postgres_changes',{event:'*',schema:'public',table:'equipment_assets'},reload).subscribe();
    window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true});
  }
  const boot=async()=>{installButton();ensureUi();await load();realtime()};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
}
