import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const statusLabels={NEW:'Новая',QUEUED:'В очереди',IN_PROGRESS:'В работе',PAUSED:'Пауза',DONE:'Готово',CANCELLED:'Отменена'};
const operationLabels={PRINT_2D:'2D-печать',PRINT_3D_FDM:'3D FDM',PRINT_3D_RESIN:'3D фотополимер',LASER_CUT:'Лазерная резка',LASER_ENGRAVE:'Лазерная гравировка',CNC:'ЧПУ',LAMINATION:'Ламинация',POSTPRESS:'Постпечатная обработка',ASSEMBLY:'Сборка',OTHER:'Другое'};
const pauseReasons={EQUIPMENT:'Поломка / станок',MATERIAL:'Нет материала',QUALITY:'Проблема качества',OPERATOR:'Оператор',MAINTENANCE:'ТО / обслуживание',WAITING_APPROVAL:'Ждём согласование',BREAK:'Перерыв',POWER:'Электричество',SOFTWARE:'ПО / файл',OTHER:'Другое'};
const eventLabels={START:'Старт',RESUME:'Продолжено',PAUSE:'Пауза',COMPLETE:'Завершено',CANCEL:'Отменено',EQUIPMENT_CHANGED:'Смена оборудования',STATUS_CHANGED:'Статус изменён',OUTPUT:'Выпуск',SCRAP:'Брак',REWORK:'Переделка',NOTE:'Заметка'};
const state={permissions:[],jobs:[],events:[],loading:false,channel:null,timer:null,reloadTimer:null,activeJobId:null,activeMode:null};

