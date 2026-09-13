import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>v===null||v===undefined?'••• ₽':Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const categories=['Материалы','Аренда','Доставка','Ремонт и обслуживание','Реклама','Канцелярия','Связь и интернет','Транспорт','Оборудование','Комиссии и банк','Зарплата и выплаты','Прочее'];
const RECEIPT_BUCKET='expense-receipts';
const MAX_RECEIPT_SIZE=15*1024*1024;
const allowedExt=new Set(['jpg','jpeg','png','webp','heic','heif','tif','tiff','pdf']);
const allowedMime=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif','image/tiff','application/pdf']);
const state={items:[],leader:false,profile:null,organizationId:null,loading:false,editingId:null,editingOwnerId:null,selectedId:null,receiptFile:null,existingReceipt:null,removeReceipt:false,previewUrl:null};

function moscowParts(){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]))}
function currentMonth(){const p=moscowParts();return `${p.year}-${p.month}`}
function todayMoscow(){const p=moscowParts();return `${p.year}-${p.month}-${p.day}`}
function monthBounds(value){const m=/^(\d{4})-(\d{2})$/.exec(value||'')||/^(\d{4})-(\d{2})$/.exec(currentMonth());let y=Number(m[1]),mo=Number(m[2]);const from=`${y}-${String(mo).padStart(2,'0')}-01`;mo++;if(mo===13){mo=1;y++}return{from,to:`${y}-${String(mo).padStart(2,'0')}-01`}}
function statusLabel(v){return({PAID:'Оплачен',PLANNED:'Запланирован',CANCELLED:'Отменён'})[String(v||'').toUpperCase()]||v||'—'}
function statusTone(v){const s=String(v||'').toUpperCase();return s==='PAID'?'green':s==='CANCELLED'?'red':'orange'}
function dateText(v){if(!v)return'—';const [y,m,d]=String(v).split('-');return y&&m&&d?`${d}.${m}.${y}`:String(v)}
function dateTimeText(v){if(!v)return'—';try{return new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v))}catch{return String(v)}}
function itemById(id){return state.items.find(x=>x.id===id)||null}
function visibleAmount(x){return x?.amount!==null&&x?.amount!==undefined}
function sumPaid(list){return list.filter(x=>String(x.status||'').toUpperCase()==='PAID'&&visibleAmount(x)).reduce((s,x)=>s+Number(x.amount||0),0)}
function fileSize(bytes){const n=Number(bytes||0);if(n<1024)return `${n} Б`;if(n<1024*1024)return `${(n/1024).toFixed(1)} КБ`;return `${(n/1024/1024).toFixed(1)} МБ`}
function fileExt(name){const m=String(name||'').toLowerCase().match(/\.([a-z0-9]+)$/);return m?m[1]:''}
function inferredMime(file){if(file?.type)return file.type;return({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif',tif:'image/tiff',tiff:'image/tiff',pdf:'application/pdf'})[fileExt(file?.name)]||''}
function randomId(){return globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`}

function fillCategories(){
  $('expenseCategory').innerHTML=categories.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
  $('categoryFilter').innerHTML='<option value="">Все категории</option>'+categories.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
}

async function initContext(){
  const {data:{session}}=await supabase.auth.getSession();
  const uid=session?.user?.id;if(!uid)throw new Error('Нет активной сессии');
  const [profile,org,leader]=await Promise.all([
    supabase.from('users').select('id,full_name').eq('auth_user_id',uid).eq('is_active',true).maybeSingle(),
    supabase.from('organizations').select('id').eq('code','A4PRINT').maybeSingle(),
    supabase.rpc('is_hub_leader')
  ]);
  if(profile.error)throw profile.error;if(org.error)throw org.error;if(leader.error)throw leader.error;
  state.profile=profile.data||null;state.organizationId=org.data?.id||null;state.leader=leader.data===true;
  window.__A4_IS_HUB_LEADER__=state.leader;applyAccessUi();
}

function applyAccessUi(){
  if(state.leader){
    $('pageSubtitle').textContent='Полный журнал рабочих расходов компании';
    $('accessHint').textContent='Руководитель видит все суммы, чеки, может редактировать и выплачивать расходы сотрудникам.';
    $('privacyMeta').textContent='Полный доступ руководителя';
    $('kpi1Label').textContent='Расходы за месяц';$('kpi1Hint').textContent='фактически оплачено';
    $('kpi2Label').textContent='Сегодня';$('kpi2Hint').textContent='фактически оплачено';
    $('kpi4Label').textContent='Средний расход';$('kpi4Hint').textContent='по оплаченным операциям';
  }else{
    $('pageSubtitle').textContent='Внесение рабочих расходов и общий журнал';
    $('accessHint').textContent='Свои суммы, чеки и состояние выплаты видны полностью. У чужих расходов сумма и чек скрыты.';
    $('privacyMeta').textContent='Чужие суммы и чеки скрыты';
    $('kpi1Label').textContent='Мои расходы за месяц';$('kpi1Hint').textContent='только ваши оплаченные расходы';
    $('kpi2Label').textContent='Мои расходы сегодня';$('kpi2Hint').textContent='только ваши оплаченные расходы';
    $('kpi4Label').textContent='Чужие записи';$('kpi4Hint').textContent='суммы скрыты';
  }
}

async function load(){
  if(state.loading)return;state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';
  try{
    const {from,to}=monthBounds($('monthFilter').value);
    const {data,error}=await supabase.rpc('list_expenses_masked',{p_from:from,p_to:to});if(error)throw error;
    state.items=Array.isArray(data)?data:[];render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){console.error('Expenses load failed',error);$('expenseList').innerHTML=`<div class="ex-empty" style="color:#b91c1c">Ошибка загрузки: ${esc(error.message||error)}</div>`}
  finally{state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить'}
}

function filtered(){
  const q=$('search').value.trim().toLowerCase(),category=$('categoryFilter').value,status=$('statusFilter').value;
  return state.items.filter(x=>{const text=[x.title,x.category,x.payment_method,x.counterparty,x.note,x.created_by_name,x.reimbursed_by_name].filter(Boolean).join(' ').toLowerCase();return(!q||text.includes(q))&&(!category||x.category===category)&&(!status||String(x.status||'').toUpperCase()===status)})
}
function renderStats(){
  const paid=state.items.filter(x=>String(x.status||'').toUpperCase()==='PAID'),today=todayMoscow();
  if(state.leader){$('kpi1').textContent=money(sumPaid(state.items));$('kpi2').textContent=money(sumPaid(state.items.filter(x=>x.expense_date===today)));$('kpi3').textContent=String(state.items.length);$('kpi4').textContent=paid.filter(visibleAmount).length?money(sumPaid(paid)/paid.filter(visibleAmount).length):'0 ₽'}
  else{const mine=state.items.filter(x=>x.is_own);$('kpi1').textContent=money(sumPaid(mine));$('kpi2').textContent=money(sumPaid(mine.filter(x=>x.expense_date===today)));$('kpi3').textContent=String(state.items.length);$('kpi4').textContent=String(state.items.filter(x=>!x.is_own).length)}
}
function reimbursementMark(x){if(x.reimbursed_at)return' <span class="receipt-mark">✓ выплачено</span>';if(String(x.status||'').toUpperCase()==='PAID')return' <span class="receipt-mark" style="color:#b45309">• к выплате</span>';return''}
function row(x){
  const masked=!x.can_view_amount||!visibleAmount(x),receipt=x.has_receipt?' <span class="receipt-mark">📎 чек</span>':'',reimbursement=reimbursementMark(x);
  return `<div class="ex-row" data-expense-id="${x.id}" tabindex="0" role="button" aria-label="Открыть расход ${esc(x.title)}"><div class="ex-main"><b>${esc(x.title||'Расход')}</b><small>№${esc(x.expense_number||'—')} · ${esc(dateText(x.expense_date))} · ${esc(x.category||'Без категории')}${receipt}${reimbursement}</small></div><div class="ex-cell"><span>Сотрудник</span><b>${esc(x.created_by_name||'Сотрудник')}${x.is_own?' · вы':''}</b></div><div class="ex-cell"><span>Оплата</span><b>${esc(x.payment_method||'—')}</b></div><div class="ex-cell"><span>Статус</span><b><span class="ex-badge ${statusTone(x.status)}">${esc(statusLabel(x.status))}</span></b></div><div class="ex-amount ${masked?'masked':''}"><strong>${masked?'••• ₽':money(x.amount)}</strong><small>${masked?'скрыто':'сумма'}</small></div></div>`;
}
function render(){renderStats();const rows=filtered();$('visibleCount').textContent=`Показано ${rows.length} из ${state.items.length}`;$('expenseList').innerHTML=rows.map(row).join('')||'<div class="ex-empty">Расходов по выбранным условиям нет</div>'}

function revokePreview(){if(state.previewUrl){URL.revokeObjectURL(state.previewUrl);state.previewUrl=null}}
function resetReceiptUi(existing=null){
  revokePreview();state.receiptFile=null;state.existingReceipt=existing;state.removeReceipt=false;
  $('expenseReceipt').value='';$('expenseReceiptCamera').value='';$('receiptPreview').classList.remove('show');$('receiptPreview').removeAttribute('src');
  if(existing?.path){$('receiptInfoName').textContent=existing.name||'Прикреплённый чек';$('receiptInfoMeta').textContent=`Файл уже сохранён${existing.size?` · ${fileSize(existing.size)}`:''}`;$('clearReceipt').hidden=false}
  else{$('receiptInfoName').textContent='Чек не прикреплён';$('receiptInfoMeta').textContent='JPG, PNG, WebP, HEIC, TIFF или PDF · до 15 МБ';$('clearReceipt').hidden=true}
}
function validateReceipt(file){
  if(!file)return;const ext=fileExt(file.name),mime=inferredMime(file);
  if(file.size>MAX_RECEIPT_SIZE)throw new Error('Чек слишком большой. Максимальный размер — 15 МБ.');
  if(!allowedExt.has(ext)||!allowedMime.has(mime))throw new Error('Поддерживаются JPG, PNG, WebP, HEIC, TIFF и PDF.');
}
function chooseReceipt(file){
  try{validateReceipt(file)}catch(error){window.alert(error.message||error);return}
  if(!file)return;revokePreview();state.receiptFile=file;state.removeReceipt=false;
  $('receiptInfoName').textContent=file.name;$('receiptInfoMeta').textContent=`${fileSize(file.size)} · ${inferredMime(file)}`;$('clearReceipt').hidden=false;
  if(inferredMime(file).startsWith('image/')){state.previewUrl=URL.createObjectURL(file);$('receiptPreview').src=state.previewUrl;$('receiptPreview').classList.add('show')}else{$('receiptPreview').classList.remove('show');$('receiptPreview').removeAttribute('src')}
}
function clearReceipt(){
  revokePreview();state.receiptFile=null;state.removeReceipt=!!state.existingReceipt?.path;$('expenseReceipt').value='';$('expenseReceiptCamera').value='';$('receiptPreview').classList.remove('show');$('receiptPreview').removeAttribute('src');
  $('receiptInfoName').textContent=state.removeReceipt?'Чек будет удалён':'Чек не прикреплён';$('receiptInfoMeta').textContent=state.removeReceipt?'Сохраните изменения, чтобы удалить вложение':'JPG, PNG, WebP, HEIC, TIFF или PDF · до 15 МБ';$('clearReceipt').hidden=true;
}
async function uploadReceipt(file,ownerId){
  validateReceipt(file);const ext=fileExt(file.name)||'bin',path=`${ownerId}/${randomId()}.${ext}`;const mime=inferredMime(file);
  const {error}=await supabase.storage.from(RECEIPT_BUCKET).upload(path,file,{contentType:mime,cacheControl:'3600',upsert:false});if(error)throw error;
  return{path,name:file.name,mime,size:file.size};
}
async function removeStoredReceipt(path){if(!path)return;const {error}=await supabase.storage.from(RECEIPT_BUCKET).remove([path]);if(error)console.warn('Receipt cleanup failed',error)}

function openCreate(){
  state.editingId=null;state.editingOwnerId=state.profile?.id||null;$('expenseForm').reset();$('expenseDlgTitle').textContent='Новый расход';$('saveExpense').textContent='Сохранить расход';$('expenseError').textContent='';$('expenseError').className='ex-msg';
  $('expenseDate').value=todayMoscow();$('expenseCategory').value='Материалы';$('expenseMethod').value='Наличные';$('expenseStatus').value='PAID';resetReceiptUi();$('expenseDlg').showModal();
}
function openEdit(x){
  if(!state.leader||!x)return;state.editingId=x.id;state.editingOwnerId=x.created_by||state.profile?.id||null;$('expenseDlgTitle').textContent=`Редактирование расхода №${x.expense_number||'—'}`;$('saveExpense').textContent='Сохранить изменения';$('expenseError').textContent='';$('expenseError').className='ex-msg';
  $('expenseDate').value=x.expense_date||todayMoscow();$('expenseAmount').value=x.amount??'';$('expenseCategory').value=x.category||'Прочее';$('expenseMethod').value=x.payment_method||'Другое';$('expenseTitle').value=x.title||'';$('expenseCounterparty').value=x.counterparty||'';$('expenseStatus').value=x.status||'PAID';$('expenseNote').value=x.note||'';
  resetReceiptUi(x.receipt_path?{path:x.receipt_path,name:x.receipt_name,mime:x.receipt_mime,size:x.receipt_size}:null);$('detailDlg').close();$('expenseDlg').showModal();
}
function detailItem(label,value,full=false){return `<div class="ex-detail ${full?'full':''}"><span>${esc(label)}</span><b>${value}</b></div>`}
function reimbursementText(x){
  if(x.reimbursed_at)return `<span class="ex-badge green">Выплачено</span> ${esc(dateTimeText(x.reimbursed_at))}${x.reimbursed_by_name?` · ${esc(x.reimbursed_by_name)}`:''}`;
  if(String(x.status||'').toUpperCase()==='PAID')return '<span class="ex-badge orange">К выплате</span>';
  if(String(x.status||'').toUpperCase()==='CANCELLED')return 'Не требуется';
  return 'После фактической оплаты';
}
function openDetail(x){
  if(!x)return;state.selectedId=x.id;$('detailTitle').textContent=x.title||'Расход';$('detailSubtitle').textContent=`Расход №${x.expense_number||'—'} · ${dateText(x.expense_date)}`;
  const masked=!x.can_view_amount||!visibleAmount(x);$('detailPrivacy').style.display=masked?'block':'none';
  let receipt='—';if(masked&&x.has_receipt)receipt='Скрыт';else if(x.receipt_path)receipt=`<button class="ex-receipt-link" type="button" data-open-receipt="${x.id}">📎 Открыть чек</button>${x.receipt_name?` <small>${esc(x.receipt_name)}</small>`:''}`;else if(x.document_url)receipt=`<a class="ex-receipt-link" href="${esc(x.document_url)}" target="_blank" rel="noopener">Открыть документ</a>`;
  $('detailBody').innerHTML=[detailItem('Сумма',masked?'••• ₽':money(x.amount)),detailItem('Категория',esc(x.category||'—')),detailItem('Сотрудник',esc(x.created_by_name||'Сотрудник')),detailItem('Статус',esc(statusLabel(x.status))),detailItem('Способ оплаты',esc(x.payment_method||'—')),detailItem('Контрагент',esc(x.counterparty||'—')),detailItem('Выплата сотруднику',reimbursementText(x),true),detailItem('Комментарий',esc(x.note||'—'),true),detailItem('Чек / документ',receipt,true)].join('');
  $('editExpense').hidden=!state.leader;$('deleteExpense').hidden=!state.leader;
  const canReimburse=state.leader&&String(x.status||'').toUpperCase()==='PAID'&&!x.reimbursed_at;
  $('reimburseExpense').hidden=!canReimburse;$('reimburseExpense').textContent=canReimburse&&visibleAmount(x)?`✓ Выплатить ${money(x.amount)}`:'✓ Выплатить расход';
  $('detailDlg').showModal();
}
async function openReceipt(x){
  if(!x?.receipt_path)return;const win=window.open('about:blank','_blank');
  try{const {data,error}=await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(x.receipt_path,180);if(error)throw error;if(!data?.signedUrl)throw new Error('Не удалось получить ссылку на чек');if(win)win.location.href=data.signedUrl;else window.location.href=data.signedUrl}
  catch(error){try{win?.close()}catch{}window.alert(`Не удалось открыть чек: ${error.message||error}`)}
}

async function reimburseSelected(){
  if(!state.leader)return;const x=itemById(state.selectedId);if(!x||x.reimbursed_at)return;
  if(String(x.status||'').toUpperCase()!=='PAID'){window.alert('Выплатить можно только фактически оплаченный расход.');return}
  const amount=visibleAmount(x)?money(x.amount):'этот расход';
  if(!window.confirm(`Выплатить ${amount} сотруднику «${x.created_by_name||'Сотрудник'}» по расходу «${x.title||'Расход'}»?`))return;
  const b=$('reimburseExpense'),oldText=b.textContent;b.disabled=true;b.textContent='Выплата…';
  try{
    const {error}=await supabase.rpc('reimburse_expense',{p_expense_id:x.id});if(error)throw error;
    $('detailDlg').close();await load();const fresh=itemById(x.id);if(fresh)openDetail(fresh);
  }catch(error){window.alert(`Не удалось выплатить расход: ${error.message||error}`)}
  finally{b.disabled=false;b.textContent=oldText}
}

async function saveExpense(event){
  event.preventDefault();const button=$('saveExpense');button.disabled=true;button.classList.add('ex-uploading');$('expenseError').textContent='';$('expenseError').className='ex-msg';let uploaded=null;
  try{
    if(!state.profile?.id)throw new Error('Профиль сотрудника не найден');const amount=Number($('expenseAmount').value);if(!(amount>0))throw new Error('Сумма должна быть больше нуля');
    const payload={expense_date:$('expenseDate').value,category:$('expenseCategory').value,title:$('expenseTitle').value.trim(),amount,payment_method:$('expenseMethod').value||null,counterparty:$('expenseCounterparty').value.trim()||null,status:$('expenseStatus').value,note:$('expenseNote').value.trim()||null,updated_at:new Date().toISOString()};if(!payload.title)throw new Error('Укажите, на что потрачены деньги');
    const old=state.editingId?itemById(state.editingId):null,ownerId=state.editingOwnerId||state.profile.id;
    if(state.receiptFile){button.textContent='Загрузка чека…';uploaded=await uploadReceipt(state.receiptFile,ownerId);payload.receipt_path=uploaded.path;payload.receipt_name=uploaded.name;payload.receipt_mime=uploaded.mime;payload.receipt_size=uploaded.size;payload.document_url=null}
    else if(state.removeReceipt){payload.receipt_path=null;payload.receipt_name=null;payload.receipt_mime=null;payload.receipt_size=null;payload.document_url=null}
    button.textContent='Сохранение…';
    if(state.editingId){if(!state.leader)throw new Error('Редактирование доступно только руководителю');const {error}=await supabase.from('expenses').update(payload).eq('id',state.editingId);if(error)throw error}
    else{payload.organization_id=state.organizationId;payload.created_by=state.profile.id;const {error}=await supabase.from('expenses').insert(payload);if(error)throw error}
    if(old?.receipt_path&&(uploaded||state.removeReceipt)&&old.receipt_path!==uploaded?.path)await removeStoredReceipt(old.receipt_path);
    $('expenseDlg').close();state.editingId=null;state.editingOwnerId=null;resetReceiptUi();await load();
  }catch(error){if(uploaded?.path)await removeStoredReceipt(uploaded.path);$('expenseError').textContent=error.message||String(error);$('expenseError').className='ex-msg error'}
  finally{button.disabled=false;button.classList.remove('ex-uploading');button.textContent=state.editingId?'Сохранить изменения':'Сохранить расход'}
}
async function deleteSelected(){
  if(!state.leader)return;const x=itemById(state.selectedId);if(!x||!window.confirm(`Удалить расход «${x.title}»?`))return;const b=$('deleteExpense');b.disabled=true;
  try{const {error}=await supabase.from('expenses').delete().eq('id',x.id);if(error)throw error;if(x.receipt_path)await removeStoredReceipt(x.receipt_path);$('detailDlg').close();await load()}catch(error){window.alert(`Не удалось удалить расход: ${error.message||error}`)}finally{b.disabled=false}
}

fillCategories();$('monthFilter').value=currentMonth();
$('refresh').addEventListener('click',load);$('addExpense').addEventListener('click',openCreate);$('addExpenseInline').addEventListener('click',openCreate);$('closeExpenseDlg').addEventListener('click',()=>$('expenseDlg').close());$('cancelExpense').addEventListener('click',()=>$('expenseDlg').close());$('expenseForm').addEventListener('submit',saveExpense);
$('pickReceipt').addEventListener('click',()=>$('expenseReceipt').click());$('cameraReceipt').addEventListener('click',()=>$('expenseReceiptCamera').click());$('clearReceipt').addEventListener('click',clearReceipt);$('expenseReceipt').addEventListener('change',e=>chooseReceipt(e.target.files?.[0]));$('expenseReceiptCamera').addEventListener('change',e=>chooseReceipt(e.target.files?.[0]));
$('search').addEventListener('input',render);$('categoryFilter').addEventListener('change',render);$('statusFilter').addEventListener('change',render);$('monthFilter').addEventListener('change',load);$('clearFilters').addEventListener('click',()=>{$('search').value='';$('categoryFilter').value='';$('statusFilter').value='';$('monthFilter').value=currentMonth();load()});
$('closeDetailDlg').addEventListener('click',()=>$('detailDlg').close());$('closeDetailBtn').addEventListener('click',()=>$('detailDlg').close());$('editExpense').addEventListener('click',()=>openEdit(itemById(state.selectedId)));$('deleteExpense').addEventListener('click',deleteSelected);$('reimburseExpense').addEventListener('click',reimburseSelected);$('detailBody').addEventListener('click',e=>{const b=e.target.closest('[data-open-receipt]');if(b)openReceipt(itemById(b.dataset.openReceipt))});
$('expenseList').addEventListener('click',e=>{const r=e.target.closest('[data-expense-id]');if(r)openDetail(itemById(r.dataset.expenseId))});$('expenseList').addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key))return;const r=e.target.closest('[data-expense-id]');if(r){e.preventDefault();openDetail(itemById(r.dataset.expenseId))}});
window.addEventListener('beforeunload',revokePreview,{once:true});
try{await initContext();resetReceiptUi();await load()}catch(error){console.error('Expenses init failed',error);$('expenseList').innerHTML=`<div class="ex-empty" style="color:#b91c1c">Ошибка инициализации: ${esc(error.message||error)}</div>`}
