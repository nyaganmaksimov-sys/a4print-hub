import {supabase} from './guard.js?v=20260905-netfix1';

const $=id=>document.getElementById(id);
const qty=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:3});
const units=['шт','мл','л','г','кг','лист','рулон','м','м²','упак','пачка','компл','банка','флакон','картридж','набор'];
const categories=['Чернила / краска','Бумага','Фотобумага','Плёнка','Ламинат','Тонер / картриджи','Клей','Упаковка','Канцелярия','Запчасти / ЗИП','Химия','Другое'];
const integerUnits=new Set(['шт','мл','г','лист','рулон','упак','пачка','компл','банка','флакон','картридж','набор']);
const state={consumables:new Map(),balances:new Map(),roles:[],profileId:null,busy:false};

function canManage(){return ['ADMIN','MANAGER','WAREHOUSE'].some(x=>state.roles.includes(x))}
function canMove(){return ['ADMIN','MANAGER','WAREHOUSE','PRODUCTION'].some(x=>state.roles.includes(x))}
function stepFor(unit){return integerUnits.has(String(unit||'').trim())?'1':'0.001'}
function normalizeUnit(v){return String(v||'').trim()||'шт'}
function current(id){return Number(state.balances.get(id)?.current_stock||0)}
function item(id){return state.consumables.get(id)||null}
function closeDialog(id){const d=$(id);if(d?.open)d.close()}
function setError(id,text=''){const el=$(id);if(el)el.textContent=text}

function installStyles(){
  if($('equipmentConsumablesV2Style'))return;
  const s=document.createElement('style');
  s.id='equipmentConsumablesV2Style';
  s.textContent=`
    .eq-stock-actions{display:flex!important;align-items:center;justify-content:flex-end;gap:5px;flex-wrap:wrap;min-width:255px}
    .eq-stock-actions button{min-height:32px!important;height:32px!important;padding:0 9px!important;border-radius:9px!important;font-size:10px!important;white-space:nowrap}
    .eq-stock-actions .eq-in{background:#ecfdf5!important;border-color:#a7f3d0!important;color:#047857!important}
    .eq-stock-actions .eq-out{background:#fff7ed!important;border-color:#fed7aa!important;color:#c2410c!important}
    .eq-stock-actions .eq-adjust{background:#eff6ff!important;border-color:#bfdbfe!important;color:#1d4ed8!important}
    .eq-unit-chip{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;background:#eef2ff;color:#4338ca;font-size:10px;font-weight:850;margin-left:5px}
    .eq-v2-note{font-size:10px;line-height:1.45;color:#64748b;margin-top:5px}
    .eq-v2-note strong{color:#334155}
    .eq-v2-fieldbox{border:1px solid #dbe5f0;border-radius:12px;background:#f8fafc;padding:10px 12px;grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px}
    .eq-v2-fieldbox span{font-size:11px;color:#64748b}.eq-v2-fieldbox b{font-size:14px;color:#0f172a}
    .eq-v2-preview{margin-top:8px;padding:9px 11px;border-radius:10px;background:#f1f5f9;color:#334155;font-size:11px;font-weight:700}
    .eq-v2-preview.bad{background:#fff1f2;color:#be123c}.eq-v2-preview.good{background:#ecfdf5;color:#047857}
    .eq-field input[disabled]{background:#f1f5f9;color:#64748b;cursor:not-allowed}
    @media(max-width:900px){.eq-stock-actions{min-width:0;justify-content:flex-start}.eq-stock-actions button{padding:0 7px!important}.eq-row[data-consumable]{grid-template-columns:minmax(0,1fr) auto!important}.eq-row[data-consumable]>.hide-mobile,.eq-row[data-consumable]>.hide-mid{display:none!important}.eq-row[data-consumable]>.eq-stock-actions{grid-column:1/-1}}
  `;
  document.head.appendChild(s);
}

function installDatalists(){
  const unit=$('conUnit');
  if(unit&&!$('consumableUnitsList')){
    const d=document.createElement('datalist');d.id='consumableUnitsList';d.innerHTML=units.map(x=>`<option value="${x}"></option>`).join('');document.body.appendChild(d);unit.setAttribute('list',d.id);unit.placeholder='шт, мл, л, лист…';
  }
  const cat=$('conCategory');
  if(cat&&!$('consumableCategoriesList')){
    const d=document.createElement('datalist');d.id='consumableCategoriesList';d.innerHTML=categories.map(x=>`<option value="${x}"></option>`).join('');document.body.appendChild(d);cat.setAttribute('list',d.id);cat.placeholder='Например: Чернила / краска';
  }
}

