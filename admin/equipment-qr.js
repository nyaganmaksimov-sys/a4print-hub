import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statusLabels={FREE:'Свободен',WORKING:'В работе',QUEUED:'В очереди',MAINTENANCE:'Обслуживание',REPAIR:'Ремонт',BROKEN:'Неисправен',WAITING_PARTS:'Ожидает запчасти',OFFLINE:'Отключён'};
const jobLabels={NEW:'Новое',QUEUED:'В очереди',IN_PROGRESS:'В работе',PAUSED:'Пауза',DONE:'Готово'};
const state={permissions:[],detailId:null,asset:null,jobs:[],actionBusy:false};
const notify=(tone,title,message,options={})=>{if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});const method=tone==='error'?'error':tone==='warning'?'warn':'log';console[method]('[A4PRINT HUB]',title,message)};

const can=code=>state.permissions.includes(code);
const canEquipmentView=()=>can('equipment.view')||can('equipment.manage')||can('equipment.repair')||can('production.view')||can('production.manage');
const canProductionView=()=>can('production.view')||can('production.manage');
const canProductionManage=()=>can('production.manage');
const canService=()=>can('equipment.manage')||can('equipment.repair');
const canIncident=()=>can('production.manage')||can('equipment.repair');

function injectStyle(){
  if(document.getElementById('equipmentQrStyle'))return;
  const s=document.createElement('style');s.id='equipmentQrStyle';s.textContent=`
    .eq-qr-mini{border:1px solid #d7e2ea;background:#fff;border-radius:9px;padding:6px 9px;font-size:11px;font-weight:900;color:#334155;cursor:pointer}
    .eq-asset .eq-qr-mini{margin-left:auto;align-self:flex-start}
    .eq-qr-quick{margin-top:14px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:14px;padding:14px}
    .eq-qr-quick-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
    .eq-qr-quick-head h4{margin:0;font-size:15px}.eq-qr-quick-head small{display:block;color:#64748b;margin-top:3px}
    .eq-qr-job{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:10px 12px;border-radius:11px;background:#fff;border:1px solid #e2e8f0}
    .eq-qr-job b{display:block;color:#0f172a}.eq-qr-job small{display:block;color:#64748b;margin-top:3px}
    .eq-qr-badge{font-size:11px;font-weight:900;padding:5px 8px;border-radius:999px;background:#e2e8f0;color:#334155}
    .eq-qr-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .eq-qr-actions button,.eq-qr-actions a{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:800;text-decoration:none;cursor:pointer}
    .eq-qr-actions .primary{background:#0f172a;color:#fff;border-color:#0f172a}.eq-qr-actions .danger{color:#991b1b;border-color:#fecaca;background:#fff7f7}
    .eq-qr-actions button:disabled{opacity:.55;cursor:not-allowed}
    .eq-qr-dialog{border:0;border-radius:18px;padding:0;width:min(460px,calc(100vw - 24px));box-shadow:0 24px 70px rgba(15,23,42,.28)}
    .eq-qr-dialog::backdrop{background:rgba(15,23,42,.48)}
    .eq-qr-dialog-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:16px 18px;border-bottom:1px solid #e2e8f0}
    .eq-qr-dialog-head h3{margin:0}.eq-qr-dialog-head p{margin:4px 0 0;color:#64748b;font-size:12px}
    .eq-qr-close{border:0;background:#f1f5f9;border-radius:9px;width:34px;height:34px;font-size:20px;cursor:pointer}
    .eq-qr-dialog-body{padding:18px}.eq-qr-code{display:flex;justify-content:center;align-items:center;min-height:260px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:10px}
    .eq-qr-code canvas,.eq-qr-code img{max-width:240px!important;max-height:240px!important}
    .eq-qr-link{margin-top:10px;padding:9px;border-radius:9px;background:#f8fafc;color:#475569;font-size:11px;word-break:break-all}
    .eq-qr-dialog-actions{display:flex;gap:8px;flex-wrap:wrap;padding:0 18px 18px}.eq-qr-dialog-actions button{flex:1 1 120px;border:1px solid #cbd5e1;background:#fff;border-radius:9px;padding:9px;font-weight:800;cursor:pointer}
    .eq-qr-complete-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.eq-qr-complete-grid label{display:grid;gap:5px;font-size:11px;color:#64748b}.eq-qr-complete-grid input,.eq-qr-complete-note{border:1px solid #cbd5e1;border-radius:9px;padding:9px;width:100%}
    .eq-qr-error{margin-top:9px;color:#b91c1c;font-size:12px}
    @media(max-width:620px){.eq-qr-quick{margin-left:-2px;margin-right:-2px}.eq-qr-actions>*{flex:1 1 calc(50% - 8px)}.eq-qr-complete-grid{grid-template-columns:1fr}.eq-qr-dialog-actions button{flex-basis:100%}}
    @media print{body>*{display:none!important}}
  `;document.head.appendChild(s);
}

