import { supabase } from './guard.js?v=20260905-netfix1';

const cfg=window.A4PRINT_CONFIG||{};
const STORAGE_WAKE='a4_jarvis_wake_enabled_v1';
const STORAGE_BOT='a4_jarvis_bot_mode_v1';
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
const SRPhrase=window.SpeechRecognitionPhrase;
const LANG='ru-RU';
const WAKE_ALIASES=['джарвис','жарвис','джервис','джарвес','жарвес','дарвис','ярвис','jarvis'];
const wake={
  enabled:localStorage.getItem(STORAGE_WAKE)!=='0',armed:false,listening:false,starting:false,blocked:false,
  rec:null,restartTimer:null,pendingCommand:'',pendingMic:false,noticeShown:false,activating:false,
  localMode:false,localAvailability:'unknown',lastError:'',lastTranscript:'',lastStartAt:0
};

function apiBase(){return String(cfg.apiBaseUrl||'').replace(/\/$/,'')}
async function token(){const {data:{session}}=await supabase.auth.getSession();return session?.access_token||''}
async function api(path,options={}){const access=await token();if(!access)throw new Error('AUTH_REQUIRED');const r=await fetch(`${apiBase()}${path}`,{...options,cache:'no-store',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json',Accept:'application/json',...(options.headers||{})}});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||body.message||`HTTP ${r.status}`);return body}
function panelOpen(){return document.getElementById('jarvisPanel')?.classList.contains('open')}
function openPanel(){if(!panelOpen())document.getElementById('jarvisLauncher')?.click()}
function voiceBusy(){return !!window.A4VoiceEngine?.isSpeaking?.()}
function manualMicBusy(){return !!document.getElementById('jarvisMic')?.classList.contains('active')}
function canListen(){return wake.enabled&&wake.armed&&!wake.blocked&&!document.hidden&&!voiceBusy()&&!manualMicBusy()&&!wake.activating&&!!SR}
function normalizeTranscript(value){return String(value||'').toLocaleLowerCase('ru-RU').replace(/[ё]/g,'е').replace(/\s+/g,' ').trim()}
function compact(value){return normalizeTranscript(value).replace(/[^a-zа-я0-9]+/gi,'')}
function parseWake(value){
  const original=String(value||'').trim();
  const normalized=normalizeTranscript(original);
  wake.lastTranscript=original;
  if(!normalized)return null;
  const words=normalized.replace(/[,.!?;:—-]+/g,' ').split(/\s+/).filter(Boolean);
  const joined=words.join('');
  let alias='';
  let aliasIndex=-1;
  for(const candidate of WAKE_ALIASES){
    const c=compact(candidate);
    const i=joined.indexOf(c);
    if(i>=0&&i<=12){alias=candidate;aliasIndex=i;break}
  }
  if(!alias)return null;
  const direct=normalized.match(/(?:^|[\s,.!?;:—-])(?:джар\s*вис|жар\s*вис|джер\s*вис|джар\s*вес|жар\s*вес|дар\s*вис|яр\s*вис|jarvis)(?:[\s,.!?;:—-]+)?(.*)$/i);
  const command=direct?String(direct[1]||'').trim():'';
  return {matched:true,command,alias,aliasIndex};
}

function withAssistant(callback,attempt=0){
  if(document.getElementById('jarvisLauncher')&&document.getElementById('jarvisForm'))return callback();
  if(attempt>=60)return;
  setTimeout(()=>withAssistant(callback,attempt+1),100);
}
function browserSpeak(text){
  try{if(!window.speechSynthesis||!window.SpeechSynthesisUtterance)return false;const u=new SpeechSynthesisUtterance(text);u.lang=LANG;u.rate=.96;u.pitch=.88;window.speechSynthesis.cancel();window.speechSynthesis.speak(u);return true}catch{return false}
}
async function acknowledgeAndListen(){
  openPanel();
  let spoken=false;
  try{await window.A4VoiceEngine?.unlock?.();spoken=!!(await window.A4VoiceEngine?.speak?.('Слушаю.',{profile:'male',apiBaseUrl:apiBase(),tokenProvider:token,interrupt:true,priority:'high'}))}catch{}
  if(!spoken)browserSpeak('Слушаю.');
  setTimeout(()=>document.getElementById('jarvisMic')?.click(),spoken?220:500);
}
function submitCommand(command){
  openPanel();
  setTimeout(()=>{const input=document.getElementById('jarvisInput'),form=document.getElementById('jarvisForm');if(input&&form){input.value=command;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))}},120);
}
function deliverPending(){
  if(wake.pendingCommand){const command=wake.pendingCommand;wake.pendingCommand='';withAssistant(()=>submitCommand(command));return}
  if(wake.pendingMic){wake.pendingMic=false;withAssistant(()=>acknowledgeAndListen())}
}
function stopWake(abort=true){
  clearTimeout(wake.restartTimer);wake.restartTimer=null;const rec=wake.rec;wake.rec=null;wake.listening=false;wake.starting=false;
  if(rec){try{abort?rec.abort():rec.stop()}catch{}}
  updateToggle();
}
function scheduleRestart(delay=350){clearTimeout(wake.restartTimer);if(!wake.enabled||wake.blocked||!wake.armed)return;wake.restartTimer=setTimeout(startWake,delay)}
function activate(command=''){
  if(wake.activating)return;
  wake.activating=true;wake.pendingCommand=String(command||'').trim();wake.pendingMic=!wake.pendingCommand;stopWake(true);
  withAssistant(()=>{openPanel();window.dispatchEvent(new CustomEvent('a4:jarvis-wake',{detail:{command:wake.pendingCommand||null,transcript:wake.lastTranscript,local:wake.localMode}}));deliverPending()});
  setTimeout(()=>{wake.activating=false;scheduleRestart(700)},2200);
}
function inspectResult(result){
  if(!result)return null;
  const count=Math.min(result.length||1,5);
  for(let i=0;i<count;i++){const parsed=parseWake(result[i]?.transcript||'');if(parsed?.matched)return parsed}
  return null;
}
function setPhraseBias(rec){
  try{if(!SRPhrase||!('phrases' in rec))return;rec.phrases=WAKE_ALIASES.slice(0,6).map(x=>new SRPhrase(x,10))}catch{}
}

async function localAvailability(install=false){
  if(!SR||typeof SR.available!=='function'||!('processLocally' in SR.prototype)){wake.localMode=false;wake.localAvailability='unsupported';return false}
  try{
    let state=await SR.available({langs:[LANG],processLocally:true});wake.localAvailability=String(state||'unknown');
    if(state==='available'){wake.localMode=true;updateToggle();return true}
    if(install&&(state==='downloadable'||state==='downloading')&&typeof SR.install==='function'){
      const ok=await SR.install({langs:[LANG],processLocally:true});
      if(ok){wake.localMode=true;wake.localAvailability='available';updateToggle();return true}
      wake.localAvailability='install-failed';
    }
  }catch(error){wake.localAvailability='error';wake.lastError=String(error?.name||error||'local-error')}
  wake.localMode=false;updateToggle();return false;
}

function startWake(){
  clearTimeout(wake.restartTimer);wake.restartTimer=null;if(!canListen()||wake.listening||wake.starting)return;
  const rec=new SR();wake.rec=rec;wake.starting=true;rec.lang=LANG;rec.continuous=false;rec.interimResults=true;rec.maxAlternatives=5;
  try{if('processLocally' in rec)rec.processLocally=!!wake.localMode}catch{}
  setPhraseBias(rec);
  rec.onstart=()=>{if(wake.rec!==rec)return;wake.starting=false;wake.listening=true;wake.lastError='';wake.lastStartAt=Date.now();updateToggle()};
  rec.onresult=e=>{
    for(let i=e.resultIndex||0;i<(e.results?.length||0);i++){const parsed=inspectResult(e.results[i]);if(parsed?.matched){activate(parsed.command);return}}
    updateToggle();
  };
  rec.onerror=e=>{
    const code=String(e?.error||'unknown');wake.lastError=code;wake.listening=false;wake.starting=false;if(wake.rec===rec)wake.rec=null;
    if(code==='not-allowed'||code==='service-not-allowed'){wake.blocked=true;wake.armed=false;if(!wake.noticeShown){wake.noticeShown=true;console.warn('Jarvis wake word: microphone permission denied')}}
    if(wake.localMode&&(code==='language-not-supported'||code==='language-unavailable')){wake.localMode=false;wake.localAvailability='unavailable';scheduleRestart(250)}
    else if(code!=='aborted'&&!wake.blocked)scheduleRestart(code==='no-speech'?180:500);
    updateToggle();
  };
  rec.onend=()=>{if(wake.rec===rec)wake.rec=null;wake.listening=false;wake.starting=false;updateToggle();if(!wake.activating&&!wake.blocked)scheduleRestart(220)};
  try{rec.start()}catch(error){wake.lastError=String(error?.name||error||'start-failed');wake.starting=false;wake.rec=null;updateToggle();scheduleRestart(650)}
}

async function requestMicrophonePermission(){
  if(!SR)return false;
  try{
    if(navigator.mediaDevices?.getUserMedia){const stream=await navigator.mediaDevices.getUserMedia({audio:true});for(const track of stream.getTracks())track.stop()}
    wake.blocked=false;wake.noticeShown=false;wake.armed=true;
    await window.A4VoiceEngine?.unlock?.().catch(()=>{});
    await localAvailability(true).catch(()=>false);
    startWake();updateToggle();return true;
  }catch(error){wake.blocked=true;wake.armed=false;wake.lastError=String(error?.name||error||'permission-failed');stopWake();updateToggle();console.warn('Jarvis wake word: microphone permission request failed',error);return false}
}
async function persistWakePreference(){api('/api/v1/jarvis/preferences',{method:'PATCH',body:JSON.stringify({wake_word_enabled:wake.enabled})}).catch(()=>{})}

function updateToggle(){
  let button=document.getElementById('jarvisWakeToggle');
  if(!button){
    button=document.createElement('button');button.id='jarvisWakeToggle';button.type='button';button.className='jarvis-wake-toggle';button.setAttribute('aria-label','Wake word Джарвис');
    button.style.cssText='position:fixed;right:154px;bottom:30px;z-index:12051;width:42px;height:42px;border:1px solid #cbd5e1;border-radius:50%;background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.18);cursor:pointer;font-size:17px';
    button.addEventListener('click',async e=>{
      e.stopPropagation();if(!SR)return;
      if(!wake.enabled){wake.enabled=true;localStorage.setItem(STORAGE_WAKE,'1');await requestMicrophonePermission();await persistWakePreference();updateToggle();return}
      if(wake.blocked||!wake.armed||(!wake.listening&&!wake.starting)){await requestMicrophonePermission();await persistWakePreference();updateToggle();return}
      wake.enabled=false;localStorage.setItem(STORAGE_WAKE,'0');stopWake();await persistWakePreference();updateToggle();
    });
    document.body.appendChild(button);
  }
  const local=wake.localMode?'локально':'облако';
  button.textContent=!SR?'🚫':!wake.enabled?'🔇':wake.blocked?'🎙️':wake.listening?'👂':wake.starting?'⏳':'🎧';
  button.title=!SR?'Wake word не поддерживается браузером':!wake.enabled?'Wake word выключен — нажмите, чтобы включить':wake.blocked?'Нужен доступ к микрофону — нажмите, чтобы разрешить':wake.listening?`Джарвис слушает (${local}). Последнее: ${wake.lastTranscript||'—'}`:wake.starting?`Запускаю распознавание (${local})`:`Wake word включён. Ошибка: ${wake.lastError||'нет'}`;
  button.style.opacity=wake.enabled?'1':'.55';button.dataset.listening=wake.listening?'1':'0';button.dataset.local=wake.localMode?'1':'0';
}
function arm(){if(wake.armed||!wake.enabled||wake.blocked||!SR)return;wake.armed=true;window.A4VoiceEngine?.unlock?.().catch(()=>{});startWake()}
async function armIfPermissionGranted(){
  if(!SR||!wake.enabled)return;
  await localAvailability(false).catch(()=>false);
  if(!navigator.permissions?.query){updateToggle();return}
  try{
    const permission=await navigator.permissions.query({name:'microphone'});
    if(permission.state==='granted'){wake.blocked=false;arm()}else if(permission.state==='denied'){wake.blocked=true;wake.armed=false;stopWake()}
    permission.onchange=()=>{if(permission.state==='granted'){wake.blocked=false;arm()}else if(permission.state==='denied'){wake.blocked=true;wake.armed=false;stopWake()}else{wake.blocked=false;wake.armed=false;updateToggle()}};
  }catch{updateToggle()}
}

document.addEventListener('pointerdown',e=>{if(e.target?.closest?.('#jarvisWakeToggle'))return;if(e.target?.closest?.('#jarvisMic')){stopWake();setTimeout(()=>scheduleRestart(700),600);return}arm()},{capture:true,passive:true});
document.addEventListener('keydown',arm,{capture:true});
document.addEventListener('change',e=>{if(e.target?.id!=='jarvisBotMode')return;const mode=['off','draft','auto'].includes(e.target.value)?e.target.value:'off';localStorage.setItem(STORAGE_BOT,mode);api('/api/v1/jarvis/bot/settings',{method:'PATCH',body:JSON.stringify({mode})}).catch(error=>console.warn('Jarvis bot settings:',error))});
window.addEventListener('a4:voice-speaking',e=>{if(e.detail?.speaking)stopWake();else scheduleRestart(300)});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopWake();else{armIfPermissionGranted();scheduleRestart(300)}});
window.addEventListener('focus',()=>{armIfPermissionGranted();scheduleRestart(220)});

