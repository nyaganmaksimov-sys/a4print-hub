import{supabase}from'./guard.js?v=20260905-netfix1';

const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const today=()=>new Date().toISOString().slice(0,10);
const state={contracts:[],assets:[],periods:[],loaded:false};

function styles(){
  if(document.getElementById('eca-composition-style'))return;
  const s=document.createElement('style');
  s.id='eca-composition-style';
  s.textContent=`
  .ecc-dialog{border:0;border-radius:18px;padding:0;width:min(1040px,calc(100vw - 24px));max-height:94vh;box-shadow:0 24px 70px #0f172a40}
  .ecc-dialog::backdrop{background:#0f172a80}.ecc-head,.ecc-foot{padding:15px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid #e2e8f0}
  .ecc-foot{border-top:1px solid #e2e8f0;border-bottom:0;justify-content:flex-end}.ecc-body{padding:18px;overflow:auto}.ecc-grid{display:grid;grid-template-columns:1.4fr .8fr;gap:12px}
  .ecc-field span{display:block;font-size:12px;font-weight:800;color:#475569;margin-bottom:5px}.ecc-field input,.ecc-field select,.ecc-field textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:10px;background:#fff}
  .ecc-full{grid-column:1/-1}.ecc-section{margin-top:16px;border:1px solid #e2e8f0;border-radius:14px;padding:14px}.ecc-section-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px}.ecc-section h3{margin:0}
  .ecc-list{display:grid;gap:10px}.ecc-row{border:1px solid #e2e8f0;border-radius:12px;padding:12px;display:grid;grid-template-columns:1.5fr .7fr .8fr .6fr;gap:9px}
  .ecc-row .wide{grid-column:span 2}.ecc-row .full{grid-column:1/-1}.ecc-row label span{display:block;font-size:11px;font-weight:800;color:#64748b;margin-bottom:4px}.ecc-row input,.ecc-row select,.ecc-row textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:9px;padding:8px;background:#fff}
  .ecc-remove-row{justify-self:end;color:#991b1b;border-color:#fecaca}.ecc-note{font-size:12px;color:#475569;background:#eff6ff;padding:10px 12px;border-radius:10px}.ecc-error{margin-top:10px;padding:10px 12px;border-radius:10px;background:#fef2f2;color:#991b1b}
  @media(max-width:760px){.ecc-grid,.ecc-row{grid-template-columns:1fr}.ecc-full,.ecc-row .wide,.ecc-row .full{grid-column:auto}}
  `;
  document.head.appendChild(s);
}

function install(){
  const host=document.querySelector('.eca-head-actions');
  if(!host||document.getElementById('ecaCompositionCreate'))return;
  styles();
  const btn=document.createElement('button');
  btn.id='ecaCompositionCreate';btn.type='button';btn.className='primary';btn.textContent='+ Изменить состав';
  host.appendChild(btn);

  const dlg=document.createElement('dialog');
  dlg.id='ecaCompositionDlg';dlg.className='ecc-dialog';
  dlg.innerHTML=`
  <form id="eccForm">
    <div class="ecc-head"><div><h2 style="margin:0">Изменение состава оборудования</h2><p style="margin:4px 0 0;color:#64748b;font-size:12px">ADD/REMOVE оформляются одним дополнительным соглашением и применяются только после подписи.</p></div><button type="button" id="eccClose">×</button></div>
    <div class="ecc-body">
      <div class="ecc-grid">
        <label class="ecc-field"><span>Договор *</span><select id="eccContract" required></select></label>
        <label class="ecc-field"><span>Вступает в силу *</span><input id="eccEffective" type="date" required></label>
        <div class="ecc-full ecc-note">Для каждой позиции обязательны состояние, работоспособность, комплектность и evidence. Evidence — номер фото/акта/файла/ссылки, одна запись на строку.</div>
      </div>
      <section class="ecc-section"><div class="ecc-section-head"><div><h3>Добавить в договор</h3><small>Оборудование той же организации, не входящее в договор на дату ДС.</small></div><button type="button" id="eccAddRow">+ Добавить позицию</button></div><div id="eccAddList" class="ecc-list"></div></section>
      <section class="ecc-section"><div class="ecc-section-head"><div><h3>Вывести из договора</h3><small>Только оборудование, действующее в договоре на выбранную дату.</small></div><button type="button" id="eccRemoveRow">+ Вывести позицию</button></div><div id="eccRemoveList" class="ecc-list"></div></section>
      <label class="ecc-field ecc-full" style="display:block;margin-top:14px"><span>Основание / причина *</span><textarea id="eccReason" rows="3" required></textarea></label>
      <div id="eccError"></div>
    </div>
    <div class="ecc-foot"><button type="button" id="eccCancel">Отмена</button><button class="primary" type="submit">Создать черновик ДС</button></div>
  </form>`;
  document.body.appendChild(dlg);

  btn.onclick=open;
  document.getElementById('eccClose').onclick=()=>dlg.close();
  document.getElementById('eccCancel').onclick=()=>dlg.close();
  document.getElementById('eccAddRow').onclick=()=>addRow('ADD');
  document.getElementById('eccRemoveRow').onclick=()=>addRow('REMOVE');
  document.getElementById('eccContract').onchange=refreshAllOptions;
  document.getElementById('eccEffective').onchange=refreshAllOptions;
  document.getElementById('eccForm').onsubmit=submit;
  dlg.addEventListener('click',e=>{
    const b=e.target.closest('[data-ecc-delete]');
    if(b)b.closest('.ecc-row')?.remove();
  });
}

