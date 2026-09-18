import {supabase} from './guard.js?v=20260905-netfix1';

const esc=value=>String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=(value,currency='RUB')=>Number(value||0).toLocaleString('ru-RU',{style:'currency',currency:currency||'RUB',maximumFractionDigits:2});
const date=value=>value?new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString('ru-RU'):'—';
const statusLabel={DRAFT:'Черновик',APPROVED:'Согласовано',PAID:'Оплачено',CANCELLED:'Отменено',ACTIVE:'Действует',COMPLETED:'Завершён',SUSPENDED:'Приостановлен',TERMINATED:'Расторгнут'};
const typeLabel={LEASE:'Аренда',LEASE_BUYOUT:'Аренда с выкупом'};
const state={permissions:[],contracts:[],charges:[],allocations:[],links:[],assets:[],selected:null,loading:false};
const can=code=>state.permissions.includes(code);
const canView=()=>can('production.buyout.manage')||can('production.settlements.view');
const canManage=()=>can('production.buyout.manage');

function addStyle(){
  if(document.querySelector('link[data-farm-buyout-style]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='./equipment-buyout.css?v=20260914-1';link.dataset.farmBuyoutStyle='1';document.head.appendChild(link);
  const style=document.createElement('style');style.dataset.farmBuyoutAllocationStyle='1';style.textContent='.farm-buyout-allocation{grid-column:1/-1;border-top:1px solid #e2e8f0;padding-top:10px;margin-top:2px}.farm-buyout-allocation summary{cursor:pointer;font-weight:800;color:#334155}.farm-buyout-allocation-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.farm-buyout-allocation-tag{display:inline-flex;padding:4px 7px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:10px;font-weight:900}.farm-buyout-allocation-tag.frozen{background:#dcfce7;color:#166534}.farm-buyout-allocation-list{display:grid;gap:6px}.farm-buyout-allocation-row{display:grid;grid-template-columns:minmax(160px,1.4fr) repeat(4,minmax(85px,.6fr));gap:8px;padding:8px;border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc;font-size:11px}.farm-buyout-allocation-row b,.farm-buyout-allocation-row span{display:block}.farm-buyout-allocation-row span{color:#64748b}.farm-buyout-allocation-empty{font-size:11px;color:#64748b}@media(max-width:760px){.farm-buyout-allocation-row{grid-template-columns:1fr 1fr}.farm-buyout-allocation-row>div:first-child{grid-column:1/-1}}';document.head.appendChild(style);
}
function monthBounds(){const d=new Date(),start=new Date(d.getFullYear(),d.getMonth(),1),end=new Date(d.getFullYear(),d.getMonth()+1,0);return [start.toISOString().slice(0,10),end.toISOString().slice(0,10)]}
function assetNames(contractId){const ids=state.links.filter(x=>x.contract_id===contractId).map(x=>x.equipment_id);return state.assets.filter(x=>ids.includes(x.id)).map(x=>`${x.inventory_number||'—'} · ${x.name||'Оборудование'}`)}
function contractById(id){return state.contracts.find(x=>x.contract_id===id)||null}
function selectedContract(){return contractById(state.selected)}
function contractCharges(id){return state.charges.filter(x=>x.contract_id===id)}
function statusClass(status){return status==='PAID'||status==='COMPLETED'?'ok':status==='APPROVED'||status==='ACTIVE'?'active':status==='CANCELLED'||status==='TERMINATED'?'bad':'warn'}

function ensureUi(){
  if(document.getElementById('farmBuyoutDlg'))return;
  const dlg=document.createElement('dialog');dlg.id='farmBuyoutDlg';dlg.className='farm-buyout-dialog';dlg.innerHTML=`
    <div class="farm-buyout-shell">
      <header class="farm-buyout-head"><div><h2>Аренда и выкуп оборудования</h2><p>Начисления, оплаты, зачёт аренды и переход оборудования в собственность HUB</p></div><div class="farm-buyout-head-actions"><button id="farmBuyoutRefresh" type="button">↻ Обновить</button><button id="farmBuyoutClose" class="farm-buyout-close" type="button">×</button></div></header>
      <div id="farmBuyoutError"></div>
      <div class="farm-buyout-layout"><aside id="farmBuyoutContracts" class="farm-buyout-contracts"></aside><main id="farmBuyoutDetail" class="farm-buyout-detail"><div class="farm-buyout-empty">Выберите договор аренды</div></main></div>
    </div>`;
  document.body.appendChild(dlg);
  document.getElementById('farmBuyoutClose').addEventListener('click',()=>dlg.close());
  document.getElementById('farmBuyoutRefresh').addEventListener('click',load);
  dlg.addEventListener('click',event=>{const card=event.target.closest('[data-buyout-contract]');if(card){state.selected=card.dataset.buyoutContract;render()}});
  document.getElementById('farmBuyoutDetail').addEventListener('click',handleAction);
}

function installButton(){
  if(document.getElementById('farmBuyoutBtn'))return;
  const actions=document.querySelector('.topbar .eq-actions');if(!actions)return;
  const button=document.createElement('button');button.id='farmBuyoutBtn';button.type='button';button.className='farm-buyout-btn';button.textContent='💳 Аренда / выкуп';
  button.addEventListener('click',async()=>{ensureUi();document.getElementById('farmBuyoutDlg').showModal();await load()});
  actions.insertBefore(button,document.getElementById('refresh')||null);
}

async function loadPermissions(){const {data,error}=await supabase.rpc('get_my_permissions');if(error)throw error;state.permissions=Array.isArray(data)?data:[]}
async function load(){
  if(state.loading)return;state.loading=true;
  const refresh=document.getElementById('farmBuyoutRefresh');if(refresh){refresh.disabled=true;refresh.textContent='Обновление…'}
  const errorBox=document.getElementById('farmBuyoutError');if(errorBox)errorBox.innerHTML='';
  try{
    const [contracts,charges,allocations,links,assets]=await Promise.all([
      supabase.from('equipment_buyout_overview').select('*').order('starts_on',{ascending:false}),
      supabase.from('equipment_lease_charges').select('*').order('created_at',{ascending:false}),
      supabase.from('equipment_lease_charge_allocations').select('*'),
      supabase.from('equipment_contract_assets').select('contract_id,equipment_id'),
      supabase.from('equipment_assets').select('id,inventory_number,name,ownership_type,current_owner_partner_id,operational_status')
    ]);
    for(const result of [contracts,charges,allocations,links,assets])if(result.error)throw result.error;
    state.contracts=contracts.data||[];state.charges=charges.data||[];state.allocations=allocations.data||[];state.links=links.data||[];state.assets=assets.data||[];
    if(!state.selected||!contractById(state.selected))state.selected=state.contracts[0]?.contract_id||null;
    render();
  }catch(error){console.error('Lease/buyout load failed',error);if(errorBox)errorBox.innerHTML=`<div class="farm-buyout-error">Не удалось загрузить аренду и выкуп: ${esc(error.message||error)}</div>`}
  finally{state.loading=false;if(refresh){refresh.disabled=false;refresh.textContent='↻ Обновить'}}
}

function render(){
  const list=document.getElementById('farmBuyoutContracts'),detail=document.getElementById('farmBuyoutDetail');if(!list||!detail)return;
  list.innerHTML=`<div class="farm-buyout-list-head"><b>Договоры</b><span>${state.contracts.length}</span></div>`+(state.contracts.map(c=>`<button type="button" class="farm-buyout-contract ${state.selected===c.contract_id?'selected':''}" data-buyout-contract="${c.contract_id}"><span><b>${esc(c.contract_number)}</b><small>${esc(c.partner_name||'Партнёр')}</small></span><span class="farm-buyout-pill ${statusClass(c.status)}">${esc(statusLabel[c.status]||c.status)}</span><em>${esc(typeLabel[c.contract_type]||c.contract_type)}</em></button>`).join('')||'<div class="farm-buyout-empty">Договоров аренды пока нет</div>');
  const c=selectedContract();if(!c){detail.innerHTML='<div class="farm-buyout-empty">Выберите договор аренды</div>';return}
  const assets=assetNames(c.contract_id),charges=contractCharges(c.contract_id),remaining=Number(c.buyout_remaining||0),price=Number(c.buyout_price||0),credit=Number(c.buyout_credited||0),progress=price>0?Math.min(100,Math.max(0,credit/price*100)):0;
  detail.innerHTML=`
    <section class="farm-buyout-summary"><div><span>${esc(typeLabel[c.contract_type]||c.contract_type)}</span><h3>${esc(c.contract_number)} · ${esc(c.partner_name||'Партнёр')}</h3><p>${date(c.starts_on)} — ${c.ends_on?date(c.ends_on):'без срока'} · ${assets.length} ед. оборудования</p></div><span class="farm-buyout-pill ${statusClass(c.status)}">${esc(statusLabel[c.status]||c.status)}</span></section>
    <section class="farm-buyout-kpis">
      <article><span>Аренда за период</span><strong>${money(c.lease_period_amount,c.currency)}</strong><small>зачёт ${Number(c.buyout_credit_percent||0)}%</small></article>
      <article><span>Оплачено аренды</span><strong>${money(c.lease_paid,c.currency)}</strong><small>по закрытым начислениям</small></article>
      <article><span>Зачтено в выкуп</span><strong>${money(c.buyout_credited,c.currency)}</strong><small>${c.contract_type==='LEASE_BUYOUT'?`из ${money(c.buyout_price,c.currency)}`:'выкуп не предусмотрен'}</small></article>
      <article><span>Остаток выкупа</span><strong>${c.contract_type==='LEASE_BUYOUT'?money(remaining,c.currency):'—'}</strong><small>${c.buyout_completed_at?'выкуп завершён':'к оплате'}</small></article>
    </section>
    ${c.contract_type==='LEASE_BUYOUT'?`<section class="farm-buyout-progress"><div><span>Прогресс выкупа</span><b>${progress.toFixed(1)}%</b></div><progress max="100" value="${progress}"></progress></section>`:''}
    <section class="farm-buyout-assets"><h4>Оборудование по договору</h4><div>${assets.map(x=>`<span>${esc(x)}</span>`).join('')||'<span>Не привязано</span>'}</div></section>
    ${canManage()&&c.status!=='COMPLETED'&&c.status!=='TERMINATED'?`<section class="farm-buyout-actions"><button type="button" data-buyout-action="terms">⚙ Условия аренды</button><button type="button" data-buyout-action="charge">+ Начислить аренду</button>${c.contract_type==='LEASE_BUYOUT'?`<button type="button" data-buyout-action="extra">+ Платёж в выкуп</button>${remaining<=0.009&&!c.buyout_completed_at?'<button class="primary" type="button" data-buyout-action="complete">✓ Завершить выкуп</button>':''}`:''}</section>`:''}
    <section class="farm-buyout-ledger"><div class="farm-buyout-section-head"><div><h4>Начисления и платежи</h4><p>Все изменения статуса выполняются серверными RPC.</p></div><span>${charges.length}</span></div>${charges.map(renderCharge).join('')||'<div class="farm-buyout-empty">Начислений пока нет</div>'}</section>`;
}

function allocationRows(ch){
  if(ch?.allocation_snapshot?.schema==='equipment_lease_allocation_v1'){
    return{frozen:true,rows:Array.isArray(ch.allocation_snapshot.allocations)?ch.allocation_snapshot.allocations:[]};
  }
  return{frozen:false,rows:state.allocations.filter(x=>x.charge_id===ch.id)};
}
function allocationAsset(row){
  if(row.inventory_number||row.equipment_name)return{inventory_number:row.inventory_number,name:row.equipment_name};
  return state.assets.find(x=>x.id===row.equipment_id)||{};
}
function renderAllocationDetails(ch){
  if(ch.charge_type!=='LEASE')return'';
  const allocation=allocationRows(ch),rows=allocation.rows;
  const tag=allocation.frozen?'Зафиксировано при согласовании':'Предварительный расчёт';
  const doc=ch.allocation_document_id?'<span class="farm-buyout-allocation-tag frozen">Документ расчёта создан</span>':'';
  return `<details class="farm-buyout-allocation" ${allocation.frozen?'':'open'}><summary>Расшифровка по оборудованию</summary><div class="farm-buyout-allocation-head"><span class="farm-buyout-allocation-tag ${allocation.frozen?'frozen':''}">${tag}</span>${doc}</div><div class="farm-buyout-allocation-list">${rows.length?rows.map(row=>{const a=allocationAsset(row),ratio=Number(row.allocation_ratio||0)*100;return`<div class="farm-buyout-allocation-row"><div><b>${esc(a.inventory_number||'—')} · ${esc(a.name||'Оборудование')}</b><span>${date(row.first_active_on)} — ${date(row.last_active_on)}</span></div><div><b>${Number(row.active_days||0)} дн.</b><span>активно</span></div><div><b>${Number(row.period_count||0)}</b><span>периодов</span></div><div><b>${ratio.toFixed(2)}%</b><span>доля</span></div><div><b>${money(row.allocated_amount,ch.currency)}</b><span>начислено</span></div></div>`}).join(''):'<div class="farm-buyout-allocation-empty">Для этого периода пока нет распределения по оборудованию.</div>'}</div></details>`;
}
function renderCharge(ch){
  const period=ch.charge_type==='LEASE'?`${date(ch.period_start)} — ${date(ch.period_end)}`:'Дополнительный платёж в счёт выкупа';
  const actions=!canManage()||ch.status==='PAID'||ch.status==='CANCELLED'?'':ch.status==='DRAFT'?`<button data-charge-id="${ch.id}" data-charge-status="APPROVED" type="button">Согласовать</button><button data-charge-id="${ch.id}" data-charge-status="CANCELLED" type="button">Отменить</button>`:`<button class="primary" data-charge-id="${ch.id}" data-charge-status="PAID" type="button">Оплачено</button><button data-charge-id="${ch.id}" data-charge-status="CANCELLED" type="button">Отменить</button>`;
  return `<article class="farm-buyout-charge"><div><b>${ch.charge_type==='LEASE'?'Аренда':'Выкуп'}</b><span>${esc(period)}</span><small>${ch.payment_reference?`Платёж: ${esc(ch.payment_reference)}`:esc(ch.notes||'')}</small></div><div class="farm-buyout-charge-money"><strong>${money(ch.amount,ch.currency)}</strong><small>в выкуп ${money(ch.buyout_credit_amount,ch.currency)}</small></div><span class="farm-buyout-pill ${statusClass(ch.status)}">${esc(statusLabel[ch.status]||ch.status)}</span><div class="farm-buyout-row-actions">${actions}</div>${renderAllocationDetails(ch)}</article>`}

async function handleAction(event){
  const action=event.target.closest('[data-buyout-action]')?.dataset.buyoutAction;if(action){if(action==='terms')return editTerms();if(action==='charge')return createLeaseCharge();if(action==='extra')return createExtraPayment();if(action==='complete')return completeBuyout()}
  const button=event.target.closest('[data-charge-status]');if(button)return setChargeStatus(button.dataset.chargeId,button.dataset.chargeStatus);
}
async function rpc(name,args){const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data}
function report(error){console.error(error);const box=document.getElementById('farmBuyoutError');if(box)box.innerHTML=`<div class="farm-buyout-error">${esc(error.message||error)}</div>`}

async function editTerms(){
  const c=selectedContract();if(!c)return;
  const amount=prompt('Арендная плата за расчётный период, ₽',String(Number(c.lease_period_amount||0)));if(amount===null)return;
  const credit=prompt('Какой процент арендной платы засчитывать в выкуп, %',String(Number(c.buyout_credit_percent||0)));if(credit===null)return;
  let price=c.buyout_price;if(c.contract_type==='LEASE_BUYOUT'){price=prompt('Полная цена выкупа, ₽',String(Number(c.buyout_price||0)));if(price===null)return}
  try{await rpc('configure_equipment_lease_terms',{p_contract_id:c.contract_id,p_lease_period_amount:Number(amount),p_buyout_credit_percent:Number(credit),p_buyout_price:c.contract_type==='LEASE_BUYOUT'?Number(price):null});await load()}catch(error){report(error)}
}
async function createLeaseCharge(){
  const c=selectedContract();if(!c)return;const [defStart,defEnd]=monthBounds();
  const start=prompt('Начало периода YYYY-MM-DD',defStart);if(start===null)return;const end=prompt('Конец периода YYYY-MM-DD',defEnd);if(end===null)return;const note=prompt('Комментарий к начислению (необязательно)','')??'';
  try{await rpc('generate_equipment_lease_charge',{p_contract_id:c.contract_id,p_period_start:start,p_period_end:end,p_notes:note||null});await load()}catch(error){report(error)}
}
async function createExtraPayment(){
  const c=selectedContract();if(!c)return;const remaining=Number(c.buyout_remaining||0);const amount=prompt(`Сумма дополнительного платежа в выкуп, максимум ${money(remaining,c.currency)}`,String(remaining));if(amount===null)return;const note=prompt('Комментарий (необязательно)','')??'';
  try{await rpc('record_equipment_buyout_payment',{p_contract_id:c.contract_id,p_amount:Number(amount),p_notes:note||null});await load()}catch(error){report(error)}
}
async function setChargeStatus(id,status){
  let ref=null;if(status==='PAID'){ref=prompt('Номер / основание платежа');if(!ref)return}
  if(status==='CANCELLED'&&!confirm('Отменить это начисление?'))return;
  try{await rpc('set_equipment_lease_charge_status',{p_charge_id:id,p_status:status,p_payment_reference:ref,p_notes:null});await load()}catch(error){report(error)}
}
async function completeBuyout(){
  const c=selectedContract();if(!c)return;if(!confirm('Подтвердить полный выкуп? Оборудование перейдёт в собственность HUB, а договор будет завершён.'))return;
  const ref=prompt('Документ / основание перехода собственности');if(!ref)return;const notes=prompt('Комментарий к выкупу (необязательно)','')??'';
  try{await rpc('complete_equipment_buyout',{p_contract_id:c.contract_id,p_transfer_reference:ref,p_notes:notes||null});await load();document.getElementById('refresh')?.click()}catch(error){report(error)}
}

async function init(){
  try{await loadPermissions();if(!canView())return;addStyle();installButton()}catch(error){console.warn('Lease/buyout workspace unavailable',error)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
