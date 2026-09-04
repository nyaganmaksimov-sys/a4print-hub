import { supabase } from './guard.js';

const $ = id => document.getElementById(id);
const cfg = window.A4PRINT_CONFIG || {};

let profile = null;
let room = null;
let generalRoom = null;
let channel = null;
let pending = [];
let staff = [];
let activeKey = 'general';

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const initials = n => (String(n || '?').trim().split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase() || '?');
const fmt = v => new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
function sizeFmt(n){n=Number(n||0);if(n<1024)return n+' Б';if(n<1048576)return(n/1024).toFixed(n<10240?1:0)+' КБ';return(n/1048576).toFixed(n<10485760?1:0)+' МБ'}
function fileIcon(a){const t=(a.mime_type||'').toLowerCase(),n=(a.file_name||'').toLowerCase();if(t.startsWith('image/'))return'🖼️';if(t.includes('pdf')||n.endsWith('.pdf'))return'📕';if(t.includes('zip')||t.includes('rar')||n.match(/\.(zip|rar|7z)$/))return'🗜️';if(t.includes('word')||n.match(/\.(doc|docx)$/))return'📘';if(t.includes('sheet')||t.includes('excel')||n.match(/\.(xls|xlsx|csv)$/))return'📗';if(t.includes('photoshop')||n.endsWith('.psd'))return'🎨';if(n.match(/\.(cdr|ai|eps|svg)$/))return'✒️';return'📄'}

