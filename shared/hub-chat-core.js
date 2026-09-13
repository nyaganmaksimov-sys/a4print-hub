const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const initials=s=>(String(s||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'?');
const fmtTime=v=>new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(new Date(v));
const fmtDay=v=>new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'long',year:'numeric'}).format(new Date(v));
const sizeFmt=n=>{n=Number(n||0);if(n<1024)return`${n} Б`;if(n<1048576)return`${(n/1024).toFixed(n<10240?1:0)} КБ`;return`${(n/1048576).toFixed(n<10485760?1:0)} МБ`};
const fileIcon=a=>{const t=String(a?.mime_type||'').toLowerCase(),n=String(a?.file_name||'').toLowerCase();if(t.startsWith('image/'))return'🖼️';if(t.includes('pdf')||n.endsWith('.pdf'))return'📕';if(n.match(/\.(zip|rar|7z)$/))return'🗜️';if(n.match(/\.(doc|docx)$/))return'📘';if(n.match(/\.(xls|xlsx|csv)$/))return'📗';if(n.match(/\.(cdr|ai|eps|svg|psd)$/))return'🎨';return'📄'};
const dateKey=v=>new Date(v).toLocaleDateString('en-CA');

export async function mountHubChat({supabase,context='staff',loginUrl='./login.html'}={}){
  if(!supabase)throw new Error('Supabase client is required');
  const root=document.getElementById('hubChatApp');
  if(!root)throw new Error('hubChatApp container not found');
  root.classList.add('hub-chat-app');
  const state={contacts:[],active:null,roomId:null,messages:[],attachments:new Map(),pending:[],channel:null,busy:false,search:'',refreshTimer:null};

  root.innerHTML=`<div class="hc-shell">
    <aside class="hc-sidebar">
      <div class="hc-sidebar-head"><h2>${context==='partner'?'Связь с HUB':'Сообщения'}</h2><p>${context==='partner'?'Прямой диалог с командой A4PRINT HUB':'Персонал и партнёры в одном месте'}</p><div class="hc-search-wrap"><span class="hc-search-icon">⌕</span><input id="hcSearch" class="hc-search" autocomplete="off" placeholder="Найти диалог"></div></div>
      <div id="hcContacts" class="hc-contact-scroll"><div class="hc-chat-empty">Загрузка диалогов…</div></div>
    </aside>
    <section class="hc-main">
      <header class="hc-chat-head">
        <div class="hc-chat-person"><button id="hcBack" class="hc-mobile-back" type="button" aria-label="Назад">‹</button><div id="hcHeadAvatar" class="hc-head-avatar">H</div><div class="hc-head-copy"><h3 id="hcTitle" class="hc-head-title">Выберите диалог</h3><div id="hcSubtitle" class="hc-head-sub">Сообщения A4PRINT HUB</div></div></div>
        <div class="hc-head-actions"><button id="hcNotify" class="hc-icon-btn" type="button" title="Уведомления">🔔</button><button id="hcRefresh" class="hc-icon-btn" type="button"><span class="hc-refresh-label">Обновить</span><span aria-hidden="true"> ↻</span></button></div>
      </header>
      <div id="hcMessages" class="hc-messages"><div class="hc-empty-main"><div><b>Чат A4PRINT HUB</b>Выберите диалог слева</div></div></div>
      <div class="hc-composer-wrap"><div id="hcUploadProgress" class="hc-upload-progress" hidden></div><div id="hcPending" class="hc-pending"></div><form id="hcComposer" class="hc-composer"><input id="hcFiles" type="file" multiple hidden><button id="hcAttach" class="hc-attach" type="button" title="Прикрепить файл">📎</button><textarea id="hcText" class="hc-text" maxlength="4000" rows="1" placeholder="Напишите сообщение…"></textarea><button id="hcSend" class="hc-send" type="submit">Отправить</button></form><div class="hc-composer-note">Enter — отправить · Shift+Enter — новая строка · до 6 файлов по 25 МБ</div></div>
    </section>
  </div><div id="hcToastHost" class="hc-toast-host"></div>`;

  const $=id=>root.querySelector(`#${id}`)||document.getElementById(id);
  const toast=(text,type='')=>{const el=document.createElement('div');el.className=`hc-toast ${type}`;el.textContent=text;$('hcToastHost').appendChild(el);setTimeout(()=>el.remove(),4200)};
  const rpc=async(name,args={})=>{const{data,error}=await supabase.rpc(name,args);if(error)throw error;return data};
  const contactKey=c=>`${c.target_kind}:${c.target_id||''}`;
  const safeName=n=>String(n||'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'_').slice(0,120)||'file';
  const isPartner=c=>c?.target_kind==='PARTNER'||c?.target_kind==='HUB';

  function relativeTime(v){if(!v)return'';const diff=Date.now()-new Date(v).getTime();if(diff<60000)return'сейчас';if(diff<3600000)return`${Math.max(1,Math.floor(diff/60000))} мин`;if(diff<86400000)return fmtTime(v);return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit'}).format(new Date(v))}
  function sectionRows(rows,title){if(!rows.length)return'';return`<div class="hc-section-title"><span>${esc(title)}</span><span class="hc-section-count">${rows.length}</span></div>${rows.map(contactHtml).join('')}`}
  function contactHtml(c){const kind=String(c.target_kind||'').toLowerCase(),active=state.active&&contactKey(state.active)===contactKey(c);return`<button type="button" class="hc-contact ${kind==='partner'||kind==='hub'?'partner ':''}${kind==='general'?'general ':''}${active?'active':''}" data-contact="${esc(contactKey(c))}"><span class="hc-contact-avatar">${kind==='general'?'#':kind==='hub'?'A4':esc(initials(c.title))}</span><span class="hc-contact-copy"><span class="hc-contact-title">${esc(c.title)}</span><span class="hc-contact-sub">${esc(c.subtitle||'')}</span></span><span class="hc-contact-meta">${Number(c.unread_count||0)>0?`<span class="hc-unread">${Math.min(99,Number(c.unread_count))}${Number(c.unread_count)>99?'+':''}</span>`:''}${c.last_message_at?`<span class="hc-last">${esc(relativeTime(c.last_message_at))}</span>`:''}</span></button>`}
  function renderContacts(){
    const q=state.search.trim().toLowerCase();
    const visible=state.contacts.filter(c=>`${c.title||''} ${c.subtitle||''}`.toLowerCase().includes(q));
    const general=visible.filter(c=>c.target_kind==='GENERAL');
    const staff=visible.filter(c=>c.target_kind==='STAFF');
    const partners=visible.filter(c=>c.target_kind==='PARTNER'||c.target_kind==='HUB');
    $('hcContacts').innerHTML=context==='partner'?(partners.map(contactHtml).join('')||'<div class="hc-chat-empty">Диалог HUB недоступен</div>'):[general.map(contactHtml).join(''),sectionRows(staff,'Персонал'),sectionRows(partners,'Партнёры')].join('')||'<div class="hc-chat-empty">Ничего не найдено</div>';
    $('hcContacts').querySelectorAll('[data-contact]').forEach(btn=>btn.onclick=()=>{const c=state.contacts.find(x=>contactKey(x)===btn.dataset.contact);if(c)openContact(c)});
    updateTitleBadge();
  }
  function updateTitleBadge(){const total=state.contacts.reduce((n,c)=>n+Number(c.unread_count||0),0);document.title=`${total?`(${total}) `:''}${context==='partner'?'Чат с A4PRINT HUB':'Сообщения — A4PRINT HUB'}`}

  async function loadContacts({keep=true}={}){
    const data=await rpc('hub_chat_contacts');
    const oldKey=keep&&state.active?contactKey(state.active):null;
    state.contacts=Array.isArray(data)?data:[];
    if(oldKey){const fresh=state.contacts.find(c=>contactKey(c)===oldKey);if(fresh)state.active={...state.active,...fresh}}
    renderContacts();
    return state.contacts;
  }

  async function loadAttachments(){
    state.attachments=new Map();
    const ids=state.messages.map(m=>m.id);if(!ids.length)return;
    const{data,error}=await supabase.from('message_attachments').select('id,message_id,file_name,mime_type,file_size,storage_path,provider,drive_file_id').eq('room_id',state.roomId).in('message_id',ids);
    if(error){console.warn('Chat attachments',error);return}
    for(const a of data||[]){if(!state.attachments.has(a.message_id))state.attachments.set(a.message_id,[]);state.attachments.get(a.message_id).push(a)}
  }

  function attachmentHtml(a){return`<button type="button" class="hc-attachment" data-attachment="${esc(a.id)}"><span class="hc-file-icon">${fileIcon(a)}</span><span class="hc-file-copy"><span class="hc-file-name">${esc(a.file_name)}</span><span class="hc-file-size">${esc(sizeFmt(a.file_size))} · скачать</span></span><span>↓</span></button>`}
  function renderMessages(){
    const host=$('hcMessages');if(!state.messages.length){host.innerHTML='<div class="hc-chat-empty">Сообщений пока нет. Напишите первым.</div>';return}
    let day='';const html=[];
    for(const m of state.messages){const k=dateKey(m.created_at);if(k!==day){day=k;html.push(`<div class="hc-day"><span>${esc(fmtDay(m.created_at))}</span></div>`)}const files=(state.attachments.get(m.id)||[]).map(attachmentHtml).join('');html.push(`<div class="hc-message-row ${m.is_mine?'mine':''}" data-message="${esc(m.id)}"><div class="hc-bubble">${m.is_mine?`<div class="hc-msg-actions"><button type="button" class="hc-msg-menu" data-menu="${esc(m.id)}" title="Действия">⋯</button></div>`:''}<div class="hc-msg-meta"><span class="hc-msg-author">${esc(m.sender_name||'Участник')}</span><span>${esc(fmtTime(m.created_at))}${m.edited_at?' · изменено':''}</span></div>${m.body?`<div class="hc-msg-body">${esc(m.body)}</div>`:''}${files?`<div class="hc-attachments">${files}</div>`:''}</div></div>`)}
    host.innerHTML=html.join('');
    host.querySelectorAll('[data-attachment]').forEach(b=>b.onclick=()=>{const a=[...state.attachments.values()].flat().find(x=>x.id===b.dataset.attachment);if(a)downloadAttachment(a)});
    host.querySelectorAll('[data-menu]').forEach(b=>b.onclick=()=>openMessageMenu(b.dataset.menu));
    requestAnimationFrame(()=>{host.scrollTop=host.scrollHeight});
  }

  async function loadMessages(){
    if(!state.roomId)return;
    const data=await rpc('hub_chat_messages',{p_room_id:state.roomId,p_limit:300});
    state.messages=Array.isArray(data)?data:[];
    await loadAttachments();
    renderMessages();
    if(document.visibilityState==='visible')await markRead();
  }
  async function markRead(){if(!state.roomId)return;try{await rpc('hub_chat_mark_read',{p_room_id:state.roomId});const c=state.contacts.find(x=>contactKey(x)===contactKey(state.active));if(c)c.unread_count=0;renderContacts()}catch(e){console.warn('Chat read state',e)}}

  async function openContact(c){
    if(state.busy)return;
    if(state.pending.length&&state.active&&contactKey(state.active)!==contactKey(c)&&!confirm('Есть неотправленные файлы. Переключить диалог и убрать их?'))return;
    if(state.active&&contactKey(state.active)!==contactKey(c))state.pending=[];
    state.busy=true;renderPending();
    try{
      const roomId=await rpc('hub_chat_open',{p_target_kind:c.target_kind,p_target_id:c.target_id||null});
      state.active={...c,room_id:roomId};state.roomId=roomId;
      $('hcTitle').textContent=c.title||'Диалог';$('hcSubtitle').textContent=c.subtitle||'';$('hcHeadAvatar').textContent=c.target_kind==='GENERAL'?'#':c.target_kind==='HUB'?'A4':initials(c.title);
      root.classList.add('chat-open');renderContacts();$('hcMessages').innerHTML='<div class="hc-chat-empty">Загрузка сообщений…</div>';
      await loadMessages();
      await loadContacts({keep:true});
      $('hcText').focus();
      const url=new URL(location.href);url.searchParams.delete('staff');url.searchParams.delete('partner');if(c.target_kind==='STAFF'&&c.target_id)url.searchParams.set('staff',c.target_id);if(c.target_kind==='PARTNER'&&c.target_id)url.searchParams.set('partner',c.target_id);history.replaceState(null,'',url);
    }catch(e){toast(e.message||'Не удалось открыть диалог','error')}finally{state.busy=false;renderPending()}
  }

  function renderPending(){const host=$('hcPending');host.innerHTML=state.pending.map((f,i)=>`<div class="hc-pending-file"><span>${fileIcon({file_name:f.name,mime_type:f.type})}</span><span title="${esc(f.name)}">${esc(f.name)}</span><button type="button" data-remove-file="${i}" aria-label="Убрать">×</button></div>`).join('');host.querySelectorAll('[data-remove-file]').forEach(b=>b.onclick=()=>{state.pending.splice(Number(b.dataset.removeFile),1);renderPending()})}
  function addFiles(list){for(const file of [...list]){if(state.pending.length>=6){toast('Можно прикрепить максимум 6 файлов','error');break}if(file.size>25*1024*1024){toast(`«${file.name}» больше 25 МБ`,'error');continue}state.pending.push(file)}renderPending();$('hcFiles').value=''}

  async function sendMessage(){
    if(!state.roomId||state.busy)return;const body=$('hcText').value.trim();const files=[...state.pending];if(!body&&!files.length)return;
    state.busy=true;$('hcSend').disabled=true;$('hcAttach').disabled=true;$('hcUploadProgress').hidden=true;
    try{
      const messageId=await rpc('hub_chat_send',{p_room_id:state.roomId,p_body:body});
      let failed=0;
      for(let i=0;i<files.length;i++){
        const file=files[i];$('hcUploadProgress').hidden=false;$('hcUploadProgress').textContent=`Загрузка файла ${i+1} из ${files.length}: ${file.name}`;
        const path=`${state.roomId}/${messageId}/${crypto.randomUUID()}-${safeName(file.name)}`;
        const{error:upErr}=await supabase.storage.from('hub-chat').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
        if(upErr){failed++;console.warn(upErr);continue}
        try{await rpc('hub_chat_attach',{p_message_id:messageId,p_storage_path:path,p_file_name:file.name,p_mime_type:file.type||'',p_file_size:file.size})}catch(e){failed++;await supabase.storage.from('hub-chat').remove([path]).catch(()=>{});console.warn(e)}
      }
      $('hcText').value='';state.pending=[];renderPending();$('hcUploadProgress').hidden=true;
      await loadMessages();await loadContacts({keep:true});if(failed)toast(`Не удалось загрузить файлов: ${failed}`,'error');
    }catch(e){toast(e.message||'Не удалось отправить сообщение','error')}finally{state.busy=false;$('hcSend').disabled=false;$('hcAttach').disabled=false;$('hcUploadProgress').hidden=true;$('hcText').focus()}
  }

  async function downloadAttachment(a){
    try{
      let blob;
      if(a.provider==='HUB_STORAGE'&&a.storage_path){const{data,error}=await supabase.storage.from('hub-chat').download(a.storage_path);if(error)throw error;blob=data}
      else{
        const cfg=window.A4PRINT_CONFIG||window.A4PRINT_PARTNER_CONFIG||{};const{data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('Сессия истекла');const r=await fetch(`${String(cfg.supabaseUrl||'').replace(/\/$/,'')}/functions/v1/chat-drive?attachment_id=${encodeURIComponent(a.id)}`,{headers:{Authorization:`Bearer ${session.access_token}`,apikey:cfg.supabasePublishableKey||''}});if(!r.ok)throw new Error('Старое вложение недоступно');blob=await r.blob();
      }
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=a.file_name||'file';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch(e){toast(e.message||'Не удалось скачать файл','error')}
  }

  function modal({title,value='',danger=false,confirmText='Сохранить',textarea=true,onConfirm}){const overlay=document.createElement('div');overlay.className='hc-modal';overlay.innerHTML=`<div class="hc-modal-card"><h3>${esc(title)}</h3>${textarea?`<textarea data-modal-value maxlength="4000"></textarea>`:`<p style="color:#64748b;font-size:13px;line-height:1.45">${esc(value)}</p>`}<div class="hc-modal-actions"><button type="button" data-cancel>Отмена</button><button type="button" class="${danger?'danger':'primary'}" data-confirm>${esc(confirmText)}</button></div></div>`;document.body.appendChild(overlay);const input=overlay.querySelector('[data-modal-value]');if(input){input.value=value;input.focus();input.setSelectionRange(input.value.length,input.value.length)}overlay.querySelector('[data-cancel]').onclick=()=>overlay.remove();overlay.onclick=e=>{if(e.target===overlay)overlay.remove()};overlay.querySelector('[data-confirm]').onclick=async e=>{e.currentTarget.disabled=true;try{await onConfirm(input?input.value:value);overlay.remove()}catch(err){e.currentTarget.disabled=false;toast(err.message||'Ошибка','error')}}}
  function openMessageMenu(id){const m=state.messages.find(x=>x.id===id);if(!m||!m.is_mine)return;const overlay=document.createElement('div');overlay.className='hc-modal';overlay.innerHTML=`<div class="hc-modal-card"><h3>Действия с сообщением</h3><div class="hc-modal-actions" style="justify-content:flex-start"><button type="button" data-edit>Редактировать</button><button type="button" class="danger" data-delete>Удалить у всех</button><button type="button" data-close>Закрыть</button></div></div>`;document.body.appendChild(overlay);overlay.querySelector('[data-close]').onclick=()=>overlay.remove();overlay.onclick=e=>{if(e.target===overlay)overlay.remove()};overlay.querySelector('[data-edit]').onclick=()=>{overlay.remove();modal({title:'Редактировать сообщение',value:m.body||'',onConfirm:async value=>{await rpc('hub_chat_edit',{p_message_id:m.id,p_body:value.trim()});await loadMessages()}})};overlay.querySelector('[data-delete]').onclick=()=>{overlay.remove();modal({title:'Удалить сообщение?',value:'Сообщение исчезнет у всех участников диалога.',textarea:false,danger:true,confirmText:'Удалить',onConfirm:async()=>{await rpc('hub_chat_delete',{p_message_id:m.id});await loadMessages();await loadContacts({keep:true})}})}}

  function updateNotifyButton(){const b=$('hcNotify');if(!('Notification'in window)){b.style.display='none';return}b.classList.toggle('on',Notification.permission==='granted');b.title=Notification.permission==='granted'?'Уведомления включены':'Включить уведомления'}
  async function notifyIncoming(payload){if(!payload?.new||payload.new.room_id===state.roomId&&document.visibilityState==='visible')return;await loadContacts({keep:true});const c=state.contacts.find(x=>x.room_id===payload.new.room_id);if(!c)return;toast(`Новое сообщение: ${c.title}`);if('Notification'in window&&Notification.permission==='granted'&&document.hidden){try{const n=new Notification(`A4PRINT HUB · ${c.title}`,{body:String(payload.new.body||'Новое сообщение').slice(0,160),tag:`hub-chat-${payload.new.id}`});n.onclick=()=>{window.focus();openContact(c);n.close()}}catch{}}}
  function subscribe(){if(state.channel)supabase.removeChannel(state.channel);state.channel=supabase.channel(`hub-chat-ui-${crypto.randomUUID()}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},p=>{notifyIncoming(p);if(p.new?.room_id===state.roomId){clearTimeout(state.refreshTimer);state.refreshTimer=setTimeout(()=>loadMessages().then(()=>loadContacts({keep:true})).catch(console.warn),100)}}).on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages'},p=>{if(p.new?.room_id===state.roomId){clearTimeout(state.refreshTimer);state.refreshTimer=setTimeout(()=>loadMessages().catch(console.warn),100)}}).on('postgres_changes',{event:'INSERT',schema:'public',table:'message_attachments'},p=>{if(p.new?.room_id===state.roomId){clearTimeout(state.refreshTimer);state.refreshTimer=setTimeout(()=>loadMessages().catch(console.warn),120)}}).subscribe()}

  $('hcSearch').oninput=e=>{state.search=e.target.value;renderContacts()};$('hcBack').onclick=()=>root.classList.remove('chat-open');$('hcAttach').onclick=()=>{if(!state.roomId)return toast('Сначала выберите диалог','error');$('hcFiles').click()};$('hcFiles').onchange=e=>addFiles(e.target.files);$('hcComposer').onsubmit=e=>{e.preventDefault();sendMessage()};$('hcText').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}};$('hcText').oninput=e=>{e.target.style.height='auto';e.target.style.height=`${Math.min(126,e.target.scrollHeight)}px`};$('hcRefresh').onclick=async()=>{try{await Promise.all([loadContacts({keep:true}),state.roomId?loadMessages():Promise.resolve()]);toast('Чат обновлён','ok')}catch(e){toast(e.message||'Ошибка обновления','error')}};$('hcNotify').onclick=async()=>{if(!('Notification'in window))return;if(Notification.permission==='default')await Notification.requestPermission();updateNotifyButton();if(Notification.permission==='denied')toast('Разрешите уведомления для сайта в настройках браузера','error')};document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.roomId)markRead().catch(()=>{})});

  const{data:{session}}=await supabase.auth.getSession();if(!session){location.replace(loginUrl);return}
  updateNotifyButton();
  try{
    await loadContacts({keep:false});subscribe();
    const params=new URLSearchParams(location.search);let initial=null;
    if(context==='partner')initial=state.contacts.find(c=>c.target_kind==='HUB')||state.contacts[0];
    else if(params.get('partner'))initial=state.contacts.find(c=>c.target_kind==='PARTNER'&&c.target_id===params.get('partner'));
    else if(params.get('staff'))initial=state.contacts.find(c=>c.target_kind==='STAFF'&&c.target_id===params.get('staff'));
    else initial=state.contacts.find(c=>c.target_kind==='GENERAL')||state.contacts[0];
    if(initial)await openContact(initial);
  }catch(e){$('hcContacts').innerHTML=`<div class="hc-chat-empty" style="color:#b91c1c">${esc(e.message||'Чат недоступен')}</div>`;toast(e.message||'Не удалось запустить чат','error')}
  window.addEventListener('beforeunload',()=>{if(state.channel)supabase.removeChannel(state.channel)},{once:true});
  return{refresh:()=>loadContacts({keep:true}),openContact};
}
