import{supabase}from'./guard.js?v=20260905-netfix1';

const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const today=()=>new Date().toISOString().slice(0,10);
const state={contracts:[],assets:[],periods:[],loaded:false};

function styles(){
  if(document.getElementById('eaw-style'))return;
  const s=document.createElement('style');s.id='eaw-style';s.textContent=`
  .eaw-dialog{border:0;border-radius:18px;padding:0;width:min(900px,calc(100vw - 24px));max-height:94vh;box-shadow:0 24px 70px #0f172a40}
  .eaw-dialog::backdrop{background:#0f172a80}.eaw-head,.eaw-foot{padding:15px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid #e2e8f0}
  .eaw-foot{border-top:1px solid #e2e8f0;border-bottom:0;justify-content:flex-end}.eaw-body{padding:18px;overflow:auto}.eaw-grid{display:grid;grid-template-columns:1.4fr .8fr;gap:12px}
  .eaw-field span{display:block;font-size:12px;font-weight:800;color:#475569;margin-bottom:5px}.eaw-field input,.eaw-field select,.eaw-field textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:10px;background:#fff}
  .eaw-full{grid-column:1/-1}.eaw-note{font-size:12px;color:#475569;background:#eff6ff;padding:10px 12px;border-radius:10px;margin-top:12px}.eaw-list{display:grid;gap:10px;margin-top:14px}
  .eaw-row{display:grid;grid-template-columns:minmax(0,1.5fr) .55fr .55fr auto;gap:10px;align-items:end;border:1px solid #e2e8f0;border-radius:12px;padding:12px}
  .eaw-row label span{display:block;font-size:11px;font-weight:800;color:#64748b;margin-bottom:4px}.eaw-row input,.eaw-row select{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:9px;padding:8px;background:#fff}
  .eaw-old{padding:8px;border-radius:9px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:800}.eaw-remove{color:#991b1b;border-color:#fecaca}.eaw-error{margin-top:10px;padding:10px 12px;border-radius:10px;background:#fef2f2;color:#991b1b}
  @media(max-width:700px){.eaw-grid,.eaw-row{grid-template-columns:1fr}.eaw-full{grid-column:auto}}
  `;document.head.appendChild(s);
}

function install(){
  const host=document.querySelector('.eca-head-actions');
  if(!host||document.getElementById('ecaAllocationCreate'))return;
  styles();
  const btn=document.createElement('button');
  btn.id='ecaAllocationCreate';btn.type='button';btn.textContent='+ Изменить веса';
  host.appendChild(btn);

  const dlg=document.createElement('dialog');
  dlg.id='eawDlg';dlg.className='eaw-dialog';
  dlg.innerHTML=`
  <form id="eawForm">
    <div class="eaw-head"><div><h2 style="margin:0">Изменение веса распределения</h2><p style="margin:4px 0 0;color:#64748b;font-size:12px">Вес влияет на распределение аренды. После подписи ДС история периода будет разделена с даты вступления.</p></div><button type="button" id="eawClose">×</button></div>
    <div class="eaw-body">
      <div class="eaw-grid">
        <label class="eaw-field"><span>Договор *</span><select id="eawContract" required></select></label>
        <label class="eaw-field"><span>Вступает в силу *</span><input id="eawEffective" type="date" required></label>
        <label class="eaw-field eaw-full"><span>Основание / причина *</span><textarea id="eawReason" rows="3" required></textarea></label>
      </div>
      <div class="eaw-note">Можно изменить несколько аппаратов одним ДС. Старый вес действует до дня перед effective date; новый — с effective date. Уже утверждённые lease snapshots не пересчитываются.</div>
      <div id="eawList" class="eaw-list"></div>
      <button type="button" id="eawAddRow" style="margin-top:10px">+ Добавить аппарат</button>
      <div id="eawError"></div>
    </div>
    <div class="eaw-foot"><button type="button" id="eawCancel">Отмена</button><button class="primary" type="submit">Создать черновик ДС</button></div>
  </form>`;
  document.body.appendChild(dlg);

  btn.onclick=open;
  document.getElementById('eawClose').onclick=()=>dlg.close();
  document.getElementById('eawCancel').onclick=()=>dlg.close();
  document.getElementById('eawAddRow').onclick=addRow;
  document.getElementById('eawContract').onchange=refreshRows;
  document.getElementById('eawEffective').onchange=refreshRows;
  document.getElementById('eawForm').onsubmit=submit;
  document.getElementById('eawList').onclick=e=>{
    const b=e.target.closest('[data-eaw-delete]');
    if(b)b.closest('.eaw-row')?.remove();
  };
  document.getElementById('eawList').onchange=e=>{
    const s=e.target.closest('[data-eaw-equipment]');
    if(s)refreshOldWeight(s.closest('.eaw-row'));
  };
}

