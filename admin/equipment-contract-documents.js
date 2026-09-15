import {supabase} from './guard.js?v=20260905-netfix1';

const esc=value=>String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const date=value=>value?new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString('ru-RU'):'—';
const dateTime=value=>value?new Date(value).toLocaleString('ru-RU'):'—';
const money=(value,currency='RUB')=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:currency||'RUB',maximumFractionDigits:2}).format(Number(value||0));
const kinds={
  ACCEPTANCE_ACT:'Акт приёма-передачи',
  ASSET_LIST:'Перечень оборудования',
  TERMS_APPENDIX:'Условия сотрудничества',
  RETURN_ACT:'Акт возврата',
  RECONCILIATION_ACT:'Акт сверки'
};
const typeToKind={EQ_ACCEPTANCE_ACT:'ACCEPTANCE_ACT',EQ_ASSET_LIST:'ASSET_LIST',EQ_TERMS_APPENDIX:'TERMS_APPENDIX',EQ_RETURN_ACT:'RETURN_ACT',EQ_RECONCILIATION_ACT:'RECONCILIATION_ACT'};
const statusLabels={DRAFT:'Черновик',PENDING_APPROVAL:'На согласовании',APPROVED:'Согласован',SIGNED:'Подписан',ACTIVE:'Действует',ARCHIVED:'Архив'};
const contractTypeLabels={REVENUE_SHARE:'Доля с выручки',LEASE:'Аренда',LEASE_BUYOUT:'Аренда с выкупом',LOAN_FOR_USE:'Безвозмездное пользование',OTHER:'Иной'};
const state={permissions:[],documents:[],contracts:[],terminations:[],organizations:[],loading:false};
const can=code=>state.permissions.includes(code);

function addStyle(){
  if(document.querySelector('link[data-contract-documents-style]'))return;
  const link=document.createElement('link');
  link.rel='stylesheet';link.href='./equipment-contract-documents.css?v=20260915-1';link.dataset.contractDocumentsStyle='1';
  document.head.appendChild(link);
}

function injectButton(){
  if(document.getElementById('contractDocumentsBtn'))return;
  const actions=document.querySelector('.topbar .eq-actions');if(!actions)return;
  const button=document.createElement('button');button.id='contractDocumentsBtn';button.type='button';button.textContent='▤ Документы договоров';
  button.addEventListener('click',async()=>{ensureWorkspace();document.getElementById('contractDocumentsDlg').showModal();await load()});
  actions.insertBefore(button,document.getElementById('refresh')||null);
}

