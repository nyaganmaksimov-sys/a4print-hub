import {supabase} from './guard.js?v=20260905-netfix1';

const cfg=window.A4PRINT_CONFIG||{};
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=value=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(Number(value||0));
const layoutKey='a4print-partners-layout-v1';
const state={partners:[],supplierServices:[],partnerServices:[],roles:[],loading:false};

function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}
function canManage(){return state.roles.includes('ADMIN')||state.roles.includes('MANAGER')}
async function token(){const {data:{session}}=await supabase.auth.getSession();return session?.access_token||''}
async function api(path,opt={}){
  const t=await token();
  const r=await fetch(`${String(cfg.apiBaseUrl||'').replace(/\/$/,'')}${path}`,{
    ...opt,
    cache:'no-store',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${t}`,...(opt.headers||{})}
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.message||j.error||`HTTP ${r.status}`);
  return j;
}
function setStatus(id,message,type=''){
  const el=$(id);if(!el)return;
  el.textContent=message;
  el.className=`small ${type==='ok'?'status-ok':type==='error'?'status-error':''}`;
}
function initLayout(){
  const columns=[...document.querySelectorAll('.grid>div')];
  columns.forEach(c=>c.classList.add('block-column'));
  const cards=[...document.querySelectorAll('.grid article.card')],ids=['partners-list','partner-catalog','partner-create','partner-outbound'];
  cards.forEach((card,i)=>{
    card.dataset.blockId=ids[i];
    card.draggable=true;
    if(!card.querySelector(':scope > .drag-handle')){
      const h=document.createElement('button');h.type='button';h.className='drag-handle';h.textContent='↕ Переместить';h.title='Перетащите блок в другое место';card.prepend(h);
    }
    card.addEventListener('dragstart',e=>{
      if(e.target.closest('input,textarea,select,label,button')&&!e.target.classList.contains('drag-handle')){e.preventDefault();return}
      card.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',card.dataset.blockId);
    });
    card.addEventListener('dragend',()=>{card.classList.remove('dragging');document.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over'));saveLayout()});
  });
  columns.forEach(col=>{
    col.addEventListener('dragover',e=>{e.preventDefault();const dragging=document.querySelector('.card.dragging');if(!dragging)return;const after=getAfterElement(col,e.clientY);if(after)col.insertBefore(dragging,after);else col.appendChild(dragging)});
    col.addEventListener('drop',e=>{e.preventDefault();saveLayout()});
  });
  restoreLayout();
}
function getAfterElement(container,y){
  return [...container.querySelectorAll('.card:not(.dragging)')].reduce((closest,child)=>{
    const box=child.getBoundingClientRect(),offset=y-box.top-box.height/2;
    return offset<0&&offset>closest.offset?{offset,element:child}:closest;
  },{offset:Number.NEGATIVE_INFINITY,element:null}).element;
}
function saveLayout(){
  const columns=[...document.querySelectorAll('.block-column')];
  localStorage.setItem(layoutKey,JSON.stringify(columns.map(c=>[...c.querySelectorAll('.card')].map(x=>x.dataset.blockId))));
}
function restoreLayout(){
  try{
    const saved=JSON.parse(localStorage.getItem(layoutKey)||'null');if(!Array.isArray(saved))return;
    const columns=[...document.querySelectorAll('.block-column')];
    saved.forEach((ids,ci)=>(ids||[]).forEach(id=>{const card=document.querySelector(`[data-block-id="${id}"]`);if(card&&columns[ci])columns[ci].appendChild(card)}));
  }catch{}
}
async function access(){
  const {data,error}=await supabase.rpc('get_my_roles');
  if(error)throw error;
  state.roles=Array.isArray(data)?data.map(String):[];
  if(!canManage())throw new Error('Доступ только для администратора или менеджера');
}

function renderPartners(){
  const q=$('search').value.trim().toLowerCase();
  const rows=state.partners.filter(p=>`${p.name} ${p.contact_name||''} ${p.email||''} ${p.phone||''}`.toLowerCase().includes(q));
  $('count').textContent=`${rows.length} партнёров`;
  $('partners').innerHTML=rows.map(p=>`<div class="partner" data-partner-id="${esc(p.id)}"><div class="row"><div><b>${esc(p.name)}</b><div class="meta">${esc(p.contact_name||'Контакт не указан')} ${p.phone?'· '+esc(p.phone):''} ${p.email?'· '+esc(p.email):''}</div><div class="meta">Заказов: ${Number(p.orders_count||0)} · скидка ${Number(p.discount_percent||0)}% · отсрочка ${Number(p.payment_terms_days||0)} дн.</div></div><div><span class="badge ${p.is_active?'':'off'}">${p.is_active?'Активен':'Отключён'}</span><br><button data-order-partner="${esc(p.id)}" style="margin-top:7px">Заказать у него</button><br><button data-toggle="${esc(p.id)}" style="margin-top:7px">${p.is_active?'Отключить':'Включить'}</button></div></div></div>`).join('')||'<div class="empty">Партнёры не найдены</div>';
  document.dispatchEvent(new CustomEvent('a4:partners-rendered',{detail:{partners:state.partners,visible:rows}}));
}
function populatePartnerSelect(){
  const current=$('outPartner').value;
  $('outPartner').innerHTML='<option value="">Выберите партнёра</option>'+state.partners.filter(p=>p.is_active).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if(current&&[...$('outPartner').options].some(o=>o.value===current))$('outPartner').value=current;
}
async function loadPartners(){
  const j=await api('/api/v1/partners');
  state.partners=Array.isArray(j.partners)?j.partners:[];
  renderPartners();populatePartnerSelect();
}

function renderServices(){
  $('services').innerHTML=state.partnerServices.map(s=>`<div class="service"><div><b>${esc(s.name)}</b><div class="small">${esc(s.category)} · ${esc(s.business_unit)}</div></div><label class="small">Розница, ₽<input data-field="base_price" data-id="${s.id}" type="number" min="0" value="${Number(s.base_price||0)}"></label><label class="small">Партнёр, ₽<input data-field="partner_price" data-id="${s.id}" type="number" min="0" value="${Number(s.partner_price||0)}"></label><button data-service-save="${s.id}">Сохранить</button></div>`).join('')||'<div class="empty">Услуг пока нет</div>';
  document.dispatchEvent(new CustomEvent('a4:partner-services-rendered',{detail:{services:state.partnerServices}}));
}
async function loadServices(){
  const {data,error}=await supabase.from('partner_services')
    .select('id,code,business_unit,category,name,unit,base_price,partner_price,is_active,sort_order,updated_at')
    .order('sort_order');
  if(error)throw error;
  state.partnerServices=data||[];
  renderServices();
}

async function loadSupplierServices(){
  const pid=$('outPartner').value;
  if(!pid){
    state.supplierServices=[];
    $('outService').innerHTML='<option value="">Сначала выберите партнёра</option>';
    $('partnerPrice').textContent='';
    document.dispatchEvent(new CustomEvent('a4:supplier-services-rendered',{detail:{partnerId:'',services:[]}}));
    return;
  }
  $('outService').innerHTML='<option value="">Загрузка прайса…</option>';
  const {data,error}=await supabase.from('partner_supplier_services')
    .select('id,partner_id,category,name,description,unit,price,is_active,updated_at')
    .eq('partner_id',pid).eq('is_active',true).order('category').order('name');
  if(error){
    state.supplierServices=[];
    $('outService').innerHTML='<option value="">Не удалось загрузить прайс</option>';
    $('partnerPrice').textContent='Прайс партнёра временно недоступен.';
    notify('error','Прайс партнёра недоступен',error.message||String(error));
    return;
  }
  state.supplierServices=data||[];
  $('outService').innerHTML='<option value="">Выберите услугу</option>'+state.supplierServices.map(s=>`<option value="${s.id}">${esc(s.category)} — ${esc(s.name)} — ${money(s.price)}/${esc(s.unit)}</option>`).join('');
  $('partnerPrice').textContent=state.supplierServices.length?`Прайс загружен: ${state.supplierServices.length} услуг.`:'У партнёра пока нет заполненного прайса.';
  calcOut();
  document.dispatchEvent(new CustomEvent('a4:supplier-services-rendered',{detail:{partnerId:pid,services:state.supplierServices}}));
}
function calcOut(){
  const s=state.supplierServices.find(x=>x.id===$('outService').value),q=Math.max(0,Number($('outQty').value)||0);
  $('outTotal').value=money(s?s.price*q:0);
}
async function uploadFiles(orderId,files){
  for(const file of files){
    const safe=file.name.replace(/[^a-zA-Zа-яА-Я0-9._-]+/g,'_'),path=`${orderId}/${crypto.randomUUID()}_${safe}`;
    const {error:uErr}=await supabase.storage.from('order-files').upload(path,file,{upsert:false,contentType:file.type||undefined});if(uErr)throw uErr;
    const {error:fErr}=await supabase.from('order_files').insert({order_id:orderId,file_name:file.name,file_url:path,mime_type:file.type||null});if(fErr)throw fErr;
  }
}
async function submitOutbound(e){
  e.preventDefault();
  const form=e.currentTarget,pid=$('outPartner').value,sid=$('outService').value,qty=Number($('outQty').value)||1;
  if(!pid||!sid)return;
  setStatus('outStatus','Отправка…');$('outSend').disabled=true;
  try{
    const {data,error}=await supabase.rpc('create_hub_partner_order',{p_partner_id:pid,p_supplier_service_id:sid,p_quantity:qty,p_comment:$('outComment').value.trim()||null,p_parameters:{details:$('outParams').value.trim()}});
    if(error)throw error;
    const files=[...$('outFiles').files];if(files.length)await uploadFiles(data,files);
    setStatus('outStatus',`✓ Заказ создан и отправлен партнёру${files.length?`. Файлов: ${files.length}`:''}.`,'ok');
    form.reset();$('outQty').value=1;$('outTotal').value=money(0);state.supplierServices=[];$('outService').innerHTML='<option value="">Сначала выберите партнёра</option>';
  }catch(err){setStatus('outStatus','Ошибка: '+(err.message||err),'error')}
  finally{$('outSend').disabled=false}
}
async function submitPartner(e){
  e.preventDefault();
  const form=e.currentTarget,body=Object.fromEntries(new FormData(form).entries()),button=form.querySelector('button[type="submit"]');
  setStatus('formStatus','Создание…');button.disabled=true;
  try{
    await api('/api/v1/partners',{method:'POST',body:JSON.stringify(body)});
    form.reset();form.elements.discount_percent.value='0';form.elements.payment_terms_days.value='0';
    setStatus('formStatus','✓ Партнёр создан. Данные для входа готовы.','ok');
    await loadPartners();
  }catch(err){
    const message=/already been registered|already exists|duplicate/i.test(err.message||'')?'Пользователь с таким email уже существует. Укажите другой email партнёра.':(err.message||String(err));
    setStatus('formStatus','Ошибка: '+message,'error');
  }finally{button.disabled=false}
}
async function togglePartner(id,button){
  const p=state.partners.find(x=>x.id===id);if(!p)return;
  button.disabled=true;
  try{await api(`/api/v1/partners/${p.id}`,{method:'PATCH',body:JSON.stringify({is_active:!p.is_active})});await loadPartners()}
  catch(error){notify('error','Не удалось изменить партнёра',error.message||String(error))}
  finally{button.disabled=false}
}
async function saveService(id,button){
  const base=document.querySelector(`[data-id="${id}"][data-field="base_price"]`),partner=document.querySelector(`[data-id="${id}"][data-field="partner_price"]`);
  button.disabled=true;const old=button.textContent;button.textContent='Сохранение…';
  const {error}=await supabase.from('partner_services').update({base_price:Number(base?.value)||0,partner_price:Number(partner?.value)||0,updated_at:new Date().toISOString()}).eq('id',id);
  button.disabled=false;button.textContent=error?'Ошибка':'Сохранено ✓';
  if(error)notify('error','Цена не сохранена',error.message||String(error));
  else setTimeout(()=>{button.textContent=old},900);
}
function bind(){
  $('search').addEventListener('input',renderPartners);
  $('refresh').addEventListener('click',async()=>{if(state.loading)return;state.loading=true;$('refresh').disabled=true;try{await Promise.all([loadPartners(),loadServices()])}catch(error){notify('error','Не удалось обновить партнёров',error.message||String(error))}finally{state.loading=false;$('refresh').disabled=false}});
  $('resetLayout').addEventListener('click',()=>{localStorage.removeItem(layoutKey);location.reload()});
  $('outPartner').addEventListener('change',loadSupplierServices);$('outService').addEventListener('change',calcOut);$('outQty').addEventListener('input',calcOut);
  $('outboundForm').addEventListener('submit',submitOutbound);$('partnerForm').addEventListener('submit',submitPartner);
  $('partners').addEventListener('click',event=>{
    const order=event.target.closest('[data-order-partner]');if(order){$('outPartner').value=order.dataset.orderPartner;loadSupplierServices();$('outPartner').scrollIntoView({behavior:'smooth',block:'center'});return}
    const toggle=event.target.closest('[data-toggle]');if(toggle)togglePartner(toggle.dataset.toggle,toggle);
  });
  $('services').addEventListener('click',event=>{const button=event.target.closest('[data-service-save]');if(button)saveService(button.dataset.serviceSave,button)});
}
async function init(){
  initLayout();bind();
  try{await access();await Promise.all([loadPartners(),loadServices()]);document.dispatchEvent(new CustomEvent('a4:partners-ready'))}
  catch(error){document.querySelector('.main').innerHTML=`<div class="empty">${esc(error.message||error)}</div>`}
}
await init();