function equipmentUrl(id){
  const u=new URL('./equipment.html',window.location.href);
  u.search='';
  u.hash='';
  u.searchParams.set('equipment',id);
  u.searchParams.set('qr','1');
  return u.toString();
}

function productionUrl(asset,job){
  const u=new URL('./production.html',window.location.href);
  u.searchParams.set('equipment',asset.id);
  if(job?.id)u.searchParams.set('job',job.id);
  u.searchParams.set('qr','1');
  return u.toString();
}

async function loadPermissions(){
  const {data,error}=await supabase.rpc('get_my_permissions');
  if(error)throw error;
  state.permissions=Array.isArray(data)?data:[];
}

async function getAsset(id){
  const {data,error}=await supabase.from('equipment_assets')
    .select('id,organization_id,inventory_number,name,category,brand,model,location,status,operational_status')
    .eq('id',id).maybeSingle();
  if(error)throw error;
  return data||null;
}

async function loadJobs(id){
  if(!canProductionView()){state.jobs=[];return}
  const {data,error}=await supabase.from('production_operator_overview')
    .select('id,equipment_id,status,title,priority,quantity,good_quantity,scrap_quantity,rework_quantity,operation_type,planned_machine_minutes,actual_machine_minutes,deadline_at,started_at')
    .eq('equipment_id',id)
    .in('status',['NEW','QUEUED','IN_PROGRESS','PAUSED'])
    .order('priority',{ascending:false});
  if(error)throw error;
  state.jobs=data||[];
}

function activeJob(){return state.jobs.find(j=>j.status==='IN_PROGRESS'||j.status==='PAUSED')||null}
function queuedJob(){return state.jobs.find(j=>j.status==='QUEUED'||j.status==='NEW')||null}

function ensureDialogs(){
  if(!$('equipmentQrDlg')){
    const d=document.createElement('dialog');d.id='equipmentQrDlg';d.className='eq-qr-dialog';d.innerHTML=`
      <div class="eq-qr-dialog-head"><div><h3 id="equipmentQrTitle">QR-код оборудования</h3><p id="equipmentQrSubtitle"></p></div><button class="eq-qr-close" data-eq-qr-close="equipmentQrDlg" type="button">×</button></div>
      <div class="eq-qr-dialog-body"><div id="equipmentQrCode" class="eq-qr-code"></div><div id="equipmentQrLink" class="eq-qr-link"></div><div id="equipmentQrError" class="eq-qr-error"></div></div>
      <div class="eq-qr-dialog-actions"><button id="equipmentQrCopy" type="button">Копировать ссылку</button><button id="equipmentQrPrint" type="button">Печать наклейки</button></div>`;
    document.body.appendChild(d);
  }
  if(!$('equipmentQrCompleteDlg')){
    const d=document.createElement('dialog');d.id='equipmentQrCompleteDlg';d.className='eq-qr-dialog';d.innerHTML=`
      <form id="equipmentQrCompleteForm"><div class="eq-qr-dialog-head"><div><h3>Завершить работу</h3><p id="equipmentQrCompleteTitle"></p></div><button class="eq-qr-close" data-eq-qr-close="equipmentQrCompleteDlg" type="button">×</button></div>
      <div class="eq-qr-dialog-body"><div class="eq-qr-complete-grid"><label>Годно<input id="equipmentQrGood" type="number" min="0" step="1" value="0"></label><label>Брак<input id="equipmentQrScrap" type="number" min="0" step="1" value="0"></label><label>Переделка<input id="equipmentQrRework" type="number" min="0" step="1" value="0"></label></div><label style="display:grid;gap:5px;margin-top:10px;font-size:11px;color:#64748b">Комментарий<input id="equipmentQrCompleteNote" class="eq-qr-complete-note" maxlength="1000"></label><div id="equipmentQrCompleteError" class="eq-qr-error"></div></div>
      <div class="eq-qr-dialog-actions"><button type="button" data-eq-qr-close="equipmentQrCompleteDlg">Отмена</button><button class="primary" id="equipmentQrCompleteSave" type="submit">Завершить</button></div></form>`;
    document.body.appendChild(d);
    $('equipmentQrCompleteForm').addEventListener('submit',submitComplete);
  }
  document.querySelectorAll('[data-eq-qr-close]').forEach(b=>{if(!b.dataset.bound){b.dataset.bound='1';b.addEventListener('click',()=>$(b.dataset.eqQrClose)?.close())}});
}

