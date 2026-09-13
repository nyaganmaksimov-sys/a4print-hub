import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>v===null||v===undefined?'••• ₽':Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})+' ₽';
const categories=['Материалы','Аренда','Доставка','Ремонт и обслуживание','Реклама','Канцелярия','Связь и интернет','Транспорт','Оборудование','Комиссии и банк','Зарплата и выплаты','Прочее'];
const state={items:[],leader:false,profile:null,organizationId:null,loading:false,editingId:null,selectedId:null};

function moscowParts(){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]))}
function currentMonth(){const p=moscowParts();return `${p.year}-${p.month}`}
function todayMoscow(){const p=moscowParts();return `${p.year}-${p.month}-${p.day}`}
function monthBounds(value){const m=/^(\d{4})-(\d{2})$/.exec(value||'')||/^(\d{4})-(\d{2})$/.exec(currentMonth());let y=Number(m[1]),mo=Number(m[2]);const from=`${y}-${String(mo).padStart(2,'0')}-01`;mo++;if(mo===13){mo=1;y++}return{from,to:`${y}-${String(mo).padStart(2,'0')}-01`}}
function statusLabel(v){return({PAID:'Оплачен',PLANNED:'Запланирован',CANCELLED:'Отменён'})[String(v||'').toUpperCase()]||v||'—'}
function statusTone(v){const s=String(v||'').toUpperCase();return s==='PAID'?'green':s==='CANCELLED'?'red':'orange'}
function dateText(v){if(!v)return'—';const [y,m,d]=String(v).split('-');return y&&m&&d?`${d}.${m}.${y}`:String(v)}
function itemById(id){return state.items.find(x=>x.id===id)||null}
function visibleAmount(x){return x?.amount!==null&&x?.amount!==undefined}
function sumPaid(list){return list.filter(x=>String(x.status||'').toUpperCase()==='PAID'&&visibleAmount(x)).reduce((s,x)=>s+Number(x.amount||0),0)}

function fillCategories(){
  $('expenseCategory').innerHTML=categories.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
  $('categoryFilter').innerHTML='<option value="">Все категории</option>'+categories.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
}

async function initContext(){
  const {data:{session}}=await supabase.auth.getSession();
  const uid=session?.user?.id;
  if(!uid)throw new Error('Нет активной сессии');
  const [profile,org,leader]=await Promise.all([
    supabase.from('users').select('id,full_name').eq('auth_user_id',uid).eq('is_active',true).maybeSingle(),
    supabase.from('organizations').select('id').eq('code','A4PRINT').maybeSingle(),
    supabase.rpc('is_hub_leader')
  ]);
  if(profile.error)throw profile.error;
  state.profile=profile.data||null;
  state.organizationId=org.data?.id||null;
  state.leader=leader.data===true;
  window.__A4_IS_HUB_LEADER__=state.leader;
  applyAccessUi();
}

