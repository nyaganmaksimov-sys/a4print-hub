import {supabase} from './guard.js?v=20260905-netfix1';

const id=new URLSearchParams(location.search).get('id');
const $=x=>document.getElementById(x);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const labels={NEW:'Новый',CONFIRMED:'Подтверждён',IN_PROGRESS:'В работе',READY:'Готов',COMPLETED:'Завершён',ON_HOLD:'Приостановлен',CANCELLED:'Отменён'};
const prodLabels={NEW:'Новая',QUEUED:'В очереди',IN_PROGRESS:'В работе',PAUSED:'Пауза',DONE:'Готово',CANCELLED:'Отменена'};
const paidStatuses=new Set(['PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED']);
const MAX_FILE_SIZE=50*1024*1024;
const state={order:null,roles:[],staffId:null,docs:[],payments:[],jobs:[],files:[],messages:[],loading:false,reloadQueued:false,channel:null,financeError:null,jobsError:null,filesError:null,messagesError:null};
let reloadTimer=null;
const notify=(tone,title,message,options={})=>{if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});const method=tone==='error'?'error':tone==='warning'?'warn':'log';console[method]('[A4PRINT HUB]',title,message)};

const canManage=()=>state.roles.includes('ADMIN')||state.roles.includes('MANAGER');
const canProduction=()=>['ADMIN','MANAGER','PRODUCTION'].some(x=>state.roles.includes(x));
const paymentOk=p=>paidStatuses.has(String(p?.status||'').toUpperCase());
const docActive=d=>String(d?.status||'').toUpperCase()!=='CANCELLED';
const fmtDate=(v,time=false)=>{if(!v)return'—';const d=new Date(v);if(!Number.isFinite(d.getTime()))return'—';return time?d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('ru-RU')};
const docPaid=docId=>state.payments.filter(p=>p.customer_document_id===docId&&paymentOk(p)).reduce((s,p)=>s+Number(p.amount||0),0);
const tone=s=>{s=String(s||'').toUpperCase();if(['COMPLETED','READY','PAID','DONE'].includes(s))return'green';if(s==='CANCELLED')return'red';if(['ON_HOLD','PAUSED'].includes(s))return'orange';return s==='NEW'?'gray':''};

async function context(){
  const {data:{session}}=await supabase.auth.getSession();
  const [roles,profile]=await Promise.all([
    supabase.rpc('get_my_roles'),
    session?.user?.id?supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle():Promise.resolve({data:null})
  ]);
  state.roles=Array.isArray(roles.data)?roles.data:[];
  state.staffId=profile.data?.id||null;
}