function addGridButtons(){
  document.querySelectorAll('[data-asset]').forEach(card=>{
    if(card.querySelector('[data-equipment-qr]'))return;
    const id=card.dataset.asset,top=card.querySelector('.eq-asset-top');if(!id||!top)return;
    const b=document.createElement('button');b.type='button';b.className='eq-qr-mini';b.dataset.equipmentQr=id;b.textContent='QR';b.title='QR-код оборудования';top.appendChild(b);
  });
}

function detailEquipmentId(){
  return state.detailId||document.querySelector('#detailBody [data-edit-asset]')?.dataset.editAsset||document.querySelector('#detailBody [data-open-service]')?.dataset.openService||null;
}

async function renderQuick(id){
  const root=$('equipmentQrQuick');if(!root)return;
  try{
    const asset=state.asset?.id===id?state.asset:await getAsset(id);
    if(!asset){root.innerHTML='<div class="eq-qr-error">Оборудование недоступно.</div>';return}
    state.asset=asset;
    await loadJobs(id);
    const active=activeJob(),next=queuedJob(),focus=active||next;
    const jobText=focus
      ? `<div class="eq-qr-job"><div><b>${esc(focus.title)}</b><small>${esc([focus.operation_type,focus.status==='PAUSED'?'пауза':jobLabels[focus.status],focus.planned_machine_minutes?`план ${Math.round(Number(focus.planned_machine_minutes))} мин`:'' ].filter(Boolean).join(' · '))}</small></div><span class="eq-qr-badge">${esc(jobLabels[focus.status]||focus.status)}</span></div>`
      : `<div class="eq-qr-job"><div><b>Активного задания нет</b><small>${canProductionView()?'Очередь этого станка пуста':'Нет доступа к производственным заданиям'}</small></div><span class="eq-qr-badge">—</span></div>`;
    const start=canProductionManage()&&focus&&focus.status==='PAUSED'
      ? `<button class="primary" data-eq-qr-action="RESUME" data-job-id="${focus.id}">Продолжить</button>`
      : canProductionManage()&&!active&&next
        ? `<button class="primary" data-eq-qr-action="START" data-job-id="${next.id}">Начать работу</button>`
        : '';
    const complete=canProductionManage()&&active&&active.status==='IN_PROGRESS'
      ? `<button class="primary" data-eq-qr-complete="${active.id}">Завершить</button>`:'';
    root.innerHTML=`
      <div class="eq-qr-quick-head"><div><h4>Быстрые действия по QR</h4><small>${esc(asset.inventory_number||asset.id.slice(0,8))} · ${esc(statusLabels[asset.operational_status]||asset.operational_status||asset.status||'')}</small></div><button class="eq-qr-mini" data-equipment-qr="${asset.id}" type="button">QR-код</button></div>
      ${jobText}
      <div class="eq-qr-actions">
        ${focus?`<a href="${esc(productionUrl(asset,focus))}">Текущее задание</a>`:''}
        ${start}${complete}
        ${canService()?'<button data-eq-qr-service="'+asset.id+'" type="button">Обслуживание</button>':''}
        ${canIncident()?'<button class="danger" data-eq-qr-incident="'+asset.id+'" type="button">⚠ Неисправность</button>':''}
        <button data-eq-qr-refresh="${asset.id}" type="button">↻ Обновить</button>
      </div>`;
  }catch(error){root.innerHTML=`<div class="eq-qr-error">${esc(friendly(error))}</div>`}
}

function enhanceDetail(){
  const body=$('detailBody'),id=detailEquipmentId();if(!body||!id||!uuid.test(id))return;
  state.detailId=id;
  const actions=body.querySelector('.eq-detail-hero .eq-actions');
  if(actions&&!actions.querySelector('[data-equipment-qr]')){
    const b=document.createElement('button');b.type='button';b.className='eq-qr-mini';b.dataset.equipmentQr=id;b.textContent='QR-код';actions.appendChild(b);
  }
  let quick=$('equipmentQrQuick');
  if(!quick){
    quick=document.createElement('section');quick.id='equipmentQrQuick';quick.className='eq-qr-quick';body.querySelector('.eq-detail-hero')?.insertAdjacentElement('afterend',quick);
  }
  if(quick.dataset.equipmentId!==id){
    quick.dataset.equipmentId=id;
    quick.innerHTML='<div class="eq-muted">Загрузка текущего задания…</div>';
    renderQuick(id);
  }
}

