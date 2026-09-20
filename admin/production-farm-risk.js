import{supabase}from'./guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const dt=v=>v?new Date(v).toLocaleString('ru-RU'):'—';
const money=(v,c='RUB')=>v==null?'':new Intl.NumberFormat('ru-RU',{style:'currency',currency:c||'RUB',maximumFractionDigits:2}).format(Number(v));
const categoryLabel={
  PAYMENT_INTEGRITY:'Integrity выплат',
  PAYMENT_OBLIGATION:'Выплата владельцу',
  CONTRACT_DEADLINE:'Срок договора',
  CONDITION_CLAIM:'Требование по состоянию',
  PARTNER_DISPUTE:'Спор владельца',
  EQUIPMENT_INCIDENT:'Инцидент оборудования'
};
const state={data:null,items:[],assignees:[],assigneesLoaded:false,canAct:false,loading:false,loadingMore:false,pendingReload:false,history:null,page:{offset:0,limit:50,total:0,returned:0,hasMore:false},searchTimer:null,presets:[],presetsLoaded:false,presetsBusy:false};
const triageValues=new Set(['mine','unassigned','ack']);
const severityValues=new Set(['CRITICAL','HIGH','MEDIUM','LOW']);

hydrateFiltersFromUrl();
style();
bind();
bootstrap();

async function bootstrap(){
  const explicit=hasExplicitCockpitFilters();
  await loadPresets();
  if(!explicit){
    const preset=state.presets.find(x=>x.is_default);
    if(preset){
      applyPresetFilters(preset.filters||{});
      syncCockpitUrl();
      setPresetSelection(preset.id);
      setPresetStatus('Применено представление по умолчанию.');
    }
  }else{
    syncPresetSelectionFromFilters();
  }
  await load(true);
}

