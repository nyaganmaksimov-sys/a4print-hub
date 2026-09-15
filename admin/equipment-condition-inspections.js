import{supabase}from'./guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const date=v=>v?new Date(`${String(v).slice(0,10)}T00:00:00`).toLocaleDateString('ru-RU'):'—';
const typeLabel={ACCEPTANCE:'Приёмка',RETURN:'Возврат',PERIODIC:'Периодический'};
const gradeLabel={EXCELLENT:'Отличное',GOOD:'Хорошее',FAIR:'Удовлетворительное',POOR:'Плохое',NON_OPERATIONAL:'Неработоспособное'};
const opLabel={READY:'Готово к работе',LIMITED:'Ограниченно',NOT_OPERATIONAL:'Не работает'};
const checkLabels={visual:'Внешний вид и корпус',power:'Включение / питание',mechanics:'Механика / движение',safety:'Защита и безопасность',accessories:'Комплектность / оснастка'};
const state={rows:[],targets:[],permissions:[],loading:false};
const canManage=()=>state.permissions.includes('equipment.manage');
const targetKey=t=>`${t.contract_id}:${t.equipment_id}`;
const today=()=>new Date().toISOString().slice(0,10);

bind();load();

function bind(){
  $('eciRefresh').onclick=load;$('eciCancelled').onchange=load;$('eciSearch').oninput=render;$('eciType').onchange=render;$('eciStatus').onchange=render;
  $('eciCreate').onclick=()=>openForm();$('eciForm').onsubmit=saveDraft;
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close)?.close());
  $('eciExistingFiles').addEventListener('click',e=>{const b=e.target.closest('[data-remove-file]');if(b)removeFile(b.dataset.removeFile,b.dataset.path)});
}

async function load(){
  if(state.loading)return;state.loading=true;$('eciRefresh').disabled=true;$('eciError').innerHTML='';
  try{
    const [permR,listR]=await Promise.all([supabase.rpc('get_my_permissions'),supabase.rpc('list_equipment_condition_inspections',{p_include_cancelled:$('eciCancelled').checked})]);
    if(permR.error)throw permR.error;if(listR.error)throw listR.error;
    state.permissions=Array.isArray(permR.data)?permR.data:[];state.rows=Array.isArray(listR.data)?listR.data:[];
    if(canManage()){const t=await supabase.rpc('get_equipment_condition_inspection_targets');if(t.error)throw t.error;state.targets=Array.isArray(t.data)?t.data:[]}else state.targets=[];
    $('eciCreate').hidden=!canManage();render();
  }catch(error){$('eciError').innerHTML=`<div class="eci-error">${esc(error?.message||error)}</div>`}
  finally{state.loading=false;$('eciRefresh').disabled=false}
}

function render(){
  const q=$('eciSearch').value.trim().toLowerCase(),type=$('eciType').value,status=$('eciStatus').value;
  const rows=state.rows.filter(r=>(!type||r.inspection_type===type)&&(!status||r.status===status)&&(!q||`${r.partner_name} ${r.contract_number} ${r.inventory_number} ${r.equipment_name}`.toLowerCase().includes(q)));
  $('eciDraft').textContent=state.rows.filter(r=>r.status==='DRAFT').length;
  $('eciMissingAcceptance').textContent=state.targets.filter(t=>!t.has_acceptance_inspection).length;
  $('eciReturnPending').textContent=state.targets.filter(t=>t.termination_id&&!state.rows.some(r=>r.status==='COMPLETED'&&r.inspection_type==='RETURN'&&r.equipment_id===t.equipment_id&&r.termination_id===t.termination_id)).length;
  $('eciDefects').textContent=state.rows.filter(r=>r.status==='COMPLETED'&&Array.isArray(r.defects)&&r.defects.length).length;
  $('eciList').innerHTML=rows.length?rows.map(rowHtml).join(''):'<div class="eci-empty">Осмотров по выбранному фильтру нет.</div>';
  $('eciList').querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>viewInspection(b.dataset.view));
  $('eciList').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openForm(b.dataset.edit));
  $('eciList').querySelectorAll('[data-complete]').forEach(b=>b.onclick=()=>completeInspection(b.dataset.complete));
  $('eciList').querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>cancelInspection(b.dataset.cancel));
}

