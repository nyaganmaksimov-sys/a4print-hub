import './voice-engine.js?v=20260911-voice2';
import { supabase } from './guard.js?v=20260905-netfix1';

const cfg = window.A4PRINT_CONFIG || {};
const STORAGE_VOICE = 'a4_jarvis_voice_enabled';
const STORAGE_PROFILE = 'a4_jarvis_voice_profile';
const savedProfile = localStorage.getItem(STORAGE_PROFILE);
const state = {
  open:false,
  busy:false,
  listening:false,
  voice:localStorage.getItem(STORAGE_VOICE)==='1',
  profile:savedProfile==='male'?'male':'female',
  lastAnnouncement:null,
  workshopText:''
};

function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

async function authHeaders(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error('Сессия HUB истекла');
  return {Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json',Accept:'application/json'};
}

async function voiceToken(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error('Сессия HUB истекла');
  return session.access_token;
}

async function api(path,options={}){
  const base=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  if(!base)throw new Error('API HUB не настроен');
  const headers={...(await authHeaders()),...(options.headers||{})};
  const r=await fetch(`${base}${path}`,{...options,headers,cache:'no-store'});
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(body.message||body.error||`HTTP ${r.status}`);
  return body;
}

async function speak(text,options={}){
  if(!state.voice||!text)return false;
  const engine=window.A4VoiceEngine;
  if(!engine)return false;
  try{
    return await engine.speak(text,{
      profile:state.profile,
      apiBaseUrl:String(cfg.apiBaseUrl||'').replace(/\/$/,''),
      tokenProvider:voiceToken,
      interrupt:!!options.interrupt,
      priority:options.priority||'normal'
    });
  }catch(error){
    console.warn('A4PRINT HUB voice:',error);
    return false;
  }
}

function assistantName(){return state.profile==='female'?'Ксюша':'Джарвис'}
function assistantReadyText(){return state.profile==='female'?'Готова помочь по заказам, выручке, сообщениям и производству.':'Готов помочь по заказам, выручке, сообщениям и производству.'}

function addMessage(role,text){
  const log=document.getElementById('jarvisLog');
  if(!log)return;
  const div=document.createElement('div');
  div.className=`jarvis-msg ${role}`;
  div.innerHTML=`<span>${role==='user'?'Вы':assistantName()}</span><p>${esc(text)}</p>`;
  log.appendChild(div);
  log.scrollTop=log.scrollHeight;
}

function setStatus(text,tone='idle'){
  const el=document.getElementById('jarvisStatus');
  if(!el)return;
  const showWorkshop=state.workshopText&&tone!=='work'&&tone!=='listen';
  el.textContent=showWorkshop?`${text} · ${state.workshopText}`:text;
  el.dataset.tone=tone;
}

function refreshIdentity(){
  const title=document.getElementById('jarvisTitle');
  if(title)title.textContent=assistantName();
  const select=document.getElementById('jarvisVoiceProfile');
  if(select)select.value=state.profile;
}

async function pollWorkshopStatus(){
  try{
    const data=await api('/api/v1/jarvis/workshop/status');
    const summary=data.summary||{};
    const total=Number(summary.total||0);
    const online=Number(summary.online||0);
    const printing=Number(summary.printing||0);
    const critical=Number(summary.critical_alerts||0);
    const offline=Number(summary.offline||0);
    const parts=[];
    if(total>0){
      parts.push(`цех ${online}/${total} в сети`);
      if(printing>0)parts.push(`${printing} печатает`);
      if(offline>0)parts.push(`${offline} офлайн`);
      if(critical>0)parts.push(`${critical} крит.`);
    }else{
      parts.push('цех: нет устройств');
    }
    state.workshopText=parts.join(' · ');
    if(!state.busy&&!state.listening)setStatus(critical>0?'Тревога':'Готов',critical>0?'error':'ok');
  }catch{
    state.workshopText='цех недоступен';
    if(!state.busy&&!state.listening)setStatus('Нет данных','error');
  }
}

async function ask(text){
  text=String(text||'').trim();
  if(!text||state.busy)return;
  state.busy=true;
  addMessage('user',text);
  setStatus('Думаю…','work');
  const input=document.getElementById('jarvisInput');
  const send=document.getElementById('jarvisSend');
  if(send)send.disabled=true;
  try{
    const data=await api('/api/v1/jarvis/query',{method:'POST',body:JSON.stringify({text})});
    const reply=data.text||'Ответ получен.';
    addMessage('assistant',reply);
    setStatus('Готов','ok');
    speak(reply);
  }catch(error){
    addMessage('assistant',`Не удалось связаться с помощником: ${error.message||error}`);
    setStatus('Нет связи','error');
  }finally{
    state.busy=false;
    if(send)send.disabled=false;
    if(input){input.value='';input.focus()}
  }
}

function startListening(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){addMessage('assistant','В этом браузере голосовой ввод не поддерживается. Можно писать команды текстом.');return}
  if(state.listening)return;
  const rec=new SR();
  rec.lang='ru-RU';rec.interimResults=false;rec.continuous=false;
  state.listening=true;setStatus('Слушаю…','listen');
  const mic=document.getElementById('jarvisMic');if(mic)mic.classList.add('active');
  rec.onresult=e=>{const text=e.results?.[0]?.[0]?.transcript||'';if(text)ask(text)};
  rec.onerror=()=>setStatus('Не расслышал','error');
  rec.onend=()=>{state.listening=false;if(mic)mic.classList.remove('active');if(!state.busy)setStatus('Готов','ok')};
  try{rec.start()}catch{state.listening=false}
}