function ensureConsumableExtras(){
  const form=$('consumableForm');const grid=form?.querySelector('.eq-form');if(!grid)return;
  if(!$('conInitialStockWrap')){
    const label=document.createElement('label');label.id='conInitialStockWrap';label.className='eq-field';label.innerHTML='<span>Начальный остаток</span><input id="conInitialStock" type="number" min="0" step="1" value="0"><small id="conInitialUnit" class="eq-v2-note">Будет записан как приход.</small>';
    const min=$('conMinStock')?.closest('.eq-field');min?.insertAdjacentElement('afterend',label);
  }
  if(!$('conStockInfo')){
    const box=document.createElement('div');box.id='conStockInfo';box.className='eq-v2-fieldbox';box.hidden=true;box.innerHTML='<span>Текущий остаток меняется только через журнал движений</span><b id="conCurrentStock">0 шт</b>';
    grid.appendChild(box);
  }
  if(!$('conUnitNote')){
    const n=document.createElement('small');n.id='conUnitNote';n.className='eq-v2-note';$('conUnit')?.insertAdjacentElement('afterend',n);
  }
}

function ensureMovementExtras(){
  const qtyInput=$('moveQty');const field=qtyInput?.closest('.eq-field');if(!field)return;
  if(!$('moveUnitSuffix')){const n=document.createElement('small');n.id='moveUnitSuffix';n.className='eq-v2-note';field.appendChild(n)}
  if(!$('moveResultPreview')){const p=document.createElement('div');p.id='moveResultPreview';p.className='eq-v2-preview';$('movementHint')?.insertAdjacentElement('afterend',p)}
}

async function refreshData(){
  const [{data:c,error:ce},{data:b,error:be}]=await Promise.all([
    supabase.from('equipment_consumables').select('id,organization_id,name,category,sku,unit,min_stock,storage_location,supplier,is_active,notes').order('name'),
    supabase.from('equipment_consumable_balances').select('*')
  ]);
  if(ce)throw ce;if(be)throw be;
  state.consumables=new Map((c||[]).map(x=>[x.id,x]));
  state.balances=new Map((b||[]).map(x=>[x.consumable_id,x]));
}

async function loadContext(){
  const {data:{session}}=await supabase.auth.getSession();
  const [roles,profile]=await Promise.all([
    supabase.rpc('get_my_roles'),
    session?.user?.id?supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle():Promise.resolve({data:null})
  ]);
  state.roles=Array.isArray(roles.data)?roles.data:[];state.profileId=profile.data?.id||null;
}

function updateUnitFields(){
  const unit=normalizeUnit($('conUnit')?.value);const step=stepFor(unit);
  if($('conMinStock'))$('conMinStock').step=step;
  if($('conInitialStock'))$('conInitialStock').step=step;
  if($('conInitialUnit'))$('conInitialUnit').textContent=`В ${unit}. При создании будет оформлен отдельный приход.`;
}

async function onConsumableOpen(){
  ensureConsumableExtras();installDatalists();
  const id=$('consumableId')?.value||'';const isNew=!id;
  $('conInitialStockWrap').hidden=!isNew;$('conStockInfo').hidden=isNew;
  if(isNew){$('conInitialStock').value='0';$('conUnit').disabled=false;$('conUnitNote').textContent='Можно выбрать из списка или ввести свою единицу измерения.';updateUnitFields();return}
  try{
    await refreshData();const c=item(id);if(c&&$('conUnit').value!==c.unit)$('conUnit').value=c.unit||'шт';
    const stock=current(id);$('conCurrentStock').textContent=`${qty(stock)} ${normalizeUnit(c?.unit)}`;
    const {count,error}=await supabase.from('equipment_consumable_movements').select('id',{count:'exact',head:true}).eq('consumable_id',id);if(error)throw error;
    const locked=Number(count||0)>0;$('conUnit').disabled=locked;
    $('conUnitNote').textContent=locked?'Единица зафиксирована: по расходнику уже есть движения. Для другой единицы создайте новую позицию.':'Единицу ещё можно изменить — движений по позиции нет.';
    updateUnitFields();
  }catch(e){console.warn('Consumables v2 open:',e)}
}