async function sessionHeaders(){const{data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('Сессия истекла. Войдите снова.');return{Authorization:`Bearer ${session.access_token}`,apikey:cfg.supabasePublishableKey||''}}
function edgeUrl(q=''){return`${cfg.supabaseUrl}/functions/v1/chat-drive${q}`}
async function edgeJson(url,opt={}){const headers=await sessionHeaders();const r=await fetch(url,{...opt,headers:{...headers,...(opt.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||d.error||'Ошибка хранилища файлов');return d}

async function loadDriveStatus(){try{const d=await edgeJson(edgeUrl('?action=status'));const el=$('driveStatus');if(d.connected){el.textContent='● Drive подключён';el.className='drive-state ok';el.title=d.google_email||'Google Drive подключён'}else{el.textContent='Файлы: HUB';el.className='drive-state ok';el.title='Файлы сохраняются в защищённом хранилище HUB. Google Drive можно подключить дополнительно.'}}catch(e){$('driveStatus').textContent='Файлы: HUB';$('driveStatus').className='drive-state ok';$('driveStatus').title='Используется защищённое хранилище HUB'}}

async function markRoomRead(){
  if(!profile||!room?.id)return;
  const{error}=await supabase.from('notifications').update({is_read:true}).eq('type','CHAT_MESSAGE').eq('entity_type','chat_room').eq('entity_id',room.id).eq('is_read',false);
  if(!error)window.dispatchEvent(new CustomEvent('a4:notifications-changed'));
}

function updateNotifButton(){
  const el=$('notifBtn');if(!el)return;
  if(!('Notification' in window)){el.textContent='🔕 Не поддерживается';el.className='off';el.disabled=true;return}
  if(Notification.permission==='granted'){el.textContent='🔔 Уведомления включены';el.className='on';el.disabled=false}
  else if(Notification.permission==='denied'){el.textContent='🔕 Уведомления запрещены';el.className='off';el.disabled=false}
  else{el.textContent='🔔 Включить уведомления';el.className='';el.disabled=false}
}

async function loadStaff(){
  const {data,error}=await supabase.from('users').select('id,full_name,email,position,is_active').eq('is_active',true).neq('id',profile.id).order('full_name');
  if(error) throw error;
  staff=data||[];
  $('staffCount').textContent=String(staff.length);
  renderStaff();
  renderRecipientSelect();
}

function renderRecipientSelect(){
  const select=$('recipientSelect');
  const current=activeKey;
  select.innerHTML='<option value="general">Общий чат</option>'+staff.map(u=>`<option value="${u.id}">${esc(u.full_name||u.email||'Сотрудник')}</option>`).join('');
  select.value=staff.some(u=>u.id===current)||current==='general'?current:'general';
}

function renderStaff(){
  const q=$('staffSearch').value.trim().toLowerCase();
  const list=staff.filter(u=>`${u.full_name||''} ${u.email||''} ${u.position||''}`.toLowerCase().includes(q));
  const el=$('staffList');
  if(!list.length){el.innerHTML='<div class="staff-empty">Сотрудники не найдены</div>';return}
  el.innerHTML=list.map(u=>`<button type="button" class="person-btn ${activeKey===u.id?'active':''}" data-person="${u.id}"><span class="person-avatar">${esc(initials(u.full_name||u.email))}</span><span class="person-copy"><b>${esc(u.full_name||u.email||'Сотрудник')}</b><small>${esc(u.position||u.email||'Личная переписка')}</small></span></button>`).join('');
  el.querySelectorAll('[data-person]').forEach(b=>b.onclick=()=>openDirect(b.dataset.person));
}

async function cleanupPendingBeforeSwitch(){
  if(!pending.length)return true;
  if(pending.some(x=>x.status==='uploading')){alert('Дождитесь окончания загрузки файлов перед переключением чата.');return false}
  if(!confirm('Есть неотправленные вложения. При переключении чата они будут удалены. Продолжить?'))return false;
  try{
    for(const item of pending){if(item.id)await edgeJson(edgeUrl(`?attachment_id=${encodeURIComponent(item.id)}`),{method:'DELETE'})}
    pending=[];drawPending();return true;
  }catch(e){alert('Не удалось удалить неотправленные вложения: '+(e.message||'Ошибка'));return false}
}

function syncActiveUi(){
  $('generalRoom').classList.toggle('active',activeKey==='general');
  if($('recipientSelect').querySelector(`option[value="${CSS.escape(activeKey)}"]`))$('recipientSelect').value=activeKey;
  renderStaff();
}

async function activateRoom(nextRoom,person=null){
  room=nextRoom;
  document.body.dataset.chatRoomId=room.id;
  if(channel){await supabase.removeChannel(channel);channel=null}
  $('messages').innerHTML='<div class="empty-chat">Загрузка сообщений...</div>';
  if(person){
    $('roomName').textContent=person.full_name||person.email||'Личный чат';
    $('roomSubtitle').textContent=[person.position,person.email].filter(Boolean).join(' · ')||'Личная переписка';
  }else{
    $('roomName').textContent='Общий чат';
    $('roomSubtitle').textContent='Все сотрудники';
  }
  syncActiveUi();
  await loadMessages();
  await markRoomRead();
  subscribe();
  $('text').focus();
}

async function openGeneral(){
  if(activeKey==='general'&&room?.id===generalRoom?.id)return true;
  const ok=await cleanupPendingBeforeSwitch();if(!ok){renderRecipientSelect();return false}
  activeKey='general';
  await activateRoom(generalRoom,null);
  return true;
}

async function openDirect(userId){
  const person=staff.find(x=>x.id===userId);if(!person)return false;
  if(activeKey===userId&&room)return true;
  const ok=await cleanupPendingBeforeSwitch();if(!ok){renderRecipientSelect();return false}
  try{
    $('messages').innerHTML='<div class="empty-chat">Открываем личный чат...</div>';
    const {data,error}=await supabase.rpc('open_direct_chat',{p_other_user_id:userId});
    if(error)throw error;
    activeKey=userId;
    await activateRoom({id:data,name:null,is_group:false},person);
    return true;
  }catch(e){alert(e.message||'Не удалось открыть личный чат.');activeKey='general';renderRecipientSelect();syncActiveUi();return false}
}

async function loadMessages(){
  if(!room)return;
  const{data,error}=await supabase.from('messages').select('id,body,created_at,sender_id,users:sender_id(full_name,email),message_attachments(id,file_name,mime_type,file_size,created_at)').eq('room_id',room.id).is('deleted_at',null).order('created_at',{ascending:true}).limit(300);
  if(error)throw error;
  render(data||[]);
}

function attachmentHtml(a){return`<button type="button" class="attachment" data-download="${esc(a.id)}" data-name="${esc(a.file_name)}"><span class="attachment-icon">${fileIcon(a)}</span><span class="attachment-info"><span class="attachment-name">${esc(a.file_name)}</span><span class="attachment-size">${sizeFmt(a.file_size)} · скачать</span></span><span>⬇️</span></button>`}
function render(rows){$('messages').innerHTML=rows.length?rows.map(m=>{const at=(m.message_attachments||[]).map(attachmentHtml).join('');return`<div class="msg ${m.sender_id===profile.id?'mine':''}"><div class="meta">${esc(m.users?.full_name||m.users?.email||'Сотрудник')} · ${fmt(m.created_at)}</div>${m.body?`<div class="body">${esc(m.body)}</div>`:''}${at?`<div class="attachments">${at}</div>`:''}</div>`}).join(''):'<div class="empty-chat">Сообщений пока нет. Напишите первым.</div>';document.querySelectorAll('[data-download]').forEach(b=>b.onclick=()=>downloadAttachment(b.dataset.download,b.dataset.name));$('messages').scrollTop=$('messages').scrollHeight}
function subscribe(){if(channel)supabase.removeChannel(channel);channel=supabase.channel(`a4print-chat-${room.id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`room_id=eq.${room.id}`},()=>setTimeout(()=>loadMessages().then(markRoomRead).catch(showError),180)).on('postgres_changes',{event:'UPDATE',schema:'public',table:'message_attachments',filter:`room_id=eq.${room.id}`},()=>loadMessages().catch(showError)).subscribe()}
function showError(e){console.error(e);$('messages').insertAdjacentHTML('beforeend',`<div class="empty-chat" style="color:#b91c1c">${esc(e.message||'Ошибка чата')}</div>`)}

function drawPending(){const el=$('pending');if(!pending.length){el.classList.remove('show');el.innerHTML='';return}el.classList.add('show');el.innerHTML=pending.map(x=>`<div class="pending-item ${x.status||''}"><span>${x.status==='uploading'?'⏳':x.status==='error'?'⚠️':fileIcon(x)}</span><span class="pending-name">${esc(x.file_name||x.name)}</span>${x.status==='uploading'?'':`<button type="button" class="pending-remove" data-remove="${esc(x.localId)}">×</button>`}</div>`).join('');el.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>removePending(b.dataset.remove))}
async function uploadOne(file){const fd=new FormData();fd.append('room_id',room.id);fd.append('file',file,file.name);const headers=await sessionHeaders();const r=await fetch(edgeUrl(),{method:'POST',headers,body:fd});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||d.error||'Не удалось загрузить файл.');return d.attachment}
async function addFiles(files){const list=[...files];if(!room||!list.length)return;if(pending.filter(x=>x.status!=='error').length+list.length>6)return alert('Можно прикрепить не более 6 файлов к одному сообщению.');for(const file of list){if(file.size>25*1024*1024){alert(`Файл «${file.name}» больше 25 МБ.`);continue}const localId=crypto.randomUUID();const item={localId,name:file.name,file_name:file.name,file_size:file.size,mime_type:file.type,status:'uploading'};pending.push(item);drawPending();try{const a=await uploadOne(file);Object.assign(item,a,{status:''});drawPending()}catch(e){item.status='error';item.error=e.message;drawPending();alert(`Не удалось загрузить «${file.name}»: ${e.message}`)}}$('fileInput').value=''}
async function removePending(localId){const item=pending.find(x=>x.localId===localId);if(!item)return;if(item.id){try{await edgeJson(edgeUrl(`?attachment_id=${encodeURIComponent(item.id)}`),{method:'DELETE'})}catch(e){console.warn(e)}}pending=pending.filter(x=>x.localId!==localId);drawPending()}
async function downloadAttachment(id,name){try{const headers=await sessionHeaders();const r=await fetch(edgeUrl(`?attachment_id=${encodeURIComponent(id)}`),{headers});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||'Не удалось скачать файл.')}const blob=await r.blob(),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name||'file';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000)}catch(e){alert(e.message||'Не удалось скачать файл.')}}

$('attachBtn').onclick=()=>$('fileInput').click();
$('fileInput').onchange=e=>addFiles(e.target.files);
$('staffSearch').oninput=renderStaff;
$('generalRoom').onclick=()=>openGeneral();
$('recipientSelect').onchange=async e=>{const value=e.target.value;const ok=value==='general'?await openGeneral():await openDirect(value);if(!ok)e.target.value=activeKey};
$('notifBtn').onclick=async()=>{if(!('Notification'in window))return alert('Этот браузер не поддерживает системные уведомления.');if(Notification.permission==='denied'){alert('Уведомления запрещены в настройках браузера. Разрешите уведомления для a4print-hub.ru.');return}if(Notification.permission!=='granted')await Notification.requestPermission();updateNotifButton()};
$('composer').onsubmit=async e=>{e.preventDefault();if(!room||!profile)return;const body=$('text').value.trim(),ready=pending.filter(x=>x.id&&x.status!=='error');if(!body&&!ready.length)return;if(pending.some(x=>x.status==='uploading'))return alert('Дождитесь окончания загрузки файлов.');try{$('send').disabled=true;$('attachBtn').disabled=true;const{data:message,error}=await supabase.from('messages').insert({room_id:room.id,sender_id:profile.id,body}).select('id').single();if(error)throw error;if(ready.length){const{error:aErr}=await supabase.from('message_attachments').update({message_id:message.id}).in('id',ready.map(x=>x.id));if(aErr){await supabase.from('messages').delete().eq('id',message.id);throw aErr}}$('text').value='';pending=[];drawPending();await loadMessages()}catch(err){alert(err.message||'Не удалось отправить сообщение.')}finally{$('send').disabled=false;$('attachBtn').disabled=false;$('text').focus()}};
$('text').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('composer').requestSubmit()}});
$('refresh').onclick=async()=>{try{await Promise.all([loadMessages(),loadDriveStatus(),loadStaff(),markRoomRead()])}catch(e){alert(e.message||'Не удалось обновить чат.')}};

async function init(){
  const{data:{session}}=await supabase.auth.getSession();
  if(!session)return location.replace('./login.html');
  const{data:p,error:pErr}=await supabase.from('users').select('id,full_name,email,is_active').eq('auth_user_id',session.user.id).maybeSingle();
  if(pErr)throw pErr;
  if(!p||p.is_active===false)throw new Error('Профиль сотрудника не найден или отключён.');
  profile=p;$('me').textContent=p.full_name||p.email;
  updateNotifButton();
  const{data:r,error:rErr}=await supabase.from('chat_rooms').select('id,name,is_group').eq('name','Общий чат').limit(1).maybeSingle();
  if(rErr)throw rErr;
  if(!r){$('messages').innerHTML='<div class="empty-chat">Общий чат ещё не создан.</div>';return}
  generalRoom=r;
  await loadStaff();
  activeKey='general';
  await activateRoom(generalRoom,null);
  loadDriveStatus();
}

init().catch(e=>{$('messages').innerHTML=`<div class="empty-chat" style="color:#b91c1c">${esc(e.message)}</div>`});