function can(code){return state.permissions.includes(code)}
function fmtDate(value){if(!value)return'—';const d=new Date(value);if(!Number.isFinite(d.getTime()))return'—';return d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
function fmtDuration(seconds){const total=Math.max(0,Math.floor(Number(seconds||0)));const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;if(h)return`${h}ч ${m}м`;if(m)return`${m}м ${s}с`;return`${s}с`}
function liveRunSeconds(job){if(job.status!=='IN_PROGRESS'||!job.active_run_started_at)return 0;const start=new Date(job.active_run_started_at).getTime();return Number.isFinite(start)?Math.max(0,(Date.now()-start)/1000):0}
function livePauseSeconds(job){if(job.status!=='PAUSED'||!job.paused_at)return 0;const start=new Date(job.paused_at).getTime();return Number.isFinite(start)?Math.max(0,(Date.now()-start)/1000):0}
function actualMinutes(job){return Number(job.actual_machine_minutes||0)+liveRunSeconds(job)/60}
function downtimeMinutes(job){return Number(job.downtime_minutes||0)+livePauseSeconds(job)/60}
function jobById(id){return state.jobs.find(x=>x.id===id)||null}
function qty(value){return Number(value||0).toLocaleString('ru-RU',{maximumFractionDigits:3})}
function yieldValue(job){const good=Number(job.good_quantity||0),scrap=Number(job.scrap_quantity||0);return good+scrap>0?`${(good/(good+scrap)*100).toFixed(1)}%`:'—'}

function injectStyle(){if(document.querySelector('link[data-production-operator]'))return;const link=document.createElement('link');link.rel='stylesheet';link.href='./production-farm-operator.css?v=20260914-1';link.dataset.productionOperator='1';document.head.appendChild(link)}

function ensureUi(){
  if(!$('productionOperatorBtn')){
    const actions=document.querySelector('.production-top-actions');if(actions){const b=document.createElement('button');b.id='productionOperatorBtn';b.type='button';b.className='prod-op-open';b.textContent='🎛 Оператор';b.addEventListener('click',openStation);actions.insertBefore(b,actions.firstChild)}
  }
  if(!$('productionOperatorDlg')){
    const d=document.createElement('dialog');d.id='productionOperatorDlg';d.className='prod-op-dialog';d.innerHTML=`
      <div class="prod-op-head"><div><h2>🎛 Оператор производства</h2><p>Что реально происходит на станках прямо сейчас</p></div><div class="prod-op-head-actions"><span id="prodOpUpdated">—</span><button id="prodOpRefresh" type="button">↻</button><button data-prod-op-close="productionOperatorDlg" type="button">×</button></div></div>
      <div class="prod-op-body">
        <section class="prod-op-kpis"><article><span>Работают</span><strong id="prodOpRunning">0</strong></article><article><span>На паузе</span><strong id="prodOpPaused">0</strong></article><article><span>Ждут запуска</span><strong id="prodOpWaiting">0</strong></article><article class="warn"><span>Брак сегодня</span><strong id="prodOpScrap">0</strong></article><article><span>Простой сегодня</span><strong id="prodOpDowntime">0м</strong></article></section>
        <section><div class="prod-op-section-title"><div><b>Активные станки</b><small>Старт, пауза, выпуск, брак и завершение</small></div></div><div id="prodOpActive" class="prod-op-grid"><div class="prod-op-empty">Загрузка…</div></div></section>
        <section><div class="prod-op-section-title"><div><b>Очередь на запуск</b><small>Задания с назначенным оборудованием</small></div></div><div id="prodOpQueue" class="prod-op-grid compact"><div class="prod-op-empty">Загрузка…</div></div></section>
        <section><div class="prod-op-section-title"><div><b>Журнал текущей смены</b><small>События производства за сегодня</small></div></div><div id="prodOpEvents" class="prod-op-events"><div class="prod-op-empty">Нет событий</div></div></section>
      </div>`;document.body.appendChild(d);
    $('prodOpRefresh').addEventListener('click',load);
  }
  if(!$('productionOperatorActionDlg')){
    const d=document.createElement('dialog');d.id='productionOperatorActionDlg';d.className='prod-op-action-dialog';d.innerHTML=`<form id="prodOpActionForm"><div class="prod-op-action-head"><div><h3 id="prodOpActionTitle">Действие</h3><p id="prodOpActionSubtitle"></p></div><button data-prod-op-close="productionOperatorActionDlg" type="button">×</button></div><div class="prod-op-action-body">
      <div id="prodOpReasonWrap" class="prod-op-field"><label>Причина</label><select id="prodOpReason"></select></div>
      <div id="prodOpGoodWrap" class="prod-op-field"><label>Годных единиц</label><input id="prodOpGood" type="number" min="0" step="0.001"></div>
      <div id="prodOpScrapWrap" class="prod-op-field"><label>Брак</label><input id="prodOpScrapQty" type="number" min="0" step="0.001"></div>
      <div id="prodOpReworkWrap" class="prod-op-field"><label>На переделку</label><input id="prodOpReworkQty" type="number" min="0" step="0.001"></div>
      <div class="prod-op-field"><label>Комментарий</label><textarea id="prodOpNote" rows="4" maxlength="1500" placeholder="Что произошло, что проверить дальше…"></textarea></div>
      <div id="prodOpError" class="prod-op-error"></div></div><div class="prod-op-action-foot"><button data-prod-op-close="productionOperatorActionDlg" type="button">Отмена</button><button id="prodOpSubmit" class="primary" type="submit">Сохранить</button></div></form>`;document.body.appendChild(d);
    $('prodOpActionForm').addEventListener('submit',submitAction);
  }
  document.querySelectorAll('[data-prod-op-close]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',()=>$(b.dataset.prodOpClose)?.close())});
}

function activeJobs(){return state.jobs.filter(j=>['IN_PROGRESS','PAUSED'].includes(j.status))}
function queuedJobs(){return state.jobs.filter(j=>['NEW','QUEUED'].includes(j.status)&&j.equipment_id)}
function todayStart(){const d=new Date();d.setHours(0,0,0,0);return d.getTime()}
function todayEvents(){const start=todayStart();return state.events.filter(e=>new Date(e.created_at).getTime()>=start)}

function renderKpis(){
  const active=activeJobs(),events=todayEvents();
  $('prodOpRunning').textContent=active.filter(j=>j.status==='IN_PROGRESS').length;
  $('prodOpPaused').textContent=active.filter(j=>j.status==='PAUSED').length;
  $('prodOpWaiting').textContent=queuedJobs().length;
  $('prodOpScrap').textContent=qty(events.reduce((sum,e)=>sum+Number(e.scrap_quantity||0),0));
  let seconds=events.filter(e=>e.event_type==='PAUSE').reduce((sum,e)=>sum+Number(e.duration_seconds||0),0);
  for(const j of active.filter(x=>x.status==='PAUSED'))seconds+=livePauseSeconds(j);
  $('prodOpDowntime').textContent=fmtDuration(seconds);
}