async function ensureData(){
  if(state.loaded)return;
  const[c,a,p]=await Promise.all([
    supabase.from('equipment_contracts').select('id,contract_number,status,organization_id,starts_on,ends_on').in('status',['ACTIVE','SUSPENDED']).order('contract_number'),
    supabase.from('equipment_assets').select('id,organization_id,inventory_number,name,brand,model,status,operational_status').neq('status','WRITTEN_OFF').order('inventory_number'),
    supabase.from('equipment_contract_assets').select('id,contract_id,equipment_id,starts_on,ends_on').order('starts_on')
  ]);
  if(c.error)throw c.error;if(a.error)throw a.error;if(p.error)throw p.error;
  state.contracts=c.data||[];state.assets=a.data||[];state.periods=p.data||[];state.loaded=true;
}

async function open(){
  const dlg=document.getElementById('ecaCompositionDlg'),err=document.getElementById('eccError');
  err.innerHTML='';
  try{
    state.loaded=false;await ensureData();
    const sel=document.getElementById('eccContract');
    sel.innerHTML='<option value="">Выберите договор</option>'+state.contracts.map(c=>`<option value="${c.id}">${esc(c.contract_number)} · ${esc(c.status)}</option>`).join('');
    document.getElementById('eccEffective').value=today();
    document.getElementById('eccReason').value='';
    document.getElementById('eccAddList').innerHTML='';
    document.getElementById('eccRemoveList').innerHTML='';
    dlg.showModal();
  }catch(e){alert(friendly(e))}
}

function activeOn(period,date){
  if(!date||!period.starts_on)return false;
  return period.starts_on<=date&&(!period.ends_on||date<=period.ends_on);
}

function candidates(action){
  const cid=document.getElementById('eccContract').value;
  const date=document.getElementById('eccEffective').value;
  const c=state.contracts.find(x=>x.id===cid);
  if(!c)return[];
  const current=new Set(state.periods.filter(p=>p.contract_id===cid&&activeOn(p,date)).map(p=>p.equipment_id));
  return state.assets.filter(a=>a.organization_id===c.organization_id&&(action==='ADD'?!current.has(a.id):current.has(a.id)));
}

