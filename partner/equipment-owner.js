import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg=window.A4PRINT_PARTNER_CONFIG;
const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=(value,currency='RUB')=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:currency||'RUB',maximumFractionDigits:2}).format(Number(value||0));
const date=value=>value?new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString('ru-RU'):'—';
const dateTime=value=>value?new Date(value).toLocaleString('ru-RU'):'—';
const statusLabel={ACTIVE:'Действует',DRAFT:'Черновик',SUSPENDED:'Приостановлен',COMPLETED:'Завершён',TERMINATED:'Расторгнут',PAID:'Оплачено',APPROVED:'Подтверждено',NOTICE:'Уведомление',PREPARING:'Подготовка',READY:'Готово к закрытию',CANCELLED:'Отменено',OPEN:'Открыт',DIAGNOSING:'Диагностика',WAITING_PARTS:'Ожидание деталей',REPAIRING:'Ремонт',RESOLVED:'Устранено',CLOSED:'Закрыто',SIGNED:'Подписан',ARCHIVED:'Архив'};
const contractTypeLabel={REVENUE_SHARE:'Доля с выручки',LEASE:'Аренда',LEASE_BUYOUT:'Аренда с выкупом',LOAN_FOR_USE:'Безвозмездное пользование',OTHER:'Иной договор'};
const state={data:null,loading:false};

const badge=(status)=>{const good=['ACTIVE','PAID','RESOLVED','CLOSED','SIGNED','APPROVED'].includes(status);const bad=['TERMINATED','CANCELLED'].includes(status);const cls=good?'good':bad?'bad':'warn';return `<span class="eo-badge ${cls}">${esc(statusLabel[status]||status||'—')}</span>`};
const empty=text=>`<div class="eo-empty">${esc(text)}</div>`;

const {data:{session}}=await supabase.auth.getSession();
if(!session){location.href='./login.html';}
else{bind();await load();}

function bind(){
  document.querySelectorAll('.eo-tab').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('.eo-tab').forEach(x=>x.classList.toggle('active',x===button));
    document.querySelectorAll('.eo-panel').forEach(x=>x.classList.toggle('active',x.dataset.panel===button.dataset.tab));
  }));
  $('eoRefresh').addEventListener('click',load);
  $('eoLogout').addEventListener('click',async()=>{await supabase.auth.signOut();location.href='./login.html';});
  $('eoDocClose').addEventListener('click',()=>$('eoDocumentDlg').close());
  $('eoPrint').addEventListener('click',()=>window.print());
  $('eoDocuments').addEventListener('click',event=>{const btn=event.target.closest('[data-document-id]');if(btn)openDocument(btn.dataset.documentId);});
  $('eoMoney').addEventListener('click',event=>{const btn=event.target.closest('[data-document-id]');if(btn)openDocument(btn.dataset.documentId);});
}

async function load(){
  if(state.loading)return;
  state.loading=true;$('eoRoot').classList.add('eo-refreshing');$('eoError').innerHTML='';
  try{
    const {data,error}=await supabase.rpc('get_partner_equipment_cabinet');
    if(error)throw error;
    state.data=data||{};render();
  }catch(error){
    $('eoError').innerHTML=`<div class="eo-alert">Не удалось загрузить кабинет: ${esc(friendly(error))}</div>`;
  }finally{state.loading=false;$('eoRoot').classList.remove('eo-refreshing');}
}

function render(){
  const d=state.data||{};const s=d.summary||{};const p=d.partner||{};
  $('eoPartner').textContent=`${p.legal_name||p.name||'Партнёр'} · данные на ${dateTime(d.generated_at)}`;
  $('eoEquipmentCount').textContent=Number(s.equipment_count||0);
  $('eoContractCount').textContent=Number(s.active_contract_count||0);
  $('eoOwnerTotal').textContent=money(s.owner_amount_total);
  $('eoOwnerPaid').textContent=money(s.owner_amount_paid);
  $('eoIncidentCount').textContent=Number(s.open_incident_count||0);
  renderEquipment(d.equipment||[]);
  renderContracts(d.contracts||[]);
  renderMoney(d.settlements||[],d.lease_charges||[],s);
  renderRepairs(d.incidents||[]);
  renderDocuments(d.documents||[]);
  renderTerminations(d.terminations||[]);
}

