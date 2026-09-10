import './voice-engine.js?v=20260911-voice3';
import { supabase } from './guard.js?v=20260905-netfix1';

const cfg=window.A4PRINT_CONFIG||{};
const STORAGE_VOICE='a4_jarvis_voice_enabled_v2';
const STORAGE_PROFILE='a4_jarvis_voice_profile_v2';
const STORAGE_BOT='a4_jarvis_bot_mode_v1';
const STORAGE_BOT_CURSOR='a4_jarvis_bot_cursor_v1';
const storedVoice=localStorage.getItem(STORAGE_VOICE);
const savedProfile=localStorage.getItem(STORAGE_PROFILE);
const savedBot=localStorage.getItem(STORAGE_BOT);
const state={
  open:false,busy:false,listening:false,
  voice:storedVoice!=='0',
  profile:savedProfile==='female'?'female':'male',
  botMode:['draft','auto'].includes(savedBot)?savedBot:'off',
  lastAnnouncement:null,workshopText:'',botBusy:false
};

const SAFE_API_ACTIONS=new Set(['/api/v1/pos/shift/open','/api/v1/pos/shift/close','/api/v1/integrations/moysklad/sync']);

function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function apiBase(){return String(cfg.apiBaseUrl||'').replace(/\/$/,'')}

async function sessionToken(){const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('Сессия HUB истекла');return session.access_token}
async function authHeaders(){return{Authorization:`Bearer ${await sessionToken()}`,'Content-Type':'application/json',Accept:'application/json'}}
async function api(path,options={}){
  const base=apiBase();if(!base)throw new Error('API HUB не настроен');
  const headers={...(await authHeaders()),...(options.headers||{})};
  const r=await fetch(`${base}${path}`,{...options,headers,cache:'no-store'});
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(body.message||body.error||`HTTP ${r.status}`);
  return body;
}

async function speak(text,options={}){
  if(!state.voice||!text)return false;const engine=window.A4VoiceEngine;if(!engine)return false;
  try{return await engine.speak(text,{profile:state.profile,apiBaseUrl:apiBase(),tokenProvider:sessionToken,interrupt:!!options.interrupt,priority:options.priority||'normal'})}
  catch(error){console.warn('A4PRINT HUB voice:',error);return false}
}

function assistantName(){return state.profile==='female'?'Ксюша':'Джарвис'}
function assistantReadyText(){return state.profile==='female'?'Я на связи. Основной оператор системы — Джарвис.':'Я на связи. Могу искать данные HUB, открывать карточки, работать с задачами и сообщениями.'}

function addMessage(role,text,options={}){
  const log=document.getElementById('jarvisLog');if(!log)return null;
  const div=document.createElement('div');div.className=`jarvis-msg ${role}`;
  div.innerHTML=`<span>${role==='user'?'Вы':assistantName()}</span><p>${esc(text)}</p>`;
  if(Array.isArray(options.actions)&&options.actions.length){
    const actions=document.createElement('div');actions.className='jarvis-result-actions';
    for(const action of options.actions){
      const button=document.createElement('button');button.type='button';button.textContent=action.label||'Открыть';button.onclick=action.onClick;actions.appendChild(button);
    }
    div.appendChild(actions);
  }
  log.appendChild(div);log.scrollTop=log.scrollHeight;return div;
}

function addSearchResults(results=[]){
  const log=document.getElementById('jarvisLog');if(!log||!results.length)return;
  const box=document.createElement('div');box.className='jarvis-results';
  results.slice(0,5).forEach((item,index)=>{
    const a=document.createElement('button');a.type='button';a.className='jarvis-result';
    a.innerHTML=`<b>${index+1}. ${esc(item.title||'Результат')}</b><small>${esc(item.subtitle||'')}</small>`;
    if(item.route)a.onclick=()=>safeNavigate(item.route);
    box.appendChild(a);
  });
  log.appendChild(box);log.scrollTop=log.scrollHeight;
}