function style(){
  const s=document.createElement('style');
  s.textContent=`
  .pfr-shell{padding:22px;max-width:1500px;margin:auto}
  .pfr-kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:12px}
  .pfr-kpis article,.pfr-grid article,.pfr-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px}
  .pfr-kpis span,.pfr-kpis small,.pfr-grid span{display:block;color:#64748b}
  .pfr-kpis strong,.pfr-grid strong{display:block;font-size:27px;margin:5px 0}
  .pfr-kpis .critical{border-color:#991b1b}.pfr-kpis .high{border-color:#fecaca}.pfr-kpis .overdue{border-color:#fde68a}
  .pfr-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
  .pfr-grid article{padding:13px}.pfr-grid strong{font-size:22px}
  .pfr-grid a{font-size:12px;text-decoration:none;color:#2563eb;font-weight:800}
  .pfr-toolbar{display:grid;grid-template-columns:minmax(220px,1fr) 210px 170px 190px auto;gap:10px;align-items:center;margin-bottom:14px}
  .pfr-toolbar input,.pfr-toolbar select,.pfr-actions select{border:1px solid #cbd5e1;border-radius:10px;padding:9px;background:#fff}
  .pfr-toolbar label{display:flex;gap:7px;align-items:center}
  .pfr-presets{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:-4px 0 14px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px}
  .pfr-presets select{min-width:230px;max-width:360px;flex:1 1 260px;border:1px solid #cbd5e1;border-radius:10px;padding:9px;background:#fff}
  .pfr-presets button{border:1px solid #cbd5e1;border-radius:9px;padding:8px 10px;background:#fff;color:#0f172a;font-weight:800;font-size:12px;cursor:pointer}
  .pfr-presets button:disabled{opacity:.5;cursor:not-allowed}
  .pfr-presets button.danger{color:#991b1b;border-color:#fecaca}
  .pfr-preset-status{font-size:11px;color:#64748b;flex:1 1 180px;text-align:right}
  .pfr-list{display:grid;gap:9px}
  .pfr-row{border:1px solid #e2e8f0;border-radius:14px;padding:13px;display:grid;grid-template-columns:minmax(0,1.4fr) .55fr .78fr minmax(280px,.9fr);gap:12px;align-items:center}
  .pfr-row.overdue{border-color:#fca5a5;background:#fffafa}
  .pfr-row.acknowledged{box-shadow:inset 3px 0 0 #22c55e}
  .pfr-row h3,.pfr-row p{margin:0}.pfr-row p,.pfr-meta{font-size:12px;color:#64748b}
  .pfr-pill{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:900;margin-right:5px}
  .pfr-pill.CRITICAL{background:#7f1d1d;color:#fff}.pfr-pill.HIGH{background:#fee2e2;color:#991b1b}
  .pfr-pill.MEDIUM{background:#fef3c7;color:#92400e}.pfr-pill.LOW{background:#e0f2fe;color:#075985}
  .pfr-pill.ACK{background:#dcfce7;color:#166534}.pfr-pill.UNASSIGNED{background:#f1f5f9;color:#475569}
  .pfr-due.overdue{color:#b91c1c;font-weight:900}
  .pfr-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .pfr-actions select{min-width:150px;flex:1 1 150px}
  .pfr-actions button,.pfr-open{border:1px solid #cbd5e1;border-radius:9px;padding:8px 10px;background:#fff;color:#0f172a;font-weight:800;font-size:12px}
  .pfr-actions button.primary{background:#0f172a;color:#fff;border-color:#0f172a}
  .pfr-open{display:inline-flex;text-decoration:none;justify-content:center}
  .pfr-age{margin-top:5px;font-size:11px;color:#64748b}
  .pfr-note{margin-top:4px;font-size:11px;color:#475569}
  .pfr-empty{padding:28px;text-align:center;color:#64748b;border:1px dashed #cbd5e1;border-radius:12px}
  .pfr-error{padding:10px 12px;background:#fef2f2;color:#991b1b;border-radius:10px}
  .pfr-info{padding:9px 11px;background:#eff6ff;color:#1e40af;border-radius:10px;margin-bottom:10px;font-size:12px}
  .pfr-page-meta{display:flex;justify-content:space-between;gap:10px;align-items:center;color:#64748b;font-size:12px;margin:0 0 10px}
  .pfr-more{display:flex;justify-content:center;margin-top:12px}.pfr-more button{border:1px solid #cbd5e1;border-radius:10px;padding:9px 15px;background:#fff;color:#0f172a;font-weight:800;cursor:pointer}.pfr-more button:disabled{opacity:.55;cursor:wait}
  .pfr-back{display:inline-flex;text-decoration:none;border:1px solid #cbd5e1;border-radius:10px;padding:9px 12px;color:#0f172a;background:#fff;font-weight:700}
  .pfr-history-dialog{width:min(760px,calc(100vw - 28px));max-height:82vh;border:0;border-radius:18px;padding:0;box-shadow:0 24px 70px rgba(15,23,42,.24)}
  .pfr-history-dialog::backdrop{background:rgba(15,23,42,.42)}
  .pfr-history-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:18px 20px 12px;border-bottom:1px solid #e2e8f0}
  .pfr-history-head h2,.pfr-history-head p{margin:0}.pfr-history-head p{margin-top:4px;color:#64748b;font-size:12px}
  .pfr-history-head button{border:0;background:#f1f5f9;border-radius:9px;width:34px;height:34px;font-size:22px;cursor:pointer}
  .pfr-history-meta{padding:10px 20px;color:#64748b;font-size:12px}
  .pfr-history-list{display:grid;gap:8px;padding:0 20px 20px;overflow:auto;max-height:60vh}
  .pfr-history-item{border:1px solid #e2e8f0;border-radius:12px;padding:11px 13px}
  .pfr-history-item .head{display:flex;justify-content:space-between;gap:10px;align-items:center}
  .pfr-history-item .who,.pfr-history-item .when{font-size:11px;color:#64748b}
  .pfr-history-item .note{margin-top:6px;white-space:pre-wrap;color:#334155;font-size:12px}
  .pfr-history-item .assignment{margin-top:5px;font-size:11px;color:#1d4ed8}
  @media(max-width:1200px){.pfr-kpis{grid-template-columns:repeat(3,1fr)}.pfr-row{grid-template-columns:1fr 1fr}.pfr-row>div:first-child,.pfr-row>.pfr-actions{grid-column:1/-1}}
  @media(max-width:900px){.pfr-grid{grid-template-columns:1fr 1fr}.pfr-toolbar{grid-template-columns:1fr 1fr}.pfr-preset-status{text-align:left}}
  @media(max-width:620px){.pfr-shell{padding:12px}.pfr-kpis,.pfr-grid,.pfr-toolbar,.pfr-row,.pfr-actions{grid-template-columns:1fr}.pfr-presets{align-items:stretch}.pfr-presets select,.pfr-presets button{width:100%;max-width:none}.pfr-row>div:first-child,.pfr-row>.pfr-actions{grid-column:auto}}
  `;
  document.head.appendChild(s);
}