function bindRenderEvents(){
  document.addEventListener('a4:equipment-grid-rendered',addGridButtons);
  document.addEventListener('a4:equipment-detail-rendered',enhanceDetail);
  addGridButtons();enhanceDetail();
}

async function openQr(id){
  ensureDialogs();
  try{
    const asset=state.asset?.id===id?state.asset:await getAsset(id);
    if(!asset)throw new Error('EQUIPMENT_NOT_AVAILABLE');
    state.asset=asset;
    const url=equipmentUrl(id),holder=$('equipmentQrCode');
    $('equipmentQrTitle').textContent=asset.inventory_number||'QR-код оборудования';
    $('equipmentQrSubtitle').textContent=[asset.name,asset.location].filter(Boolean).join(' · ');
    $('equipmentQrLink').textContent=url;$('equipmentQrError').textContent='';holder.innerHTML='';
    if(window.QRCode){
      new window.QRCode(holder,{text:url,width:240,height:240,colorDark:'#000000',colorLight:'#ffffff',correctLevel:window.QRCode.CorrectLevel.M});
    }else{
      holder.innerHTML='<div class="eq-qr-error">Библиотека QR не загрузилась. Ссылка доступна ниже.</div>';
    }
    $('equipmentQrCopy').onclick=async()=>{try{await navigator.clipboard.writeText(url);$('equipmentQrCopy').textContent='Скопировано ✓';setTimeout(()=>$('equipmentQrCopy').textContent='Копировать ссылку',1200)}catch{$('equipmentQrError').textContent='Не удалось скопировать ссылку.'}};
    $('equipmentQrPrint').onclick=()=>printLabel(asset,url);
    $('equipmentQrDlg').showModal();
  }catch(error){notify('error','QR-код недоступен',friendly(error))}
}