function actionButtons(job){
  if(!can('production.manage'))return'';
  const out=[];
  if(['NEW','QUEUED'].includes(job.status)&&job.equipment_id)out.push(`<button class="start" data-op-direct="${job.id}|START">▶ Старт</button>`);
  if(job.status==='IN_PROGRESS')out.push(`<button class="pause" data-op-dialog="${job.id}|PAUSE">Ⅱ Пауза</button>`,`<button class="done" data-op-dialog="${job.id}|COMPLETE">✓ Готово</button>`);
  if(job.status==='PAUSED')out.push(`<button class="start" data-op-direct="${job.id}|RESUME">▶ Продолжить</button>`,`<button class="done" data-op-dialog="${job.id}|COMPLETE">✓ Готово</button>`);
  out.push(`<button data-op-dialog="${job.id}|OUTPUT">+ Выпуск</button>`,`<button class="danger" data-op-dialog="${job.id}|SCRAP">Брак</button>`,`<button data-op-dialog="${job.id}|REWORK">Переделка</button>`,`<button data-op-dialog="${job.id}|NOTE">Заметка</button>`);
  return `<div class="prod-op-card-actions">${out.join('')}</div>`;
}
function cardHtml(job,compact=false){
  const running=job.status==='IN_PROGRESS',paused=job.status==='PAUSED';
  const machine=[job.inventory_number,job.equipment_name].filter(Boolean).join(' · ')||'Оборудование не назначено';
  const live=actualMinutes(job),plan=Number(job.planned_machine_minutes||0),progress=plan>0?Math.min(100,live/plan*100):0;
  const clock=running?`работает ${fmtDuration(liveRunSeconds(job))}`:paused?`пауза ${fmtDuration(livePauseSeconds(job))}`:statusLabels[job.status]||job.status;
  const reason=paused&&job.pause_reason?` · ${pauseReasons[job.pause_reason]||job.pause_reason}`:'';
  return `<article class="prod-op-card ${running?'running':''} ${paused?'paused':''} ${compact?'compact':''}" data-op-job="${job.id}">
    <div class="prod-op-card-head"><div><span class="prod-op-status">${running?'● ':''}${esc(clock+reason)}</span><h3>${esc(job.title)}</h3><small>${esc(machine)}</small></div><span class="prod-op-priority">${Number(job.priority||0)}</span></div>
    <div class="prod-op-card-meta"><span>${esc(operationLabels[job.operation_type]||job.operation_type||'Операция не указана')}</span><span>План: ${plan?`${Math.round(plan)} мин`:'—'}</span><span>Факт: <b data-op-live-minutes="${job.id}">${live.toFixed(1)} мин</b></span></div>
    ${plan?`<div class="prod-op-progress"><i style="width:${progress.toFixed(1)}%"></i></div>`:''}
    <div class="prod-op-quality"><div><span>Годно</span><b>${qty(job.good_quantity)}</b></div><div><span>Брак</span><b>${qty(job.scrap_quantity)}</b></div><div><span>Переделка</span><b>${qty(job.rework_quantity)}</b></div><div><span>Выход</span><b>${yieldValue(job)}</b></div><div><span>Простой</span><b data-op-downtime="${job.id}">${downtimeMinutes(job).toFixed(1)} мин</b></div></div>
    ${paused&&job.pause_note?`<div class="prod-op-note">${esc(job.pause_note)}</div>`:''}
    ${actionButtons(job)}
  </article>`;
}
function renderCards(){
  const active=activeJobs().sort((a,b)=>Number(b.priority||0)-Number(a.priority||0));
  const queue=queuedJobs().sort((a,b)=>Number(b.priority||0)-Number(a.priority||0));
  $('prodOpActive').innerHTML=active.map(j=>cardHtml(j)).join('')||'<div class="prod-op-empty">Сейчас ни один станок не работает</div>';
  $('prodOpQueue').innerHTML=queue.map(j=>cardHtml(j,true)).join('')||'<div class="prod-op-empty">Очередь на запуск пуста</div>';
}
function renderEvents(){
  const rows=todayEvents().slice(0,80);
  $('prodOpEvents').innerHTML=rows.map(e=>{const job=jobById(e.production_job_id);const values=[Number(e.good_quantity||0)>0?`годно ${qty(e.good_quantity)}`:'',Number(e.scrap_quantity||0)>0?`брак ${qty(e.scrap_quantity)}`:'',Number(e.rework_quantity||0)>0?`переделка ${qty(e.rework_quantity)}`:'',e.duration_seconds!=null?`${fmtDuration(e.duration_seconds)}`:''].filter(Boolean).join(' · ');return `<div class="prod-op-event"><time>${esc(new Date(e.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}))}</time><div><b>${esc(eventLabels[e.event_type]||e.event_type)}</b><span>${esc(job?.title||e.production_job_id.slice(0,8))}${e.reason_code?` · ${esc(pauseReasons[e.reason_code]||e.reason_code)}`:''}${values?` · ${esc(values)}`:''}</span>${e.note?`<small>${esc(e.note)}</small>`:''}</div></div>`}).join('')||'<div class="prod-op-empty">За сегодня событий ещё нет</div>';
}
function render(){if(!$('productionOperatorDlg'))return;renderKpis();renderCards();renderEvents();$('prodOpUpdated').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`}

async function loadPermissions(){const {data,error}=await supabase.rpc('get_my_permissions');if(error)throw error;state.permissions=Array.isArray(data)?data:[]}
async function load(){
  if(state.loading)return;state.loading=true;
  try{
    const [jobs,events]=await Promise.all([
      supabase.from('production_operator_overview').select('*').in('status',['NEW','QUEUED','IN_PROGRESS','PAUSED']).order('priority',{ascending:false}),
      supabase.from('production_job_events').select('id,production_job_id,equipment_id,operator_user_id,event_type,reason_code,note,good_quantity,scrap_quantity,rework_quantity,duration_seconds,created_at').order('created_at',{ascending:false}).limit(500)
    ]);
    if(jobs.error)throw jobs.error;if(events.error)throw events.error;state.jobs=jobs.data||[];state.events=events.data||[];render();
  }catch(error){console.warn('Production operator load failed',error);if($('prodOpActive'))$('prodOpActive').innerHTML=`<div class="prod-op-empty error">${esc(error.message||error)}</div>`}finally{state.loading=false}
}
async function openStation(){ensureUi();$('productionOperatorDlg').showModal();await load()}

function setVisible(id,visible){const el=$(id);if(el)el.hidden=!visible}
function openActionDialog(jobId,mode){
  const job=jobById(jobId)||{id:jobId,title:'Производственное задание',quantity:0,good_quantity:0};state.activeJobId=jobId;state.activeMode=mode;ensureUi();
  $('prodOpActionForm').reset();$('prodOpError').textContent='';
  const title={PAUSE:'Поставить на паузу',COMPLETE:'Завершить задание',OUTPUT:'Записать выпуск',SCRAP:'Записать брак',REWORK:'Записать переделку',NOTE:'Добавить заметку'}[mode]||'Действие';
  $('prodOpActionTitle').textContent=title;$('prodOpActionSubtitle').textContent=job.title||'';
  const reasonMode=['PAUSE','SCRAP','REWORK'].includes(mode);setVisible('prodOpReasonWrap',reasonMode);setVisible('prodOpGoodWrap',['COMPLETE','OUTPUT'].includes(mode));setVisible('prodOpScrapWrap',mode==='COMPLETE'||mode==='SCRAP');setVisible('prodOpReworkWrap',mode==='COMPLETE'||mode==='REWORK');
  $('prodOpReason').innerHTML=Object.entries(pauseReasons).map(([v,l])=>`<option value="${v}">${l}</option>`).join('');$('prodOpReason').value=mode==='SCRAP'||mode==='REWORK'?'QUALITY':'EQUIPMENT';
  $('prodOpGood').value=mode==='COMPLETE'?Math.max(0,Number(job.quantity||0)-Number(job.good_quantity||0)):mode==='OUTPUT'?1:0;
  $('prodOpScrapQty').value=mode==='SCRAP'?1:0;$('prodOpReworkQty').value=mode==='REWORK'?1:0;
  $('prodOpSubmit').textContent=mode==='PAUSE'?'Поставить на паузу':mode==='COMPLETE'?'Завершить':'Сохранить';
  $('productionOperatorActionDlg').showModal();
}
function translateError(error){const t=String(error?.message||error||'Ошибка');if(t.includes('PERMISSION_DENIED'))return'Недостаточно прав для управления производством.';if(t.includes('PAUSE_REASON_REQUIRED'))return'Выберите причину паузы.';if(t.includes('EQUIPMENT_REQUIRED'))return'Сначала назначьте оборудование.';if(t.includes('EQUIPMENT_UNAVAILABLE'))return'Оборудование недоступно.';if(t.includes('EQUIPMENT_ALREADY_RUNNING'))return'На этом станке уже выполняется другое задание.';if(t.includes('GOOD_QUANTITY_REQUIRED'))return'Укажите количество годной продукции.';if(t.includes('SCRAP_QUANTITY_REQUIRED'))return'Укажите количество брака.';if(t.includes('REWORK_QUANTITY_REQUIRED'))return'Укажите количество на переделку.';if(t.includes('ACTIVE_RUN_NOT_FOUND'))return'Активный запуск не найден. Обновите страницу.';return t}
async function operatorAction(jobId,action,payload={}){
  const params={p_job_id:jobId,p_action:action,p_reason_code:payload.reason||null,p_note:payload.note||null,p_good_quantity:Number(payload.good||0),p_scrap_quantity:Number(payload.scrap||0),p_rework_quantity:Number(payload.rework||0)};
  const {error}=await supabase.rpc('production_operator_action',params);if(error)throw error;await load();setTimeout(()=>window.dispatchEvent(new Event('production-operator-changed')),0);
}
async function directAction(jobId,action,button){button?.classList.add('busy');button&&(button.disabled=true);try{await operatorAction(jobId,action)}catch(error){window.alert(translateError(error))}finally{button?.classList.remove('busy');button&&(button.disabled=false)}}
async function submitAction(event){
  event.preventDefault();const button=$('prodOpSubmit');button.disabled=true;$('prodOpError').textContent='';
  try{await operatorAction(state.activeJobId,state.activeMode,{reason:$('prodOpReason').value,note:$('prodOpNote').value.trim(),good:$('prodOpGood').value,scrap:$('prodOpScrapQty').value,rework:$('prodOpReworkQty').value});$('productionOperatorActionDlg').close()}
  catch(error){$('prodOpError').textContent=translateError(error)}finally{button.disabled=false}
}

function bindActions(){
  document.addEventListener('click',event=>{
    const direct=event.target.closest('[data-op-direct]');if(direct){event.preventDefault();const[id,action]=direct.dataset.opDirect.split('|');directAction(id,action,direct);return}
    const modal=event.target.closest('[data-op-dialog]');if(modal){event.preventDefault();const[id,mode]=modal.dataset.opDialog.split('|');openActionDialog(id,mode)}
  });
  // Capture the older runtime buttons before their bubble handler. That makes every
  // visible start/pause/complete button use the same operator journal RPC.
  document.addEventListener('click',event=>{
    const legacy=event.target.closest('[data-farm-action]');if(!legacy)return;const[id,action]=legacy.dataset.farmAction.split('|');if(!['START','RESUME','PAUSE','COMPLETE'].includes(action))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(['PAUSE','COMPLETE'].includes(action))openActionDialog(id,action);else directAction(id,action,legacy);
  },true);
}
function updateLive(){
  renderKpis();for(const job of state.jobs){const live=document.querySelector(`[data-op-live-minutes="${job.id}"]`);if(live)live.textContent=`${actualMinutes(job).toFixed(1)} мин`;const down=document.querySelector(`[data-op-downtime="${job.id}"]`);if(down)down.textContent=`${downtimeMinutes(job).toFixed(1)} мин`}
}
function initRealtime(){if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(state.reloadTimer);state.reloadTimer=setTimeout(load,350)};state.channel=supabase.channel('production-operator-v1').on('postgres_changes',{event:'*',schema:'public',table:'production_jobs'},reload).on('postgres_changes',{event:'*',schema:'public',table:'production_job_runs'},reload).on('postgres_changes',{event:'*',schema:'public',table:'production_job_events'},reload).subscribe()}
async function init(){
  try{await loadPermissions();if(!can('production.view'))return;injectStyle();ensureUi();bindActions();await load();state.timer=setInterval(updateLive,1000);initRealtime();window.addEventListener('production-operator-changed',()=>setTimeout(load,150));window.addEventListener('beforeunload',()=>{if(state.timer)clearInterval(state.timer);if(state.channel)supabase.removeChannel(state.channel)},{once:true})}
  catch(error){console.warn('Production operator station unavailable',error)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
