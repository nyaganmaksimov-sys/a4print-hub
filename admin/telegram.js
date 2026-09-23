import {supabase} from './guard.js?v=20260923-telegram1';

const $=id=>document.getElementById(id);
const cfg=window.A4PRINT_CONFIG||{};
const apiBase=String(cfg.apiBaseUrl||'https://a4print-hub-api.onrender.com').replace(/\/$/,'');
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const state={session:null,rows:[],acceptOrders:true,selected:null,orderUnit:null,loading:false};
let searchTimer=null;

const statusText=s=>({NEW:'Новое',READ:'Прочитано',IN_WORK:'В работе',ORDER_CREATED:'Заказ создан',CLOSED:'Закрыто'}[s]||s);
const statusClass=s=>s==='IN_WORK'?'work':s==='ORDER_CREATED'?'order':s==='CLOSED'?'closed':'';

function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}
async function ensureSession(){
  if(state.session?.access_token)return state.session;
  const {data:{session},error}=await supabase.auth.getSession();
  if(error)throw error;
  if(!session){location.replace('./login.html');return null}
  state.session=session;return session;
}
async function api(path,options={}){
  const session=await ensureSession();
  if(!session?.access_token)throw new Error('Нет активной сессии.');
  const res=await fetch(apiBase+path,{
    ...options,
    headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json',...(options.headers||{})},
    cache:'no-store'
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.message||data.error||('HTTP '+res.status));
  return data;
}
function sender(row){
  const name=[row.first_name,row.last_name].filter(Boolean).join(' ').trim();
  return name||(row.username?'@'+row.username:'Telegram '+row.chat_id);
}
function render(){
  $('list').innerHTML=state.rows.map(row=>`<article class="card">
    <div class="head"><div class="sender"><b>${esc(sender(row))}</b><small>${row.username?'@'+esc(row.username)+' · ':''}${esc(new Date(row.created_at).toLocaleString('ru-RU'))}</small></div><span class="chip ${statusClass(row.status)}">${esc(statusText(row.status))}</span></div>
    <div class="message">${esc(row.message_text||'Сообщение без текста')}</div>
    <div class="actions">
      ${row.status==='NEW'?`<button data-work="${row.id}">В работу</button>`:''}
      <button data-reply="${row.id}" class="primary">Ответить</button>
      ${state.acceptOrders&&!row.linked_order_id?`<button data-order="${row.id}" data-unit="A4_PRINT" class="green">Создать заказ А4</button><button data-order="${row.id}" data-unit="3D_ARTPRINT">Создать 3D-заказ</button>`:''}
      ${row.linked_order_id?`<a href="./order.html?id=${encodeURIComponent(row.linked_order_id)}" class="green">Открыть заказ</a>`:''}
      ${row.status!=='CLOSED'?`<button data-close="${row.id}">Закрыть</button>`:''}
    </div>
  </article>`).join('')||'<div class="empty">Сообщений пока нет</div>';
}
function renderLoading(){$('list').innerHTML='<div class="telegram-loading-list"><div class="a4-skeleton"></div><div class="a4-skeleton"></div><div class="a4-skeleton"></div></div>'}
function renderError(error){$('list').innerHTML=`<div class="a4-error"><b>Не удалось загрузить Telegram</b><div style="margin-top:4px">${esc(error.message||error)}</div><button id="telegramRetry" type="button" class="a4-btn" style="margin-top:10px">Повторить</button></div>`;$('telegramRetry')?.addEventListener('click',refreshAll)}

async function loadStatus(){
  const data=await api('/api/v1/integrations/telegram/status');
  state.acceptOrders=data.accept_orders!==false;
  const status=$('botStatus');
  status.classList.toggle('on',Boolean(data.connected&&data.enabled));
  status.innerHTML=`<i></i>${data.connected?(data.enabled?'@'+esc(data.bot_username||'bot'):'Бот выключен'):'Не подключён'}`;
}
async function loadMessages(){
  if(state.loading)return;state.loading=true;renderLoading();
  try{
    const params=new URLSearchParams();
    const q=$('q').value.trim(),status=$('statusFilter').value;
    if(q)params.set('q',q);if(status)params.set('status',status);
    const data=await api('/api/v1/integrations/telegram/messages'+(params.size?'?'+params.toString():''));
    state.rows=Array.isArray(data.messages)?data.messages:[];
    render();
  }catch(error){console.error('Telegram messages load failed',error);renderError(error)}
  finally{state.loading=false}
}
async function refreshAll(){
  $('reload').disabled=true;
  try{
    const [statusResult]=await Promise.allSettled([loadStatus(),loadMessages()]);
    if(statusResult.status==='rejected'){
      const status=$('botStatus');status.classList.remove('on');status.innerHTML='<i></i>Статус недоступен';
      console.warn('Telegram status unavailable',statusResult.reason);
    }
  }finally{$('reload').disabled=false}
}
async function setStatus(id,status){
  try{
    await api(`/api/v1/integrations/telegram/messages/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status})});
    await loadMessages();
  }catch(error){notify('error','Не удалось изменить статус',error.message||String(error))}
}
function openReply(id){
  const row=state.rows.find(x=>x.id===id);if(!row)return;
  state.selected=row;$('replyRecipient').textContent=sender(row);$('replyText').value='';$('replyError').textContent='';$('replyDlg').showModal();setTimeout(()=>$('replyText').focus(),30);
}
async function sendReply(event){
  event.preventDefault();const text=$('replyText').value.trim();if(!text){$('replyError').textContent='Введите текст ответа.';return}
  const button=$('replySubmit');button.disabled=true;$('replyError').textContent='';
  try{
    await api(`/api/v1/integrations/telegram/messages/${encodeURIComponent(state.selected.id)}/reply`,{method:'POST',body:JSON.stringify({text})});
    $('replyDlg').close();notify('success','Ответ отправлен','Сообщение отправлено клиенту в Telegram.');await loadMessages();
  }catch(error){$('replyError').textContent=error.message||String(error)}
  finally{button.disabled=false}
}
function openOrder(id,unit){
  const row=state.rows.find(x=>x.id===id);if(!row)return;
  state.selected=row;state.orderUnit=unit;
  $('orderDialogTitle').textContent=unit==='3D_ARTPRINT'?'Создать 3D-заказ':'Создать заказ А4-Принт';
  $('orderDialogText').textContent=`Сообщение от ${sender(row)} будет преобразовано в новый заказ ${unit==='3D_ARTPRINT'?'3D-ARTPRINT':'А4-Принт'}.`;
  $('orderDialogError').textContent='';$('orderDlg').showModal();
}
async function createOrder(event){
  event.preventDefault();const button=$('orderSubmit');button.disabled=true;$('orderDialogError').textContent='';
  try{
    const data=await api(`/api/v1/integrations/telegram/messages/${encodeURIComponent(state.selected.id)}/create-order`,{method:'POST',body:JSON.stringify({business_unit:state.orderUnit})});
    $('orderDlg').close();
    if(data.order?.id){location.href='./order.html?id='+encodeURIComponent(data.order.id);return}
    notify('success','Заказ создан','Заказ создан из Telegram-сообщения.');await loadMessages();
  }catch(error){$('orderDialogError').textContent=error.message||String(error)}
  finally{button.disabled=false}
}

$('list').addEventListener('click',event=>{
  const work=event.target.closest('[data-work]');if(work){void setStatus(work.dataset.work,'IN_WORK');return}
  const close=event.target.closest('[data-close]');if(close){void setStatus(close.dataset.close,'CLOSED');return}
  const reply=event.target.closest('[data-reply]');if(reply){openReply(reply.dataset.reply);return}
  const order=event.target.closest('[data-order]');if(order)openOrder(order.dataset.order,order.dataset.unit);
});
$('q').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadMessages,280)});
$('statusFilter').addEventListener('change',loadMessages);
$('reload').addEventListener('click',refreshAll);
$('replyCancel').addEventListener('click',()=>$('replyDlg').close());
$('replyForm').addEventListener('submit',sendReply);
$('orderCancel').addEventListener('click',()=>$('orderDlg').close());
$('orderForm').addEventListener('submit',createOrder);

await ensureSession();
await refreshAll();
