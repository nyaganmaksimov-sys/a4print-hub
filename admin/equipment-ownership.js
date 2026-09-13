import {supabase} from './guard.js?v=20260905-netfix1';

const esc=value=>String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=value=>Number(value||0).toLocaleString('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2});
const date=value=>value?new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString('ru-RU'):'—';
const num=value=>value===''||value==null?null:Number(value);
const ownLabels={HUB:'Собственность HUB',PARTNER:'Оборудование партнёра',LEASE:'Аренда',LEASE_BUYOUT:'Аренда с выкупом',OTHER:'Иное'};
const opLabels={FREE:'Свободно',WORKING:'В работе',QUEUED:'В очереди',MAINTENANCE:'ТО',REPAIR:'Ремонт',FAULT:'Неисправность',WAITING_PARTS:'Ожидание запчастей',OFFLINE:'Не используется',RETIRED:'Выведено'};
const contractTypeLabels={REVENUE_SHARE:'Доля с выручки',LEASE:'Аренда',LEASE_BUYOUT:'Аренда с выкупом',LOAN_FOR_USE:'Безвозмездное пользование',OTHER:'Иной'};
const contractStatusLabels={DRAFT:'Черновик',ACTIVE:'Действует',SUSPENDED:'Приостановлен',TERMINATED:'Расторгнут',COMPLETED:'Завершён'};
const state={assets:[],partners:[],contracts:[],links:[],permissions:[],loading:false};

function can(code){return state.permissions.includes(code)}
function partnerName(id){const p=state.partners.find(x=>x.id===id);return p?.legal_name||p?.name||'—'}
function contractAssets(id){return state.links.filter(x=>x.contract_id===id).map(x=>x.equipment_id)}
function activeContractFor(assetId){
  const ids=new Set(state.links.filter(x=>x.equipment_id===assetId).map(x=>x.contract_id));
  return state.contracts.find(c=>ids.has(c.id)&&c.status==='ACTIVE')||null;
}
function pillForAsset(asset){
  const cls=asset.ownership_type==='HUB'?'hub':asset.operational_status==='FAULT'?'bad':asset.operational_status==='REPAIR'||asset.operational_status==='MAINTENANCE'?'warn':'';
  return `<span class="farm-pill ${cls}">${esc(ownLabels[asset.ownership_type]||asset.ownership_type||'HUB')}</span>`;
}
function addStyle(){
  if(document.querySelector('link[data-farm-ownership-style]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='./equipment-ownership.css?v=20260914-1';link.dataset.farmOwnershipStyle='1';document.head.appendChild(link);
}

function ensureWorkspace(){
  if(document.getElementById('farmOwnershipDlg'))return;
  const dlg=document.createElement('dialog');dlg.id='farmOwnershipDlg';dlg.className='farm-owner-dialog';dlg.innerHTML=`
    <div class="farm-owner-shell">
      <header class="farm-owner-head"><div><h2>Собственность и договоры</h2><p>Владельцы оборудования, условия сотрудничества и экономика производственной фермы</p></div><div class="farm-owner-head-actions"><button id="farmRefresh" type="button">↻ Обновить</button><button class="farm-close" id="farmClose" type="button">×</button></div></header>
      <div class="farm-owner-body">
        <div id="farmLoadError"></div>
        <section class="farm-owner-kpis">
          <article class="farm-owner-kpi"><span>Оборудование</span><strong id="farmKpiAll">0</strong><small>в реестре</small></article>
          <article class="farm-owner-kpi"><span>Собственность HUB</span><strong id="farmKpiHub">0</strong><small>без обязательств владельцу</small></article>
          <article class="farm-owner-kpi"><span>Чужое / аренда</span><strong id="farmKpiPartner">0</strong><small>требует договорного учёта</small></article>
          <article class="farm-owner-kpi"><span>Активные договоры</span><strong id="farmKpiContracts">0</strong><small>действуют сейчас</small></article>
        </section>
        <div class="farm-owner-toolbar"><input id="farmSearch" type="search" placeholder="Оборудование, инв. номер, модель, владелец…"><select id="farmOwnershipFilter"><option value="">Любая собственность</option>${Object.entries(ownLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select><select id="farmOperationalFilter"><option value="">Любой рабочий статус</option>${Object.entries(opLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select><button id="farmAddContract" class="farm-primary" type="button">+ Договор</button></div>
        <div class="farm-owner-grid">
          <section class="farm-panel"><div class="farm-panel-head"><div><h3>Оборудование</h3><p>Собственность, рабочий статус и действующий договор</p></div><span id="farmAssetCount" class="farm-pill">0</span></div><div id="farmAssetList" class="farm-panel-body"><div class="farm-owner-empty">Загрузка…</div></div></section>
          <section class="farm-panel"><div class="farm-panel-head"><div><h3>Договоры владельцев</h3><p>Проценты и условия берутся из договора, а не из кода</p></div><span id="farmContractCount" class="farm-pill">0</span></div><div id="farmContractList" class="farm-panel-body"><div class="farm-owner-empty">Загрузка…</div></div></section>
        </div>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  const owner=document.createElement('dialog');owner.id='farmOwnerFormDlg';owner.className='farm-form-dialog';owner.innerHTML=`
    <form id="farmOwnerForm"><div class="farm-form-head"><div><h3 id="farmOwnerTitle">Собственность оборудования</h3><p id="farmOwnerSubtitle"></p></div><button type="button" data-farm-close="farmOwnerFormDlg">×</button></div>
    <div class="farm-form-body"><input id="farmOwnerEquipmentId" type="hidden"><div class="farm-form-grid">
      <label class="farm-field"><span>Форма владения *</span><select id="farmOwnershipType">${Object.entries(ownLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="farm-field"><span>Владелец / партнёр</span><select id="farmOwnerPartner"><option value="">Не выбран</option></select></label>
      <label class="farm-field"><span>Рабочий статус *</span><select id="farmOperationalStatus">${Object.entries(opLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="farm-field"><span>Год выпуска</span><input id="farmManufactureYear" type="number" min="1900" max="2200"></label>
      <label class="farm-field"><span>Рыночная стоимость, ₽</span><input id="farmMarketValue" type="number" min="0" step="0.01"></label>
      <label class="farm-field"><span>Цена аналога / замены, ₽</span><input id="farmAnaloguePrice" type="number" min="0" step="0.01"></label>
      <label class="farm-field"><span>Принято в HUB</span><input id="farmReceivedAt" type="date"></label>
      <label class="farm-field"><span>Введено в эксплуатацию</span><input id="farmCommissionedAt" type="date"></label>
      <label class="farm-field"><span>Внутренняя себестоимость часа, ₽</span><input id="farmInternalHourCost" type="number" min="0" step="0.01"></label>
      <label class="farm-field"><span>Производственная цена часа, ₽</span><input id="farmProductionHourPrice" type="number" min="0" step="0.01"></label>
      <label class="farm-field"><span>Средняя мощность, кВт</span><input id="farmAveragePower" type="number" min="0" step="0.001"></label>
      <label class="farm-field"><span>Максимальная мощность, кВт</span><input id="farmMaxPower" type="number" min="0" step="0.001"></label>
      <label class="farm-field"><span>Тариф электричества, ₽/кВт⋅ч</span><input id="farmElectricityTariff" type="number" min="0" step="0.0001"></label>
      <label class="farm-field"><span>Предупреждать о замене при, %</span><input id="farmReplacementPercent" type="number" min="0" max="500" step="0.01" value="80"></label>
      <label class="farm-check full"><input id="farmElectricityDirect" type="checkbox" checked> Электроэнергия учитывается как прямой производственный расход</label>
      <label class="farm-field full"><span>Причина изменения владельца / формы владения</span><textarea id="farmOwnershipReason" placeholder="Заполняется при смене владельца или формы владения"></textarea></label>
    </div><div id="farmOwnerError" class="farm-form-error"></div><div id="farmOwnershipHistory" class="farm-history"></div></div>
    <div class="farm-form-foot"><button type="button" data-farm-close="farmOwnerFormDlg">Отмена</button><button id="farmSaveOwner" class="farm-primary" type="submit">Сохранить</button></div></form>`;
  document.body.appendChild(owner);

  const contract=document.createElement('dialog');contract.id='farmContractFormDlg';contract.className='farm-form-dialog';contract.innerHTML=`
    <form id="farmContractForm"><div class="farm-form-head"><div><h3 id="farmContractTitle">Новый договор</h3><p>Условия расчётов хранятся в договоре и используются следующими этапами системы.</p></div><button type="button" data-farm-close="farmContractFormDlg">×</button></div>
    <div class="farm-form-body"><input id="farmContractId" type="hidden"><div class="farm-form-grid">
      <label class="farm-field full"><span>Владелец / партнёр *</span><select id="farmContractPartner" required></select></label>
      <label class="farm-field"><span>Номер договора *</span><input id="farmContractNumber" required></label>
      <label class="farm-field"><span>Тип договора *</span><select id="farmContractType">${Object.entries(contractTypeLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="farm-field"><span>Статус</span><select id="farmContractStatus">${Object.entries(contractStatusLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="farm-field"><span>Начало *</span><input id="farmContractStart" type="date" required></label>
      <label class="farm-field"><span>Окончание</span><input id="farmContractEnd" type="date"></label>
      <label class="farm-field"><span>Доля HUB, %</span><input id="farmHubShare" type="number" min="0" max="100" step="0.01" value="70"></label>
      <label class="farm-field"><span>Доля владельца, %</span><input id="farmOwnerShare" type="number" min="0" max="100" step="0.01" value="30"></label>
      <label class="farm-field"><span>Расчётная база</span><select id="farmCalculationBasis"><option value="RECEIVED_REVENUE">Фактически полученная выручка</option><option value="OPERATION_REVENUE">Выручка производственной операции</option><option value="NET_AFTER_DIRECT_COSTS">После прямых расходов</option></select></label>
      <label class="farm-field"><span>Периодичность расчётов</span><select id="farmSettlementFrequency"><option value="MONTHLY">Ежемесячно</option><option value="WEEKLY">Еженедельно</option><option value="ON_DEMAND">По требованию</option><option value="OTHER">Иная</option></select></label>
      <label class="farm-field"><span>День расчёта (1–28)</span><input id="farmSettlementDay" type="number" min="1" max="28"></label>
      <label class="farm-field"><span>Кто отвечает за ремонт</span><select id="farmRepairResponsibility"><option value="BY_AGREEMENT">По договорённости</option><option value="HUB">HUB</option><option value="OWNER">Владелец</option><option value="SHARED">Совместно</option></select></label>
      <label class="farm-field"><span>Уведомление о расторжении, дней</span><input id="farmTerminationNotice" type="number" min="0" value="30"></label>
      <label class="farm-field"><span>Валюта</span><input id="farmContractCurrency" value="RUB" maxlength="3"></label>
      <label class="farm-check full"><input id="farmDirectCostsBeforeSplit" type="checkbox"> Вычитать прямые расходы до распределения долей</label>
      <label class="farm-check full"><input id="farmBuyoutEnabled" type="checkbox"> Договор предусматривает последующий выкуп оборудования</label>
      <label class="farm-field full"><span>Цена выкупа, ₽</span><input id="farmBuyoutPrice" type="number" min="0" step="0.01"></label>
      <div class="farm-field full"><span>Оборудование по договору</span><div id="farmContractAssets" class="farm-assets-checks"></div></div>
      <label class="farm-field full"><span>Условия / примечание</span><textarea id="farmContractNotes"></textarea></label>
    </div><div id="farmContractError" class="farm-form-error"></div></div>
    <div class="farm-form-foot"><button type="button" data-farm-close="farmContractFormDlg">Отмена</button><button id="farmSaveContract" class="farm-primary" type="submit">Сохранить договор</button></div></form>`;
  document.body.appendChild(contract);

  document.querySelectorAll('[data-farm-close]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.farmClose)?.close()));
  document.getElementById('farmClose').addEventListener('click',()=>dlg.close());
  document.getElementById('farmRefresh').addEventListener('click',load);
  document.getElementById('farmSearch').addEventListener('input',render);
  document.getElementById('farmOwnershipFilter').addEventListener('change',render);
  document.getElementById('farmOperationalFilter').addEventListener('change',render);
  document.getElementById('farmAddContract').addEventListener('click',()=>openContract());
  document.getElementById('farmOwnershipType').addEventListener('change',syncOwnerPartnerRequirement);
  document.getElementById('farmContractType').addEventListener('change',syncContractFields);
  document.getElementById('farmBuyoutEnabled').addEventListener('change',syncContractFields);
  document.getElementById('farmOwnerForm').addEventListener('submit',saveOwner);
  document.getElementById('farmContractForm').addEventListener('submit',saveContract);
  document.addEventListener('click',event=>{
    const ownerBtn=event.target.closest('[data-farm-owner]');if(ownerBtn)openOwner(ownerBtn.dataset.farmOwner);
    const contractBtn=event.target.closest('[data-farm-contract]');if(contractBtn)openContract(contractBtn.dataset.farmContract);
  });
}

function installButton(){
  if(document.getElementById('farmOwnershipBtn'))return;
  const actions=document.querySelector('.topbar .eq-actions');if(!actions)return;
  const button=document.createElement('button');button.id='farmOwnershipBtn';button.type='button';button.className='farm-owner-btn';button.textContent='⚙ Собственность и договоры';
  button.addEventListener('click',async()=>{ensureWorkspace();document.getElementById('farmOwnershipDlg').showModal();await load()});
  actions.insertBefore(button,document.getElementById('refresh')||null);
}

async function loadPermissions(){
  const {data,error}=await supabase.rpc('get_my_permissions');if(error)throw error;state.permissions=Array.isArray(data)?data:[];
}
async function load(){
  if(state.loading)return;state.loading=true;
  const refresh=document.getElementById('farmRefresh');if(refresh){refresh.disabled=true;refresh.textContent='Обновление…'};
  const errorBox=document.getElementById('farmLoadError');if(errorBox)errorBox.innerHTML='';
  try{
    const [assets,partners,contracts,links]=await Promise.all([
      supabase.from('equipment_assets').select('id,inventory_number,name,brand,model,serial_number,status,location,ownership_type,current_owner_partner_id,operational_status,manufacture_year,market_value,received_at,commissioned_at,internal_hour_cost,production_hour_price,average_power_kw,max_power_kw,electricity_tariff,electricity_as_direct_cost,analogue_purchase_price,buy_replacement_warning_percent').order('name'),
      supabase.from('partners').select('id,name,legal_name,tax_id,legal_form,registration_number,is_active').eq('is_active',true).order('name'),
      supabase.from('equipment_contracts').select('*').order('starts_on',{ascending:false}),
      supabase.from('equipment_contract_assets').select('id,contract_id,equipment_id,starts_on,ends_on')
    ]);
    for(const result of [assets,partners,contracts,links])if(result.error)throw result.error;
    state.assets=assets.data||[];state.partners=partners.data||[];state.contracts=contracts.data||[];state.links=links.data||[];
    fillOptions();render();
  }catch(error){console.error('Farm ownership load failed',error);if(errorBox)errorBox.innerHTML=`<div class="farm-load-error">Не удалось загрузить данные: ${esc(error.message||error)}</div>`}
  finally{state.loading=false;if(refresh){refresh.disabled=false;refresh.textContent='↻ Обновить'}}
}
function fillOptions(){
  const partnerOptions='<option value="">Не выбран</option>'+state.partners.map(p=>`<option value="${p.id}">${esc(p.legal_name||p.name)}</option>`).join('');
  const owner=document.getElementById('farmOwnerPartner'),contract=document.getElementById('farmContractPartner');if(owner)owner.innerHTML=partnerOptions;if(contract)contract.innerHTML=partnerOptions;
  const box=document.getElementById('farmContractAssets');if(box)box.innerHTML=state.assets.map(a=>`<label><input type="checkbox" value="${a.id}"><span>${esc(a.inventory_number)} · ${esc(a.name)}</span></label>`).join('')||'<div class="farm-owner-empty">Оборудования нет</div>';
}
function filteredAssets(){
  const q=(document.getElementById('farmSearch')?.value||'').trim().toLowerCase(),ownership=document.getElementById('farmOwnershipFilter')?.value||'',operation=document.getElementById('farmOperationalFilter')?.value||'';
  return state.assets.filter(a=>{
    const text=[a.inventory_number,a.name,a.brand,a.model,a.serial_number,a.location,partnerName(a.current_owner_partner_id)].filter(Boolean).join(' ').toLowerCase();
    return(!q||text.includes(q))&&(!ownership||a.ownership_type===ownership)&&(!operation||a.operational_status===operation);
  });
}
function render(){
  if(!document.getElementById('farmAssetList'))return;
  const visible=filteredAssets();
  document.getElementById('farmKpiAll').textContent=state.assets.length;
  document.getElementById('farmKpiHub').textContent=state.assets.filter(a=>a.ownership_type==='HUB').length;
  document.getElementById('farmKpiPartner').textContent=state.assets.filter(a=>a.ownership_type!=='HUB').length;
  document.getElementById('farmKpiContracts').textContent=state.contracts.filter(c=>c.status==='ACTIVE').length;
  document.getElementById('farmAssetCount').textContent=visible.length;
  document.getElementById('farmContractCount').textContent=state.contracts.length;
  document.getElementById('farmAssetList').innerHTML=visible.map(a=>{
    const c=activeContractFor(a.id),owner=a.current_owner_partner_id?partnerName(a.current_owner_partner_id):'A4PRINT HUB';
    return `<div class="farm-asset"><div class="farm-asset-title"><b>${esc(a.inventory_number)} · ${esc(a.name)}</b><small>${esc([a.brand,a.model,a.location].filter(Boolean).join(' · ')||'без дополнительных данных')}</small></div><div>${pillForAsset(a)}<div style="margin-top:4px"><span class="farm-pill ${['FAULT'].includes(a.operational_status)?'bad':['REPAIR','MAINTENANCE','WAITING_PARTS'].includes(a.operational_status)?'warn':''}">${esc(opLabels[a.operational_status]||a.operational_status)}</span></div></div><div class="farm-asset-owner"><span>Владелец</span><b>${esc(owner)}</b><small>${c?`Договор ${esc(c.contract_number)}`:'Договор не привязан'}</small></div><div class="farm-row-actions">${can('equipment.ownership.manage')?`<button data-farm-owner="${a.id}" type="button">Настроить</button>`:''}</div></div>`;
  }).join('')||'<div class="farm-owner-empty">Ничего не найдено</div>';

  document.getElementById('farmContractList').innerHTML=state.contracts.map(c=>{
    const assetIds=contractAssets(c.id),assets=state.assets.filter(a=>assetIds.includes(a.id));
    return `<div class="farm-contract"><div class="farm-contract-top"><div><b>${esc(c.contract_number)} · ${esc(contractTypeLabels[c.contract_type]||c.contract_type)}</b><br><small>${esc(partnerName(c.partner_id))}</small></div><span class="farm-pill ${c.status==='ACTIVE'?'hub':c.status==='TERMINATED'?'bad':'warn'}">${esc(contractStatusLabels[c.status]||c.status)}</span></div><div class="farm-contract-meta"><div><span>Доли</span><strong>${Number(c.hub_share_percent||0)}% HUB / ${Number(c.owner_share_percent||0)}% владелец</strong></div><div><span>Период</span><strong>${date(c.starts_on)} — ${c.ends_on?date(c.ends_on):'без срока'}</strong></div><div><span>Оборудование</span><strong>${assets.length}</strong></div><div><span>Выкуп</span><strong>${c.buyout_enabled?money(c.buyout_price):'нет'}</strong></div></div>${can('equipment.contracts.manage')?`<div class="farm-contract-actions"><button data-farm-contract="${c.id}" type="button">Изменить</button></div>`:''}</div>`;
  }).join('')||'<div class="farm-owner-empty">Договоров пока нет</div>';
  document.getElementById('farmAddContract').hidden=!can('equipment.contracts.manage');
}

function syncOwnerPartnerRequirement(){
  const type=document.getElementById('farmOwnershipType').value,select=document.getElementById('farmOwnerPartner');
  select.disabled=type==='HUB';select.required=['PARTNER','LEASE','LEASE_BUYOUT'].includes(type);if(type==='HUB')select.value='';
}
async function openOwner(id){
  const a=state.assets.find(x=>x.id===id);if(!a||!can('equipment.ownership.manage'))return;
  document.getElementById('farmOwnerEquipmentId').value=a.id;document.getElementById('farmOwnerTitle').textContent=`${a.inventory_number} · ${a.name}`;document.getElementById('farmOwnerSubtitle').textContent='Собственность, рабочий статус и производственная экономика оборудования.';
  document.getElementById('farmOwnershipType').value=a.ownership_type||'HUB';document.getElementById('farmOwnerPartner').value=a.current_owner_partner_id||'';document.getElementById('farmOperationalStatus').value=a.operational_status||'FREE';
  document.getElementById('farmManufactureYear').value=a.manufacture_year??'';document.getElementById('farmMarketValue').value=a.market_value??'';document.getElementById('farmAnaloguePrice').value=a.analogue_purchase_price??'';document.getElementById('farmReceivedAt').value=a.received_at||'';document.getElementById('farmCommissionedAt').value=a.commissioned_at||'';
  document.getElementById('farmInternalHourCost').value=a.internal_hour_cost??'';document.getElementById('farmProductionHourPrice').value=a.production_hour_price??'';document.getElementById('farmAveragePower').value=a.average_power_kw??'';document.getElementById('farmMaxPower').value=a.max_power_kw??'';document.getElementById('farmElectricityTariff').value=a.electricity_tariff??'';document.getElementById('farmElectricityDirect').checked=a.electricity_as_direct_cost!==false;document.getElementById('farmReplacementPercent').value=a.buy_replacement_warning_percent??80;document.getElementById('farmOwnershipReason').value='';document.getElementById('farmOwnerError').textContent='';syncOwnerPartnerRequirement();
  document.getElementById('farmOwnershipHistory').innerHTML='<h4>История владения</h4><div class="farm-muted">Загрузка…</div>';
  document.getElementById('farmOwnerFormDlg').showModal();
  const {data,error}=await supabase.from('equipment_ownership_history').select('id,ownership_type,partner_id,valid_from,valid_to,reason').eq('equipment_id',id).order('valid_from',{ascending:false}).limit(20);
  if(error){document.getElementById('farmOwnershipHistory').innerHTML='<h4>История владения</h4><div class="farm-muted">История недоступна</div>';return}
  document.getElementById('farmOwnershipHistory').innerHTML='<h4>История владения</h4>'+((data||[]).map(h=>`<div class="farm-history-row"><span><b>${esc(ownLabels[h.ownership_type]||h.ownership_type)}</b>${h.partner_id?` · ${esc(partnerName(h.partner_id))}`:''}<br><span class="farm-muted">${esc(h.reason||'Без комментария')}</span></span><span>${new Date(h.valid_from).toLocaleString('ru-RU')}${h.valid_to?` → ${new Date(h.valid_to).toLocaleString('ru-RU')}`:' → сейчас'}</span></div>`).join('')||'<div class="farm-muted">Истории пока нет</div>');
}
async function saveOwner(event){
  event.preventDefault();const button=document.getElementById('farmSaveOwner');button.disabled=true;document.getElementById('farmOwnerError').textContent='';
  const ownership=document.getElementById('farmOwnershipType').value,partner=document.getElementById('farmOwnerPartner').value||null;
  if(['PARTNER','LEASE','LEASE_BUYOUT'].includes(ownership)&&!partner){document.getElementById('farmOwnerError').textContent='Для выбранной формы владения укажите владельца.';button.disabled=false;return}
  try{
    const {error}=await supabase.rpc('save_equipment_ownership',{
      p_equipment_id:document.getElementById('farmOwnerEquipmentId').value,p_ownership_type:ownership,p_owner_partner_id:partner,p_operational_status:document.getElementById('farmOperationalStatus').value,
      p_manufacture_year:num(document.getElementById('farmManufactureYear').value),p_market_value:num(document.getElementById('farmMarketValue').value),p_received_at:document.getElementById('farmReceivedAt').value||null,p_commissioned_at:document.getElementById('farmCommissionedAt').value||null,
      p_internal_hour_cost:num(document.getElementById('farmInternalHourCost').value),p_production_hour_price:num(document.getElementById('farmProductionHourPrice').value),p_average_power_kw:num(document.getElementById('farmAveragePower').value),p_max_power_kw:num(document.getElementById('farmMaxPower').value),
      p_electricity_tariff:num(document.getElementById('farmElectricityTariff').value),p_electricity_as_direct_cost:document.getElementById('farmElectricityDirect').checked,p_analogue_purchase_price:num(document.getElementById('farmAnaloguePrice').value),p_buy_replacement_warning_percent:num(document.getElementById('farmReplacementPercent').value)??80,p_reason:document.getElementById('farmOwnershipReason').value.trim()||null
    });
    if(error)throw error;document.getElementById('farmOwnerFormDlg').close();await load();document.getElementById('refresh')?.click();
  }catch(error){document.getElementById('farmOwnerError').textContent=error.message||String(error)}finally{button.disabled=false}
}

function syncContractFields(){
  const type=document.getElementById('farmContractType').value,buyout=document.getElementById('farmBuyoutEnabled');if(type==='LEASE_BUYOUT')buyout.checked=true;
  document.getElementById('farmBuyoutPrice').disabled=!buyout.checked;document.getElementById('farmBuyoutPrice').required=buyout.checked;
  const shareMode=type==='REVENUE_SHARE';document.getElementById('farmHubShare').disabled=!shareMode;document.getElementById('farmOwnerShare').disabled=!shareMode;
}
function openContract(id=''){
  if(!can('equipment.contracts.manage'))return;const c=state.contracts.find(x=>x.id===id)||null;const form=document.getElementById('farmContractForm');form.reset();
  document.getElementById('farmContractId').value=c?.id||'';document.getElementById('farmContractTitle').textContent=c?`Договор ${c.contract_number}`:'Новый договор владельца';
  document.getElementById('farmContractPartner').value=c?.partner_id||'';document.getElementById('farmContractNumber').value=c?.contract_number||'';document.getElementById('farmContractType').value=c?.contract_type||'REVENUE_SHARE';document.getElementById('farmContractStatus').value=c?.status||'DRAFT';document.getElementById('farmContractStart').value=c?.starts_on||new Date().toISOString().slice(0,10);document.getElementById('farmContractEnd').value=c?.ends_on||'';
  document.getElementById('farmHubShare').value=c?.hub_share_percent??70;document.getElementById('farmOwnerShare').value=c?.owner_share_percent??30;document.getElementById('farmCalculationBasis').value=c?.calculation_basis||'RECEIVED_REVENUE';document.getElementById('farmDirectCostsBeforeSplit').checked=Boolean(c?.direct_costs_before_split);document.getElementById('farmSettlementFrequency').value=c?.settlement_frequency||'MONTHLY';document.getElementById('farmSettlementDay').value=c?.settlement_day??'';document.getElementById('farmRepairResponsibility').value=c?.repair_responsibility||'BY_AGREEMENT';document.getElementById('farmTerminationNotice').value=c?.early_termination_notice_days??30;document.getElementById('farmBuyoutEnabled').checked=Boolean(c?.buyout_enabled);document.getElementById('farmBuyoutPrice').value=c?.buyout_price??'';document.getElementById('farmContractCurrency').value=c?.currency||'RUB';document.getElementById('farmContractNotes').value=c?.notes||'';
  const selected=new Set(c?contractAssets(c.id):[]);document.querySelectorAll('#farmContractAssets input[type="checkbox"]').forEach(input=>input.checked=selected.has(input.value));document.getElementById('farmContractError').textContent='';syncContractFields();document.getElementById('farmContractFormDlg').showModal();
}
async function saveContract(event){
  event.preventDefault();const button=document.getElementById('farmSaveContract');button.disabled=true;document.getElementById('farmContractError').textContent='';
  try{
    const type=document.getElementById('farmContractType').value,hub=Number(document.getElementById('farmHubShare').value||0),owner=Number(document.getElementById('farmOwnerShare').value||0);
    if(type==='REVENUE_SHARE'&&Math.abs(hub+owner-100)>0.001)throw new Error('Для договора с долей сумма процентов HUB и владельца должна быть 100%.');
    const equipmentIds=[...document.querySelectorAll('#farmContractAssets input[type="checkbox"]:checked')].map(x=>x.value);
    const {error}=await supabase.rpc('save_equipment_contract',{
      p_contract_id:document.getElementById('farmContractId').value||null,p_partner_id:document.getElementById('farmContractPartner').value||null,p_contract_number:document.getElementById('farmContractNumber').value.trim(),p_contract_type:type,p_status:document.getElementById('farmContractStatus').value,p_starts_on:document.getElementById('farmContractStart').value||null,p_ends_on:document.getElementById('farmContractEnd').value||null,
      p_hub_share_percent:hub,p_owner_share_percent:owner,p_calculation_basis:document.getElementById('farmCalculationBasis').value,p_direct_costs_before_split:document.getElementById('farmDirectCostsBeforeSplit').checked,p_settlement_frequency:document.getElementById('farmSettlementFrequency').value,p_settlement_day:num(document.getElementById('farmSettlementDay').value),p_repair_responsibility:document.getElementById('farmRepairResponsibility').value,p_early_termination_notice_days:num(document.getElementById('farmTerminationNotice').value)??30,p_buyout_enabled:document.getElementById('farmBuyoutEnabled').checked,p_buyout_price:num(document.getElementById('farmBuyoutPrice').value),p_currency:document.getElementById('farmContractCurrency').value.trim()||'RUB',p_notes:document.getElementById('farmContractNotes').value.trim()||null,p_equipment_ids:equipmentIds
    });
    if(error)throw error;document.getElementById('farmContractFormDlg').close();await load();
  }catch(error){document.getElementById('farmContractError').textContent=error.message||String(error)}finally{button.disabled=false}
}

async function init(){
  try{await loadPermissions();if(!can('equipment.ownership.manage')&&!can('equipment.contracts.manage'))return;addStyle();installButton()}catch(error){console.warn('Production farm ownership workspace unavailable',error)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