function renderEquipment(rows){
  $('eoEquipment').innerHTML=rows.length?rows.map(x=>`<article class="eo-card">
    <div class="eo-card-head"><div><h3>${esc(x.name)}</h3><p>${esc(x.inventory_number)}${x.brand||x.model?` · ${esc([x.brand,x.model].filter(Boolean).join(' '))}`:''}</p></div>${badge(x.operational_status)}</div>
    <div class="eo-meta">
      <div><span>Серийный номер</span><b>${esc(x.serial_number||'—')}</b></div>
      <div><span>Категория</span><b>${esc(x.category||'—')}</b></div>
      <div><span>Место установки</span><b>${esc(x.location||'—')}</b></div>
      <div><span>Год выпуска</span><b>${esc(x.manufacture_year||'—')}</b></div>
      <div><span>Оценочная стоимость</span><b>${x.market_value!=null?money(x.market_value):'—'}</b></div>
      <div><span>Передано в HUB</span><b>${date(x.received_at)}</b></div>
    </div>
    <div class="eo-note">${(x.contracts||[]).length?(x.contracts||[]).map(c=>`Договор <b>${esc(c.contract_number)}</b> — ${esc(statusLabel[c.contract_status]||c.contract_status)}, с ${date(c.starts_on)}${c.ends_on?` по ${date(c.ends_on)}`:''}`).join('<br>'):'Нет привязанного договора'}</div>
  </article>`).join(''):empty('Оборудование по вашим договорам пока не зарегистрировано.');
}

function renderContracts(rows){
  $('eoContracts').innerHTML=rows.length?rows.map(c=>{
    const share=c.contract_type==='REVENUE_SHARE'?`${Number(c.owner_share_percent||0)}% владельцу / ${Number(c.hub_share_percent||0)}% HUB`:null;
    const lease=['LEASE','LEASE_BUYOUT'].includes(c.contract_type)?money(c.lease_period_amount,c.currency):null;
    return `<article class="eo-card"><div class="eo-card-head"><div><h3>${esc(c.contract_number)}</h3><p>${esc(contractTypeLabel[c.contract_type]||c.contract_type)}</p></div>${badge(c.status)}</div>
      <div class="eo-meta">
        <div><span>Начало</span><b>${date(c.starts_on)}</b></div><div><span>Окончание</span><b>${date(c.ends_on)}</b></div>
        <div><span>Оборудование</span><b>${Number(c.equipment_count||0)} ед.</b></div><div><span>Уведомление о расторжении</span><b>${Number(c.early_termination_notice_days||0)} дн.</b></div>
        ${share?`<div><span>Распределение</span><b>${esc(share)}</b></div>`:''}
        ${lease?`<div><span>Платёж за период</span><b>${lease}</b></div>`:''}
        ${c.buyout_enabled?`<div><span>Цена выкупа</span><b>${money(c.buyout_price,c.currency)}</b></div><div><span>Зачёт платежей</span><b>${Number(c.buyout_credit_percent||0)}%</b></div>`:''}
        <div><span>Ремонт</span><b>${esc(repairLabel(c.repair_responsibility))}</b></div>
      </div>${c.notes?`<div class="eo-note">${esc(c.notes)}</div>`:''}</article>`;
  }).join(''):empty('Договоров по оборудованию пока нет.');
}