function applyAccessUi(){
  if(state.leader){
    $('pageSubtitle').textContent='Полный журнал рабочих расходов компании';
    $('accessHint').textContent='Руководитель видит все суммы, документы и может редактировать записи.';
    $('privacyMeta').textContent='Полный доступ руководителя';
    $('kpi1Label').textContent='Расходы за месяц';$('kpi1Hint').textContent='фактически оплачено';
    $('kpi2Label').textContent='Сегодня';$('kpi2Hint').textContent='фактически оплачено';
    $('kpi4Label').textContent='Средний расход';$('kpi4Hint').textContent='по оплаченным операциям';
  }else{
    $('pageSubtitle').textContent='Внесение рабочих расходов и общий журнал';
    $('accessHint').textContent='Свои суммы видны полностью. У расходов других сотрудников сумма и чек скрыты.';
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
    const {data,error}=await supabase.rpc('list_expenses_masked',{p_from:from,p_to:to});
    if(error)throw error;
    state.items=Array.isArray(data)?data:[];
    render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){
    console.error('Expenses load failed',error);
    $('expenseList').innerHTML=`<div class="ex-empty" style="color:#b91c1c">Ошибка загрузки: ${esc(error.message||error)}</div>`;
  }finally{state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить'}
}

function filtered(){
  const q=$('search').value.trim().toLowerCase(),category=$('categoryFilter').value,status=$('statusFilter').value;
  return state.items.filter(x=>{
    const text=[x.title,x.category,x.payment_method,x.counterparty,x.note,x.created_by_name].filter(Boolean).join(' ').toLowerCase();
    if(q&&!text.includes(q))return false;
    if(category&&x.category!==category)return false;
    if(status&&String(x.status||'').toUpperCase()!==status)return false;
    return true;
  });
}

function renderStats(){
  const paid=state.items.filter(x=>String(x.status||'').toUpperCase()==='PAID');
  const today=todayMoscow();
  if(state.leader){
    $('kpi1').textContent=money(sumPaid(state.items));
    $('kpi2').textContent=money(sumPaid(state.items.filter(x=>x.expense_date===today)));
    $('kpi3').textContent=String(state.items.length);
    const visiblePaid=paid.filter(visibleAmount);$('kpi4').textContent=visiblePaid.length?money(sumPaid(visiblePaid)/visiblePaid.length):'0 ₽';
  }else{
    const mine=state.items.filter(x=>x.is_own);
    $('kpi1').textContent=money(sumPaid(mine));
    $('kpi2').textContent=money(sumPaid(mine.filter(x=>x.expense_date===today)));
    $('kpi3').textContent=String(state.items.length);
    $('kpi4').textContent=String(state.items.filter(x=>!x.is_own).length);
  }
}

function row(x){
  const masked=!x.can_view_amount||!visibleAmount(x);
  return `<div class="ex-row" data-expense-id="${x.id}" tabindex="0" role="button" aria-label="Открыть расход ${esc(x.title)}">
    <div class="ex-main"><b>${esc(x.title||'Расход')}</b><small>№${esc(x.expense_number||'—')} · ${esc(dateText(x.expense_date))} · ${esc(x.category||'Без категории')}</small></div>
    <div class="ex-cell"><span>Сотрудник</span><b>${esc(x.created_by_name||'Сотрудник')}${x.is_own?' · вы':''}</b></div>
    <div class="ex-cell"><span>Оплата</span><b>${esc(x.payment_method||'—')}</b></div>
    <div class="ex-cell"><span>Статус</span><b><span class="ex-badge ${statusTone(x.status)}">${esc(statusLabel(x.status))}</span></b></div>
    <div class="ex-amount ${masked?'masked':''}"><strong>${masked?'••• ₽':money(x.amount)}</strong><small>${masked?'скрыто':'сумма'}</small></div>
  </div>`;
}

function render(){
  renderStats();
  const rows=filtered();
  $('visibleCount').textContent=`Показано ${rows.length} из ${state.items.length}`;
  $('expenseList').innerHTML=rows.map(row).join('')||'<div class="ex-empty">Расходов по выбранным условиям нет</div>';
}

function openCreate(){
  state.editingId=null;$('expenseForm').reset();$('expenseDlgTitle').textContent='Новый расход';$('saveExpense').textContent='Сохранить расход';$('expenseError').textContent='';$('expenseError').className='ex-msg';
  $('expenseDate').value=todayMoscow();$('expenseCategory').value='Материалы';$('expenseMethod').value='Наличные';$('expenseStatus').value='PAID';$('expenseDlg').showModal();
}

function openEdit(x){
  if(!state.leader||!x)return;
  state.editingId=x.id;$('expenseDlgTitle').textContent=`Редактирование расхода №${x.expense_number||'—'}`;$('saveExpense').textContent='Сохранить изменения';$('expenseError').textContent='';$('expenseError').className='ex-msg';
  $('expenseDate').value=x.expense_date||todayMoscow();$('expenseAmount').value=x.amount??'';$('expenseCategory').value=x.category||'Прочее';$('expenseMethod').value=x.payment_method||'Другое';$('expenseTitle').value=x.title||'';$('expenseCounterparty').value=x.counterparty||'';$('expenseStatus').value=x.status||'PAID';$('expenseNote').value=x.note||'';$('expenseDocument').value=x.document_url||'';$('detailDlg').close();$('expenseDlg').showModal();
}

function detailItem(label,value,full=false){return `<div class="ex-detail ${full?'full':''}"><span>${esc(label)}</span><b>${value}</b></div>`}
function openDetail(x){
  if(!x)return;state.selectedId=x.id;
  $('detailTitle').textContent=x.title||'Расход';$('detailSubtitle').textContent=`Расход №${x.expense_number||'—'} · ${dateText(x.expense_date)}`;
  const masked=!x.can_view_amount||!visibleAmount(x);$('detailPrivacy').style.display=masked?'block':'none';
  const doc=x.document_url?`<a href="${esc(x.document_url)}" target="_blank" rel="noopener">Открыть документ</a>`:(masked?'Скрыт':'—');
  $('detailBody').innerHTML=[
    detailItem('Сумма',masked?'••• ₽':money(x.amount)),detailItem('Категория',esc(x.category||'—')),
    detailItem('Сотрудник',esc(x.created_by_name||'Сотрудник')),detailItem('Статус',esc(statusLabel(x.status))),
    detailItem('Способ оплаты',esc(x.payment_method||'—')),detailItem('Контрагент',esc(x.counterparty||'—')),
    detailItem('Комментарий',esc(x.note||'—'),true),detailItem('Чек / документ',doc,true)
  ].join('');
  $('editExpense').hidden=!state.leader;$('deleteExpense').hidden=!state.leader;$('detailDlg').showModal();
}

async function saveExpense(event){
  event.preventDefault();const button=$('saveExpense');button.disabled=true;$('expenseError').textContent='';$('expenseError').className='ex-msg';
  try{
    if(!state.profile?.id)throw new Error('Профиль сотрудника не найден');
    const amount=Number($('expenseAmount').value);if(!(amount>0))throw new Error('Сумма должна быть больше нуля');
    const payload={expense_date:$('expenseDate').value,category:$('expenseCategory').value,title:$('expenseTitle').value.trim(),amount,payment_method:$('expenseMethod').value||null,counterparty:$('expenseCounterparty').value.trim()||null,status:$('expenseStatus').value,note:$('expenseNote').value.trim()||null,document_url:$('expenseDocument').value.trim()||null,updated_at:new Date().toISOString()};
    if(!payload.title)throw new Error('Укажите, на что потрачены деньги');
    if(state.editingId){
      if(!state.leader)throw new Error('Редактирование доступно только руководителю');
      const {error}=await supabase.from('expenses').update(payload).eq('id',state.editingId);if(error)throw error;
    }else{
      payload.organization_id=state.organizationId;payload.created_by=state.profile.id;
      const {error}=await supabase.from('expenses').insert(payload);if(error)throw error;
    }
    $('expenseDlg').close();state.editingId=null;await load();
  }catch(error){$('expenseError').textContent=error.message||String(error);$('expenseError').className='ex-msg error'}finally{button.disabled=false}
}

async function deleteSelected(){
  if(!state.leader)return;const x=itemById(state.selectedId);if(!x)return;
  if(!window.confirm(`Удалить расход «${x.title}»?`))return;
  const b=$('deleteExpense');b.disabled=true;
  try{const {error}=await supabase.from('expenses').delete().eq('id',x.id);if(error)throw error;$('detailDlg').close();await load()}catch(error){window.alert(`Не удалось удалить расход: ${error.message||error}`)}finally{b.disabled=false}
}

fillCategories();$('monthFilter').value=currentMonth();
$('refresh').addEventListener('click',load);$('addExpense').addEventListener('click',openCreate);$('closeExpenseDlg').addEventListener('click',()=>$('expenseDlg').close());$('cancelExpense').addEventListener('click',()=>$('expenseDlg').close());$('expenseForm').addEventListener('submit',saveExpense);
$('search').addEventListener('input',render);$('categoryFilter').addEventListener('change',render);$('statusFilter').addEventListener('change',render);$('monthFilter').addEventListener('change',load);$('clearFilters').addEventListener('click',()=>{$('search').value='';$('categoryFilter').value='';$('statusFilter').value='';$('monthFilter').value=currentMonth();load()});
$('closeDetailDlg').addEventListener('click',()=>$('detailDlg').close());$('closeDetailBtn').addEventListener('click',()=>$('detailDlg').close());$('editExpense').addEventListener('click',()=>openEdit(itemById(state.selectedId)));$('deleteExpense').addEventListener('click',deleteSelected);
$('expenseList').addEventListener('click',e=>{const row=e.target.closest('[data-expense-id]');if(row)openDetail(itemById(row.dataset.expenseId))});$('expenseList').addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key))return;const row=e.target.closest('[data-expense-id]');if(row){e.preventDefault();openDetail(itemById(row.dataset.expenseId))}});
window.addEventListener('focus',()=>{if(!document.hidden)load()});document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});

await initContext();await load();