function ensureWorkspace(){
  if(document.getElementById('contractDocumentsDlg'))return;
  const dlg=document.createElement('dialog');dlg.id='contractDocumentsDlg';dlg.className='cd-dialog';dlg.innerHTML=`
    <div class="cd-shell">
      <header class="cd-head"><div><h2>Документы по договорам оборудования</h2><p>Акты и приложения формируются из неизменяемого снимка договора, владельца, техники и расчётов.</p></div><div class="cd-head-actions"><button id="cdRefresh" type="button">↻ Обновить</button><button id="cdClose" class="cd-close" type="button">×</button></div></header>
      <div class="cd-body">
        <div id="cdError"></div>
        <section class="cd-kpis">
          <article><span>Документы</span><strong id="cdKpiTotal">0</strong><small>в архиве договоров</small></article>
          <article><span>Черновики</span><strong id="cdKpiDraft">0</strong><small>требуют проверки</small></article>
          <article><span>Подписано</span><strong id="cdKpiSigned">0</strong><small>юридически зафиксировано</small></article>
          <article><span>Договоры</span><strong id="cdKpiContracts">0</strong><small>имеют документы</small></article>
        </section>
        <div class="cd-toolbar">
          <input id="cdSearch" type="search" placeholder="Номер документа, договор, владелец…">
          <select id="cdContractFilter"><option value="">Все договоры</option></select>
          <select id="cdStatusFilter"><option value="">Все статусы</option>${Object.entries(statusLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select>
          <button id="cdGenerate" class="cd-primary" type="button">+ Сформировать</button>
        </div>
        <div id="cdList" class="cd-list"><div class="cd-empty">Загрузка…</div></div>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  const form=document.createElement('dialog');form.id='cdGenerateDlg';form.className='cd-form-dialog';form.innerHTML=`
    <form id="cdGenerateForm">
      <div class="cd-form-head"><div><h3>Сформировать документ</h3><p>После создания данные сохраняются снимком и не меняются вместе с карточками.</p></div><button type="button" data-cd-close="cdGenerateDlg">×</button></div>
      <div class="cd-form-body"><div class="cd-form-grid">
        <label class="cd-field full"><span>Договор *</span><select id="cdContract" required></select></label>
        <label class="cd-field full"><span>Документ *</span><select id="cdKind" required>${Object.entries(kinds).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
        <label class="cd-field full" id="cdTerminationWrap"><span>Процедура расторжения *</span><select id="cdTermination"></select><small>Для акта возврата и финальной сверки обязательна действующая процедура расторжения.</small></label>
        <label class="cd-field full"><span>Подразделение HUB</span><select id="cdOrganization"><option value="">Определить автоматически</option></select><small>Если всё оборудование относится к одному подразделению, оно определяется автоматически; иначе используется А4-Принт.</small></label>
        <label class="cd-field full"><span>Примечание к документу</span><textarea id="cdNotes" placeholder="Состояние, комплектность, оговорки или дополнительная информация"></textarea></label>
      </div><div id="cdGenerateError" class="cd-form-error"></div></div>
      <div class="cd-form-foot"><button type="button" data-cd-close="cdGenerateDlg">Отмена</button><button id="cdGenerateSave" class="cd-primary" type="submit">Сформировать снимок</button></div>
    </form>`;
  document.body.appendChild(form);

  document.getElementById('cdClose').addEventListener('click',()=>dlg.close());
  document.getElementById('cdRefresh').addEventListener('click',load);
  document.getElementById('cdSearch').addEventListener('input',render);
  document.getElementById('cdContractFilter').addEventListener('change',render);
  document.getElementById('cdStatusFilter').addEventListener('change',render);
  document.getElementById('cdGenerate').addEventListener('click',openGenerate);
  document.getElementById('cdContract').addEventListener('change',syncTerminationOptions);
  document.getElementById('cdKind').addEventListener('change',syncTerminationOptions);
  document.getElementById('cdGenerateForm').addEventListener('submit',submitGenerate);
  document.getElementById('cdList').addEventListener('click',handleListAction);
  document.querySelectorAll('[data-cd-close]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.cdClose)?.close()));
}

async function loadPermissions(){const {data,error}=await supabase.rpc('get_my_permissions');if(error)throw error;state.permissions=Array.isArray(data)?data:[]}

async function load(){
  if(state.loading)return;state.loading=true;
  const refresh=document.getElementById('cdRefresh');if(refresh){refresh.disabled=true;refresh.textContent='Обновление…'}
  try{
    if(!state.permissions.length)await loadPermissions();
    const [docs,contracts,terms,orgs]=await Promise.all([
      supabase.from('equipment_contract_document_overview').select('*').order('created_at',{ascending:false}),
      supabase.from('equipment_contracts').select('id,partner_id,contract_number,contract_type,status,starts_on,ends_on').order('created_at',{ascending:false}),
      supabase.from('equipment_contract_termination_overview').select('termination_id,contract_id,status,effective_end_date,reason,partner_name,contract_number').order('created_at',{ascending:false}),
      supabase.from('organizations').select('id,name,code,is_active').eq('is_active',true).order('name')
    ]);
    if(docs.error)throw docs.error;if(contracts.error)throw contracts.error;if(terms.error)throw terms.error;if(orgs.error)throw orgs.error;
    state.documents=docs.data||[];state.contracts=contracts.data||[];state.terminations=terms.data||[];state.organizations=orgs.data||[];
    fillFilters();render();
  }catch(err){showError('cdError',friendlyError(err))}
  finally{state.loading=false;if(refresh){refresh.disabled=false;refresh.textContent='↻ Обновить'}}
}

function fillFilters(){
  const filter=document.getElementById('cdContractFilter');const selected=filter?.value||'';
  if(filter){filter.innerHTML='<option value="">Все договоры</option>'+state.contracts.map(c=>`<option value="${c.id}">${esc(c.contract_number)} · ${esc(contractTypeLabels[c.contract_type]||c.contract_type)}</option>`).join('');filter.value=selected}
  const contract=document.getElementById('cdContract');if(contract){const current=contract.value;contract.innerHTML=state.contracts.length?state.contracts.map(c=>`<option value="${c.id}">${esc(c.contract_number)} · ${esc(contractTypeLabels[c.contract_type]||c.contract_type)} · ${esc(c.status)}</option>`).join(''):'<option value="">Нет договоров</option>';if(state.contracts.some(c=>c.id===current))contract.value=current}
  const org=document.getElementById('cdOrganization');if(org){const current=org.value;org.innerHTML='<option value="">Определить автоматически</option>'+state.organizations.map(o=>`<option value="${o.id}">${esc(o.name)} (${esc(o.code)})</option>`).join('');if(state.organizations.some(o=>o.id===current))org.value=current}
}

function render(){
  const list=document.getElementById('cdList');if(!list)return;
  const q=(document.getElementById('cdSearch')?.value||'').trim().toLowerCase();
  const contractId=document.getElementById('cdContractFilter')?.value||'';
  const status=document.getElementById('cdStatusFilter')?.value||'';
  document.getElementById('cdKpiTotal').textContent=state.documents.length;
  document.getElementById('cdKpiDraft').textContent=state.documents.filter(x=>['DRAFT','PENDING_APPROVAL','APPROVED'].includes(x.status)).length;
  document.getElementById('cdKpiSigned').textContent=state.documents.filter(x=>['SIGNED','ACTIVE'].includes(x.status)).length;
  document.getElementById('cdKpiContracts').textContent=new Set(state.documents.map(x=>x.contract_id)).size;
  document.getElementById('cdGenerate').style.display=can('equipment.contracts.manage')?'':'none';
  const rows=state.documents.filter(x=>(!contractId||x.contract_id===contractId)&&(!status||x.status===status)&&(!q||`${x.document_number} ${x.contract_number} ${x.partner_name} ${x.document_type_name}`.toLowerCase().includes(q)));
  if(!rows.length){list.innerHTML='<div class="cd-empty">Документов по выбранным условиям пока нет.</div>';return}
  list.innerHTML=rows.map(card).join('');
}

function card(row){
  const kind=typeToKind[row.document_type_code]||row.metadata?.document_kind||'';
  const signed=['SIGNED','ACTIVE'].includes(row.status);const archived=row.status==='ARCHIVED';const manage=can('equipment.contracts.manage');
  let actions=`<button data-act="preview" data-id="${row.document_id}">Предпросмотр</button><button data-act="print" data-id="${row.document_id}">Печать / PDF</button>`;
  if(manage&&!archived){
    if(row.status==='DRAFT')actions+=`<button data-act="approve" data-id="${row.document_id}">Согласовать</button>`;
    if(row.status==='PENDING_APPROVAL')actions+=`<button data-act="approve" data-id="${row.document_id}">Согласовать</button>`;
    if(row.status==='APPROVED')actions+=`<button data-act="sign" data-id="${row.document_id}" class="cd-primary">Отметить подписанным</button>`;
    if(signed)actions+=`<button data-act="archive" data-id="${row.document_id}">В архив</button>`;
  }
  return `<article class="cd-card">
    <div class="cd-card-head"><div><div class="cd-title-row"><h3>${esc(row.document_number||'Без номера')}</h3><span class="cd-pill ${String(row.status).toLowerCase()}">${esc(statusLabels[row.status]||row.status)}</span></div><p>${esc(kinds[kind]||row.document_type_name)} · договор ${esc(row.contract_number)}</p></div><strong>${date(row.issue_date)}</strong></div>
    <div class="cd-meta"><span>Владелец: <b>${esc(row.partner_name)}</b></span><span>Тип договора: <b>${esc(contractTypeLabels[row.contract_type]||row.contract_type)}</b></span><span>Подписан: <b>${row.signed_at?dateTime(row.signed_at):'нет'}</b></span><span>Snapshot: <b>${dateTime(row.metadata?.snapshot_generated_at)}</b></span></div>
    ${row.notes?`<div class="cd-note">${esc(row.notes)}</div>`:''}
    <div class="cd-card-actions">${actions}</div>
  </article>`;
}

function openGenerate(){
  document.getElementById('cdGenerateForm').reset();fillFilters();showError('cdGenerateError','');syncTerminationOptions();document.getElementById('cdGenerateDlg').showModal();
}

function syncTerminationOptions(){
  const kind=document.getElementById('cdKind')?.value;const contractId=document.getElementById('cdContract')?.value;
  const required=['RETURN_ACT','RECONCILIATION_ACT'].includes(kind);const wrap=document.getElementById('cdTerminationWrap');const select=document.getElementById('cdTermination');
  if(wrap)wrap.style.display=required?'':'none';if(!select)return;
  const rows=state.terminations.filter(t=>t.contract_id===contractId&&t.status!=='CANCELLED');
  select.innerHTML=rows.length?rows.map(t=>`<option value="${t.termination_id}">${esc(t.status)} · ${date(t.effective_end_date)} · ${esc(t.reason||'без причины')}</option>`).join(''):'<option value="">Нет действующей процедуры</option>';
  select.required=required;
}

async function submitGenerate(e){
  e.preventDefault();const btn=document.getElementById('cdGenerateSave');btn.disabled=true;showError('cdGenerateError','');
  try{
    const kind=document.getElementById('cdKind').value;const needTerm=['RETURN_ACT','RECONCILIATION_ACT'].includes(kind);
    const args={
      p_contract_id:document.getElementById('cdContract').value,
      p_document_kind:kind,
      p_termination_id:needTerm?(document.getElementById('cdTermination').value||null):null,
      p_hub_organization_id:document.getElementById('cdOrganization').value||null,
      p_notes:document.getElementById('cdNotes').value.trim()||null
    };
    const {data,error}=await supabase.rpc('generate_equipment_contract_document',args);if(error)throw error;
    document.getElementById('cdGenerateDlg').close();await load();
    const doc=state.documents.find(x=>x.document_id===data);if(doc)openDocument(doc,false);
  }catch(err){showError('cdGenerateError',friendlyError(err))}finally{btn.disabled=false}
}

async function handleListAction(e){
  const button=e.target.closest('button[data-act]');if(!button||button.disabled)return;
  const doc=state.documents.find(x=>x.document_id===button.dataset.id);if(!doc)return;
  const act=button.dataset.act;
  if(act==='preview'){openDocument(doc,false);return}
  if(act==='print'){openDocument(doc,true);return}
  const next=act==='approve'?'APPROVED':act==='sign'?'SIGNED':act==='archive'?'ARCHIVED':null;if(!next)return;
  const question=next==='SIGNED'?'Отметить документ подписанным? После этого вернуть его в черновик нельзя.':next==='ARCHIVED'?'Переместить документ в архив?':'Согласовать документ?';
  if(!confirm(question))return;
  button.disabled=true;
  const {error}=await supabase.rpc('set_equipment_contract_document_status',{p_document_id:doc.document_id,p_status:next,p_comment:`Статус изменён из раздела оборудования: ${next}`});
  if(error)alert(friendlyError(error));await load();
}

function openDocument(doc,autoPrint){
  const win=window.open('','_blank','noopener,noreferrer');if(!win){alert('Браузер заблокировал окно предпросмотра. Разрешите всплывающие окна для HUB.');return}
  win.document.open();win.document.write(printHtml(doc,autoPrint));win.document.close();
}

function printHtml(doc,autoPrint=false){
  const m=doc.metadata||{};const p=m.partner_snapshot||{};const h=m.hub_snapshot||{};const c=m.contract_snapshot||{};const equipment=Array.isArray(m.equipment_snapshot)?m.equipment_snapshot:[];const f=m.financial_snapshot||{};const t=m.termination_snapshot||{};const kind=m.document_kind||typeToKind[doc.document_type_code];
  const party=n=>esc(n||'—');
  const equipmentRows=equipment.length?equipment.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.inventory_number||'—')}</td><td>${esc([x.brand,x.model,x.name].filter(Boolean).join(' ')||'—')}</td><td>${esc(x.serial_number||'—')}</td><td>${x.manufacture_year||'—'}</td><td>${money(x.market_value,c.currency)}</td></tr>`).join(''):'<tr><td colspan="6">Оборудование в снимке не указано</td></tr>';
  const eqTable=`<table><thead><tr><th>№</th><th>Инв. №</th><th>Оборудование</th><th>Серийный №</th><th>Год</th><th>Стоимость</th></tr></thead><tbody>${equipmentRows}</tbody></table>`;
  const intro=`<p><b>${party(h.legal_name||h.name)}</b>, далее «HUB», и <b>${party(p.legal_name||p.name)}</b>, далее «Владелец», составили настоящий документ к договору № <b>${esc(c.contract_number||doc.contract_number||'—')}</b>.</p>`;
  let body='';
  if(kind==='ACCEPTANCE_ACT')body=`${intro}<p>Владелец передал, а HUB принял оборудование для эксплуатации и выполнения заказов на условиях договора. Идентификация оборудования зафиксирована на дату формирования настоящего акта.</p>${eqTable}<p><b>Состояние / комплектность:</b> ${esc(doc.notes||'Без отдельных замечаний.')}</p>`;
  else if(kind==='ASSET_LIST')body=`${intro}<p>Настоящий перечень является приложением к договору и фиксирует состав переданного оборудования.</p>${eqTable}`;
  else if(kind==='TERMS_APPENDIX')body=`${intro}<table class="terms"><tbody><tr><th>Тип договора</th><td>${esc(contractTypeLabels[c.contract_type]||c.contract_type||'—')}</td></tr><tr><th>Доля HUB / владельца</th><td>${Number(c.hub_share_percent||0)}% / ${Number(c.owner_share_percent||0)}%</td></tr><tr><th>База расчёта</th><td>${esc(c.calculation_basis||'—')}</td></tr><tr><th>Прямые расходы до разделения</th><td>${c.direct_costs_before_split?'Да':'Нет'}</td></tr><tr><th>Периодичность расчётов</th><td>${esc(c.settlement_frequency||'—')}</td></tr><tr><th>Арендный платёж</th><td>${money(c.lease_period_amount,c.currency)}</td></tr><tr><th>Ремонт</th><td>${esc(c.repair_responsibility||'—')}</td></tr><tr><th>Уведомление о расторжении</th><td>${Number(c.early_termination_notice_days||0)} дней</td></tr><tr><th>Выкуп</th><td>${c.buyout_enabled?`Да, цена ${money(c.buyout_price,c.currency)}, зачёт аренды ${Number(c.buyout_credit_percent||0)}%`:'Не предусмотрен'}</td></tr></tbody></table><p><b>Оборудование по договору:</b></p>${eqTable}`;
  else if(kind==='RETURN_ACT')body=`${intro}<p>В связи с прекращением сотрудничества HUB возвращает Владельцу оборудование, указанное ниже.</p>${eqTable}<table class="terms"><tbody><tr><th>Дата уведомления</th><td>${date(t.notice_date)}</td></tr><tr><th>Дата прекращения</th><td>${date(t.effective_end_date)}</td></tr><tr><th>Основание</th><td>${esc(t.reason||'—')}</td></tr></tbody></table><p><b>Состояние / комплектность:</b> ${esc(doc.notes||t.final_notes||'Без отдельных замечаний.')}</p>`;
  else if(kind==='RECONCILIATION_ACT'){
    const rs=f.revenue_share||{};const lease=f.lease||{};
    body=`${intro}<p>Стороны сверили взаиморасчёты по данным HUB на момент формирования документа.</p><table class="terms"><tbody><tr><th>Выручка по расчётам</th><td>${money(rs.gross_revenue_total,rs.currency||c.currency)}</td></tr><tr><th>Прямые расходы</th><td>${money(rs.direct_costs_total,rs.currency||c.currency)}</td></tr><tr><th>Начислено владельцу по доле</th><td>${money(rs.owner_amount_total,rs.currency||c.currency)}</td></tr><tr><th>Оплачено владельцу по доле</th><td>${money(rs.owner_amount_paid,rs.currency||c.currency)}</td></tr><tr><th>Аренда начислена</th><td>${money(lease.amount_total,lease.currency||c.currency)}</td></tr><tr><th>Аренда оплачена</th><td>${money(lease.amount_paid,lease.currency||c.currency)}</td></tr><tr><th>Зачтено в выкуп</th><td>${money(lease.buyout_credit_paid,lease.currency||c.currency)}</td></tr><tr><th>Дата прекращения</th><td>${date(t.effective_end_date)}</td></tr></tbody></table><p><b>Примечание:</b> ${esc(doc.notes||'Дополнительных разногласий в документе не зафиксировано.')}</p>`;
  } else body=`${intro}${eqTable}`;
  const details=`<div class="parties"><div><b>HUB</b><br>${party(h.legal_name||h.name)}<br>ИНН: ${party(h.tax_id)}<br>Рег. №: ${party(h.registration_number)}<br>${party(h.address)}<br><br>________________ / __________________</div><div><b>Владелец</b><br>${party(p.legal_name||p.name)}<br>ИНН: ${party(p.tax_id)}<br>Рег. №: ${party(p.registration_number)}<br>${party(p.address)}<br><br>________________ / __________________</div></div>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(doc.document_number||doc.title)}</title><style>${printCss()}</style></head><body><div class="toolbar"><button onclick="window.print()">Печать / сохранить PDF</button><span>Snapshot: ${esc(dateTime(m.snapshot_generated_at))}</span></div><main><header><h1>${esc(kinds[kind]||doc.document_type_name)}</h1><div class="number">${esc(doc.document_number||'')}</div><div class="date">г. ${esc(h.address||'__________')} · ${date(doc.issue_date)}</div></header>${body}<div class="status">Статус в HUB: ${esc(statusLabels[doc.status]||doc.status)}</div>${details}<footer>Документ сформирован A4PRINT HUB из зафиксированного снимка данных. Перед подписанием стороны обязаны проверить реквизиты, состав оборудования и суммы.</footer></main>${autoPrint?'<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),150))<\/script>':''}</body></html>`;
}