function rowHtml(r){
  const files=Array.isArray(r.files)?r.files:[],defects=Array.isArray(r.defects)?r.defects:[];
  const actions=`<button class="eci-btn" type="button" data-view="${r.inspection_id}">Открыть</button>${r.status==='DRAFT'&&canManage()?`<button class="eci-btn" type="button" data-edit="${r.inspection_id}">Изменить</button><button class="eci-btn good" type="button" data-complete="${r.inspection_id}">Завершить акт</button><button class="eci-btn danger" type="button" data-cancel="${r.inspection_id}">Отменить</button>`:''}`;
  return `<article class="eci-row"><div><h3>${esc(typeLabel[r.inspection_type]||r.inspection_type)} · ${esc(r.inventory_number||'—')} · ${esc(r.equipment_name||'')}</h3><p>${esc(r.partner_name||'—')} · договор ${esc(r.contract_number||'—')}</p><small>${r.document_number?`Документ ${esc(r.document_number)} · `:''}${files.length} файл(ов)${defects.length?` · дефектов: ${defects.length}`:''}</small></div><div><small>Дата / место</small><b>${date(r.inspected_on)}</b><p>${esc(r.location||'—')}</p></div><div><small>Состояние</small><b>${esc(gradeLabel[r.condition_grade]||r.condition_grade)}</b><p><span class="eci-pill ${esc(r.operational_state)}">${esc(opLabel[r.operational_state]||r.operational_state)}</span>${r.meter_hours!=null?` · ${Number(r.meter_hours).toLocaleString('ru-RU')} ч`:''}</p></div><div><span class="eci-pill ${esc(r.status)}">${esc(r.status)}</span><div class="eci-actions" style="margin-top:8px">${actions}</div></div></article>`;
}

function fillTargets(selected){
  let targets=[...state.targets];
  const existing=state.rows.find(r=>r.inspection_id===$('eciId').value);
  if(existing&&!targets.some(t=>targetKey(t)===`${existing.contract_id}:${existing.equipment_id}`))targets.push({contract_id:existing.contract_id,equipment_id:existing.equipment_id,partner_name:existing.partner_name,contract_number:existing.contract_number,inventory_number:existing.inventory_number,equipment_name:existing.equipment_name,termination_id:existing.termination_id});
  $('eciTarget').innerHTML='<option value="">Выберите договор и оборудование</option>'+targets.map(t=>`<option value="${targetKey(t)}" ${selected===targetKey(t)?'selected':''}>${esc(t.partner_name)} · ${esc(t.contract_number)} · ${esc(t.inventory_number||'—')} ${esc(t.equipment_name||'')}${t.termination_id?' · есть расторжение':''}</option>`).join('');
}

function openForm(id){
  if(!canManage())return;const r=id?state.rows.find(x=>x.inspection_id===id):null;
  $('eciId').value=r?.inspection_id||'';$('eciDlgTitle').textContent=r?'Изменить черновик':'Новый осмотр';fillTargets(r?`${r.contract_id}:${r.equipment_id}`:'');
  $('eciInspectionType').value=r?.inspection_type||'ACCEPTANCE';$('eciInspectedOn').value=r?.inspected_on||today();$('eciLocation').value=r?.location||'';$('eciMeter').value=r?.meter_hours??'';$('eciGrade').value=r?.condition_grade||'GOOD';$('eciOperational').value=r?.operational_state||'READY';$('eciDefectText').value=(r?.defects||[]).map(x=>x.description||x.text||JSON.stringify(x)).join('\n');$('eciNotes').value=r?.notes||'';$('eciFiles').value='';$('eciFormError').innerHTML='';
  document.querySelectorAll('.eci-check-row').forEach(el=>{const item=(r?.checklist||[]).find(x=>x.key===el.dataset.check);el.querySelector('select').value=item?.result||'PASS';el.querySelector('input').value=item?.note||''});
  renderExistingFiles(r?.files||[]);$('eciDlg').showModal();
}