function setStatus(text,tone='idle'){
  const el=document.getElementById('jarvisStatus');if(!el)return;
  const showWorkshop=state.workshopText&&tone!=='work'&&tone!=='listen';
  el.textContent=showWorkshop?`${text} · ${state.workshopText}`:text;el.dataset.tone=tone;
}

function refreshIdentity(){
  const title=document.getElementById('jarvisTitle');if(title)title.textContent=assistantName();
  const select=document.getElementById('jarvisVoiceProfile');if(select)select.value=state.profile;
  const bot=document.getElementById('jarvisBotMode');if(bot)bot.value=state.botMode;
}

function safeNavigate(raw){
  try{
    const url=new URL(String(raw||''),location.href);
    if(url.origin!==location.origin)throw new Error('Внешний переход запрещён');
    if(!/^\/(?:admin|kassa)(?:\/|$)/.test(url.pathname))throw new Error('Переход вне HUB запрещён');
    location.href=url.href;return true;
  }catch(error){addMessage('assistant',`Не могу выполнить переход: ${error.message||error}`);return false}
}

async function executeSystemAction(action){
  if(!action||typeof action!=='object')return false;
  if(action.type==='navigate')return safeNavigate(action.url);
  if(action.type!=='api'||!SAFE_API_ACTIONS.has(String(action.path||'')))return false;
  if(action.requires_confirmation!==false){
    const ok=window.confirm(action.confirm_text||'Выполнить действие?');if(!ok){addMessage('assistant','Действие отменено.');return false}
  }
  try{
    setStatus('Выполняю…','work');
    const data=await api(action.path,{method:action.method||'POST',body:JSON.stringify(action.body||{})});
    const text=action.success_text||data.message||'Готово.';addMessage('assistant',text);speak(text,{priority:'high'});setStatus('Готов','ok');return true;
  }catch(error){addMessage('assistant',`Не удалось выполнить действие: ${error.message||error}`);setStatus('Ошибка','error');return false}
}

async function handleAnswer(data){
  const reply=data.text||'Ответ получен.';
  const actions=[];
  if(data.navigation?.url&&!data.system_action?.url)actions.push({label:data.navigation.label||'Открыть',onClick:()=>safeNavigate(data.navigation.url)});
  if(data.kind==='message_draft'&&data.draft){actions.push({label:'Скопировать',onClick:()=>navigator.clipboard?.writeText(data.draft).catch(()=>{})})}
  addMessage('assistant',reply,{actions});
  if(Array.isArray(data.results)&&data.results.length>1)addSearchResults(data.results);
  setStatus('Готов','ok');
  speak(reply);
  if(data.system_action){
    if(data.system_action.type==='navigate'&&data.system_action.requires_confirmation===false){setTimeout(()=>executeSystemAction(data.system_action),420);return}
    if(data.system_action.type==='api')setTimeout(()=>executeSystemAction(data.system_action),150);
  }
}

async function ask(text){
  text=String(text||'').trim();if(!text||state.busy)return;
  state.busy=true;addMessage('user',text);setStatus('Думаю…','work');
  const input=document.getElementById('jarvisInput'),send=document.getElementById('jarvisSend');if(send)send.disabled=true;
  try{
    const data=await api('/api/v1/jarvis/query',{method:'POST',body:JSON.stringify({text,context:{path:location.pathname,search:location.search,title:document.title}})});
    await handleAnswer(data);
  }catch(error){addMessage('assistant',`Не удалось выполнить запрос: ${error.message||error}`);setStatus('Нет связи','error')}
  finally{state.busy=false;if(send)send.disabled=false;if(input){input.value='';input.focus()}}
}