function printCss(){return `@page{size:A4;margin:16mm}*{box-sizing:border-box}body{margin:0;background:#eef2f7;color:#111827;font-family:Arial,sans-serif;font-size:12px;line-height:1.45}.toolbar{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 16px;background:#111827;color:#fff;z-index:2}.toolbar button{border:0;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer}main{width:210mm;min-height:297mm;margin:18px auto;background:#fff;padding:18mm;box-shadow:0 10px 35px rgba(15,23,42,.14)}header{text-align:center;margin-bottom:24px}h1{font-size:18px;text-transform:uppercase;margin:0 0 6px}.number{font-weight:700}.date{margin-top:12px;text-align:right}p{margin:12px 0}table{width:100%;border-collapse:collapse;margin:14px 0;font-size:11px}th,td{border:1px solid #374151;padding:6px;vertical-align:top}th{background:#f3f4f6}.terms th{width:38%;text-align:left}.parties{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:38px}.status{margin-top:24px;padding:8px 10px;background:#f3f4f6;font-size:11px}footer{margin-top:32px;padding-top:10px;border-top:1px solid #d1d5db;color:#6b7280;font-size:9px}@media print{body{background:#fff}.toolbar{display:none}main{width:auto;min-height:auto;margin:0;padding:0;box-shadow:none}}`}

