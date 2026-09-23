import {supabase} from './guard.js?v=20260923-item1';

const $=id=>document.getElementById(id);
const cfg=window.A4PRINT_CONFIG||{};
const apiBase=String(cfg.apiBaseUrl||'https://a4print-hub-api.onrender.com').replace(/\/$/,'');
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})+' ₽';
const qty=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:3});
const typeLabel={PRODUCT:'Товар',MATERIAL:'Материал',SERVICE:'Услуга',FINISHED_PRODUCT:'Готовая продукция',MODEL_3D:'3D-модель'};
const positiveTypes=new Set(['RECEIPT','TRANSFER_IN','PRODUCTION_IN','ADJUSTMENT']);
const id=new URLSearchParams(location.search).get('id');
const state={item:null,profileId:null,roles:[],balance:null,history:[],loading:false,mode:null,msStockAvailable:false};

if(!id)location.replace('./warehouse.html');

function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}
function canMove(){return ['ADMIN','MANAGER','WAREHOUSE','PRODUCTION'].some(r=>state.roles.includes(r))}
function isMoySklad(){return state.item?.external_source==='MOYSKLAD'&&Boolean(state.item?.external_id)}
function hasLocalStock(){return state.item&&state.item.item_type!=='SERVICE'&&!isMoySklad()}
function stockText(){return state.item?.item_type==='SERVICE'?'—':state.balance==null?'—':`${qty(state.balance)} ${state.item.unit||'шт'}`}
function sourceText(){return isMoySklad()?'МойСклад':'HUB'}