function bind(){
  $('pfrRefresh').onclick=()=>load(true);
  $('pfrLoadMore').onclick=()=>load(false);
  for(const id of['pfrSearch','pfrCategory','pfrSeverity','pfrTriage','pfrOverdueOnly']){
    $(id).addEventListener(id==='pfrSearch'?'input':'change',applyFilters);
  }
  $('pfrList').addEventListener('click',handleListClick);
  $('pfrHistoryClose').onclick=()=>$('pfrHistoryDlg').close();
  $('pfrPreset').addEventListener('change',updatePresetButtons);
  $('pfrPresetApply').onclick=applySelectedPreset;
  $('pfrPresetSave').onclick=saveCurrentPreset;
  $('pfrPresetUpdate').onclick=updateSelectedPreset;
  $('pfrPresetDefault').onclick=toggleSelectedPresetDefault;
  $('pfrPresetDelete').onclick=deleteSelectedPreset;
  $('pfrPresetClear').onclick=clearPresetFilters;
  $('pfrPresetDelete').classList.add('danger');
  window.addEventListener('popstate',()=>{
    hydrateFiltersFromUrl();
    syncPresetSelectionFromFilters();
    load(true);
  });
}

function applyFilters(ev){
  syncCockpitUrl();
  syncPresetSelectionFromFilters();
  clearTimeout(state.searchTimer);
  if(ev?.target?.id==='pfrSearch'){
    state.searchTimer=setTimeout(()=>load(true),250);
  }else{
    load(true);
  }
}

function rpcFilters(offset=0){
  return{
    p_category:$('pfrCategory').value||null,
    p_severity:$('pfrSeverity').value||null,
    p_overdue_only:$('pfrOverdueOnly').checked,
    p_triage:$('pfrTriage').value||null,
    p_search:$('pfrSearch').value.trim().slice(0,120)||null,
    p_limit:state.page.limit,
    p_offset:offset
  };
}

function hydrateFiltersFromUrl(){
  const p=new URLSearchParams(window.location.search);
  const category=p.get('category')||'';
  const severity=(p.get('severity')||'').toUpperCase();
  const triage=p.get('triage')||'';
  $('pfrSearch').value=String(p.get('q')||'').slice(0,120);
  $('pfrCategory').value=Object.prototype.hasOwnProperty.call(categoryLabel,category)?category:'';
  $('pfrSeverity').value=severityValues.has(severity)?severity:'';
  $('pfrTriage').value=triageValues.has(triage)?triage:'';
  $('pfrOverdueOnly').checked=p.get('overdue')==='1';
}

function cockpitStateParams(){
  const p=new URLSearchParams();
  const q=$('pfrSearch').value.trim().slice(0,120);
  const category=$('pfrCategory').value;
  const severity=$('pfrSeverity').value;
  const triage=$('pfrTriage').value;
  if(q)p.set('q',q);
  if(Object.prototype.hasOwnProperty.call(categoryLabel,category))p.set('category',category);
  if(severityValues.has(severity))p.set('severity',severity);
  if(triageValues.has(triage))p.set('triage',triage);
  if($('pfrOverdueOnly').checked)p.set('overdue','1');
  return p;
}

function syncCockpitUrl(){
  const p=cockpitStateParams();
  const next=window.location.pathname+(p.size?'?'+p.toString():'')+window.location.hash;
  window.history.replaceState(null,'',next);
}

function hasExplicitCockpitFilters(){
  const p=new URLSearchParams(window.location.search);
  return ['q','category','severity','triage','overdue'].some(key=>p.has(key));
}