async function pollAnnouncements(){
  try{
    const data=await api('/api/v1/jarvis/announcements');
    const items=Array.isArray(data.announcements)?data.announcements:[];
    for(const item of items){
      if(!item?.id||item.id===state.lastAnnouncement)continue;
      state.lastAnnouncement=item.id;
      const text=item.text||item.message||item.title||'Новое событие в HUB';
      addMessage('assistant',text);
      const urgent=item.severity==='critical'||item.priority==='high';
      speak(text,{interrupt:urgent,priority:urgent?'high':'normal'});
      await api('/api/v1/jarvis/announcements/ack',{method:'POST',body:JSON.stringify({id:item.id})}).catch(()=>{});
    }
  }catch{}
}

function build(){
  if(document.getElementById('jarvisLauncher'))return;
  const style=document.createElement('style');
  style.textContent=`
  #jarvisLauncher{position:fixed;right:92px;bottom:22px;z-index:12050;width:58px;height:58px;border:0;border-radius:50%;background:#0f172a;color:#fff;box-shadow:0 18px 46px rgba(15,23,42,.32);font-weight:900;cursor:pointer;font-size:16px}
  #jarvisPanel{position:fixed;right:22px;bottom:92px;z-index:12049;width:min(410px,calc(100vw - 28px));height:min(610px,calc(100vh - 120px));display:none;grid-template-rows:auto 1fr auto;background:#fff;border:1px solid #dbe2ea;border-radius:20px;box-shadow:0 28px 80px rgba(15,23,42,.3);overflow:hidden}
  #jarvisPanel.open{display:grid}.jarvis-head{padding:14px 15px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#0f172a;color:#fff}.jarvis-head b{display:block;font-size:16px}.jarvis-head small{opacity:.75;display:block;max-width:245px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.jarvis-head-actions{display:flex;align-items:center;gap:7px}.jarvis-head button{border:0;border-radius:9px;background:rgba(255,255,255,.12);color:#fff;padding:7px 9px;cursor:pointer}.jarvis-head select{height:34px;min-height:34px!important;border:1px solid rgba(255,255,255,.18)!important;background:#1e293b!important;color:#fff!important;border-radius:9px!important;padding:0 8px!important;font-size:12px;box-shadow:none!important}
  #jarvisStatus[data-tone="ok"]{color:#86efac}#jarvisStatus[data-tone="error"]{color:#fca5a5}#jarvisStatus[data-tone="listen"]{color:#fde68a}.jarvis-log{padding:14px;overflow:auto;background:#f8fafc}.jarvis-msg{margin:0 0 11px}.jarvis-msg span{display:block;font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}.jarvis-msg p{display:inline-block;max-width:88%;margin:0;padding:10px 12px;border-radius:13px;background:#fff;border:1px solid #e5e7eb;line-height:1.4}.jarvis-msg.user{text-align:right}.jarvis-msg.user span{text-align:right}.jarvis-msg.user p{background:#dbeafe;border-color:#bfdbfe}.jarvis-compose{display:grid;grid-template-columns:auto 1fr auto;gap:8px;padding:12px;border-top:1px solid #e5e7eb;background:#fff}.jarvis-compose input{min-width:0;border:1px solid #cbd5e1;border-radius:11px;padding:10px 11px;font:inherit}.jarvis-compose button{border:0;border-radius:11px;cursor:pointer;font-weight:900}.jarvis-mic{width:42px;background:#eef2ff;color:#3730a3}.jarvis-mic.active{background:#fee2e2;color:#b91c1c}.jarvis-send{padding:0 14px;background:#2563eb;color:#fff}.jarvis-send:disabled{opacity:.55}
  @media(max-width:700px){#jarvisLauncher{right:78px;bottom:14px}#jarvisPanel{right:14px;bottom:80px;height:min(72vh,570px)}.jarvis-head select{max-width:108px}.jarvis-head small{max-width:180px}}`;
  document.head.appendChild(style);

  document.body.insertAdjacentHTML('beforeend',`
    <button id="jarvisLauncher" type="button" title="Открыть помощника">J</button>
    <section id="jarvisPanel" aria-label="Голосовой помощник">
      <div class="jarvis-head">
        <div><b id="jarvisTitle">${assistantName()}</b><small id="jarvisStatus" data-tone="idle">Подключение…</small></div>
        <div class="jarvis-head-actions">
          <select id="jarvisVoiceProfile" title="Голос"><option value="female">Ксюша ♀</option><option value="male">Джарвис ♂</option></select>
          <button id="jarvisVoice" type="button" title="Озвучивание">${state.voice?'🔊':'🔇'}</button>
          <button id="jarvisClose" type="button">×</button>
        </div>
      </div>
      <div id="jarvisLog" class="jarvis-log"><div class="jarvis-msg assistant"><span>${assistantName()}</span><p>${assistantReadyText()}</p></div></div>
      <form id="jarvisForm" class="jarvis-compose"><button id="jarvisMic" class="jarvis-mic" type="button" title="Голосовой ввод">🎙</button><input id="jarvisInput" maxlength="4000" autocomplete="off" placeholder="Например: какая сегодня выручка?"><button id="jarvisSend" class="jarvis-send" type="submit">→</button></form>
    </section>`);

  refreshIdentity();
  const panel=document.getElementById('jarvisPanel');
  document.getElementById('jarvisLauncher').onclick=()=>{state.open=!state.open;panel.classList.toggle('open',state.open);if(state.open)document.getElementById('jarvisInput')?.focus()};
  document.getElementById('jarvisClose').onclick=()=>{state.open=false;panel.classList.remove('open')};
  document.getElementById('jarvisForm').onsubmit=e=>{e.preventDefault();ask(document.getElementById('jarvisInput').value)};
  document.getElementById('jarvisMic').onclick=startListening;
  document.getElementById('jarvisVoiceProfile').onchange=e=>{
    state.profile=e.target.value==='male'?'male':'female';
    localStorage.setItem(STORAGE_PROFILE,state.profile);
    refreshIdentity();
    if(state.voice)speak(state.profile==='female'?'Привет. Я Ксюша. Голос переключён.':'Здравствуйте. Джарвис на связи.',{interrupt:true,priority:'high'});
  };
  document.getElementById('jarvisVoice').onclick=()=>{
    state.voice=!state.voice;
    localStorage.setItem(STORAGE_VOICE,state.voice?'1':'0');
    document.getElementById('jarvisVoice').textContent=state.voice?'🔊':'🔇';
    if(state.voice)speak(state.profile==='female'?'Озвучивание включено. Я на связи.':'Озвучивание включено. Джарвис на связи.',{interrupt:true,priority:'high'});
    else window.A4VoiceEngine?.stop?.();
  };

  api('/api/v1/jarvis/health').then(()=>setStatus('Готов','ok')).catch(()=>setStatus('Не настроен','error'));
  setInterval(pollAnnouncements,12000);
  setInterval(pollWorkshopStatus,15000);
  setTimeout(pollWorkshopStatus,800);
  setTimeout(pollAnnouncements,1800);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build,{once:true});else build();
