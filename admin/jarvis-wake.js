import { supabase } from './guard.js?v=20260905-netfix1';

const cfg=window.A4PRINT_CONFIG||{};
const STORAGE_WAKE='a4_jarvis_wake_enabled_v1';
const STORAGE_BOT='a4_jarvis_bot_mode_v1';
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
const WAKE_RE=/(?:^|[\s,.!?;:—-])(джарвис|жарвис|джервис|jarvis)(?=$|[\s,.!?;:—-])/i;

const wake={enabled:localStorage.getItem(STORAGE_WAKE)!=='0',armed:false,listening:false,blocked:false,rec:null,restartTimer:null,pendingCommand:'',pendingMic:false,noticeShown:false,activating:false};

function apiBase(){return String(cfg.apiBaseUrl||'').replace(/\/$/,'')}
async function token(){const {data:{session}}=await supabase.auth.getSession();return session?.access_token||''}
async function api(path,options={}){const access=await token();if(!access)throw new Error('AUTH_REQUIRED');const r=await fetch(`${apiBase()}${path}`,{...options,cache:'no-store',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json',Accept:'application/json',...(options.headers||{})}});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||body.message||`HTTP ${r.status}`);return body}
function panelOpen(){return document.getElementById('jarvisPanel')?.classList.contains('open')}
function openPanel(){if(!panelOpen())document.getElementById('jarvisLauncher')?.click()}
function voiceBusy(){return !!window.A4VoiceEngine?.isSpeaking?.()}
function manualMicBusy(){return !!document.getElementById('jarvisMic')?.classList.contains('active')}
function canListen(){return wake.enabled&&wake.armed&&!wake.blocked&&!document.hidden&&!voiceBusy()&&!manualMicBusy()&&!wake.activating&&!!SR}
function stopWake(abort=true){clearTimeout(wake.restartTimer);wake.restartTimer=null;const rec=wake.rec;wake.rec=null;wake.listening=false;if(rec){try{abort?rec.abort():rec.stop()}catch{}}updateToggle()}
function scheduleRestart(delay=450){clearTimeout(wake.restartTimer);if(!wake.enabled||wake.blocked||!wake.armed)return;wake.restartTimer=setTimeout(()=>startWake(),delay)}
function normalizeTranscript(value){return String(value||'').replace(/\s+/g,' ').trim()}
function extractAfterWake(value){const text=normalizeTranscript(value);const match=WAKE_RE.exec(text);if(!match)return{matched:false,command:''};const command=normalizeTranscript(text.slice((match.index||0)+match[0].length));return{matched:true,command}}

function withAssistant(callback,attempt=0){
  if(document.getElementById('jarvisLauncher')&&document.getElementById('jarvisForm'))return callback();
  if(attempt>=50)return;
  setTimeout(()=>withAssistant(callback,attempt+1),100);
}
function browserSpeak(text){
  try{
    if(!window.speechSynthesis||!window.SpeechSynthesisUtterance)return false;
    const utterance=new SpeechSynthesisUtterance(text);utterance.lang='ru-RU';utterance.rate=.96;utterance.pitch=.88;window.speechSynthesis.cancel();window.speechSynthesis.speak(utterance);return true;
  }catch{return false}
}
async function acknowledgeAndListen(){
  openPanel();
  let spoken=false;
  try{
    await window.A4VoiceEngine?.unlock?.();
    spoken=!!(await window.A4VoiceEngine?.speak?.('Слушаю.',{profile:'male',apiBaseUrl:apiBase(),tokenProvider:token,interrupt:true,priority:'high'}));
  }catch{}
  if(!spoken)browserSpeak('Слушаю.');
  setTimeout(()=>document.getElementById('jarvisMic')?.click(),spoken?180:420);
}
function submitCommand(command){
  openPanel();
  setTimeout(()=>{
    const input=document.getElementById('jarvisInput'),form=document.getElementById('jarvisForm');
    if(input&&form){input.value=command;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))}
  },100);
}
function deliverPending(){
  if(wake.pendingCommand){const command=wake.pendingCommand;wake.pendingCommand='';withAssistant(()=>submitCommand(command));return}
  if(wake.pendingMic){wake.pendingMic=false;withAssistant(()=>acknowledgeAndListen())}
}
function activate(command=''){
  if(wake.activating)return;
  wake.activating=true;
  wake.pendingCommand=normalizeTranscript(command);
  wake.pendingMic=!wake.pendingCommand;
  stopWake(true);
  withAssistant(()=>{openPanel();window.dispatchEvent(new CustomEvent('a4:jarvis-wake',{detail:{command:wake.pendingCommand||null}}));deliverPending()});
  setTimeout(()=>{wake.activating=false;scheduleRestart(900)},2400);
}
function inspectResult(result){
  if(!result)return null;
  const count=Math.min(result.length||1,3);
  for(let i=0;i<count;i++){
    const parsed=extractAfterWake(result[i]?.transcript||'');
    if(parsed.matched)return parsed;
  }
  return null;
}
function startWake(){
  clearTimeout(wake.restartTimer);wake.restartTimer=null;if(!canListen()||wake.listening)return;
  const rec=new SR();wake.rec=rec;wake.listening=true;rec.lang='ru-RU';rec.continuous=false;rec.interimResults=true;rec.maxAlternatives=3;
  rec.onresult=e=>{
    for(let i=e.resultIndex||0;i<(e.results?.length||0);i++){
      const parsed=inspectResult(e.results[i]);
      if(parsed?.matched){activate(parsed.command);return}
    }
  };
  rec.onerror=e=>{
    const code=String(e?.error||'');
    if(code==='not-allowed'||code==='service-not-allowed'){
      wake.blocked=true;wake.armed=false;wake.listening=false;wake.rec=null;updateToggle();
      if(!wake.noticeShown){wake.noticeShown=true;console.warn('Jarvis wake word: microphone permission denied')}
      return;
    }
    wake.listening=false;wake.rec=null;updateToggle();
    if(code!=='aborted')scheduleRestart(code==='no-speech'?250:700);
  };
  rec.onend=()=>{
    if(wake.rec===rec)wake.rec=null;wake.listening=false;updateToggle();
    if(!wake.activating)scheduleRestart(300);
  };
  try{rec.start();updateToggle()}catch{wake.listening=false;wake.rec=null;scheduleRestart(900)}
}

async function requestMicrophonePermission(){
  if(!SR)return false;
  try{
    if(navigator.mediaDevices?.getUserMedia){const stream=await navigator.mediaDevices.getUserMedia({audio:true});for(const track of stream.getTracks())track.stop()}
    wake.blocked=false;wake.noticeShown=false;wake.armed=true;
    await window.A4VoiceEngine?.unlock?.().catch(()=>{});
    startWake();updateToggle();return true;
  }catch(error){wake.blocked=true;wake.armed=false;stopWake();updateToggle();console.warn('Jarvis wake word: microphone permission request failed',error);return false}
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
      if(wake.blocked||!wake.armed||!wake.listening){await requestMicrophonePermission();await persistWakePreference();updateToggle();return}
      wake.enabled=false;localStorage.setItem(STORAGE_WAKE,'0');stopWake();await persistWakePreference();updateToggle();
    });
    document.body.appendChild(button);
  }
  button.textContent=!SR?'🚫':!wake.enabled?'🔇':wake.blocked?'🎙️':wake.listening?'👂':'🎧';
  button.title=!SR?'Wake word не поддерживается браузером':!wake.enabled?'Wake word выключен — нажмите, чтобы включить':wake.blocked?'Нужен доступ к микрофону — нажмите, чтобы разрешить':wake.listening?'Джарвис слушает имя — окно открывать не нужно':'Wake word включён — нажмите, чтобы запустить прослушивание';
  button.style.opacity=wake.enabled?'1':'.55';button.dataset.listening=wake.listening?'1':'0';
}
function arm(){if(wake.armed||!wake.enabled||wake.blocked||!SR)return;wake.armed=true;window.A4VoiceEngine?.unlock?.().catch(()=>{});startWake()}
async function armIfPermissionGranted(){
  if(!SR||!wake.enabled)return;
  if(!navigator.permissions?.query){updateToggle();return}
  try{
    const permission=await navigator.permissions.query({name:'microphone'});
    if(permission.state==='granted'){wake.blocked=false;arm()}else if(permission.state==='denied'){wake.blocked=true;wake.armed=false;stopWake()}
    permission.onchange=()=>{if(permission.state==='granted'){wake.blocked=false;arm()}else if(permission.state==='denied'){wake.blocked=true;wake.armed=false;stopWake()}else{wake.blocked=false;wake.armed=false;updateToggle()}};
  }catch{updateToggle()}
}