async function ensureData(){
  if(state.loaded)return;
  const[c,a,p]=await Promise.all([
    supabase.from('equipment_contracts').select('id,contract_number,status,organization_id,starts_on,ends_on').in('status',['ACTIVE','SUSPENDED']).order('contract_number'),
    supabase.from('equipment_assets').select('id,organization_id,inventory_number,name,brand,model').order('inventory_number'),
    supabase.from('equipment_contract_assets').select('id,contract_id,equipment_id,starts_on,ends_on,allocation_weight').order('starts_on')
  ]);
  if(c.error)throw c.error;if(a.error)throw a.error;if(p.error)throw p.error;
  state.contracts=c.data||[];state.assets=a.data||[];state.periods=p.data||[];state.loaded=true;
}

async function open(){
  const err=document.getElementById('eawError');err.innerHTML='';
  try{
    state.loaded=false;await ensureData();
    const sel=document.getElementById('eawContract');
    sel.innerHTML='<option value="">Выберите договор</option>'+state.contracts.map(c=>`<option value="${c.id}">${esc(c.contract_number)} · ${esc(c.status)}</option>`).join('');
    document.getElementById('eawEffective').value=today();
    document.getElementById('eawReason').value='';
    document.getElementById('eawList').innerHTML='';
    document.getElementById('eawDlg').showModal();
  }catch(e){alert(friendly(e))}
}

function activePeriod(equipmentId){
  const cid=document.getElementById('eawContract').value;
  const date=document.getElementById('eawEffective').value;
  return state.periods
    .filter(p=>p.contract_id===cid&&p.equipment_id===equipmentId&&p.starts_on<=date&&(!p.ends_on||date<=p.ends_on))
    .sort((a,b)=>String(b.starts_on).localeCompare(String(a.starts_on)))[0]||null;
}

function candidates(){
  const cid=document.getElementById('eawContract').value;
  const date=document.getElementById('eawEffective').value;
  const c=state.contracts.find(x=>x.id===cid);
  if(!c||!date)return[];
  const activeIds=new Set(state.periods.filter(p=>p.contract_id===cid&&p.starts_on<=date&&(!p.ends_on||date<=p.ends_on)).map(p=>p.equipment_id));
  return state.assets.filter(a=>a.organization_id===c.organization_id&&activeIds.has(a.id));
}