function currentPresetFilters(){
  const filters={};
  const q=$('pfrSearch').value.trim().slice(0,120);
  const category=$('pfrCategory').value;
  const severity=$('pfrSeverity').value;
  const triage=$('pfrTriage').value;
  if(q)filters.q=q;
  if(Object.prototype.hasOwnProperty.call(categoryLabel,category))filters.category=category;
  if(severityValues.has(severity))filters.severity=severity;
  if(triageValues.has(triage))filters.triage=triage;
  if($('pfrOverdueOnly').checked)filters.overdue=true;
  return filters;
}

function applyPresetFilters(filters={}){
  const q=String(filters?.q||'').trim().slice(0,120);
  const category=String(filters?.category||'').toUpperCase();
  const severity=String(filters?.severity||'').toUpperCase();
  const triage=String(filters?.triage||'').toLowerCase();
  $('pfrSearch').value=q;
  $('pfrCategory').value=Object.prototype.hasOwnProperty.call(categoryLabel,category)?category:'';
  $('pfrSeverity').value=severityValues.has(severity)?severity:'';
  $('pfrTriage').value=triageValues.has(triage)?triage:'';
  $('pfrOverdueOnly').checked=filters?.overdue===true;
}

function presetFiltersKey(filters={}){
  const normalized={};
  const q=String(filters?.q||'').trim().slice(0,120);
  const category=String(filters?.category||'').toUpperCase();
  const severity=String(filters?.severity||'').toUpperCase();
  const triage=String(filters?.triage||'').toLowerCase();
  if(q)normalized.q=q;
  if(Object.prototype.hasOwnProperty.call(categoryLabel,category))normalized.category=category;
  if(severityValues.has(severity))normalized.severity=severity;
  if(triageValues.has(triage))normalized.triage=triage;
  if(filters?.overdue===true)normalized.overdue=true;
  return JSON.stringify(normalized);
}

function selectedPreset(){
  const id=$('pfrPreset').value;
  return state.presets.find(x=>x.id===id)||null;
}

function setPresetSelection(id=''){
  const select=$('pfrPreset');
  select.value=state.presets.some(x=>x.id===id)?id:'';
  updatePresetButtons();
}

function syncPresetSelectionFromFilters(){
  if(!state.presetsLoaded)return;
  const key=presetFiltersKey(currentPresetFilters());
  const match=state.presets.find(x=>presetFiltersKey(x.filters||{})===key);
  setPresetSelection(match?.id||'');
}

function updatePresetButtons(){
  const preset=selectedPreset();
  const disabled=state.presetsBusy||!preset;
  $('pfrPresetApply').disabled=disabled;
  $('pfrPresetUpdate').disabled=disabled;
  $('pfrPresetDefault').disabled=disabled;
  $('pfrPresetDelete').disabled=disabled;
  $('pfrPresetSave').disabled=state.presetsBusy;
  $('pfrPresetClear').disabled=state.presetsBusy;
  $('pfrPresetDefault').textContent=preset?.is_default?'Снять по умолчанию':'По умолчанию';
  if(preset){
    setPresetStatus((preset.is_default?'★ По умолчанию · ':'')+'сохранено '+dt(preset.updated_at||preset.created_at));
  }else if(!state.presetsBusy){
    setPresetStatus(state.presets.length?'Выберите представление или сохраните текущее.':'Сохранённых представлений пока нет.');
  }
}

function setPresetStatus(textValue){
  $('pfrPresetStatus').textContent=textValue||'';
}

function renderPresets(selectId=''){
  const select=$('pfrPreset');
  select.innerHTML='<option value="">Сохранённые представления</option>'
    +state.presets.map(p=>'<option value="'+esc(p.id)+'">'+(p.is_default?'★ ':'')+esc(p.name)+'</option>').join('');
  setPresetSelection(selectId);
}

async function loadPresets(selectId=''){
  state.presetsBusy=true;
  updatePresetButtons();
  try{
    const{data,error}=await supabase.rpc('get_my_production_farm_risk_presets');
    if(error)throw error;
    state.presets=Array.isArray(data)?data:[];
    state.presetsLoaded=true;
    renderPresets(selectId);
    return true;
  }catch(e){
    state.presets=[];
    state.presetsLoaded=false;
    renderPresets('');
    setPresetStatus('Пресеты недоступны: '+friendly(e));
    return false;
  }finally{
    state.presetsBusy=false;
    updatePresetButtons();
  }
}