function renderExistingFiles(files){$('eciExistingFiles').innerHTML=(files||[]).map(f=>`<div class="eci-file"><span>${esc(f.file_kind)} · ${esc(f.file_name)}</span>${canManage()&&$('eciId').value?`<button class="eci-btn danger" type="button" data-remove-file="${f.id}" data-path="${esc(f.storage_path)}">Удалить</button>`:''}</div>`).join('')}

function checklistPayload(){return [...document.querySelectorAll('.eci-check-row')].map(el=>({key:el.dataset.check,label:checkLabels[el.dataset.check],result:el.querySelector('select').value,note:el.querySelector('input').value.trim()||null}))}
function defectsPayload(){return $('eciDefectText').value.split('\n').map(x=>x.trim()).filter(Boolean).map(description=>({description,severity:'UNSPECIFIED'}))}
function selectedTarget(){const key=$('eciTarget').value;const [contract,equipment]=key.split(':');return state.targets.find(t=>t.contract_id===contract&&t.equipment_id===equipment)||state.rows.filter(r=>r.contract_id===contract&&r.equipment_id===equipment).map(r=>({contract_id:r.contract_id,equipment_id:r.equipment_id,termination_id:r.termination_id}))[0]}

async function saveDraft(e){
  e.preventDefault();$('eciFormError').innerHTML='';const t=selectedTarget();if(!t){formError('Выберите договор и оборудование.');return}const type=$('eciInspectionType').value;if(type==='RETURN'&&!t.termination_id){formError('Для возвратного осмотра сначала должен быть открыт процесс расторжения договора.');return}
  const payload={p_inspection_id:$('eciId').value||null,p_contract_id:t.contract_id,p_equipment_id:t.equipment_id,p_inspection_type:type,p_termination_id:type==='RETURN'?t.termination_id:null,p_inspected_on:$('eciInspectedOn').value,p_location:$('eciLocation').value.trim()||null,p_meter_hours:$('eciMeter').value===''?null:Number($('eciMeter').value),p_condition_grade:$('eciGrade').value,p_operational_state:$('eciOperational').value,p_checklist:checklistPayload(),p_defects:defectsPayload(),p_notes:$('eciNotes').value.trim()||null};
  const submit=e.submitter;submit.disabled=true;
  try{const{data,error}=await supabase.rpc('save_equipment_condition_inspection',payload);if(error)throw error;const id=data;await uploadFiles(id,[...$('eciFiles').files]);$('eciDlg').close();await load()}catch(error){formError(friendly(error))}finally{submit.disabled=false}
}

