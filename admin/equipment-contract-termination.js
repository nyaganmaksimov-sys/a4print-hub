import {supabase} from './guard.js?v=20260905-netfix1';

const esc=value=>String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const date=value=>value?new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString('ru-RU'):'—';
const todayIso=()=>{const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10)};
const addDays=(iso,days)=>{const d=new Date(`${iso}T12:00:00`);d.setDate(d.getDate()+Number(days||0));return d.toISOString().slice(0,10)};
const statusLabels={NOTICE:'Уведомление',PREPARING:'Подготовка',READY:'Готово к закрытию',COMPLETED:'Завершено',CANCELLED:'Отменено'};
const initiatorLabels={HUB:'A4PRINT HUB',OWNER:'Владелец',MUTUAL:'По соглашению сторон',OTHER:'Иное'};
const contractTypeLabels={REVENUE_SHARE:'Доля с выручки',LEASE:'Аренда',LEASE_BUYOUT:'Аренда с выкупом',LOAN_FOR_USE:'Безвозмездное пользование',OTHER:'Иной'};
const state={permissions:[],terminations:[],contracts:[],partners:[],loading:false};
const can=code=>state.permissions.includes(code);
const partnerName=id=>{const p=state.partners.find(x=>x.id===id);return p?.legal_name||p?.name||'—'};
const blockerCount=row=>['open_jobs_count','open_incidents_count','open_settlements_count','open_lease_charges_count','unsettled_jobs_count'].reduce((s,k)=>s+Number(row?.[k]||0),0);