function printLabel(asset,url){
  const holder=$('equipmentQrCode'),canvas=holder?.querySelector('canvas'),img=holder?.querySelector('img');
  const src=canvas?.toDataURL?.('image/png')||img?.src||'';
  if(!src){$('equipmentQrError').textContent='QR ещё не готов к печати.';return}
  const w=window.open('','_blank','width=520,height=650');
  if(!w){$('equipmentQrError').textContent='Браузер заблокировал окно печати.';return}
  const name=esc(asset.name||'Оборудование'),inv=esc(asset.inventory_number||asset.id),loc=esc(asset.location||'');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${inv}</title><style>@page{size:70mm 70mm;margin:4mm}body{font-family:Arial,sans-serif;margin:0;text-align:center;color:#111}.label{border:1px solid #ddd;border-radius:4mm;padding:4mm}.qr{width:42mm;height:42mm;object-fit:contain}.inv{font-size:16pt;font-weight:800;margin-top:2mm}.name{font-size:10pt;margin-top:1mm}.loc{font-size:8pt;color:#555;margin-top:1mm}.hint{font-size:7pt;color:#777;margin-top:2mm}</style></head><body><div class="label"><img class="qr" src="${src}"><div class="inv">${inv}</div><div class="name">${name}</div>${loc?`<div class="loc">${loc}</div>`:''}<div class="hint">A4PRINT-HUB · сканируйте для карточки станка</div></div><script>window.onload=()=>{window.print()}<\/script></body></html>`);
  w.document.close();
}

async function operatorAction(jobId,action,payload={}){
  if(!canProductionManage())throw new Error('PERMISSION_DENIED');
  if(state.actionBusy)return;
  state.actionBusy=true;
  try{
    const {error}=await supabase.rpc('production_operator_action',{
      p_job_id:jobId,p_action:action,p_reason_code:payload.reason||null,p_note:payload.note||null,
      p_good_quantity:Number(payload.good||0),p_scrap_quantity:Number(payload.scrap||0),p_rework_quantity:Number(payload.rework||0)
    });
    if(error)throw error;
    await renderQuick(state.detailId);
    window.dispatchEvent(new Event('production-operator-changed'));
  }finally{state.actionBusy=false}
}

function openComplete(jobId){
  const job=state.jobs.find(j=>j.id===jobId);if(!job)return;
  ensureDialogs();
  const remaining=Math.max(0,Number(job.quantity||0)-Number(job.good_quantity||0));
  $('equipmentQrCompleteTitle').textContent=job.title||'Производственное задание';
  $('equipmentQrGood').value=String(remaining);
  $('equipmentQrScrap').value='0';$('equipmentQrRework').value='0';$('equipmentQrCompleteNote').value='';$('equipmentQrCompleteError').textContent='';
  $('equipmentQrCompleteDlg').dataset.jobId=jobId;
  $('equipmentQrCompleteDlg').showModal();
}

async function submitComplete(event){
  event.preventDefault();const b=$('equipmentQrCompleteSave');b.disabled=true;$('equipmentQrCompleteError').textContent='';
  try{
    await operatorAction($('equipmentQrCompleteDlg').dataset.jobId,'COMPLETE',{
      good:$('equipmentQrGood').value,scrap:$('equipmentQrScrap').value,rework:$('equipmentQrRework').value,note:$('equipmentQrCompleteNote').value.trim()
    });
    $('equipmentQrCompleteDlg').close();
  }catch(error){$('equipmentQrCompleteError').textContent=friendly(error)}finally{b.disabled=false}
}

function clickService(id){
  const b=document.querySelector('#detailBody [data-open-service="'+id+'"]');
  if(b){b.click();return}
  const cal=$('calendarTabButton');if(cal){cal.click();return}
  notify('warning','Недостаточно прав','Для обслуживания нужны права управления оборудованием.');
}

function clickIncident(id){
  const tryClick=()=>{
    const b=document.querySelector('#detailBody [data-report-asset-incident="'+id+'"]');
    if(b){b.click();return true}
    return false;
  };
  if(tryClick())return;
  setTimeout(()=>{if(!tryClick())notify('warning','Недостаточно прав','Для сообщения о неисправности нужны права production.manage или equipment.repair.');},60);
}

function friendly(error){
  const t=String(error?.message||error||'Ошибка');
  if(t.includes('PERMISSION_DENIED'))return'Недостаточно прав для этого действия.';
  if(t.includes('EQUIPMENT_NOT_AVAILABLE'))return'Оборудование не найдено или недоступно в вашей организации.';
  if(t.includes('EQUIPMENT_UNAVAILABLE'))return'Станок сейчас недоступен для запуска.';
  if(t.includes('EQUIPMENT_ALREADY_RUNNING'))return'На станке уже выполняется другое задание.';
  if(t.includes('GOOD_QUANTITY_REQUIRED'))return'Укажите количество годной продукции.';
  if(t.includes('ACTIVE_RUN_NOT_FOUND'))return'Активный запуск не найден. Обновите карточку.';
  return t;
}

function bind(){
  document.addEventListener('click',async event=>{
    const card=event.target.closest('[data-asset]');
    if(card&&!event.target.closest('button,a,input,select,textarea'))state.detailId=card.dataset.asset;
    const qr=event.target.closest('[data-equipment-qr]');if(qr){event.preventDefault();event.stopPropagation();await openQr(qr.dataset.equipmentQr);return}
    const action=event.target.closest('[data-eq-qr-action]');if(action){event.preventDefault();action.disabled=true;try{await operatorAction(action.dataset.jobId,action.dataset.eqQrAction)}catch(error){notify('error','Операция не выполнена',friendly(error))}finally{action.disabled=false}return}
    const complete=event.target.closest('[data-eq-qr-complete]');if(complete){event.preventDefault();openComplete(complete.dataset.eqQrComplete);return}
    const service=event.target.closest('[data-eq-qr-service]');if(service){event.preventDefault();clickService(service.dataset.eqQrService);return}
    const incident=event.target.closest('[data-eq-qr-incident]');if(incident){event.preventDefault();clickIncident(incident.dataset.eqQrIncident);return}
    const refresh=event.target.closest('[data-eq-qr-refresh]');if(refresh){event.preventDefault();refresh.disabled=true;try{await renderQuick(refresh.dataset.eqQrRefresh)}finally{refresh.disabled=false}}
  },true);
}

function openDeepLink(id){
  if(!uuid.test(id))return;
  state.detailId=id;
  const open=()=>{
    const card=document.querySelector('[data-asset="'+id+'"]');
    if(!card)return false;
    card.click();
    setTimeout(enhanceDetail,0);
    return true;
  };
  if(open())return;
  const onRender=()=>{if(open())document.removeEventListener('a4:equipment-grid-rendered',onRender)};
  document.addEventListener('a4:equipment-grid-rendered',onRender);
  setTimeout(()=>document.removeEventListener('a4:equipment-grid-rendered',onRender),8000);
}

async function init(){
  injectStyle();ensureDialogs();bind();
  try{
    await loadPermissions();
    if(!canEquipmentView())return;
    bindRenderEvents();
    const id=new URLSearchParams(window.location.search).get('equipment');
    if(id&&uuid.test(id)){
      const asset=await getAsset(id);
      if(!asset){notify('error','Оборудование недоступно','Оборудование не найдено или недоступно.');return}
      state.asset=asset;openDeepLink(id);
    }
  }catch(error){console.warn('Equipment QR unavailable',error)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