function label(a){return [a.inventory_number,a.name,[a.brand,a.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}

function rowHtml(){
  return `<div class="eaw-row">
    <label><span>Оборудование *</span><select data-eaw-equipment required><option value="">Выберите</option>${candidates().map(a=>`<option value="${a.id}">${esc(label(a))}</option>`).join('')}</select></label>
    <label><span>Старый вес</span><div class="eaw-old" data-eaw-old>—</div></label>
    <label><span>Новый вес *</span><input data-eaw-new type="number" min="0.0001" step="0.0001" required></label>
    <button type="button" class="eaw-remove" data-eaw-delete>Удалить</button>
    <label style="grid-column:1/-1"><span>Комментарий</span><input data-eaw-note type="text" placeholder="Почему меняется вес"></label>
  </div>`;
}

function addRow(){document.getElementById('eawList').insertAdjacentHTML('beforeend',rowHtml())}

function refreshRows(){
  const opts=candidates();
  for(const row of document.querySelectorAll('#eawList .eaw-row')){
    const sel=row.querySelector('[data-eaw-equipment]'),old=sel.value;
    sel.innerHTML='<option value="">Выберите</option>'+opts.map(a=>`<option value="${a.id}">${esc(label(a))}</option>`).join('');
    if(opts.some(x=>x.id===old))sel.value=old;
    refreshOldWeight(row);
  }
}

function refreshOldWeight(row){
  const id=row.querySelector('[data-eaw-equipment]')?.value;
  const p=id?activePeriod(id):null;
  row.querySelector('[data-eaw-old]').textContent=p?String(p.allocation_weight):'—';
}

async function submit(ev){
  ev.preventDefault();
  const submit=ev.submitter,err=document.getElementById('eawError');err.innerHTML='';submit.disabled=true;
  try{
    const rows=[...document.querySelectorAll('#eawList .eaw-row')];
    if(!rows.length)throw new Error('ALLOCATION_CHANGES_REQUIRED');
    const changes=rows.map(row=>{
      const equipment_id=row.querySelector('[data-eaw-equipment]').value;
      const p=activePeriod(equipment_id);
      const allocation_weight=Number(row.querySelector('[data-eaw-new]').value);
      if(!p)throw new Error('EQUIPMENT_NOT_ACTIVE_FOR_ALLOCATION_CHANGE');
      if(!Number.isFinite(allocation_weight)||allocation_weight<=0)throw new Error('INVALID_ALLOCATION_WEIGHT');
      if(Number(p.allocation_weight)===allocation_weight)throw new Error('ALLOCATION_WEIGHT_UNCHANGED');
      return{equipment_id,allocation_weight,note:row.querySelector('[data-eaw-note]').value.trim()||null};
    });
    if(new Set(changes.map(x=>x.equipment_id)).size!==changes.length)throw new Error('DUPLICATE_EQUIPMENT_CHANGE');
    const{error}=await supabase.rpc('create_equipment_allocation_weight_amendment',{
      p_contract_id:document.getElementById('eawContract').value,
      p_effective_on:document.getElementById('eawEffective').value,
      p_changes:changes,
      p_reason:document.getElementById('eawReason').value
    });
    if(error)throw error;
    document.getElementById('eawDlg').close();
    document.getElementById('ecaRefresh')?.click();
  }catch(e){
    err.innerHTML=`<div class="eaw-error">${esc(friendly(e))}</div>`;
  }finally{submit.disabled=false}
}

function friendly(e){
  const m=String(e?.message||e||'Ошибка');
  const map=[
    ['STAFF_CONTEXT_REQUIRED','Операция доступна только из рабочего места сотрудника HUB.'],
    ['ALLOCATION_CHANGES_REQUIRED','Добавьте хотя бы один аппарат.'],
    ['EQUIPMENT_NOT_ACTIVE_FOR_ALLOCATION_CHANGE','Оборудование не входит в договор на выбранную дату.'],
    ['ALLOCATION_WEIGHT_UNCHANGED','Новый вес должен отличаться от текущего.'],
    ['INVALID_ALLOCATION_WEIGHT','Вес должен быть больше нуля.'],
    ['DUPLICATE_EQUIPMENT_CHANGE','Один аппарат нельзя указывать дважды.'],
    ['PAST_EFFECTIVE_DATE_NOT_ALLOWED','Дата вступления в силу не может быть в прошлом.']
  ];
  for(const[k,v]of map)if(m.includes(k))return v;
  return m;
}

document.readyState==='loading'?document.addEventListener('DOMContentLoaded',install,{once:true}):install();