function startListening(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){addMessage('assistant','В этом браузере голосовой ввод не поддерживается. Можно писать команды текстом.');return}
  if(state.listening)return;
  window.A4VoiceEngine?.unlock?.().catch(()=>{});
  const rec=new SR();rec.lang='ru-RU';rec.interimResults=false;rec.continuous=false;
  state.listening=true;setStatus('Слушаю…','listen');const mic=document.getElementById('jarvisMic');if(mic)mic.classList.add('active');
  rec.onresult=e=>{const text=e.results?.[0]?.[0]?.transcript||'';if(text)ask(text)};
  rec.onerror=()=>setStatus('Не расслышал','error');
  rec.onend=()=>{state.listening=false;if(mic)mic.classList.remove('active');if(!state.busy)setStatus('Готов','ok')};
  try{rec.start()}catch{state.listening=false}
}

async function pollWorkshopStatus(){
  try{
    const data=await api('/api/v1/jarvis/workshop/status');const s=data.summary||{};const total=Number(s.total||0),online=Number(s.online||0),printing=Number(s.printing||0),critical=Number(s.critical_alerts||0),offline=Number(s.offline||0);const parts=[];
    if(total>0){parts.push(`цех ${online}/${total} в сети`);if(printing>0)parts.push(`${printing} печатает`);if(offline>0)parts.push(`${offline} офлайн`);if(critical>0)parts.push(`${critical} крит.`)}else parts.push('цех: нет устройств');
    state.workshopText=parts.join(' · ');if(!state.busy&&!state.listening)setStatus(critical>0?'Тревога':'Готов',critical>0?'error':'ok');
  }catch{state.workshopText='цех недоступен';if(!state.busy&&!state.listening)setStatus('Нет данных','error')}
}

async function pollAnnouncements(){
  try{
    const data=await api('/api/v1/jarvis/announcements');const items=Array.isArray(data.announcements)?data.announcements:[];
    for(const item of items){
      if(!item?.id||item.id===state.lastAnnouncement)continue;state.lastAnnouncement=item.id;
      const text=item.text||item.message||item.title||'Новое событие в HUB';addMessage('assistant',text);const urgent=item.severity==='critical'||item.priority==='high';speak(text,{interrupt:urgent,priority:urgent?'high':'normal'});await api('/api/v1/jarvis/announcements/ack',{method:'POST',body:JSON.stringify({id:item.id})}).catch(()=>{});
    }
  }catch{}
}

function botCursor(){try{return localStorage.getItem(STORAGE_BOT_CURSOR)||''}catch{return''}}
function setBotCursor(value){try{localStorage.setItem(STORAGE_BOT_CURSOR,String(value||''))}catch{}}

async function pollBot(){
  if(state.botMode==='off'||state.botBusy||document.hidden)return;state.botBusy=true;
  try{
    let cursor=botCursor();if(!cursor){cursor=new Date().toISOString();setBotCursor(cursor);return}
    const data=await api(`/api/v1/jarvis/bot/inbox?after=${encodeURIComponent(cursor)}`);const items=Array.isArray(data.messages)?data.messages:[];
    for(const item of [...items].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at))){
      if(item.created_at)setBotCursor(item.created_at);
      const sender=item.users?.full_name||item.users?.email||'сотрудник';
      const draft=await api('/api/v1/jarvis/bot/draft',{method:'POST',body:JSON.stringify({message_id:item.id})});
      if(state.botMode==='auto'&&draft.can_auto_send){
        const sent=await api('/api/v1/jarvis/bot/send',{method:'POST',body:JSON.stringify({message_id:item.id})});
        addMessage('assistant',`Бот ответил ${sender}: ${sent.message?.body||draft.draft||''}`);continue;
      }
      const actions=[{label:'Отправить',onClick:async()=>{
        try{const sent=await api('/api/v1/jarvis/bot/send',{method:'POST',body:JSON.stringify({message_id:item.id,allow_fallback:true})});addMessage('assistant',sent.sent===false?'Ответ оставлен черновиком.':'Ответ отправлен.')}
        catch(error){addMessage('assistant',`Не удалось отправить: ${error.message||error}`)}
      }}];
      addMessage('assistant',`Входящее от ${sender}: «${item.body}»\nЧерновик ответа: ${draft.draft}`,{actions});
      if(state.botMode==='auto'&&!draft.can_auto_send)addMessage('assistant','Автоответ не отправлен: генеративная модель Джарвиса сейчас недоступна, поэтому нужен ручной запуск.')
    }
  }catch(error){console.warn('Jarvis bot poll:',error)}finally{state.botBusy=false}
}