async function load(force=false){
  if(!id){$('orderInfo').innerHTML='<div class="a4-error">Не указан ID заказа</div>';return}
  if(state.loading){if(force)state.reloadQueued=true;return}
  state.loading=true;$('refresh').disabled=true;$('refresh').textContent='Обновление…';
  try{
    const baseSelect='id,order_number,business_unit,customer_id,assigned_to,status,total,customer_comment,internal_comment,source,model_id,model_name,model_url,created_at,updated_at,partner_id,partner_user_id,fulfillment_partner_id,partner_direction,due_at,partner_workflow,partner_fulfillment_status,partner_planned_cost,partner_actual_cost,partner_external_ref,partner_tracking,partner_fulfillment_updated_at,partner_sent_at,partner_confirmed_at,partner_production_at,partner_shipped_at,partner_received_at,customers(id,full_name,company_name,phone,email),order_items(id,name,quantity,unit_price,total_price,parameters),order_status_history(id,old_status,new_status,changed_by,comment,created_at)';
    const managerRelations=canManage()?',requester:partners!orders_partner_id_fkey(id,name,contact_name,email,phone,discount_percent,payment_terms_days),executor:partners!orders_fulfillment_partner_id_fkey(id,name,contact_name,email,phone,discount_percent,payment_terms_days),partner_users(id,full_name,email,phone)':'';
    const orderQuery=supabase.from('orders').select(baseSelect+managerRelations).eq('id',id).single();
    const jobsQuery=supabase.from('production_jobs').select('id,order_id,assigned_to,status,title,priority,planned_start,planned_end,started_at,completed_at,notes,created_at,updated_at,assignee:users!production_jobs_assigned_to_fkey(full_name,email)').eq('order_id',id).order('created_at',{ascending:false});
    const filesQuery=supabase.from('order_files').select('id,order_id,file_name,file_url,mime_type,created_at').eq('order_id',id).order('created_at',{ascending:false});
    const docsQuery=canManage()?supabase.from('customer_documents').select('id,customer_id,order_id,document_number,document_type,status,title,amount,currency,issue_date,due_date,description,created_at').eq('order_id',id).order('created_at',{ascending:false}):Promise.resolve({data:[],error:null});
    const messagesQuery=canManage()?supabase.from('partner_order_messages').select('id,order_id,sender_type,body,created_at').eq('order_id',id).order('created_at',{ascending:true}):Promise.resolve({data:[],error:null});

    const [orderR,jobsR,filesR,docsR,messagesR]=await Promise.all([orderQuery,jobsQuery,filesQuery,docsQuery,messagesQuery]);
    if(orderR.error)throw orderR.error;
    state.order=orderR.data;

    state.jobsError=jobsR.error||null;
    state.jobs=jobsR.error?[]:(jobsR.data||[]);
    if(jobsR.error)console.warn('Order production block unavailable',jobsR.error);

    state.filesError=filesR.error||null;
    state.files=filesR.error?[]:(filesR.data||[]);
    if(filesR.error)console.warn('Order files block unavailable',filesR.error);

    state.docs=docsR.error?[]:(docsR.data||[]);
    state.financeError=docsR.error||null;
    if(docsR.error)console.warn('Order documents block unavailable',docsR.error);

    state.messagesError=messagesR.error||null;
    state.messages=messagesR.error?[]:(messagesR.data||[]);
    if(messagesR.error)console.warn('Order partner messages unavailable',messagesR.error);

    state.payments=[];
    if(canManage()){
      const paymentsR=await supabase.rpc('get_order_workspace_payments',{p_order_id:id});
      if(paymentsR.error){
        state.financeError=state.financeError||paymentsR.error;
        console.warn('Order payments block unavailable',paymentsR.error);
      }else state.payments=paymentsR.data||[];
    }

    render();
    $('updatedAt').textContent=`обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){
    console.error('Order load failed',error);
    $('orderInfo').innerHTML=`<div class="a4-error"><b>Не удалось загрузить заказ</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="orderRetry" type="button" class="a4-btn" style="margin-top:10px">Повторить</button></div>`;
    $('orderRetry')?.addEventListener('click',()=>load(true));
    $('updatedAt').textContent='ошибка загрузки';
  }finally{
    state.loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Обновить';
    if(state.reloadQueued){state.reloadQueued=false;setTimeout(()=>load(),0)}
  }
}

function partnerContext(o){
  if(o.partner_id)return{partner:o.requester||{},id:o.partner_id,role:'Партнёр заказал у A4PRINT',direction:'ПАРТНЁР → A4PRINT'};
  if(o.fulfillment_partner_id)return{partner:o.executor||{},id:o.fulfillment_partner_id,role:'A4PRINT заказал у партнёра',direction:'A4PRINT → ПАРТНЁР'};
  return null;
}

function render(){
  const o=state.order;if(!o)return;const pc=partnerContext(o),c=o.customers||{};
  $('title').textContent=`Заказ №${o.order_number??'—'}`;
  $('subtitle').textContent=[o.business_unit==='3D_ARTPRINT'?'3D-ARTPRINT':o.business_unit==='A4_PRINT'?'А4-Принт':'Общее направление',o.model_name||o.source].filter(Boolean).join(' · ');
  $('status').textContent=labels[o.status]||o.status||'—';$('status').className=`order-badge ${tone(o.status)}`;
  $('orderDirection').textContent=pc?.direction||(o.customer_id?'КЛИЕНТ → A4PRINT':'HUB');
  document.querySelectorAll('[data-status]').forEach(b=>{b.hidden=!canManage();b.classList.toggle('active',b.dataset.status===o.status)});
  renderOrder(o,pc,c);renderFiles();renderFinance(o,pc);renderProduction();renderHistory(o);renderMessages(o);
  window.__A4_ORDER_DETAIL__={order:o,roles:[...state.roles]};
  document.dispatchEvent(new CustomEvent('a4:order-detail-loaded',{detail:window.__A4_ORDER_DETAIL__}));
}

function renderOrder(o,pc,c){
  if(pc&&canManage()){const p=pc.partner;$('partnerBlock').innerHTML=`<div class="order-partner"><b>${esc(pc.role)} · <a class="order-link" href="./partner.html?id=${encodeURIComponent(pc.id)}">${esc(p.name||'Партнёр')}</a></b><small>${esc(o.partner_users?.full_name||p.contact_name||'')}${p.phone?' · '+esc(p.phone):''}${p.email?' · '+esc(p.email):''}<br>Скидка ${Number(p.discount_percent||0)}% · отсрочка ${Number(p.payment_terms_days||0)} дн.</small></div>`}else if(pc){$('partnerBlock').innerHTML=`<div class="order-partner"><b>${esc(pc.direction)}</b><small>Детали партнёра доступны менеджеру или администратору.</small></div>`}else $('partnerBlock').innerHTML='';
  const outbound=String(o.partner_direction||'').toUpperCase()==='OUTBOUND'&&o.fulfillment_partner_id;
  const customerName=c.company_name||c.full_name||'Не указан';
  const customerContact=[c.full_name&&c.company_name?c.full_name:'',c.phone,c.email].filter(Boolean).join(' · ')||'—';
  const name=outbound?customerName:(pc?(pc.partner.name||'Партнёр'):customerName);
  const contact=outbound?customerContact:(pc?(pc.partner.phone||pc.partner.email||'—'):customerContact);
  const label=outbound||!pc?'Клиент':'Контрагент';
  const nameHtml=(outbound||!pc)&&o.customer_id?`<a class="order-link" href="./customer.html?id=${encodeURIComponent(o.customer_id)}">${esc(name)}</a>`:esc(name);
  $('orderInfo').innerHTML=`<div class="order-info"><span>${label}</span><b>${nameHtml}</b><small>${esc(contact)}</small></div><div class="order-info"><span>Работа / модель</span><b>${esc(o.model_name||o.source||'—')}</b><small>${o.model_url?`<a class="order-link" href="${esc(o.model_url)}" target="_blank" rel="noopener">Открыть модель ↗</a>`:'Файлы заказа — ниже'}</small></div><div class="order-info"><span>Создан</span><b>${esc(fmtDate(o.created_at,true))}</b><small>${esc(o.source||'A4PRINT HUB')}</small></div><div class="order-info"><span>Комментарий заказчика</span><b>${esc(o.customer_comment||'Нет')}</b><small>${o.partner_direction?`Направление: ${esc(o.partner_direction)}`:'—'}</small></div>`;
  $('itemsList').innerHTML=(o.order_items||[]).map(i=>`<div class="order-item"><span><b>${esc(i.name||'Позиция')} × ${Number(i.quantity||0).toLocaleString('ru-RU')}</b><small>${i.parameters?.details?esc(i.parameters.details):''}</small></span><strong>${money(i.total_price)}</strong></div>`).join('')||'<div class="order-empty">Позиции не добавлены</div>';
  $('internalComment').value=o.internal_comment||'';$('internalComment').disabled=!canManage();$('saveComment').hidden=!canManage();
}

function fileIcon(mime,name){
  const type=String(mime||'').toLowerCase(),n=String(name||'').toLowerCase();
  if(type.startsWith('image/'))return'▧';
  if(type==='application/pdf'||n.endsWith('.pdf'))return'PDF';
  if(/\.(stl|3mf|obj|step|stp|gltf|glb)$/i.test(n))return'3D';
  if(/\.(zip|rar|7z)$/i.test(n))return'ZIP';
  return'📄';
}

function renderFiles(){
  const count=$('orderFilesCount'),list=$('orderFiles'),actions=$('orderFilesActions');
  if(count)count.textContent=String(state.files.length);
  if(actions)actions.hidden=!canManage();
  if(!list)return;
  if(state.filesError){list.innerHTML='<div class="a4-error">Файлы временно недоступны. Остальная карточка продолжает работать.</div>';return}
  list.innerHTML=state.files.length?state.files.map(file=>`<div class="order-file-row"><div class="order-file-icon">${esc(fileIcon(file.mime_type,file.file_name))}</div><div class="order-file-meta"><b title="${esc(file.file_name)}">${esc(file.file_name)}</b><small>${esc(file.mime_type||'файл')} · ${esc(fmtDate(file.created_at,true))}</small></div><button class="order-file-open" type="button" data-order-file="${esc(file.id)}">Открыть</button></div>`).join(''):'<div class="order-empty">Файлы не прикреплены</div>';
}

async function openOrderFile(fileId,button){
  const file=state.files.find(x=>x.id===fileId);if(!file)return;
  button.disabled=true;const old=button.textContent;button.textContent='Открываю…';
  try{
    let url=String(file.file_url||'');
    if(!/^https?:\/\//i.test(url)){
      const {data,error}=await supabase.storage.from('order-files').createSignedUrl(url,3600);
      if(error)throw error;url=data?.signedUrl||'';
    }
    if(!url)throw new Error('Не удалось получить ссылку на файл.');
    window.open(url,'_blank','noopener,noreferrer');
  }catch(error){notify('error','Не удалось открыть файл',error.message||String(error))}
  finally{button.disabled=false;button.textContent=old}
}

function safeStorageName(name){
  const clean=String(name||'file').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'-').replace(/\s+/g,' ').trim().slice(-150);
  return clean||'file';
}
function uniquePart(){return globalThis.crypto?.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2,12)}`}

async function addOrderFiles(fileList){
  if(!canManage())return;
  const files=[...(fileList||[])];if(!files.length)return;
  const tooLarge=files.filter(f=>f.size>MAX_FILE_SIZE);
  if(tooLarge.length){notify('warning','Файл слишком большой',`Максимум 50 МБ: ${tooLarge.map(f=>f.name).join(', ')}`);return}
  const button=$('addOrderFiles'),status=$('orderFileStatus');button.disabled=true;
  const failures=[];
  try{
    for(let index=0;index<files.length;index++){
      const file=files[index];
      button.textContent=`Загрузка ${index+1}/${files.length}…`;if(status)status.textContent=file.name;
      const path=`${id}/${uniquePart()}-${safeStorageName(file.name)}`;
      try{
        const upload=await supabase.storage.from('order-files').upload(path,file,{contentType:file.type||'application/octet-stream',cacheControl:'3600',upsert:false});
        if(upload.error)throw upload.error;
        const meta=await supabase.from('order_files').insert({order_id:id,file_name:file.name,file_url:path,mime_type:file.type||null});
        if(meta.error){await supabase.storage.from('order-files').remove([path]).catch(()=>{});throw meta.error}
      }catch(error){console.error('Order file upload failed',file.name,error);failures.push(file.name)}
    }
    if(failures.length)notify('warning','Не все файлы прикреплены',failures.join(', '),{duration:9000});
    await load();
  }finally{
    button.disabled=false;button.textContent='📎 Прикрепить файлы';if(status)status.textContent='до 50 МБ на файл';const input=$('orderFileInput');if(input)input.value='';
  }
}

function renderMessages(o){
  $('partnerMessagesSection').hidden=!o.partner_id||!canManage();if(!o.partner_id||!canManage())return;
  if(state.messagesError){$('partnerMessages').innerHTML='<div class="a4-error">Переписка временно недоступна.</div>';return}
  const rows=state.messages;
  $('partnerMessages').innerHTML=rows.map(m=>`<div class="order-message-bubble ${m.sender_type==='STAFF'?'staff':''}"><b>${m.sender_type==='PARTNER'?'Партнёр':'A4PRINT'}</b><div>${esc(m.body)}</div><small>${esc(fmtDate(m.created_at,true))}</small></div>`).join('')||'<div class="order-empty">Сообщений пока нет</div>';
  $('partnerReply').disabled=!canManage();$('sendPartnerReply').hidden=!canManage();
}

function renderFinance(o,pc){
  $('orderTotal').textContent=money(o.total);
  if(!canManage()){
    $('invoicedTotal').textContent='—';$('paidTotal').textContent='—';$('debtTotal').textContent='—';
    $('invoicedNote').textContent='ограничено ролью';$('debtNote').textContent='ограничено ролью';
    $('financeTitle').textContent='Финансы заказа';$('financeSubtitle').textContent='Доступно менеджеру или администратору';
    $('financeBadge').className='order-badge gray';$('financeBadge').textContent='—';
    $('financeMessage').innerHTML='<div class="order-alert blue">Финансовые данные скрыты для текущей роли. Заказ, файлы и производство доступны независимо.</div>';
    $('invoiceList').innerHTML='';$('paymentList').innerHTML='';$('financeActions').hidden=true;return;
  }
  $('financeActions').hidden=false;
  if(state.financeError){
    $('invoicedTotal').textContent='—';$('paidTotal').textContent='—';$('debtTotal').textContent='—';
    $('financeMessage').innerHTML='<div class="a4-error">Финансовый блок временно недоступен. Остальная карточка загружена.</div>';
    $('invoiceList').innerHTML='';$('paymentList').innerHTML='';return;
  }
  if(pc&&String(o.partner_direction||'').toUpperCase()==='INBOUND'){
    $('invoicedTotal').textContent='—';$('paidTotal').textContent='—';$('debtTotal').textContent='—';$('debtLabel').textContent='Расчёты';$('invoicedNote').textContent='партнёрский контур';$('debtNote').textContent='отдельно от клиентских оплат';
    $('financeTitle').textContent='Расчёты с партнёром';$('financeSubtitle').textContent='Партнёрские взаиморасчёты не смешиваются с клиентскими счетами';$('financeBadge').className='order-badge orange';$('financeBadge').textContent='PARTNER';
    $('financeMessage').innerHTML=`<div class="order-alert blue">${esc(pc.role)}. Для этого заказа используется финансовый контур партнёра, а не клиентская таблица payments.</div>`;$('invoiceList').innerHTML='';$('paymentList').innerHTML='';
    $('financeActions').innerHTML=`<a class="primary" href="./partner.html?id=${encodeURIComponent(pc.id)}">Открыть карточку партнёра</a>`;return;
  }

  const docs=state.docs.filter(docActive),invoiced=docs.reduce((s,d)=>s+Number(d.amount||0),0),paid=state.payments.filter(paymentOk).reduce((s,p)=>s+Number(p.amount||0),0),debt=Math.max(0,Number(o.total||0)-paid);
  $('invoicedTotal').textContent=money(invoiced);$('paidTotal').textContent=money(paid);$('debtTotal').textContent=money(debt);$('debtLabel').textContent='К получению';$('invoicedNote').textContent=`${docs.length} ${docs.length===1?'счёт':'счетов'}`;$('debtNote').textContent=debt>0?'остаток по заказу':'заказ оплачен';
  $('financeTitle').textContent='Финансы заказа';$('financeSubtitle').textContent='Счета и подтверждённые оплаты, связанные с заказом';$('financeBadge').className=`order-badge ${debt<=0&&Number(o.total||0)>0?'green':'orange'}`;$('financeBadge').textContent=debt<=0&&Number(o.total||0)>0?'ОПЛАЧЕН':'₽';
  if(!o.customer_id)$('financeMessage').innerHTML='<div class="order-alert">У заказа не выбран клиент. Сначала привяжите клиента, чтобы выставлять счета и регистрировать оплаты.</div>';
  else if(debt<=0&&Number(o.total||0)>0)$('financeMessage').innerHTML='<div class="order-alert green">Заказ полностью оплачен по подтверждённым платежам HUB.</div>';
  else if(invoiced<Number(o.total||0))$('financeMessage').innerHTML=`<div class="order-alert">Ещё не выставлено счетов на ${money(Math.max(0,Number(o.total||0)-invoiced))}.</div>`;
  else $('financeMessage').innerHTML=`<div class="order-alert blue">Счета покрывают стоимость заказа. Осталось получить ${money(debt)}.</div>`;

  $('invoiceList').innerHTML=`<div class="order-section"><div class="order-section-title">Счета</div>${docs.length?docs.map(d=>{const p=docPaid(d.id),left=Math.max(0,Number(d.amount||0)-p),late=d.due_date&&left>0&&new Date(d.due_date+'T23:59:59').getTime()<Date.now();return `<div class="order-mini-row"><span><b><a class="order-link" href="./invoice.html?id=${encodeURIComponent(d.id)}">${esc(d.document_number||'Счёт')}</a> <span class="order-badge ${left<=0?'green':late?'red':'gray'}">${left<=0?'ОПЛАЧЕН':late?'ПРОСРОЧЕН':esc(d.status||'ISSUED')}</span></b><small>${esc(fmtDate(d.issue_date))}${d.due_date?' · до '+esc(fmtDate(d.due_date)):''} · оплачено ${money(p)}</small></span><strong>${money(d.amount)}</strong></div>`}).join(''):'<div class="order-empty">Счета по заказу ещё не выставлялись</div>'}</div>`;
  $('paymentList').innerHTML=state.payments.length?state.payments.map(p=>`<div class="order-mini-row"><span><b>${esc(p.payment_number||'Оплата')} <span class="order-badge ${paymentOk(p)?'green':p.status==='CANCELLED'?'red':'gray'}">${esc(p.status||'PENDING')}</span></b><small>${esc(p.payment_method||'способ не указан')} · ${esc(fmtDate(p.paid_at||p.created_at,true))}</small></span><strong>${money(p.amount)}</strong></div>`).join(''):'<div class="order-empty">Оплат по заказу пока нет</div>';

  const create=$('createInvoice'),payment=$('registerPayment');if(create)create.hidden=!canManage()||!o.customer_id;if(payment)payment.hidden=!canManage()||!o.customer_id;
  const unpaid=docs.find(d=>Number(d.amount||0)-docPaid(d.id)>0);
  if(payment)payment.href=`./payments.html?customer=${encodeURIComponent(o.customer_id||'')}&order=${encodeURIComponent(o.id)}${unpaid?`&document=${encodeURIComponent(unpaid.id)}`:''}`;
}

function renderProduction(){
  $('productionCount').textContent=state.jobs.length;
  if(state.jobsError){$('productionJobs').innerHTML='<div class="a4-error">Производственный блок временно недоступен.</div>';$('productionBtn').hidden=true;return}
  $('productionJobs').innerHTML=state.jobs.length?state.jobs.map(j=>`<div class="order-production-job"><b>${esc(j.title||'Производственное задание')} · <span class="order-badge ${tone(j.status)}">${esc(prodLabels[j.status]||j.status)}</span></b><small>${j.assignee?.full_name||j.assignee?.email?`Исполнитель: ${esc(j.assignee?.full_name||j.assignee?.email)} · `:''}приоритет ${Number(j.priority||0)}${j.planned_end?' · срок '+esc(fmtDate(j.planned_end,true)):''}</small></div>`).join(''):'<div class="order-empty">Производственных заданий пока нет</div>';
  $('productionBtn').hidden=!canProduction()||state.jobs.length>0;
}

function renderHistory(o){const rows=(o.order_status_history||[]).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));$('history').innerHTML=rows.length?rows.map(h=>`<div class="order-history-row"><b>${esc(labels[h.new_status]||h.new_status)}</b><small>${esc(fmtDate(h.created_at,true))}${h.comment?' · '+esc(h.comment):''}</small></div>`).join(''):'<div class="order-empty">История пока пуста</div>'}