async function api(path,opt={}){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error('Сессия истекла.');
  const r=await fetch(apiBase+path,{
    ...opt,
    headers:{Authorization:`Bearer ${session.access_token}`,...(opt.body?{'Content-Type':'application/json'}:{}),...(opt.headers||{})},
    cache:'no-store'
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.message||data.error||`HTTP ${r.status}`);
  return data;
}

async function initContext(){
  const {data:{session}}=await supabase.auth.getSession();
  if(session)$('userEmail').textContent=session.user.email||'';
  const [roles,profile]=await Promise.all([
    supabase.rpc('get_my_roles'),
    session?.user?.id?supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle():Promise.resolve({data:null,error:null})
  ]);
  if(!roles.error&&Array.isArray(roles.data))state.roles=roles.data.map(String);
  if(profile.error)console.warn('Item profile unavailable',profile.error);
  state.profileId=profile.data?.id||null;
}

async function loadItem(){
  const fields='id,organization_id,sku,name,item_type,category,unit,description,sale_price,cost_price,min_stock,is_active,external_source,external_id,external_href,article,barcode,external_updated_at,last_synced_at';
  const {data,error}=await supabase.from('catalog_items').select(fields).eq('id',id).single();
  if(error)throw error;
  state.item=data;
}
async function loadLocalBalance(){
  const {data,error}=await supabase.from('inventory_balances').select('quantity').eq('catalog_item_id',id);
  if(error)throw error;
  state.balance=(data||[]).reduce((sum,row)=>sum+Number(row.quantity||0),0);
}
async function loadMoySkladBalance(){
  try{
    const data=await api('/api/v1/warehouse/stock');
    state.balance=Number(data?.stock?.[state.item.external_id]??0);
    state.msStockAvailable=true;
  }catch(error){
    console.warn('MoySklad stock unavailable',error);
    state.balance=null;state.msStockAvailable=false;
  }
}
async function loadHistory(){
  const fields='id,catalog_item_id,warehouse_id,transaction_type,quantity,unit_cost,reference_type,reference_id,note,created_by,created_at';
  const {data,error}=await supabase.from('inventory_transactions').select(fields).eq('catalog_item_id',id).order('created_at',{ascending:false}).limit(100);
  if(error)throw error;
  state.history=data||[];
}

function render(){
  const item=state.item;if(!item)return;
  $('name').textContent=item.name||'Позиция';
  $('meta').textContent=`${item.sku||'без SKU'} · ${typeLabel[item.item_type]||item.item_type||'—'} · ${item.unit||'шт'} · ${sourceText()}`;
  $('min').textContent=item.item_type==='SERVICE'?'—':`${qty(item.min_stock)} ${item.unit||'шт'}`;
  $('price').textContent=money(item.sale_price);
  $('total').textContent=stockText();

  $('card').innerHTML=`
    <p><b>SKU:</b> ${esc(item.sku||'—')}</p>
    <p><b>Тип:</b> ${esc(typeLabel[item.item_type]||item.item_type||'—')}</p>
    <p><b>Категория:</b> ${esc(item.category||'—')}</p>
    <p><b>Единица:</b> ${esc(item.unit||'—')}</p>
    <p><b>Закупка:</b> ${money(item.cost_price)}</p>
    <p><b>Источник:</b> ${esc(sourceText())}</p>
    ${item.article?`<p><b>Артикул:</b> ${esc(item.article)}</p>`:''}
    ${item.barcode?`<p><b>Штрихкод:</b> ${esc(item.barcode)}</p>`:''}
    <p><b>Описание:</b> ${esc(item.description||'—')}</p>`;

  $('history').innerHTML=state.history.map(row=>{
    const positive=positiveTypes.has(row.transaction_type);
    return `<div class="row"><span><b>${esc(row.transaction_type)}</b><small>${esc(new Date(row.created_at).toLocaleString('ru-RU'))}${row.note?' · '+esc(row.note):''}</small></span><strong>${positive?'+':'−'}${qty(row.quantity)} ${esc(item.unit||'шт')}</strong></div>`;
  }).join('')||'<div class="empty">Движений пока нет</div>';

  const allowed=canMove()&&hasLocalStock();
  $('receipt').hidden=!allowed;
  $('writeoff').hidden=!allowed;
  $('transfer').hidden=true;

  const note=$('stockNotice');
  if(item.item_type==='SERVICE'){
    note.textContent='Услуга не участвует в складском учёте.';
    note.hidden=false;
  }else if(isMoySklad()){
    note.textContent=state.msStockAvailable?'Остаток читается из МойСклад. Ручные движения в HUB отключены.':'Не удалось получить остаток из МойСклад.';
    note.hidden=false;
  }else if(!canMove()){
    note.textContent='У вашей роли нет права проводить складские движения.';
    note.hidden=false;
  }else{
    note.textContent='';note.hidden=true;
  }
}
function renderLoading(){
  $('history').innerHTML='<div class="item-loading-list"><div class="a4-skeleton"></div><div class="a4-skeleton"></div><div class="a4-skeleton"></div></div>';
}
function renderError(error){
  $('name').textContent='Не удалось открыть позицию';
  $('meta').textContent=error.message||String(error);
  $('history').innerHTML='<div class="a4-error">Ошибка загрузки карточки склада.</div>';
}

async function load(){
  if(state.loading)return;state.loading=true;renderLoading();
  try{
    await loadItem();
    await Promise.all([
      loadHistory(),
      isMoySklad()?loadMoySkladBalance():state.item.item_type==='SERVICE'?Promise.resolve(state.balance=null):loadLocalBalance()
    ]);
    render();
  }catch(error){
    console.error('Warehouse item load failed',error);
    renderError(error);
  }finally{state.loading=false}
}
function openMovement(type,title){
  if(!canMove()||!hasLocalStock())return;
  state.mode=type;$('dlgTitle').textContent=title;$('form').reset();$('itemError').textContent='';$('dlg').showModal();setTimeout(()=>$('qty')?.focus(),30);
}
async function saveMovement(event){
  event.preventDefault();if(!canMove()||!hasLocalStock())return;
  const amount=Number($('qty').value),save=$('save');save.disabled=true;$('itemError').textContent='';
  if(!(amount>0)){$('itemError').textContent='Количество должно быть больше нуля.';save.disabled=false;return}
  if(state.mode==='WRITE_OFF'&&state.balance!=null&&amount>Number(state.balance)){
    $('itemError').textContent=`Нельзя списать ${qty(amount)}: доступно ${qty(state.balance)} ${state.item.unit||'шт'}.`;save.disabled=false;return;
  }
  if(!state.profileId){$('itemError').textContent='Не определён профиль текущего сотрудника.';save.disabled=false;return}
  try{
    const {error}=await supabase.from('inventory_transactions').insert({
      catalog_item_id:id,
      transaction_type:state.mode,
      quantity:amount,
      unit_cost:Number(state.item.cost_price||0),
      note:$('note').value.trim()||null,
      created_by:state.profileId
    });
    if(error)throw error;
    $('dlg').close();
    notify('success','Склад обновлён',state.mode==='RECEIPT'?'Приход сохранён.':'Списание сохранено.');
    await load();
  }catch(error){
    $('itemError').textContent=error.message||String(error);
  }finally{save.disabled=false}
}

$('receipt').addEventListener('click',()=>openMovement('RECEIPT','Приход на склад'));
$('writeoff').addEventListener('click',()=>openMovement('WRITE_OFF','Списание со склада'));
$('transfer').addEventListener('click',()=>notify('warning','Перемещение отключено','Для корректного перемещения нужно выбрать склад-источник и склад назначения. Старый односторонний TRANSFER_OUT отключён.'));
$('form').addEventListener('submit',saveMovement);

await initContext();
await load();