function leaseAllocationDetails(l){
  const snap=l?.allocation_snapshot;
  if(!snap||snap.schema!=='equipment_lease_allocation_v1')return'';
  const rows=Array.isArray(snap.allocations)?snap.allocations:[];
  const details=rows.map(x=>{const name=[x.inventory_number,x.equipment_name,[x.brand,x.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');const ratio=Number(x.allocation_ratio||0)*100;return`<tr><td><b>${esc(name||'Оборудование')}</b><br><small>${date(x.first_active_on)} — ${date(x.last_active_on)}</small></td><td>${Number(x.active_days||0)} дн.</td><td>${Number(x.period_count||0)}</td><td>${ratio.toFixed(2)}%</td><td><b>${money(x.allocated_amount,l.currency)}</b></td><td>${money(x.allocated_buyout_credit_amount,l.currency)}</td></tr>`}).join('');
  const doc=l.allocation_document_id?`<button class="eo-doc-btn" type="button" data-document-id="${l.allocation_document_id}">Открыть документ расчёта</button>`:'';
  return `<details class="eo-note" style="grid-column:1/-1;margin-top:4px"><summary style="cursor:pointer;font-weight:800">Зафиксированная расшифровка по оборудованию</summary><div style="overflow:auto;margin-top:10px"><table><thead><tr><th>Оборудование</th><th>Активно</th><th>Периодов</th><th>Доля</th><th>Начислено</th><th>В выкуп</th></tr></thead><tbody>${details||'<tr><td colspan="6">Нет строк распределения</td></tr>'}</tbody></table></div>${doc?`<div style="margin-top:8px">${doc}</div>`:''}</details>`;
}
function renderMoney(settlements,leases,summary){
  const blocks=[];
  if(settlements.length){
    blocks.push(`<article class="eo-card"><div class="eo-card-head"><div><h3>Доля с выручки</h3><p>Расчёты по завершённым периодам</p></div><b>${money(summary.owner_amount_paid)} выплачено</b></div></article>`);
    blocks.push(...settlements.map(s=>`<div class="eo-row"><div><b>${esc(s.contract_number)}</b><span>${date(s.period_start)} — ${date(s.period_end)}</span></div><div><span>База расчёта</span><b>${money(s.split_base,s.currency)}</b></div><div><span>Ваша доля</span><b>${Number(s.owner_share_percent||0)}% · ${money(s.owner_amount,s.currency)}</b></div><div><span>Оплата</span>${badge(s.status)}${s.paid_at?`<span>${dateTime(s.paid_at)}</span>`:''}</div><div>${s.payment_reference?`<span>Документ</span><b>${esc(s.payment_reference)}</b>`:''}</div></div>`));
  }
  if(leases.length){
    blocks.push(`<article class="eo-card"><div class="eo-card-head"><div><h3>Аренда / выкуп</h3><p>Утверждённый расчёт фиксируется и не меняется задним числом</p></div><b>${money(summary.lease_amount_paid)} оплачено</b></div></article>`);
    blocks.push(...leases.map(l=>`<div class="eo-row"><div><b>${esc(l.contract_number)}</b><span>${date(l.period_start)} — ${date(l.period_end)}</span></div><div><span>Начислено</span><b>${money(l.amount,l.currency)}</b></div><div><span>Зачёт в выкуп</span><b>${money(l.buyout_credit_amount,l.currency)}</b></div><div><span>Оплата</span>${badge(l.status)}${l.paid_at?`<span>${dateTime(l.paid_at)}</span>`:''}</div><div>${l.payment_reference?`<span>Платёж</span><b>${esc(l.payment_reference)}</b>`:l.allocation_document_id?'<span>Расчёт</span><b>зафиксирован</b>':''}</div>${leaseAllocationDetails(l)}</div>`));
  }
  $('eoMoney').innerHTML=blocks.length?blocks.join(''):empty('Начислений по оборудованию пока нет.');
}

function renderRepairs(rows){
  $('eoRepairs').innerHTML=rows.length?rows.map(i=>`<div class="eo-row"><div><b>${esc(i.equipment_name)}</b><span>${esc(i.inventory_number)} · ${dateTime(i.reported_at)}</span></div><div><span>Статус</span>${badge(i.status)}</div><div><span>Важность</span><b>${esc(severityLabel(i.severity))}</b></div><div><span>Простой</span><b>${i.downtime_started_at?`${dateTime(i.downtime_started_at)}${i.downtime_ended_at?` — ${dateTime(i.downtime_ended_at)}`:' — сейчас'}`:'Нет'}</b></div><div><span>Описание</span><b>${esc(i.description||'—')}</b>${i.resolution?`<span>Результат: ${esc(i.resolution)}</span>`:''}</div></div>`).join(''):empty('Инцидентов и ремонтов по вашему оборудованию нет.');
}

function renderDocuments(rows){
  $('eoDocuments').innerHTML=rows.length?rows.map(d=>`<div class="eo-row"><div><b>${esc(d.document_type_name)}</b><span>${esc(d.document_number)} · договор ${esc(d.contract_number)}</span></div><div><span>Дата</span><b>${date(d.issue_date)}</b></div><div><span>Статус</span>${badge(d.status)}</div><div><span>Действует</span><b>${date(d.valid_from)}${d.valid_until?` — ${date(d.valid_until)}`:''}</b></div><div><button class="eo-doc-btn" data-document-id="${d.document_id}">Открыть</button></div></div>`).join(''):empty('Опубликованных документов пока нет. Черновики и документы на согласовании здесь не отображаются.');
}

function renderTerminations(rows){
  $('eoTermination').innerHTML=rows.length?rows.map(t=>`<article class="eo-card"><div class="eo-card-head"><div><h3>Договор ${esc(t.contract_number)}</h3><p>Процедура прекращения сотрудничества</p></div>${badge(t.status)}</div><div class="eo-meta"><div><span>Уведомление</span><b>${date(t.notice_date)}</b></div><div><span>Плановая дата</span><b>${date(t.effective_end_date)}</b></div><div><span>Инициатор</span><b>${esc(initiatorLabel(t.initiated_by_party))}</b></div><div><span>Срок сокращён</span><b>${t.notice_waived?'Да':'Нет'}</b></div></div><div class="eo-note"><b>Причина:</b> ${esc(t.reason||'—')}${t.waiver_reason?`<br><b>Основание изменения срока:</b> ${esc(t.waiver_reason)}`:''}${t.return_reference?`<br><b>Акт возврата:</b> ${esc(t.return_reference)}`:''}${t.financial_clearance_reference?`<br><b>Финальная сверка:</b> ${esc(t.financial_clearance_reference)}`:''}</div></article>`).join(''):empty('Активных или завершённых процедур расторжения нет.');
}

async function openDocument(id){
  $('eoDocTitle').textContent='Документ';$('eoDocBody').innerHTML=empty('Загрузка документа…');$('eoDocumentDlg').showModal();
  try{
    const {data,error}=await supabase.rpc('get_partner_equipment_document',{p_document_id:id});
    if(error)throw error;
    $('eoDocTitle').textContent=data.title||data.document_type_name||'Документ';
    $('eoDocBody').innerHTML=renderDocument(data);
  }catch(error){$('eoDocBody').innerHTML=`<div class="eo-alert">${esc(friendly(error))}</div>`;}
}

function renderDocument(doc){
  if(doc.document_type_code==='EQ_LEASE_CHARGE')return renderLeaseChargeDocument(doc);
  const m=doc.metadata||{};const p=m.partner_snapshot||{};const h=m.hub_snapshot||{};const c=m.contract_snapshot||{};const equipment=m.equipment_snapshot||[];const fin=m.financial_snapshot||{};const term=m.termination_snapshot||null;
  return `<h1>${esc(doc.document_type_name||doc.title)}</h1><div class="doc-number">№ ${esc(doc.document_number||'—')} от ${date(doc.issue_date)}</div>
    <p><b>${esc(h.legal_name||h.name||'A4PRINT HUB')}</b> и <b>${esc(p.legal_name||p.name||'владелец оборудования')}</b> фиксируют сведения по договору <b>${esc(c.contract_number||'—')}</b>.</p>
    <h3>Стороны</h3><table><tr><th>A4PRINT HUB</th><th>Владелец</th></tr><tr><td>${party(h)}</td><td>${party(p)}</td></tr></table>
    <h3>Договор</h3><table><tr><th>Номер</th><td>${esc(c.contract_number||'—')}</td><th>Тип</th><td>${esc(contractTypeLabel[c.contract_type]||c.contract_type||'—')}</td></tr><tr><th>Период</th><td>${date(c.starts_on)} — ${date(c.ends_on)}</td><th>Расторжение</th><td>уведомление ${Number(c.early_termination_notice_days||0)} дн.</td></tr>${c.contract_type==='REVENUE_SHARE'?`<tr><th>Доля владельца</th><td>${Number(c.owner_share_percent||0)}%</td><th>Доля HUB</th><td>${Number(c.hub_share_percent||0)}%</td></tr>`:''}${['LEASE','LEASE_BUYOUT'].includes(c.contract_type)?`<tr><th>Аренда</th><td>${money(c.lease_period_amount,c.currency)}</td><th>Выкуп</th><td>${c.buyout_enabled?money(c.buyout_price,c.currency):'Не предусмотрен'}</td></tr>`:''}</table>
    <h3>Оборудование</h3>${equipment.length?`<table><thead><tr><th>Инв. №</th><th>Наименование</th><th>Модель</th><th>Серийный №</th><th>Стоимость</th></tr></thead><tbody>${equipment.map(a=>`<tr><td>${esc(a.inventory_number||'—')}</td><td>${esc(a.name||'—')}</td><td>${esc([a.brand,a.model].filter(Boolean).join(' ')||'—')}</td><td>${esc(a.serial_number||'—')}</td><td>${a.market_value!=null?money(a.market_value,c.currency):'—'}</td></tr>`).join('')}</tbody></table>`:'<p class="eo-muted">Оборудование не указано.</p>'}
    ${doc.document_type_code==='EQ_RECONCILIATION_ACT'?financialBlock(fin,c.currency):''}
    ${term?`<h3>Прекращение договора</h3><table><tr><th>Дата прекращения</th><td>${date(term.effective_end_date)}</td><th>Статус</th><td>${esc(statusLabel[term.status]||term.status)}</td></tr><tr><th>Акт возврата</th><td>${esc(term.return_reference||'—')}</td><th>Финансовая сверка</th><td>${esc(term.financial_clearance_reference||'—')}</td></tr></table>`:''}
    ${doc.notes?`<p><b>Примечание:</b> ${esc(doc.notes)}</p>`:''}
    <div class="sign-grid"><div><b>${esc(h.legal_name||h.name||'A4PRINT HUB')}</b><div class="sign">Подпись / М.П.</div></div><div><b>${esc(p.legal_name||p.name||'Владелец')}</b><div class="sign">Подпись / М.П.</div></div></div>`;
}

function renderLeaseChargeDocument(doc){
  const m=doc.metadata||{},snap=m.allocation_snapshot||{},p=m.partner_snapshot||{},rows=Array.isArray(snap.allocations)?snap.allocations:[],currency=snap.currency||'RUB';
  const body=rows.map(x=>{const name=[x.inventory_number,x.equipment_name,[x.brand,x.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');const ratio=Number(x.allocation_ratio||0)*100;return`<tr><td><b>${esc(name||'Оборудование')}</b>${x.serial_number?`<br><small>С/Н ${esc(x.serial_number)}</small>`:''}</td><td>${date(x.first_active_on)} — ${date(x.last_active_on)}</td><td>${Number(x.active_days||0)}</td><td>${Number(x.period_count||0)}</td><td>${ratio.toFixed(2)}%</td><td><b>${money(x.allocated_amount,currency)}</b></td><td>${money(x.allocated_buyout_credit_amount,currency)}</td></tr>`}).join('');
  return `<h1>${esc(doc.document_type_name||'Начисление аренды оборудования')}</h1><div class="doc-number">№ ${esc(doc.document_number||'—')} от ${date(doc.issue_date)}</div><p><b>Договор:</b> ${esc(m.contract_number||'—')} · <b>Владелец:</b> ${esc(p.legal_name||p.name||'—')}</p><table><tr><th>Расчётный период</th><td>${date(snap.period_start)} — ${date(snap.period_end)}</td><th>Начисление</th><td><b>${money(snap.charge_amount,currency)}</b></td></tr><tr><th>Зачёт в выкуп</th><td>${money(snap.buyout_credit_amount,currency)}</td><th>Статус документа</th><td>${esc(statusLabel[doc.status]||doc.status||'—')}</td></tr></table><h3>Зафиксированная расшифровка</h3><table><thead><tr><th>Оборудование</th><th>Участие</th><th>Дней</th><th>Периодов</th><th>Доля</th><th>Начислено</th><th>В выкуп</th></tr></thead><tbody>${body||'<tr><td colspan="7">Нет строк распределения</td></tr>'}</tbody></table><p class="eo-note">Эта расшифровка зафиксирована в момент согласования начисления и не пересчитывается задним числом при последующем изменении состава договора.</p>${doc.notes?`<p><b>Примечание:</b> ${esc(doc.notes)}</p>`:''}`;
}

function financialBlock(fin,currency){const r=fin.revenue_share||{},l=fin.lease||{};return `<h3>Финальная сверка</h3><table><tr><th>Начислено владельцу</th><td>${money(r.owner_amount_total,currency)}</td><th>Выплачено владельцу</th><td>${money(r.owner_amount_paid,currency)}</td></tr><tr><th>Арендные начисления</th><td>${money(l.amount_total,currency)}</td><th>Оплачено аренды</th><td>${money(l.amount_paid,currency)}</td></tr><tr><th>Зачтено в выкуп</th><td colspan="3">${money(l.buyout_credit_paid,currency)}</td></tr></table>`;}
function party(x){return [x.legal_name||x.name,x.tax_id?`ИНН: ${x.tax_id}`:null,x.registration_number?`Рег. №: ${x.registration_number}`:null,x.address,x.email,x.phone].filter(Boolean).map(esc).join('<br>')||'—';}
function repairLabel(value){return ({OWNER:'Владелец',HUB:'A4PRINT HUB',SHARED:'Совместно',BY_AGREEMENT:'По соглашению сторон'})[value]||value||'По соглашению';}
function severityLabel(value){return ({LOW:'Низкая',MEDIUM:'Средняя',HIGH:'Высокая',CRITICAL:'Критическая'})[value]||value||'—';}
function initiatorLabel(value){return ({HUB:'A4PRINT HUB',OWNER:'Владелец',MUTUAL:'По соглашению сторон',OTHER:'Иное'})[value]||value||'—';}
function friendly(error){const msg=String(error?.message||error||'Ошибка');if(msg.includes('PARTNER_ACCESS_REQUIRED'))return 'Этот раздел доступен только активному партнёрскому аккаунту.';if(msg.includes('PARTNER_DISABLED'))return 'Партнёрский доступ отключён.';if(msg.includes('DOCUMENT_NOT_AVAILABLE'))return 'Документ не опубликован или недоступен вашему аккаунту.';return msg;}