function addStyle(){
  if(document.querySelector('link[data-contract-termination-style]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='./equipment-contract-termination.css?v=20260915-1';link.dataset.contractTerminationStyle='1';document.head.appendChild(link);
}

function injectButton(){
  if(document.getElementById('contractTerminationBtn'))return;
  const actions=document.querySelector('.topbar .eq-actions');if(!actions)return;
  const button=document.createElement('button');button.id='contractTerminationBtn';button.type='button';button.textContent='↩ Расторжения';
  button.addEventListener('click',async()=>{ensureWorkspace();document.getElementById('contractTerminationDlg').showModal();await load()});
  actions.insertBefore(button,document.getElementById('refresh')||null);
}

function ensureWorkspace(){
  if(document.getElementById('contractTerminationDlg'))return;
  const dlg=document.createElement('dialog');dlg.id='contractTerminationDlg';dlg.className='ct-dialog';dlg.innerHTML=`
    <div class="ct-shell">
      <header class="ct-head"><div><h2>Расторжение и возврат оборудования</h2><p>Контролируемое закрытие договора: уведомление → подготовка → расчёты → акт возврата.</p></div><div class="ct-head-actions"><button id="ctRefresh" type="button">↻ Обновить</button><button id="ctClose" class="ct-close" type="button">×</button></div></header>
      <div class="ct-body">
        <div id="ctError"></div>
        <section class="ct-kpis">
          <article><span>Активные процедуры</span><strong id="ctKpiOpen">0</strong><small>требуют контроля</small></article>
          <article><span>Оборудование</span><strong id="ctKpiEquipment">0</strong><small>в открытых процедурах</small></article>
          <article><span>Блокировки</span><strong id="ctKpiBlockers">0</strong><small>работа, аварии, деньги</small></article>
          <article><span>Завершено</span><strong id="ctKpiDone">0</strong><small>история закрытий</small></article>
        </section>
        <div class="ct-toolbar"><input id="ctSearch" type="search" placeholder="Договор, владелец, причина…"><select id="ctStatus"><option value="">Все статусы</option>${Object.entries(statusLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select><button id="ctStart" class="ct-primary" type="button">+ Начать расторжение</button></div>
        <div id="ctList" class="ct-list"><div class="ct-empty">Загрузка…</div></div>
      </div>
    </div>`;document.body.appendChild(dlg);

  const start=document.createElement('dialog');start.id='ctStartDlg';start.className='ct-form-dialog';start.innerHTML=`
    <form id="ctStartForm"><div class="ct-form-head"><div><h3>Начать расторжение</h3><p>Система проверит договорный срок уведомления.</p></div><button type="button" data-ct-close="ctStartDlg">×</button></div>
    <div class="ct-form-body"><div class="ct-form-grid">
      <label class="ct-field full"><span>Договор *</span><select id="ctContract" required></select><small id="ctContractHint"></small></label>
      <label class="ct-field"><span>Инициатор *</span><select id="ctInitiator"><option value="HUB">A4PRINT HUB</option><option value="OWNER">Владелец</option><option value="MUTUAL">По соглашению сторон</option><option value="OTHER">Иное</option></select></label>
      <label class="ct-field"><span>Плановая дата прекращения *</span><input id="ctEndDate" type="date" required></label>
      <label class="ct-field full"><span>Причина *</span><textarea id="ctReason" required placeholder="Основание и обстоятельства досрочного прекращения"></textarea></label>
      <label class="ct-check full"><input id="ctWaived" type="checkbox"> Срок уведомления сокращён / отменён по соглашению сторон</label>
      <label class="ct-field full" id="ctWaiverWrap"><span>Основание сокращения срока *</span><textarea id="ctWaiverReason" placeholder="Например: письменное соглашение сторон от …"></textarea></label>
    </div><div id="ctStartError" class="ct-form-error"></div></div>
    <div class="ct-form-foot"><button type="button" data-ct-close="ctStartDlg">Отмена</button><button class="ct-primary" id="ctStartSave" type="submit">Запустить процедуру</button></div></form>`;document.body.appendChild(start);

  const finish=document.createElement('dialog');finish.id='ctFinishDlg';finish.className='ct-form-dialog';finish.innerHTML=`
    <form id="ctFinishForm"><div class="ct-form-head"><div><h3>Финальное закрытие договора</h3><p id="ctFinishSubtitle"></p></div><button type="button" data-ct-close="ctFinishDlg">×</button></div>
    <div class="ct-form-body"><input id="ctFinishId" type="hidden"><div id="ctFinishBlockers" class="ct-blocker-box"></div><div class="ct-form-grid">
      <label class="ct-field full"><span>Акт возврата / передачи *</span><input id="ctReturnRef" required placeholder="Номер и дата акта"></label>
      <label class="ct-field full"><span>Финальная сверка расчётов *</span><input id="ctFinanceRef" required placeholder="Номер акта сверки / платёжного документа"></label>
      <label class="ct-field full"><span>ID документа в архиве</span><input id="ctDocumentId" placeholder="UUID — необязательно"></label>
      <label class="ct-field full"><span>Итоговое примечание</span><textarea id="ctFinalNotes" placeholder="Состояние оборудования, комплектность, дополнительные договорённости"></textarea></label>
    </div><div id="ctFinishError" class="ct-form-error"></div></div>
    <div class="ct-form-foot"><button type="button" data-ct-close="ctFinishDlg">Отмена</button><button class="ct-danger" id="ctFinishSave" type="submit">Закрыть договор и вывести оборудование</button></div></form>`;document.body.appendChild(finish);

  document.getElementById('ctClose').addEventListener('click',()=>dlg.close());
  document.getElementById('ctRefresh').addEventListener('click',load);
  document.getElementById('ctSearch').addEventListener('input',render);
  document.getElementById('ctStatus').addEventListener('change',render);
  document.getElementById('ctStart').addEventListener('click',openStart);
  document.getElementById('ctContract').addEventListener('change',syncContractHint);
  document.getElementById('ctWaived').addEventListener('change',syncWaiver);
  document.getElementById('ctStartForm').addEventListener('submit',submitStart);
  document.getElementById('ctFinishForm').addEventListener('submit',submitFinish);
  document.querySelectorAll('[data-ct-close]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.ctClose)?.close()));
  document.getElementById('ctList').addEventListener('click',handleListAction);
  syncWaiver();
}

async function loadPermissions(){const {data,error}=await supabase.rpc('get_my_permissions');if(error)throw error;state.permissions=Array.isArray(data)?data:[]}
async function load(){
  if(state.loading)return;state.loading=true;
  const refresh=document.getElementById('ctRefresh');if(refresh){refresh.disabled=true;refresh.textContent='Обновление…'};
  try{
    if(!state.permissions.length)await loadPermissions();
    const [termRes,contractRes,partnerRes]=await Promise.all([
      supabase.from('equipment_contract_termination_overview').select('*').order('created_at',{ascending:false}),
      supabase.from('equipment_contracts').select('id,partner_id,contract_number,contract_type,status,starts_on,ends_on,early_termination_notice_days').in('status',['ACTIVE','SUSPENDED']).order('created_at',{ascending:false}),
      supabase.from('partners').select('id,name,legal_name').order('name')
    ]);
    if(termRes.error)throw termRes.error;if(contractRes.error)throw contractRes.error;if(partnerRes.error)throw partnerRes.error;
    state.terminations=termRes.data||[];state.contracts=contractRes.data||[];state.partners=partnerRes.data||[];
    render();
  }catch(err){showError('ctError',friendlyError(err))}
  finally{state.loading=false;if(refresh){refresh.disabled=false;refresh.textContent='↻ Обновить'}}
}

function render(){
  const list=document.getElementById('ctList');if(!list)return;
  const q=(document.getElementById('ctSearch')?.value||'').trim().toLowerCase();const status=document.getElementById('ctStatus')?.value||'';
  const open=state.terminations.filter(x=>['NOTICE','PREPARING','READY'].includes(x.status));
  document.getElementById('ctKpiOpen').textContent=open.length;
  document.getElementById('ctKpiEquipment').textContent=open.reduce((s,x)=>s+Number(x.equipment_count||0),0);
  document.getElementById('ctKpiBlockers').textContent=open.reduce((s,x)=>s+blockerCount(x),0);
  document.getElementById('ctKpiDone').textContent=state.terminations.filter(x=>x.status==='COMPLETED').length;
  document.getElementById('ctStart').style.display=can('equipment.contracts.manage')?'':'none';
  const rows=state.terminations.filter(x=>(!status||x.status===status)&&(!q||`${x.contract_number} ${x.partner_name} ${x.reason}`.toLowerCase().includes(q)));
  if(!rows.length){list.innerHTML='<div class="ct-empty">Процедур расторжения пока нет.</div>';return}
  list.innerHTML=rows.map(card).join('');
}

function card(row){
  const blockers=blockerCount(row);const final=row.status==='COMPLETED'||row.status==='CANCELLED';const dateReached=todayIso()>=String(row.effective_end_date||'');
  const canManage=can('equipment.contracts.manage');
  const blockerHtml=[['Рабочие задания',row.open_jobs_count],['Аварии / ремонт',row.open_incidents_count],['Расчёты владельцу',row.open_settlements_count],['Арендные начисления',row.open_lease_charges_count],['Неоплаченные операции',row.unsettled_jobs_count]].map(([label,n])=>`<span class="${Number(n)>0?'bad':'ok'}">${esc(label)}: <b>${Number(n||0)}</b></span>`).join('');
  let actions='';
  if(canManage&&!final){
    if(row.status==='NOTICE')actions+=`<button data-act="prepare" data-id="${row.termination_id}">Начать подготовку</button>`;
    if(['NOTICE','PREPARING','READY'].includes(row.status))actions+=`<button data-act="finish" data-id="${row.termination_id}" class="ct-primary" ${blockers||!dateReached?'disabled':''}>Финально закрыть</button>`;
    actions+=`<button data-act="cancel" data-id="${row.termination_id}" class="ct-ghost-danger">Отменить</button>`;
  }
  return `<article class="ct-card" data-id="${row.termination_id}">
    <div class="ct-card-head"><div><div class="ct-title-row"><h3>${esc(row.contract_number||'Без номера')}</h3><span class="ct-pill ${row.status.toLowerCase()}">${esc(statusLabels[row.status]||row.status)}</span></div><p>${esc(row.partner_name)} · ${esc(contractTypeLabels[row.contract_type]||row.contract_type)}</p></div><strong>${date(row.effective_end_date)}</strong></div>
    <div class="ct-meta"><span>Инициатор: <b>${esc(initiatorLabels[row.initiated_by_party]||row.initiated_by_party)}</b></span><span>Уведомление: <b>${date(row.notice_date)}</b></span><span>Срок по договору: <b>${Number(row.early_termination_notice_days||0)} дн.</b></span><span>Оборудование: <b>${Number(row.equipment_count||0)}</b></span></div>
    <div class="ct-reason">${esc(row.reason||'—')}${row.notice_waived?`<small>Срок уведомления сокращён: ${esc(row.waiver_reason||'основание указано')}</small>`:''}</div>
    <div class="ct-blockers">${blockerHtml}</div>
    ${!dateReached&&!final?`<div class="ct-note warn">Финальное закрытие станет доступно ${date(row.effective_end_date)}.</div>`:''}
    ${blockers&&!final?`<div class="ct-note danger">Сначала устраните все блокировки. Система не даст закрыть договор принудительно.</div>`:''}
    ${row.return_reference?`<div class="ct-result"><b>Возврат:</b> ${esc(row.return_reference)}<br><b>Сверка:</b> ${esc(row.financial_clearance_reference||'—')}</div>`:''}
    ${actions?`<div class="ct-card-actions">${actions}</div>`:''}
  </article>`;
}

function openStart(){
  const select=document.getElementById('ctContract');
  const activeTermContracts=new Set(state.terminations.filter(x=>['NOTICE','PREPARING','READY'].includes(x.status)).map(x=>x.contract_id));
  const available=state.contracts.filter(c=>!activeTermContracts.has(c.id));
  select.innerHTML=available.length?available.map(c=>`<option value="${c.id}">${esc(c.contract_number)} — ${esc(partnerName(c.partner_id))}</option>`).join(''):'<option value="">Нет доступных договоров</option>';
  document.getElementById('ctStartForm').reset();document.getElementById('ctInitiator').value='HUB';syncWaiver();syncContractHint();showError('ctStartError','');document.getElementById('ctStartDlg').showModal();
}
function syncContractHint(){
  const id=document.getElementById('ctContract')?.value;const c=state.contracts.find(x=>x.id===id);const hint=document.getElementById('ctContractHint');if(!hint)return;
  if(!c){hint.textContent='Нет действующего или приостановленного договора без открытой процедуры.';return}
  const earliest=addDays(todayIso(),c.early_termination_notice_days||0);hint.textContent=`Минимальная дата по сроку уведомления: ${date(earliest)} (${Number(c.early_termination_notice_days||0)} дн.).`;
  const input=document.getElementById('ctEndDate');if(input&&!input.value)input.value=earliest;input.min=todayIso();
}
function syncWaiver(){const checked=document.getElementById('ctWaived')?.checked;const wrap=document.getElementById('ctWaiverWrap');if(wrap)wrap.style.display=checked?'':'none';const field=document.getElementById('ctWaiverReason');if(field)field.required=!!checked}

async function submitStart(e){
  e.preventDefault();const btn=document.getElementById('ctStartSave');btn.disabled=true;showError('ctStartError','');
  try{
    const args={p_contract_id:document.getElementById('ctContract').value,p_requested_end_date:document.getElementById('ctEndDate').value,p_initiated_by_party:document.getElementById('ctInitiator').value,p_reason:document.getElementById('ctReason').value.trim(),p_notice_waived:document.getElementById('ctWaived').checked,p_waiver_reason:document.getElementById('ctWaiverReason').value.trim()||null};
    const {error}=await supabase.rpc('start_equipment_contract_termination',args);if(error)throw error;document.getElementById('ctStartDlg').close();await load();
  }catch(err){showError('ctStartError',friendlyError(err))}finally{btn.disabled=false}
}

async function handleListAction(e){
  const btn=e.target.closest('button[data-act]');if(!btn||btn.disabled)return;const row=state.terminations.find(x=>x.termination_id===btn.dataset.id);if(!row)return;
  if(btn.dataset.act==='prepare'){
    btn.disabled=true;const {error}=await supabase.rpc('set_equipment_contract_termination_status',{p_termination_id:row.termination_id,p_status:'PREPARING',p_note:'Подготовка возврата начата из интерфейса HUB'});if(error)alert(friendlyError(error));await load();return;
  }
  if(btn.dataset.act==='cancel'){
    const note=prompt('Причина отмены процедуры расторжения:');if(note===null)return;btn.disabled=true;const {error}=await supabase.rpc('set_equipment_contract_termination_status',{p_termination_id:row.termination_id,p_status:'CANCELLED',p_note:note.trim()||'Отменено оператором'});if(error)alert(friendlyError(error));await load();return;
  }
  if(btn.dataset.act==='finish')openFinish(row);
}

function openFinish(row){
  document.getElementById('ctFinishForm').reset();document.getElementById('ctFinishId').value=row.termination_id;document.getElementById('ctFinishSubtitle').textContent=`${row.contract_number} · ${row.partner_name} · прекращение ${date(row.effective_end_date)}`;
  const blockers=blockerCount(row);document.getElementById('ctFinishBlockers').innerHTML=blockers?`<b>Закрытие заблокировано:</b> ${blockers} незавершённых элементов.`:'<b>Проверка пройдена:</b> активных работ, аварий и незакрытых расчётов нет.';
  document.getElementById('ctFinishSave').disabled=!!blockers||todayIso()<String(row.effective_end_date||'');showError('ctFinishError','');document.getElementById('ctFinishDlg').showModal();
}

async function submitFinish(e){
  e.preventDefault();const btn=document.getElementById('ctFinishSave');btn.disabled=true;showError('ctFinishError','');
  try{
    const {error}=await supabase.rpc('finalize_equipment_contract_termination',{p_termination_id:document.getElementById('ctFinishId').value,p_return_reference:document.getElementById('ctReturnRef').value.trim(),p_financial_clearance_reference:document.getElementById('ctFinanceRef').value.trim(),p_document_id:document.getElementById('ctDocumentId').value.trim()||null,p_final_notes:document.getElementById('ctFinalNotes').value.trim()||null});
    if(error)throw error;document.getElementById('ctFinishDlg').close();await load();
  }catch(err){showError('ctFinishError',friendlyError(err));btn.disabled=false}
}

function showError(id,text){const el=document.getElementById(id);if(!el)return;el.innerHTML=text?`<div class="ct-error">${esc(text)}</div>`:''}
function friendlyError(err){
  const msg=String(err?.message||err||'Ошибка');
  const map=[['PERMISSION_DENIED','Недостаточно прав для этой операции.'],['NOTICE_PERIOD_REQUIRED:','Выбранная дата нарушает срок уведомления по договору. Укажите допустимую дату либо оформите сокращение срока по соглашению сторон.'],['ACTIVE_TERMINATION_EXISTS','По этому договору уже есть незавершённая процедура расторжения.'],['CONTRACT_TERMINATION_OPEN_JOBS:','Есть незавершённые производственные задания на оборудовании договора.'],['CONTRACT_TERMINATION_OPEN_INCIDENTS:','Есть незакрытые аварии или ремонты оборудования.'],['CONTRACT_TERMINATION_OPEN_SETTLEMENTS:','Есть незакрытые расчёты с владельцем.'],['CONTRACT_TERMINATION_OPEN_LEASE_CHARGES:','Есть незакрытые арендные начисления.'],['CONTRACT_TERMINATION_UNSETTLED_JOBS:','Есть завершённые операции, ещё не включённые в оплаченный расчёт владельца.'],['TERMINATION_DATE_NOT_REACHED','Дата прекращения договора ещё не наступила.'],['RETURN_REFERENCE_REQUIRED','Укажите акт возврата / передачи.'],['FINANCIAL_CLEARANCE_REQUIRED','Укажите документ финальной сверки расчётов.'],['DOCUMENT_NOT_FOUND','Документ с указанным ID не найден.']];
  for(const [key,text] of map)if(msg.includes(key))return text;return msg;
}

function init(){addStyle();injectButton()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