function showError(id,text){const el=document.getElementById(id);if(!el)return;el.innerHTML=text?`<div class="cd-error">${esc(text)}</div>`:''}
function friendlyError(err){
  const msg=String(err?.message||err||'Ошибка');
  const map=[['AUTH_REQUIRED','Сессия истекла. Войдите в систему снова.'],['PERMISSION_DENIED','Недостаточно прав для документов договоров.'],['CONTRACT_NOT_FOUND','Договор не найден.'],['PARTNER_NOT_FOUND','Владелец договора не найден.'],['HUB_ORGANIZATION_NOT_FOUND','Не удалось определить подразделение HUB.'],['TERMINATION_REQUIRED','Для этого документа сначала нужна процедура расторжения договора.'],['TERMINATION_NOT_FOUND','Процедура расторжения не найдена для выбранного договора.'],['TERMINATION_CANCELLED','Нельзя формировать финальный документ по отменённому расторжению.'],['SIGNED_DOCUMENT_CANNOT_REOPEN','Подписанный документ нельзя вернуть в черновик.'],['ARCHIVED_DOCUMENT_IMMUTABLE','Архивный документ нельзя менять.'],['DOCUMENT_MUST_BE_SIGNED_FIRST','Сначала документ должен быть подписан.']];
  for(const [key,text] of map)if(msg.includes(key))return text;return msg;
}

function init(){addStyle();injectButton()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