async function saveConsumableV2(e){
  e.preventDefault();e.stopImmediatePropagation();if(state.busy||!canManage())return;
  const button=$('saveConsumable');state.busy=true;if(button)button.disabled=true;setError('consumableError');
  try{
    const id=$('consumableId').value;const unit=normalizeUnit($('conUnit').value);const min=Number($('conMinStock').value||0);const initial=Number($('conInitialStock')?.value||0);
    if(!$('conName').value.trim())throw new Error('Укажите название расходника.');
    if(!unit)throw new Error('Укажите единицу измерения.');
    if(!Number.isFinite(min)||min<0)throw new Error('Минимальный запас не может быть отрицательным.');
    if(!id&&(!Number.isFinite(initial)||initial<0))throw new Error('Начальный остаток не может быть отрицательным.');
    const common={
      p_organization_id:$('conOrganization').value||null,p_name:$('conName').value.trim(),p_category:$('conCategory').value.trim()||null,p_sku:$('conSku').value.trim()||null,p_unit:unit,p_min_stock:min,
      p_storage_location:$('conStorage').value.trim()||null,p_supplier:$('conSupplier').value.trim()||null,p_is_active:$('conActive').value==='1',p_notes:$('conNotes').value.trim()||null
    };
    if(!id){
      const {error}=await supabase.rpc('create_equipment_consumable_v2',{...common,p_initial_stock:initial});if(error)throw error;
    }else{
      const payload={organization_id:common.p_organization_id,name:common.p_name,category:common.p_category,sku:common.p_sku,unit:common.p_unit,min_stock:common.p_min_stock,storage_location:common.p_storage_location,supplier:common.p_supplier,is_active:common.p_is_active,notes:common.p_notes};
      const {error}=await supabase.from('equipment_consumables').update(payload).eq('id',id);if(error){if(/UNIT_CHANGE_REQUIRES_EMPTY_JOURNAL/i.test(error.message||''))throw new Error('Единицу измерения нельзя менять после появления движений.');throw error}
    }
    closeDialog('consumableDlg');await refreshData();$('refresh')?.click();
  }catch(error){setError('consumableError',error?.message||String(error))}
  finally{state.busy=false;if(button)button.disabled=false}
}

function movementPreview(){
  const id=$('moveConsumable')?.value;const c=item(id);if(!c)return;
  const unit=normalizeUnit(c.unit),stock=current(id),type=$('moveType').value,input=$('moveQty'),raw=Number(input.value||0);input.step=stepFor(unit);input.min=type==='ADJUSTMENT'?'0':'0.001';
  const label=input.closest('.eq-field')?.querySelector(':scope > span');if(label)label.textContent=type==='ADJUSTMENT'?'Фактический остаток *':'Количество *';
  $('moveUnitSuffix').textContent=type==='ADJUSTMENT'?`Укажите, сколько ${unit} реально осталось. Система рассчитает корректировку.`:`Единица: ${unit}. Текущий остаток: ${qty(stock)} ${unit}.`;
  let next=stock;
  if(Number.isFinite(raw)){
    if(type==='RECEIPT'||type==='RETURN')next=stock+Math.max(0,raw);
    else if(type==='ISSUE'||type==='WRITE_OFF')next=stock-Math.max(0,raw);
    else if(type==='ADJUSTMENT')next=raw;
  }
  const p=$('moveResultPreview');p.className='eq-v2-preview '+(next<0?'bad':next>stock?'good':'');p.textContent=`Было: ${qty(stock)} ${unit} → станет: ${qty(next)} ${unit}`;
  $('movementHint').textContent=type==='ADJUSTMENT'?'Корректировка запишет разницу отдельным движением. История сохранится.':'Количество вводится положительным числом.';
}

async function onMovementOpen(){
  ensureMovementExtras();try{await refreshData()}catch(e){console.warn(e)}movementPreview();
}