async function savePreset({id=null,name,filters,makeDefault=false}){
  state.presetsBusy=true;
  updatePresetButtons();
  try{
    const{data,error}=await supabase.rpc('save_my_production_farm_risk_preset',{
      p_name:name,
      p_filters:filters,
      p_make_default:Boolean(makeDefault),
      p_preset_id:id
    });
    if(error)throw error;
    await loadPresets(data||id||'');
    setPresetStatus('Представление сохранено.');
    return data||id||null;
  }catch(e){
    setPresetStatus(friendly(e));
    alert(friendly(e));
    return null;
  }finally{
    state.presetsBusy=false;
    updatePresetButtons();
  }
}

async function saveCurrentPreset(){
  const name=prompt('Название представления:','');
  if(name===null)return;
  const clean=name.trim();
  if(!clean)return;
  await savePreset({name:clean,filters:currentPresetFilters(),makeDefault:false});
}

async function updateSelectedPreset(){
  const preset=selectedPreset();
  if(!preset)return;
  const name=prompt('Название представления:',preset.name);
  if(name===null)return;
  const clean=name.trim();
  if(!clean)return;
  await savePreset({
    id:preset.id,
    name:clean,
    filters:currentPresetFilters(),
    makeDefault:Boolean(preset.is_default)
  });
}

async function toggleSelectedPresetDefault(){
  const preset=selectedPreset();
  if(!preset)return;
  await savePreset({
    id:preset.id,
    name:preset.name,
    filters:preset.filters||{},
    makeDefault:!preset.is_default
  });
}

async function deleteSelectedPreset(){
  const preset=selectedPreset();
  if(!preset)return;
  if(!confirm('Удалить представление «'+preset.name+'»?'))return;
  state.presetsBusy=true;
  updatePresetButtons();
  try{
    const{error}=await supabase.rpc('delete_my_production_farm_risk_preset',{p_preset_id:preset.id});
    if(error)throw error;
    await loadPresets('');
    setPresetStatus('Представление удалено.');
  }catch(e){
    setPresetStatus(friendly(e));
    alert(friendly(e));
  }finally{
    state.presetsBusy=false;
    updatePresetButtons();
  }
}

async function applySelectedPreset(){
  const preset=selectedPreset();
  if(!preset)return;
  applyPresetFilters(preset.filters||{});
  syncCockpitUrl();
  setPresetStatus((preset.is_default?'★ ':'')+'Применено «'+preset.name+'».');
  await load(true);
}

async function clearPresetFilters(){
  applyPresetFilters({});
  setPresetSelection('');
  syncCockpitUrl();
  setPresetStatus('Фильтры сброшены.');
  await load(true);
}

function actionableHref(href){
  if(!href)return'#';
  try{
    const u=new URL(href,window.location.href);
    if(u.origin!==window.location.origin)return href;
    const cockpit=cockpitStateParams().toString();
    if(cockpit)u.searchParams.set('cockpit',cockpit);
    else u.searchParams.delete('cockpit');
    return u.href;
  }catch{
    return href;
  }
}

