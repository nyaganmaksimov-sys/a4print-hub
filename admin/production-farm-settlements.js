import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=(n,c='RUB')=>Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+(c==='RUB'?'₽':c);
const statusLabels={DRAFT:'Черновик',APPROVED:'Согласовано',PAID:'Выплачено',CANCELLED:'Отменено'};
const basisLabels={RECEIVED_REVENUE:'Полученная выручка',OPERATION_REVENUE:'Выручка операции',NET_AFTER_DIRECT_COSTS:'После прямых расходов'};
const state={permissions:[],contracts:[],partners:new Map(),settlements:[],lines:[],jobs:new Map(),loading:false};

function can(code){return state.permissions.includes(code)}
function localIso(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function todayIso(){return localIso()}
function monthStartIso(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`}
function translate(error){
  const t=String(error?.message||error||'Ошибка');
  if(t.includes('PERMISSION_DENIED'))return'Недостаточно прав для расчётов с владельцами.';
  if(t.includes('CONTRACT_NOT_ACTIVE'))return'Договор не активен.';
  if(t.includes('SETTLEMENT_CONTRACT_TYPE_UNSUPPORTED'))return'Автоматический расчёт доступен для договоров доли от выручки.';
  if(t.includes('SETTLEMENT_LOCKED'))return'Период уже согласован или выплачен и больше не пересчитывается.';
  if(t.includes('PERIOD_OUTSIDE_CONTRACT'))return'Период расчёта должен полностью находиться внутри срока договора.';
  if(t.includes('SETTLEMENT_PERIOD_OVERLAP'))return'Этот период пересекается с другим незакрытым расчётом по договору.';
  if(t.includes('SETTLEMENT_HAS_NO_JOBS'))return'В расчёте нет завершённых производственных заданий — согласовать пустой период нельзя.';
  if(t.includes('PRODUCTION_JOB_ALREADY_SETTLED'))return'Одно из заданий уже включено в другой согласованный расчёт.';
  if(t.includes('PAYMENT_REFERENCE_REQUIRED'))return'Для выплаты владельцу укажите номер или основание платежа.';
  if(t.includes('INVALID_TRANSITION'))return'Недопустимый переход статуса расчёта.';
  return t;
}
function installStyle(){if(document.querySelector('link[data-farm-settlements]'))return;const l=document.createElement('link');l.rel='stylesheet';l.href='./production-farm-settlements.css?v=20260914-2';l.dataset.farmSettlements='1';document.head.appendChild(l)}
function ensureDialog(){
  if($('farmSettlementsDlg'))return;
  const d=document.createElement('dialog');d.id='farmSettlementsDlg';d.className='farm-settlements-dialog';d.innerHTML=`
    <div class="farm-settle-head"><div><h2>Расчёты с владельцами оборудования</h2><p>Закрытие периода по фактической работе станков и условиям договора</p></div><button type="button" data-settle-close>×</button></div>
    <div class="farm-settle-body">
      <div class="farm-settle-controls">
        <label class="wide"><span>Договор</span><select id="farmSettleContract"></select></label>
        <label><span>Период с</span><input id="farmSettleFrom" type="date"></label>
        <label><span>по</span><input id="farmSettleTo" type="date"></label>
        <button id="farmSettleGenerate" class="primary" type="button">Рассчитать период</button>
        <button id="farmSettleReload" type="button">↻ Обновить</button>
      </div>
      <div id="farmSettleError" class="farm-settle-error"></div>
      <div id="farmSettleSummary" class="farm-settle-summary"></div>
      <div id="farmSettleList" class="farm-settle-list"><div class="farm-settle-empty">Загрузка…</div></div>
    </div>`;
  document.body.appendChild(d);
  $('farmSettleFrom').value=monthStartIso();$('farmSettleTo').value=todayIso();
  d.querySelector('[data-settle-close]').addEventListener('click',()=>d.close());
  $('farmSettleContract').addEventListener('change',applyContractPeriodBounds);
  $('farmSettleGenerate').addEventListener('click',generateSettlement);
  $('farmSettleReload').addEventListener('click',loadData);
  $('farmSettleList').addEventListener('click',handleListAction);
}
function installButton(){
  if($('farmSettlementsBtn'))return;const actions=document.querySelector('.production-top-actions');if(!actions)return;
  const b=document.createElement('button');b.id='farmSettlementsBtn';b.type='button';b.textContent='💰 Расчёты';b.addEventListener('click',async()=>{ensureDialog();await loadData();$('farmSettlementsDlg').showModal()});actions.insertBefore(b,$('refresh')||null);
}
async function loadPermissions(){const {data,error}=await supabase.rpc('get_my_permissions');if(error)throw error;state.permissions=Array.isArray(data)?data:[]}
async function loadData(){
  if(state.loading)return;state.loading=true;if($('farmSettleError'))$('farmSettleError').textContent='';
  try{
    const [contracts,partners,settlements,lines,jobs]=await Promise.all([
      supabase.from('equipment_contracts').select('id,partner_id,contract_number,contract_type,status,starts_on,ends_on,owner_share_percent,hub_share_percent,calculation_basis,direct_costs_before_split,currency').in('status',['ACTIVE','COMPLETED']).eq('contract_type','REVENUE_SHARE').order('starts_on',{ascending:false}),
      supabase.from('partners').select('id,name,legal_name').order('name'),
      supabase.from('equipment_owner_settlement_overview').select('*').order('period_end',{ascending:false}).limit(200),
      supabase.from('equipment_owner_settlement_lines').select('*').order('completed_at',{ascending:false}).limit(5000),
      supabase.from('production_jobs').select('id,title,order_id,equipment_id').limit(5000)
    ]);
    for(const r of [contracts,partners,settlements,lines,jobs])if(r.error)throw r.error;
    state.contracts=contracts.data||[];state.partners=new Map((partners.data||[]).map(p=>[p.id,p]));state.settlements=settlements.data||[];state.lines=lines.data||[];state.jobs=new Map((jobs.data||[]).map(j=>[j.id,j]));
    fillContracts();render();
  }catch(error){if($('farmSettleError'))$('farmSettleError').textContent=translate(error);console.warn('Owner settlements load failed',error)}finally{state.loading=false}
}
function fillContracts(){
  if(!$('farmSettleContract'))return;const keep=$('farmSettleContract').value;
  $('farmSettleContract').innerHTML=state.contracts.map(c=>{const p=state.partners.get(c.partner_id);return `<option value="${c.id}">${esc(c.contract_number)} · ${esc(p?.name||p?.legal_name||'Владелец')} · ${esc(c.owner_share_percent)}%</option>`}).join('')||'<option value="">Нет активных договоров доли</option>';
  if(keep&&state.contracts.some(c=>c.id===keep))$('farmSettleContract').value=keep;
  $('farmSettleGenerate').disabled=!can('production.settlements.manage')||!state.contracts.length;applyContractPeriodBounds(false);
}
function applyContractPeriodBounds(reset=true){
  if(!$('farmSettleContract'))return;const c=state.contracts.find(x=>x.id===$('farmSettleContract').value);if(!c)return;
  $('farmSettleFrom').min=c.starts_on||'';$('farmSettleFrom').max=c.ends_on||'';$('farmSettleTo').min=c.starts_on||'';$('farmSettleTo').max=c.ends_on||'';
  if(reset){$('farmSettleFrom').value=c.starts_on>monthStartIso()?c.starts_on:monthStartIso();const upper=c.ends_on&&c.ends_on<todayIso()?c.ends_on:todayIso();$('farmSettleTo').value=upper<$('farmSettleFrom').value?$('farmSettleFrom').value:upper;}
}
function render(){
  if(!$('farmSettleList'))return;
  const active=state.settlements.filter(s=>s.status!=='CANCELLED');
  const totals=active.reduce((a,s)=>{a.owner+=Number(s.owner_amount||0);a.hub+=Number(s.hub_amount||0);a.base+=Number(s.split_base||0);return a},{owner:0,hub:0,base:0});
  $('farmSettleSummary').innerHTML=`<article><span>База расчётов</span><strong>${money(totals.base)}</strong></article><article><span>Владельцам</span><strong>${money(totals.owner)}</strong></article><article><span>HUB</span><strong>${money(totals.hub)}</strong></article><article><span>Периодов</span><strong>${active.length}</strong></article>`;
  $('farmSettleList').innerHTML=state.settlements.map(s=>{
    const lines=state.lines.filter(l=>l.settlement_id===s.id);const canManage=can('production.settlements.manage');const actions=[];
    if(canManage&&s.status==='DRAFT')actions.push(`<button data-settle-status="APPROVED" data-id="${s.id}" type="button">Согласовать</button>`,`<button data-settle-status="CANCELLED" data-id="${s.id}" type="button">Отменить</button>`);
    if(canManage&&s.status==='APPROVED')actions.push(`<button class="paid" data-settle-status="PAID" data-id="${s.id}" type="button">Отметить выплату</button>`,`<button data-settle-status="CANCELLED" data-id="${s.id}" type="button">Отменить</button>`);
    const direct=s.direct_costs_before_split?' · расходы до деления':'';
    return `<article class="farm-settle-card"><div class="farm-settle-card-head"><div><b>${esc(s.contract_number)} · ${esc(s.partner_name)}</b><small>${esc(s.period_start)} — ${esc(s.period_end)} · ${esc(basisLabels[s.calculation_basis]||s.calculation_basis)}${direct}</small></div><span class="farm-settle-status ${String(s.status).toLowerCase()}">${esc(statusLabels[s.status]||s.status)}</span></div><div class="farm-settle-metrics"><span>Выручка операций <b>${money(s.gross_revenue,s.currency)}</b></span><span>Получено <b>${money(s.received_revenue,s.currency)}</b></span><span>Прямые расходы <b>${money(s.direct_costs,s.currency)}</b></span><span>База <b>${money(s.split_base,s.currency)}</b></span><span>Владельцу ${esc(s.owner_share_percent)}% <b>${money(s.owner_amount,s.currency)}</b></span><span>HUB ${esc(s.hub_share_percent)}% <b>${money(s.hub_amount,s.currency)}</b></span><span>Заданий <b>${s.jobs_count||lines.length}</b></span></div>${lines.length?`<details><summary>Показать задания</summary><div class="farm-settle-lines">${lines.map(l=>{const j=state.jobs.get(l.production_job_id);return `<div><span>${esc(j?.title||l.production_job_id)}</span><b>${money(l.owner_amount,s.currency)} владельцу</b><small>операция ${money(l.operation_revenue,s.currency)} · получено ${money(l.received_revenue,s.currency)} · расходы ${money(l.direct_costs,s.currency)} · база ${money(l.split_base,s.currency)}</small></div>`}).join('')}</div></details>`:''}${actions.length?`<div class="farm-settle-actions">${actions.join('')}</div>`:''}${s.status==='PAID'?`<div class="farm-settle-paid-ref">Выплачено ${esc(s.paid_at||'')} ${s.payment_reference?`· ${esc(s.payment_reference)}`:''}</div>`:''}</article>`;
  }).join('')||'<div class="farm-settle-empty">Расчётных периодов пока нет.</div>';
}
async function generateSettlement(){
  const btn=$('farmSettleGenerate');btn.disabled=true;$('farmSettleError').textContent='';
  try{const {error}=await supabase.rpc('generate_equipment_owner_settlement',{p_contract_id:$('farmSettleContract').value,p_period_start:$('farmSettleFrom').value,p_period_end:$('farmSettleTo').value});if(error)throw error;await loadData()}
  catch(error){$('farmSettleError').textContent=translate(error)}finally{btn.disabled=!can('production.settlements.manage')||!state.contracts.length}
}
async function handleListAction(event){
  const btn=event.target.closest('[data-settle-status]');if(!btn)return;let ref=null;
  if(btn.dataset.settleStatus==='PAID'){
    const row=state.settlements.find(s=>s.id===btn.dataset.id);const required=Number(row?.owner_amount||0)>0;
    const entered=window.prompt(required?'Номер/основание выплаты (обязательно):':'Номер/основание выплаты:','');
    if(entered===null)return;ref=entered.trim()||null;if(required&&!ref){$('farmSettleError').textContent='Для выплаты владельцу укажите номер или основание платежа.';return;}
  }
  btn.disabled=true;$('farmSettleError').textContent='';
  try{const {error}=await supabase.rpc('set_equipment_owner_settlement_status',{p_settlement_id:btn.dataset.id,p_status:btn.dataset.settleStatus,p_payment_reference:ref,p_notes:null});if(error)throw error;await loadData()}
  catch(error){$('farmSettleError').textContent=translate(error)}finally{btn.disabled=false}
}
async function init(){try{await loadPermissions();if(!can('production.settlements.view'))return;installStyle();ensureDialog();installButton()}catch(error){console.warn('Owner settlements unavailable',error)}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();