async function saveComment(){if(!canManage())return;const b=$('saveComment');b.disabled=true;try{const {error}=await supabase.from('orders').update({internal_comment:$('internalComment').value,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw error;await load(true)}catch(e){notify('error','Комментарий не сохранён',e.message||String(e))}finally{b.disabled=false}}
async function sendMessage(){if(!canManage())return;const body=$('partnerReply').value.trim();if(!body)return;const b=$('sendPartnerReply');b.disabled=true;try{const {error}=await supabase.from('partner_order_messages').insert({order_id:id,staff_user_id:state.staffId,sender_type:'STAFF',body});if(error)throw error;$('partnerReply').value='';await load(true)}catch(e){notify('error','Сообщение не отправлено',e.message||String(e))}finally{b.disabled=false}}
async function changeStatus(next){if(!canManage()||!state.order||state.order.status===next)return;const old=state.order.status;const {error}=await supabase.from('orders').update({status:next,updated_at:new Date().toISOString()}).eq('id',id);if(error){notify('error','Статус не изменён',error.message||String(error));return}const history=await supabase.from('order_status_history').insert({order_id:id,old_status:old,new_status:next,comment:'Изменено из карточки заказа'});if(history.error)notify('warning','Статус изменён, но история не записалась',history.error.message||String(history.error));await load(true)}
async function sendProduction(){if(!canProduction()||state.jobs.length)return;const o=state.order,b=$('productionBtn');b.disabled=true;try{const {error}=await supabase.from('production_jobs').insert({order_id:id,title:`Заказ №${o.order_number}${o.model_name?' — '+o.model_name:''}`,status:'NEW',priority:50});if(error)throw error;if(canManage()&&o.status==='NEW')await changeStatus('CONFIRMED');else await load(true)}catch(e){notify('error','Не удалось передать в производство',e.message||String(e))}finally{b.disabled=false}}

function openInvoice(){
  const o=state.order;if(!o?.customer_id||!canManage())return;const docs=state.docs.filter(docActive),invoiced=docs.reduce((s,d)=>s+Number(d.amount||0),0),paid=state.payments.filter(paymentOk).reduce((s,p)=>s+Number(p.amount||0),0),debt=Math.max(0,Number(o.total||0)-paid),uninvoiced=Math.max(0,Number(o.total||0)-invoiced);
  $('invoiceForm').reset();$('invoiceError').textContent='';$('invoiceAmount').value=(uninvoiced>0?uninvoiced:debt>0?debt:Number(o.total||0)).toFixed(2);$('invoiceDescription').value=o.model_name||o.source||`Заказ №${o.order_number}`;$('invoiceDlgText').textContent=docs.length?`У заказа уже есть ${docs.length} счёт(а). Проверьте сумму перед созданием.`:'Счёт будет автоматически связан с заказом и клиентом.';$('invoiceDlg').showModal();
}
async function createInvoice(e){
  e.preventDefault();if(!canManage()||!state.order?.customer_id)return;const b=$('saveInvoice'),amount=Number($('invoiceAmount').value);if(!(amount>0)){$('invoiceError').textContent='Сумма должна быть больше нуля.';return}b.disabled=true;$('invoiceError').textContent='';
  try{const {data,error}=await supabase.rpc('create_customer_invoice',{p_customer_id:state.order.customer_id,p_amount:amount,p_description:$('invoiceDescription').value.trim(),p_due_date:$('invoiceDue').value||null,p_order_id:id});if(error)throw error;$('invoiceDlg').close();await load();$('financeMessage').innerHTML=`<div class="order-alert green">Счёт создан и связан с заказом. <a class="order-link" href="./invoice.html?id=${encodeURIComponent(data)}">Открыть счёт</a></div>`}catch(err){$('invoiceError').textContent=err.message||String(err)}finally{b.disabled=false}
}

$('refresh').addEventListener('click',()=>load(true));$('saveComment').addEventListener('click',saveComment);$('sendPartnerReply').addEventListener('click',sendMessage);$('productionBtn').addEventListener('click',sendProduction);$('createInvoice').addEventListener('click',openInvoice);$('closeInvoiceDlg').addEventListener('click',()=>$('invoiceDlg').close());$('invoiceForm').addEventListener('submit',createInvoice);document.querySelectorAll('[data-status]').forEach(b=>b.addEventListener('click',()=>changeStatus(b.dataset.status)));
$('addOrderFiles')?.addEventListener('click',()=>$('orderFileInput')?.click());$('orderFileInput')?.addEventListener('change',event=>addOrderFiles(event.target.files));$('orderFiles')?.addEventListener('click',event=>{const button=event.target.closest('[data-order-file]');if(button)openOrderFile(button.dataset.orderFile,button)});
function realtime(){if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>load(true),650)};let ch=supabase.channel(`order-card-${id}`);for(const table of ['orders','order_status_history','partner_order_messages','production_jobs','customer_documents','payments','order_files'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);state.channel=ch.subscribe();window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true})}

await context();await load();realtime();