async function load(reset=true){
  if(state.loading||state.loadingMore){
    if(reset)state.pendingReload=true;
    return;
  }
  const offset=reset?0:state.items.length;
  if(reset){
    state.loading=true;
    $('pfrRefresh').disabled=true;
    $('pfrError').innerHTML='';
  }else{
    state.loadingMore=true;
    $('pfrLoadMore').disabled=true;
  }

  try{
    const needAssignees=!state.assigneesLoaded;
    const requests=[
      supabase.rpc('get_production_farm_risk_cockpit_page',rpcFilters(offset))
    ];
    if(needAssignees)requests.push(supabase.rpc('get_production_farm_risk_assignees'));
    const results=await Promise.all(requests);
    const cockpit=results[0];
    if(cockpit.error)throw cockpit.error;

    const data=cockpit.data||{};
    state.data=data;
    const incoming=Array.isArray(data.items)?data.items:[];
    state.items=reset?incoming:[...state.items,...incoming];
    const page=data.page||{};
    state.page={
      offset:Number(page.offset||0),
      limit:Number(page.limit||state.page.limit||50),
      total:Number(page.total||0),
      returned:Number(page.returned||incoming.length),
      hasMore:Boolean(page.has_more)
    };

    if(needAssignees){
      state.assigneesLoaded=true;
      const assignees=results[1];
      if(!assignees?.error){
        state.assignees=Array.isArray(assignees.data)?assignees.data:[];
        state.canAct=true;
      }else{
        state.assignees=[];
        state.canAct=false;
      }
    }

    fillKpis();
    render();
  }catch(e){
    $('pfrError').innerHTML='<div class="pfr-error">'+esc(friendly(e))+'</div>';
  }finally{
    state.loading=false;
    state.loadingMore=false;
    $('pfrRefresh').disabled=false;
    $('pfrLoadMore').disabled=false;
    if(state.pendingReload){
      state.pendingReload=false;
      queueMicrotask(()=>load(true));
    }
  }
}

function fillKpis(){
  const s=state.data?.summary||{};
  $('pfrCritical').textContent=Number(s.critical||0);
  $('pfrHigh').textContent=Number(s.high||0);
  $('pfrOverdue').textContent=Number(s.overdue||0);
  $('pfrTotal').textContent=Number(s.total||0);
  $('pfrUnassigned').textContent=Number(s.unassigned||0);
  $('pfrAcknowledged').textContent=Number(s.acknowledged||0);
  $('pfrIntegrity').textContent=Number(s.payment_integrity||0);
  $('pfrPayments').textContent=Number(s.payment_obligations||0);
  $('pfrContracts').textContent=Number(s.contract_deadlines||0);
  $('pfrClaims').textContent=Number(s.condition_claims||0);
  $('pfrDisputes').textContent=Number(s.partner_disputes||0);
  $('pfrIncidents').textContent=Number(s.equipment_incidents||0);
}

function render(){
  const rows=state.items;
  const banner=state.canAct?'':'<div class="pfr-info">У вас есть доступ к просмотру рисков. Для назначения и ACK нужны управляющие права Production Farm.</div>';
  $('pfrList').innerHTML=banner+(rows.length?rows.map(card).join(''):'<div class="pfr-empty">Активных рисков по выбранному фильтру нет.</div>');

  const filtered=state.data?.filtered_summary||{};
  const total=Number(state.page.total||0);
  const shown=state.items.length;
  const parts=['Найдено '+total,'показано '+shown];
  if(Number(filtered.overdue||0)>0)parts.push('просрочено '+Number(filtered.overdue||0));
  $('pfrPageMeta').textContent=parts.join(' · ');
  $('pfrLoadMore').hidden=!state.page.hasMore;
}

function assigneeOptions(selected){
  return '<option value="">Ответственный</option>'+state.assignees.map(u=>
    '<option value="'+esc(u.id)+'" '+(u.id===selected?'selected':'')+'>'+esc(u.full_name||'Сотрудник')+'</option>'
  ).join('');
}

function ageLabel(minutes){
  const m=Math.max(0,Number(minutes||0));
  if(m<60)return Math.round(m)+' мин';
  if(m<1440)return (m/60).toFixed(m<600?1:0)+' ч';
  return (m/1440).toFixed(m<14400?1:0)+' дн';
}