async function uploadFiles(id,files){
  for(const file of files){if(file.size>52428800)throw new Error(`Файл ${file.name} больше 50 МБ`);const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_')||'file';const path=`equipment-inspections/${id}/${crypto.randomUUID()}-${safe}`;const up=await supabase.storage.from('hub-documents').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});if(up.error)throw up.error;const kind=file.type?.startsWith('image/')?'PHOTO':'DOCUMENT';const reg=await supabase.rpc('register_equipment_condition_inspection_file',{p_inspection_id:id,p_file_kind:kind,p_file_name:file.name,p_mime_type:file.type||null,p_file_size:file.size,p_storage_path:path,p_caption:null});if(reg.error){await supabase.storage.from('hub-documents').remove([path]);throw reg.error}}
}

async function removeFile(id,path){if(!confirm('Удалить этот файл из черновика осмотра?'))return;const{data,error}=await supabase.rpc('remove_equipment_condition_inspection_file',{p_file_id:id});if(error){alert(friendly(error));return}await supabase.storage.from('hub-documents').remove([data||path]);const current=$('eciId').value;await load();$('eciDlg').close();if(current)openForm(current)}

async function completeInspection(id){if(!confirm('Завершить акт? После этого данные осмотра и список файлов станут неизменяемыми.'))return;const{error}=await supabase.rpc('complete_equipment_condition_inspection',{p_inspection_id:id});if(error){alert(friendly(error));return}await load()}
async function cancelInspection(id){const reason=prompt('Причина отмены черновика:');if(reason===null)return;if(!reason.trim()){alert('Причина обязательна.');return}const{error}=await supabase.rpc('cancel_equipment_condition_inspection',{p_inspection_id:id,p_reason:reason.trim()});if(error){alert(friendly(error));return}await load()}

async function viewInspection(id){const r=state.rows.find(x=>x.inspection_id===id);if(!r)return;$('eciViewTitle').textContent=`${typeLabel[r.inspection_type]||r.inspection_type} · ${r.inventory_number||''} ${r.equipment_name||''}`;$('eciViewBody').innerHTML='<div class="eci-empty">Формирую просмотр…</div>';$('eciViewDlg').showModal();const files=await Promise.all((r.files||[]).map(async f=>{const s=await supabase.storage.from('hub-documents').createSignedUrl(f.storage_path,900);return{...f,url:s.data?.signedUrl||null}}));const checks=(r.checklist||[]).map(x=>`<div><b>${esc(x.label||x.key)}</b>: ${x.result==='PASS'?'Норма':x.result==='ISSUE'?'Есть замечание':'Не применимо'}${x.note?` · ${esc(x.note)}`:''}</div>`).join('');const defects=(r.defects||[]).map(x=>`<li>${esc(x.description||x.text||JSON.stringify(x))}</li>`).join('');const photos=files.filter(f=>f.file_kind==='PHOTO'&&f.url).map(f=>`<a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt="${esc(f.caption||f.file_name)}"></a>`).join('');const docs=files.filter(f=>f.file_kind!=='PHOTO').map(f=>f.url?`<div><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.file_name)}</a></div>`:`<div>${esc(f.file_name)}</div>`).join('');$('eciViewBody').innerHTML=`<div class="eci-detail-grid"><section class="eci-detail-box"><h3>Основные данные</h3><p><b>Партнёр:</b> ${esc(r.partner_name)}</p><p><b>Договор:</b> ${esc(r.contract_number)}</p><p><b>Дата:</b> ${date(r.inspected_on)} · <b>место:</b> ${esc(r.location||'—')}</p><p><b>Состояние:</b> ${esc(gradeLabel[r.condition_grade]||r.condition_grade)} · ${esc(opLabel[r.operational_state]||r.operational_state)}</p><p><b>Наработка:</b> ${r.meter_hours==null?'—':Number(r.meter_hours).toLocaleString('ru-RU')+' ч'}</p><p><b>Документ:</b> ${esc(r.document_number||'черновик')}</p></section><section class="eci-detail-box"><h3>Чек-лист</h3>${checks||'—'}</section><section class="eci-detail-box"><h3>Дефекты</h3>${defects?`<ul>${defects}</ul>`:'Не зафиксированы'}${r.notes?`<p><b>Примечания:</b> ${esc(r.notes)}</p>`:''}</section><section class="eci-detail-box"><h3>Файлы</h3>${docs||''}<div class="eci-photo-grid">${photos}</div>${!docs&&!photos?'Нет файлов':''}</section></div>`}

function formError(message){$('eciFormError').innerHTML=`<div class="eci-error">${esc(message)}</div>`}
function friendly(error){const m=String(error?.message||error||'Ошибка');if(m.includes('INSPECTION_PHOTO_REQUIRED'))return 'Для приёмки или возврата нужна минимум одна фотография.';if(m.includes('DEFECT_DESCRIPTION_REQUIRED'))return 'Есть замечание по чек-листу или состоянию — добавьте описание дефекта.';if(m.includes('RETURN_INSPECTION_REQUIRED'))return 'Нельзя завершить возврат договора: не по всем единицам оборудования есть завершённый возвратный осмотр.';if(m.includes('CHECKLIST_REQUIRED'))return 'Заполните чек-лист.';if(m.includes('INSPECTION_NOT_EDITABLE'))return 'Этот осмотр уже нельзя изменять.';return m}