async function syncServerSettings(){
  try{
    const data=await api('/api/v1/jarvis/preferences');const prefs=data.preferences||{};
    if(typeof prefs.wake_word_enabled==='boolean'){wake.enabled=prefs.wake_word_enabled;localStorage.setItem(STORAGE_WAKE,wake.enabled?'1':'0');if(!wake.enabled)stopWake();else armIfPermissionGranted()}
    if(['off','draft','auto'].includes(prefs.bot_mode)){const old=localStorage.getItem(STORAGE_BOT)||'off';localStorage.setItem(STORAGE_BOT,prefs.bot_mode);const select=document.getElementById('jarvisBotMode');if(select&&old!==prefs.bot_mode){select.value=prefs.bot_mode;select.dispatchEvent(new Event('change',{bubbles:true}))}}
  }catch{}
  updateToggle();
}
function init(){updateToggle();syncServerSettings();armIfPermissionGranted()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();

window.A4JarvisWake={
  async enable(){wake.enabled=true;wake.blocked=false;localStorage.setItem(STORAGE_WAKE,'1');await requestMicrophonePermission();updateToggle();persistWakePreference()},
  disable(){wake.enabled=false;localStorage.setItem(STORAGE_WAKE,'0');stopWake();updateToggle();persistWakePreference()},
  isListening:()=>wake.listening,
  isEnabled:()=>wake.enabled,
  status:()=>({enabled:wake.enabled,armed:wake.armed,listening:wake.listening,starting:wake.starting,blocked:wake.blocked,localMode:wake.localMode,localAvailability:wake.localAvailability,lastError:wake.lastError,lastTranscript:wake.lastTranscript,lastStartAt:wake.lastStartAt}),
  test(){activate('')},
  async installLocal(){return requestMicrophonePermission()}
};