async function saveMovementV2(e){
  e.preventDefault();e.stopImmediatePropagation();if(state.busy||!canMove())return;
  const button=$('saveMovement');state.busy=true;if(button)button.disabled=true;setError('movementError');
  try{
    await refreshData();const id=$('moveConsumable').value,c=item(id);if(!c)throw new Error('Выберите расходник.');
    const unit=normalizeUnit(c.unit),stock=current(id),type=$('moveType').value,raw=Number($('moveQty').value);
    if(!Number.isFinite(raw))throw new Error('Проверьте количество.');
    let delta;
    if(type==='ADJUSTMENT'){
      if(raw<0)throw new Error('Фактический остаток не может быть отрицательным.');delta=raw-stock;if(Math.abs(delta)<0.000001)throw new Error(`Остаток уже равен ${qty(stock)} ${unit}.`);
    }else{
      if(raw<=0)throw new Error('Количество должно быть больше нуля.');
      delta=(type==='ISSUE'||type==='WRITE_OFF')?-Math.abs(raw):Math.abs(raw);
      if(delta<0&&stock+delta< -0.000001)throw new Error(`Недостаточно остатка. Доступно ${qty(stock)} ${unit}.`);
    }
    const payload={consumable_id:id,equipment_id:$('moveEquipmentSelect').value||null,movement_type:type,quantity_delta:delta,note:$('moveNote').value.trim()||null,document_ref:$('moveDocument').value.trim()||null,created_by:state.profileId};
    const {error}=await supabase.from('equipment_consumable_movements').insert(payload);if(error)throw error;
    closeDialog('movementDlg');await refreshData();$('refresh')?.click();
  }catch(error){setError('movementError',error?.message||String(error))}
  finally{state.busy=false;if(button)button.disabled=false}
}

function openMovementFor(id,type){
  $('addMovement')?.click();setTimeout(()=>{if($('moveConsumable'))$('moveConsumable').value=id;if($('moveType'))$('moveType').value=type;if($('moveQty'))$('moveQty').value=type==='ADJUSTMENT'?String(current(id)):String(stepFor(item(id)?.unit)==='1'?1:0.001);movementPreview()},0);
}

function enhanceRows(){
  if(!canMove())return;
  document.querySelectorAll('#consumablesList .eq-row[data-consumable]').forEach(row=>{
    if(row.dataset.v2Actions==='1')return;row.dataset.v2Actions='1';const id=row.dataset.consumable,cell=row.lastElementChild;if(!cell)return;cell.classList.add('eq-stock-actions');
    const c=item(id),stock=current(id);const badge=document.createElement('span');badge.className='eq-unit-chip';badge.textContent=normalizeUnit(c?.unit);row.querySelector('.eq-stock')?.appendChild(badge);
    const buttons=[['RECEIPT','+ Приход','eq-in'],['ISSUE','− Расход','eq-out'],['ADJUSTMENT','Коррект.','eq-adjust']];
    buttons.reverse().forEach(([type,text,cls])=>{const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=text;b.title=type==='ADJUSTMENT'?`Установить фактический остаток (сейчас ${qty(stock)} ${normalizeUnit(c?.unit)})`:text;b.onclick=ev=>{ev.stopPropagation();openMovementFor(id,type)};cell.prepend(b)});
  });
}

function watch(){
  const list=$('consumablesList');if(list)new MutationObserver(()=>{refreshData().then(enhanceRows).catch(()=>{})}).observe(list,{childList:true,subtree:false});
  const cdlg=$('consumableDlg');if(cdlg)new MutationObserver(()=>{if(cdlg.open)onConsumableOpen()}).observe(cdlg,{attributes:true,attributeFilter:['open']});
  const mdlg=$('movementDlg');if(mdlg)new MutationObserver(()=>{if(mdlg.open)onMovementOpen()}).observe(mdlg,{attributes:true,attributeFilter:['open']});
}

async function init(){
  installStyles();installDatalists();ensureConsumableExtras();ensureMovementExtras();
  await loadContext();await refreshData();enhanceRows();watch();
  $('conUnit')?.addEventListener('input',updateUnitFields);$('conUnit')?.addEventListener('change',updateUnitFields);
  $('moveConsumable')?.addEventListener('change',movementPreview);$('moveType')?.addEventListener('change',movementPreview);$('moveQty')?.addEventListener('input',movementPreview);
  $('consumableForm')?.addEventListener('submit',saveConsumableV2,true);$('movementForm')?.addEventListener('submit',saveMovementV2,true);
  $('refresh')?.addEventListener('click',()=>setTimeout(()=>refreshData().then(enhanceRows).catch(()=>{}),350));
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>init().catch(console.error),0),{once:true});else setTimeout(()=>init().catch(console.error),0);