function setBotMode(mode){
  state.botMode=['draft','auto'].includes(mode)?mode:'off';localStorage.setItem(STORAGE_BOT,state.botMode);
  if(state.botMode!=='off'&&!botCursor())setBotCursor(new Date().toISOString());refreshIdentity();
  const text=state.botMode==='auto'?'Режим бота: автоответы включены для новых доступных сообщений.':state.botMode==='draft'?'Режим бота: готовлю черновики ответов на новые сообщения.':'Режим бота выключен.';
  addMessage('assistant',text);speak(text,{interrupt:true});
}

function build(){
  if(document.getElementById('jarvisLauncher'))return;
  const style=document.createElement('style');style.textContent=`
  #jarvisLauncher{position:fixed;right:92px;bottom:22px;z-index:12050;width:58px;height:58px;border:0;border-radius:50%;background:#0f172a;color:#fff;box-shadow:0 18px 46px rgba(15,23,42,.32);font-weight:900;cursor:pointer;font-size:16px}
  #jarvisPanel{position:fixed;right:22px;bottom:92px;z-index:12049;width:min(440px,calc(100vw - 28px));height:min(650px,calc(100vh - 120px));display:none;grid-template-rows:auto 1fr auto;background:#fff;border:1px solid #dbe2ea;border-radius:20px;box-shadow:0 28px 80px rgba(15,23,42,.3);overflow:hidden}#jarvisPanel.open{display:grid}
  .jarvis-head{padding:12px 14px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;gap:8px;background:#0f172a;color:#fff}.jarvis-head b{display:block;font-size:16px}.jarvis-head small{opacity:.78;display:block;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.jarvis-head-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}.jarvis-head button{border:0;border-radius:9px;background:rgba(255,255,255,.12);color:#fff;padding:7px 9px;cursor:pointer}.jarvis-head select{height:34px;min-height:34px!important;border:1px solid rgba(255,255,255,.18)!important;background:#1e293b!important;color:#fff!important;border-radius:9px!important;padding:0 7px!important;font-size:11px;box-shadow:none!important}
  #jarvisStatus[data-tone="ok"]{color:#86efac}#jarvisStatus[data-tone="error"]{color:#fca5a5}#jarvisStatus[data-tone="listen"]{color:#fde68a}.jarvis-log{padding:14px;overflow:auto;background:#f8fafc}.jarvis-msg{margin:0 0 11px}.jarvis-msg span{display:block;font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}.jarvis-msg p{white-space:pre-wrap;display:inline-block;max-width:90%;margin:0;padding:10px 12px;border-radius:13px;background:#fff;border:1px solid #e5e7eb;line-height:1.4}.jarvis-msg.user{text-align:right}.jarvis-msg.user span{text-align:right}.jarvis-msg.user p{background:#dbeafe;border-color:#bfdbfe}
  .jarvis-result-actions{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}.jarvis-result-actions button,.jarvis-result{border:1px solid #cbd5e1;background:#fff;border-radius:9px;padding:7px 9px;cursor:pointer;font:inherit}.jarvis-results{display:grid;gap:6px;margin:-4px 0 12px}.jarvis-result{text-align:left;display:grid;gap:2px}.jarvis-result b{font-size:12px;color:#0f172a}.jarvis-result small{font-size:11px;color:#64748b}
  .jarvis-compose{display:grid;grid-template-columns:auto 1fr auto;gap:8px;padding:12px;border-top:1px solid #e5e7eb;background:#fff}.jarvis-compose input{min-width:0;border:1px solid #cbd5e1;border-radius:11px;padding:10px 11px;font:inherit}.jarvis-compose button{border:0;border-radius:11px;cursor:pointer;font-weight:900}.jarvis-mic{width:42px;background:#eef2ff;color:#3730a3}.jarvis-mic.active{background:#fee2e2;color:#b91c1c}.jarvis-send{padding:0 14px;background:#2563eb;color:#fff}.jarvis-send:disabled{opacity:.55}
  @media(max-width:700px){#jarvisLauncher{right:78px;bottom:14px}#jarvisPanel{right:14px;bottom:80px;height:min(76vh,610px)}.jarvis-head small{max-width:160px}.jarvis-head select{max-width:98px}}`;
  document.head.appendChild(style);
  document.body.insertAdjacentHTML('beforeend',`
    <button id="jarvisLauncher" type="button" title="Открыть Джарвиса">J</button>
    <section id="jarvisPanel" aria-label="Джарвис">
      <div class="jarvis-head"><div><b id="jarvisTitle">${assistantName()}</b><small id="jarvisStatus" data-tone="idle">Подключение…</small></div><div class="jarvis-head-actions">
        <select id="jarvisBotMode" title="Режим сообщений"><option value="off">Бот выкл</option><option value="draft">Черновики</option><option value="auto">Авто</option></select>
        <select id="jarvisVoiceProfile" title="Голос"><option value="male">Джарвис ♂</option><option value="female">Ксюша ♀</option></select>
        <button id="jarvisVoice" type="button" title="Озвучивание">${state.voice?'🔊':'🔇'}</button><button id="jarvisClose" type="button">×</button>
      </div></div>
      <div id="jarvisLog" class="jarvis-log"><div class="jarvis-msg assistant"><span>${assistantName()}</span><p>${assistantReadyText()}</p></div></div>
      <form id="jarvisForm" class="jarvis-compose"><button id="jarvisMic" class="jarvis-mic" type="button" title="Голосовой ввод">🎙</button><input id="jarvisInput" maxlength="4000" autocomplete="off" placeholder="Например: найди заказ Иванова на визитки"><button id="jarvisSend" class="jarvis-send" type="submit">→</button></form>
    </section>`);
  refreshIdentity();const panel=document.getElementById('jarvisPanel');
  document.getElementById('jarvisLauncher').onclick=()=>{window.A4VoiceEngine?.unlock?.().catch(()=>{});state.open=!state.open;panel.classList.toggle('open',state.open);if(state.open)document.getElementById('jarvisInput')?.focus()};
  document.getElementById('jarvisClose').onclick=()=>{state.open=false;panel.classList.remove('open')};
  document.getElementById('jarvisForm').onsubmit=e=>{e.preventDefault();ask(document.getElementById('jarvisInput').value)};
  document.getElementById('jarvisMic').onclick=startListening;
  document.getElementById('jarvisBotMode').onchange=e=>setBotMode(e.target.value);
  document.getElementById('jarvisVoiceProfile').onchange=e=>{state.profile=e.target.value==='female'?'female':'male';localStorage.setItem(STORAGE_PROFILE,state.profile);refreshIdentity();if(state.voice)speak(state.profile==='female'?'Ксюша на связи.':'Джарвис на связи.',{interrupt:true,priority:'high'})};
  document.getElementById('jarvisVoice').onclick=async()=>{state.voice=!state.voice;localStorage.setItem(STORAGE_VOICE,state.voice?'1':'0');document.getElementById('jarvisVoice').textContent=state.voice?'🔊':'🔇';if(state.voice){await window.A4VoiceEngine?.unlock?.();speak('Озвучивание включено. Джарвис на связи.',{interrupt:true,priority:'high'})}else window.A4VoiceEngine?.stop?.()};
  api('/api/v1/jarvis/health').then(()=>setStatus('Готов','ok')).catch(()=>setStatus('Не настроен','error'));
  setInterval(pollAnnouncements,12000);setInterval(pollWorkshopStatus,15000);setInterval(pollBot,12000);
  setTimeout(pollWorkshopStatus,800);setTimeout(pollAnnouncements,1800);setTimeout(pollBot,2500);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build,{once:true});else build();