document.addEventListener('pointerdown',e=>{if(e.target?.closest?.('#jarvisWakeToggle'))return;if(e.target?.closest?.('#jarvisMic')){stopWake();setTimeout(()=>scheduleRestart(900),700);return}arm()},{capture:true,passive:true});
document.addEventListener('keydown',arm,{capture:true});
document.addEventListener('change',e=>{if(e.target?.id!=='jarvisBotMode')return;const mode=['off','draft','auto'].includes(e.target.value)?e.target.value:'off';localStorage.setItem(STORAGE_BOT,mode);api('/api/v1/jarvis/bot/settings',{method:'PATCH',body:JSON.stringify({mode})}).catch(error=>console.warn('Jarvis bot settings:',error))});
window.addEventListener('a4:voice-speaking',e=>{if(e.detail?.speaking)stopWake();else scheduleRestart(350)});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopWake();else{armIfPermissionGranted();scheduleRestart(350)}});
window.addEventListener('focus',()=>{armIfPermissionGranted();scheduleRestart(250)});

async function syncServerSettings(){
  try{
    const data=await api('/api/v1/jarvis/preferences');const prefs=data.preferences||{};
    if(typeof prefs.wake_word_enabled==='boolean'){
      wake.enabled=prefs.wake_word_enabled;localStorage.setItem(STORAGE_WAKE,wake.enabled?'1':'0');
      if(!wake.enabled)stopWake();else armIfPermissionGranted();
    }
    if(['off','draft','auto'].includes(prefs.bot_mode)){
      const old=localStorage.getItem(STORAGE_BOT)||'off';localStorage.setItem(STORAGE_BOT,prefs.bot_mode);const select=document.getElementById('jarvisBotMode');if(select&&old!==prefs.bot_mode){select.value=prefs.bot_mode;select.dispatchEvent(new Event('change',{bubbles:true}))}
    }
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
  test(){activate('')}
};