function card(x){
  const meta=x.meta||{};
  const due=x.due_at?dt(x.due_at):'без срока';
  const amount=x.amount==null?'':money(x.amount,x.currency);
  const assigned=meta.risk_assigned_to||meta.assigned_to||'';
  const assignedName=meta.risk_assigned_to_name||meta.assigned_to_name||'';
  const acknowledged=Boolean(meta.risk_acknowledged);
  const sla=meta.operational_sla_hours!=null?Number(meta.operational_sla_hours):null;
  const age=meta.age_minutes!=null?ageLabel(meta.age_minutes):'—';
  const note=meta.risk_note?'<div class="pfr-note">Последняя заметка: '+esc(meta.risk_note)+'</div>':'';

  const statusBadges=
    '<span class="pfr-pill '+esc(x.severity)+'">'+esc(x.severity||'—')+'</span>'
    +(acknowledged?'<span class="pfr-pill ACK">ACK</span>':'')
    +(!assigned?'<span class="pfr-pill UNASSIGNED">БЕЗ ОТВЕТСТВЕННОГО</span>':'');

  const historyButton='<button type="button" data-risk-history>История</button>';
  const openHref=actionableHref(x.href||'#');
  const controls=state.canAct
    ?'<div class="pfr-actions">'
      +'<select data-risk-assignee>'+assigneeOptions(assigned)+'</select>'
      +'<button type="button" class="primary" data-risk-action="assign">Назначить</button>'
      +(acknowledged?'':'<button type="button" data-risk-action="ack">ACK</button>')
      +'<button type="button" data-risk-action="note">Заметка</button>'
      +historyButton
      +'<a class="pfr-open" href="'+esc(openHref)+'">Открыть →</a>'
      +'</div>'
    :'<div class="pfr-actions">'+historyButton+'<a class="pfr-open" href="'+esc(openHref)+'">Открыть →</a></div>';

  return '<article class="pfr-row '+(x.overdue?'overdue ':'')+(acknowledged?'acknowledged':'')+'" data-category="'+esc(x.category)+'" data-entity-id="'+esc(x.entity_id)+'">'
    +'<div><h3>'+esc(x.title||'Риск')+'</h3>'
    +'<p>'+esc(categoryLabel[x.category]||x.category)+' · '+esc(x.subtitle||'—')+'</p>'
    +'<div class="pfr-meta">'+esc(x.state||'—')+(assignedName?' · ответственный '+esc(assignedName):'')+'</div>'
    +note+'</div>'
    +'<div>'+statusBadges+'<div class="pfr-meta">'+(amount?esc(amount):'')+'</div></div>'
    +'<div><div class="pfr-due '+(x.overdue?'overdue':'')+'">'+(x.overdue?'ПРОСРОЧЕНО · ':'')+esc(due)+'</div>'
    +'<div class="pfr-age">Возраст: '+esc(age)+(sla!=null?' · опер. SLA '+esc(sla)+' ч':'')+'</div></div>'
    +controls
    +'</article>';
}

async function handleListClick(ev){
  const historyBtn=ev.target.closest('button[data-risk-history]');
  if(historyBtn){
    const row=historyBtn.closest('.pfr-row');
    if(row)await openHistory(row);
    return;
  }

  const btn=ev.target.closest('button[data-risk-action]');
  if(!btn)return;
  const row=btn.closest('.pfr-row');
  if(!row)return;

  const action=btn.dataset.riskAction;
  const category=row.dataset.category;
  const entityId=row.dataset.entityId;
  let assignedTo=null;

  if(action==='assign'){
    assignedTo=row.querySelector('[data-risk-assignee]')?.value||null;
    if(!assignedTo){
      alert('Выберите ответственного.');
      return;
    }
  }

  const prompts={
    assign:['Комментарий к назначению:','Назначено из Production Farm risk cockpit'],
    ack:['Комментарий ACK:','Принято в работу из Production Farm risk cockpit'],
    note:['Заметка к риску:','']
  };
  const [label,defaultNote]=prompts[action]||prompts.note;
  const note=prompt(label,defaultNote);
  if(!note)return;

  btn.disabled=true;
  try{
    const actionMap={assign:'ASSIGN',ack:'ACKNOWLEDGE',note:'NOTE'};
    const{error}=await supabase.rpc('apply_production_farm_risk_action',{
      p_category:category,
      p_entity_id:entityId,
      p_action:actionMap[action]||'NOTE',
      p_assigned_to:assignedTo,
      p_note:note
    });
    if(error)throw error;
    await load(true);
  }catch(e){
    alert(friendly(e));
  }finally{
    btn.disabled=false;
  }
}