function assetLabel(a){return [a.inventory_number,a.name,[a.brand,a.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}

function rowHtml(action){
  const opts=candidates(action);
  return `<div class="ecc-row" data-ecc-action="${action}">
    <label class="wide"><span>Оборудование *</span><select data-ecc="equipment" required><option value="">Выберите</option>${opts.map(a=>`<option value="${a.id}">${esc(assetLabel(a))}</option>`).join('')}</select></label>
    <label><span>Состояние *</span><select data-ecc="condition"><option value="EXCELLENT">Отличное</option><option value="GOOD" selected>Хорошее</option><option value="FAIR">Удовлетворительное</option><option value="POOR">Плохое</option><option value="NON_OPERATIONAL">Нерабочее</option></select></label>
    <label><span>Работоспособность *</span><select data-ecc="operational"><option value="READY" selected>Готово</option><option value="LIMITED">Ограниченно</option><option value="NOT_OPERATIONAL">Не работает</option></select></label>
    <label><span>Счётчик часов</span><input data-ecc="meter" type="number" min="0" step="0.01"></label>
    <label class="wide"><span>Комплектность * (по одной позиции на строку)</span><textarea data-ecc="completeness" rows="2" placeholder="Оборудование&#10;Кабель питания" required></textarea></label>
    <label class="wide"><span>Evidence * (по одной ссылке/номеру на строку)</span><textarea data-ecc="evidence" rows="2" placeholder="Фото IMG_001&#10;Акт №15" required></textarea></label>
    <label class="full"><span>Примечание</span><textarea data-ecc="note" rows="2"></textarea></label>
    <button type="button" class="ecc-remove-row" data-ecc-delete>Удалить строку</button>
  </div>`;
}

function addRow(action){
  const root=document.getElementById(action==='ADD'?'eccAddList':'eccRemoveList');
  root.insertAdjacentHTML('beforeend',rowHtml(action));
}

function refreshAllOptions(){
  for(const row of document.querySelectorAll('.ecc-row')){
    const action=row.dataset.eccAction,sel=row.querySelector('[data-ecc="equipment"]'),old=sel.value;
    const opts=candidates(action);
    sel.innerHTML='<option value="">Выберите</option>'+opts.map(a=>`<option value="${a.id}">${esc(assetLabel(a))}</option>`).join('');
    if(opts.some(x=>x.id===old))sel.value=old;
  }
}

function lines(v){return String(v||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean)}
function payload(row){
  const get=k=>row.querySelector(`[data-ecc="${k}"]`);
  const completeness=lines(get('completeness').value);
  const evidence=lines(get('evidence').value).map(reference=>({reference}));
  if(!completeness.length)throw new Error('COMPLETENESS_REQUIRED');
  if(!evidence.length)throw new Error('EVIDENCE_REQUIRED');
  const meter=get('meter').value.trim();
  return{
    equipment_id:get('equipment').value,
    condition_grade:get('condition').value,
    operational_state:get('operational').value,
    meter_hours:meter===''?null:Number(meter),
    completeness,
    evidence,
    note:get('note').value.trim()||null
  };
}

async function submit(ev){
  ev.preventDefault();
  const err=document.getElementById('eccError');err.innerHTML='';
  const submit=ev.submitter;submit.disabled=true;
  try{
    const additions=[...document.querySelectorAll('#eccAddList .ecc-row')].map(payload);
    const removals=[...document.querySelectorAll('#eccRemoveList .ecc-row')].map(payload);
    if(!additions.length&&!removals.length)throw new Error('EQUIPMENT_CHANGES_REQUIRED');
    const ids=[...additions,...removals].map(x=>x.equipment_id);
    if(new Set(ids).size!==ids.length)throw new Error('DUPLICATE_EQUIPMENT_CHANGE');
    const{error}=await supabase.rpc('create_equipment_composition_amendment',{
      p_contract_id:document.getElementById('eccContract').value,
      p_effective_on:document.getElementById('eccEffective').value,
      p_additions:additions,
      p_removals:removals,
      p_reason:document.getElementById('eccReason').value
    });
    if(error)throw error;
    document.getElementById('ecaCompositionDlg').close();
    document.getElementById('ecaRefresh')?.click();
  }catch(e){
    err.innerHTML=`<div class="ecc-error">${esc(friendly(e))}</div>`;
  }finally{submit.disabled=false}
}

function friendly(e){
  const m=String(e?.message||e||'Ошибка');
  const map=[
    ['EQUIPMENT_CHANGES_REQUIRED','Добавьте хотя бы одну позицию ADD или REMOVE.'],
    ['DUPLICATE_EQUIPMENT_CHANGE','Один аппарат нельзя одновременно добавить/вывести или указать дважды.'],
    ['COMPLETENESS_REQUIRED','Для каждой позиции заполните комплектность.'],
    ['EVIDENCE_REQUIRED','Для каждой позиции добавьте хотя бы одно evidence.'],
    ['EQUIPMENT_ALREADY_IN_CONTRACT_PERIOD','Оборудование уже входит в договор на этот период.'],
    ['EQUIPMENT_NOT_ACTIVE_FOR_REMOVAL','Выбранное оборудование не входит в договор на дату вывода.'],
    ['ACTIVE_OR_SUSPENDED_CONTRACT_REQUIRED','Изменение состава доступно только для действующего/приостановленного договора.'],
    ['PAST_EFFECTIVE_DATE_NOT_ALLOWED','Дата вступления в силу не может быть в прошлом.']
  ];
  for(const[k,v]of map)if(m.includes(k))return v;
  return m;
}

document.readyState==='loading'?document.addEventListener('DOMContentLoaded',install,{once:true}):install();