async function openHistory(row){
  const category=row.dataset.category;
  const entityId=row.dataset.entityId;
  const item=state.items.find(x=>x.category===category&&x.entity_id===entityId);
  const dlg=$('pfrHistoryDlg');
  $('pfrHistoryTitle').textContent=item?.title||'История риска';
  $('pfrHistorySubtitle').textContent=(categoryLabel[category]||category)+' · '+(item?.subtitle||entityId);
  $('pfrHistoryMeta').textContent='Загрузка истории…';
  $('pfrHistoryList').innerHTML='<div class="pfr-empty">Загрузка…</div>';
  state.history={category,entityId};
  if(!dlg.open)dlg.showModal();

  try{
    const{data,error}=await supabase.rpc('get_production_farm_risk_action_history',{
      p_category:category,
      p_entity_id:entityId,
      p_limit:50
    });
    if(error)throw error;
    if(!state.history||state.history.category!==category||state.history.entityId!==entityId)return;
    renderHistory(data||{});
  }catch(e){
    $('pfrHistoryMeta').textContent='';
    $('pfrHistoryList').innerHTML='<div class="pfr-error">'+esc(friendly(e))+'</div>';
  }
}

function renderHistory(data){
  const rows=Array.isArray(data?.actions)?data.actions:[];
  const total=Number(data?.total||0);
  $('pfrHistoryMeta').textContent=total
    ?'Событий: '+total+(total>rows.length?' · показаны последние '+rows.length:'')
    :'История действий пока пуста.';
  $('pfrHistoryList').innerHTML=rows.length?rows.map(historyItem).join('')
    :'<div class="pfr-empty">Для этого риска ещё нет действий cockpit.</div>';
}

function historyItem(x){
  const labels={ASSIGNED:'Назначен ответственный',ACKNOWLEDGED:'Принято в работу',NOTE:'Заметка'};
  const actor=x.acted_by_name||'Сотрудник';
  const assignment=x.action_type==='ASSIGNED'&&x.assigned_to_name
    ?'<div class="assignment">Ответственный: '+esc(x.assigned_to_name)+'</div>':'';
  return '<article class="pfr-history-item">'
    +'<div class="head"><strong>'+esc(labels[x.action_type]||x.action_type||'Действие')+'</strong><span class="when">'+esc(dt(x.created_at))+'</span></div>'
    +'<div class="who">'+esc(actor)+'</div>'
    +assignment
    +'<div class="note">'+esc(x.note||'—')+'</div>'
    +'</article>';
}

function friendly(e){
  const m=String(e?.message||e||'Ошибка');
  const map={
    RISK_NOT_AVAILABLE:'Риск больше не активен или относится к другой организации. Обновите экран.',
    RISK_ASSIGNEE_REQUIRED:'Выберите ответственного.',
    RISK_ASSIGNEE_NOT_AVAILABLE:'Этот сотрудник недоступен для назначения.',
    RISK_ACTION_NOTE_REQUIRED:'Добавьте комментарий к действию.',
    RISK_CATEGORY_INVALID:'Неизвестная категория риска.',
    RISK_ENTITY_REQUIRED:'Не указан объект риска.',
    RISK_PRESET_NAME_INVALID:'Название представления должно содержать от 1 до 60 символов.',
    RISK_PRESET_NAME_EXISTS:'Представление с таким названием уже существует.',
    RISK_PRESET_LIMIT_REACHED:'Можно сохранить не более 20 представлений.',
    RISK_PRESET_NOT_AVAILABLE:'Это представление недоступно или уже удалено.',
    RISK_PRESET_FILTERS_MUST_BE_OBJECT:'Некорректные фильтры представления.',
    RISK_PRESET_FILTER_KEY_INVALID:'Представление содержит неподдерживаемый фильтр.',
    RISK_PRESET_SEARCH_TOO_LONG:'Поиск в представлении слишком длинный.',
    RISK_PRESET_OVERDUE_MUST_BE_BOOLEAN:'Некорректный фильтр просрочки.',
    RISK_TRIAGE_INVALID:'Некорректный triage-фильтр.',
    RISK_SEVERITY_INVALID:'Некорректный приоритет риска.',
    PERMISSION_DENIED:'Недостаточно прав для изменения workflow риска.'
  };
  for(const[k,v]of Object.entries(map))if(m.includes(k))return v;
  return m;
}
