import { supabase } from './guard.js?v=20260905-netfix1';

const cfg=window.A4PRINT_CONFIG||{};
const STORAGE_WAKE='a4_jarvis_wake_enabled_v1';
const STORAGE_BOT='a4_jarvis_bot_mode_v1';
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;

const wake={enabled:localStorage.getItem(STORAGE_WAKE)!=='0',armed:false,listening:false,blocked:false,rec:null,restartTimer:null,pendingCommand:'',pendingMic:false,noticeShown:false};

function apiBase(){return String(cfg.apiBaseUrl||'').replace(/\/$/,'')}
async function token(){const {data:{session}}=await supabase.auth.getSession();return session?.access_token||''}
async function api(path,options={}){const access=await token();if(!access)throw new Error('AUTH_REQUIRED');const r=await fetch(`${apiBase()}${path}`,{...options,cache:'no-store',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json',Accept:'application/json',...(options.headers||{})}});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||body.message||`HTTP ${r.status}`);return body}
function panelOpen(){return document.getElementById('jarvisPanel')?.classList.contains('open')}
function openPanel(){if(!panelOpen())document.getElementById('jarvisLauncher')?.click()}
function voiceBusy(){return !!window.A4VoiceEngine?.isSpeaking?.()}
function manualMicBusy(){return !!document.getElementById('jarvisMic')?.classList.contains('active')}
function canListen(){return wake.enabled&&wake.armed&&!wake.blocked&&!document.hidden&&!voiceBusy()&&!manualMicBusy()&&!!SR}
function stopWake(abort=true){clearTimeout(wake.restartTimer);wake.restartTimer=null;const rec=wake.rec;wake.rec=null;wake.listening=false;if(rec){try{abort?rec.abort():rec.stop()}catch{}}updateToggle()}
function scheduleRestart(delay=700){clearTimeout(wake.restartTimer);if(!wake.enabled||wake.blocked||!wake.armed)return;wake.restartTimer=setTimeout(()=>startWake(),delay)}
function normalizeTranscript(value){return String(value||'').replace(/\s+/g,' ').trim()}
function extractAfterWake(value){const text=normalizeTranscript(value);const match=text.match(/\bджарвис\b[\s,.:;!?-]*(.*)$/i);return match?{matched:true,command:normalizeTranscript(match[1])}:{matched:false,command:''}}

function withAssistant(callback,attempt=0){
  if(document.getElementById('jarvisLauncher')&&document.getElementById('jarvisForm'))return callback();
  if(attempt>=30)return;
  setTimeout(()=>withAssistant(callback,attempt+1),100);
}
function deliverPending(){
  if(wake.pendingCommand){const command=wake.pendingCommand;wake.pendingCommand='';withAssistant(()=>{openPanel();setTimeout(()=>{const input=document.getElementById('jarvisInput'),form=document.getElementById('jarvisForm');if(input&&form){input.value=command;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))}},80)});return}
  if(wake.pendingMic){wake.pendingMic=false;withAssistant(()=>{openPanel();setTimeout(()=>document.getElementById('jarvisMic')?.click(),180)})}
}
function startWake(){
  clearTimeout(wake.restartTimer);wake.restartTimer=null;if(!canListen()||wake.listening)return;
  const rec=new SR();wake.rec=rec;wake.listening=true;rec.lang='ru-RU';rec.continuous=true;rec.interimResults=false;rec.maxAlternatives=1;
  rec.onresult=e=>{for(let i=e.resultIndex||0;i<(e.results?.length||0);i++){const parsed=extractAfterWake(e.results?.[i]?.[0]?.transcript||'');if(!parsed.matched)continue;if(parsed.command)wake.pendingCommand=parsed.command;else wake.pendingMic=true;stopWake(false);break}};
  rec.onerror=e=>{const code=String(e?.error||'');if(code==='not-allowed'||code==='service-not-allowed'){wake.blocked=true;wake.listening=false;wake.rec=null;updateToggle();if(!wake.noticeShown){wake.noticeShown=true;console.warn('Jarvis wake word: microphone permission denied')}return}wake.listening=false;wake.rec=null};
  rec.onend=()=>{if(wake.rec===rec)wake.rec=null;wake.listening=false;updateToggle();if(wake.pendingCommand||wake.pendingMic){deliverPending();setTimeout(()=>scheduleRestart(1300),400);return}scheduleRestart(850)};
  try{rec.start();updateToggle()}catch{wake.listening=false;wake.rec=null;scheduleRestart(1200)}
}
function updateToggle(){
  let button=document.getElementById('jarvisWakeToggle');
  if(!button){button=document.createElement('button');button.id='jarvisWakeToggle';button.type='button';button.className='jarvis-wake-toggle';button.style.cssText='position:fixed;right:154px;bottom:30px;z-index:12051;width:42px;height:42px;border:1px solid #cbd5e1;border-radius:50%;background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.18);cursor:pointer;font-size:17px';button.addEventListener('click',async e=>{e.stopPropagation();wake.enabled=!wake.enabled;wake.blocked=false;localStorage.setItem(STORAGE_WAKE,wake.enabled?'1':'0');if(wake.enabled){wake.armed=true;startWake()}else stopWake();updateToggle();api('/api/v1/jarvis/preferences',{method:'PATCH',body:JSON.stringify({wake_word_enabled:wake.enabled})}).catch(()=>{})});document.body.appendChild(button)}
  button.textContent=!SR?'🚫':wake.enabled?(wake.listening?'👂':'🎧'):'🔇';button.title=!SR?'Wake word не поддерживается браузером':wake.enabled?(wake.listening?'Джарвис слушает имя':'Wake word включён'):'Wake word выключен';button.style.opacity=wake.enabled?'1':'.55';
}
function arm(){if(wake.armed||!wake.enabled||wake.blocked||!SR)return;wake.armed=true;window.A4VoiceEngine?.unlock?.().catch(()=>{});startWake()}
async function armIfPermissionGranted(){
  if(!SR||!wake.enabled||!navigator.permissions?.query)return;
  try{
    const permission=await navigator.permissions.query({name:'microphone'});
    if(permission.state==='granted')arm();
    permission.onchange=()=>{if(permission.state==='granted'){wake.blocked=false;arm()}else if(permission.state==='denied'){wake.blocked=true;stopWake()}};
  }catch{}
}

document.addEventListener('pointerdown',e=>{if(e.target?.closest?.('#jarvisMic')){stopWake();setTimeout(()=>scheduleRestart(1400),700);return}arm()},{capture:true,passive:true});
document.addEventListener('keydown',arm,{capture:true});
document.addEventListener('change',e=>{if(e.target?.id!=='jarvisBotMode')return;const mode=['off','draft','auto'].includes(e.target.value)?e.target.value:'off';localStorage.setItem(STORAGE_BOT,mode);api('/api/v1/jarvis/bot/settings',{method:'PATCH',body:JSON.stringify({mode})}).catch(error=>console.warn('Jarvis bot settings:',error))});
window.addEventListener('a4:voice-speaking',e=>{if(e.detail?.speaking)stopWake();else scheduleRestart(600)});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopWake();else{armIfPermissionGranted();scheduleRestart(700)}});

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

window.A4JarvisWake={enable(){wake.enabled=true;wake.blocked=false;wake.armed=true;localStorage.setItem(STORAGE_WAKE,'1');startWake();updateToggle()},disable(){wake.enabled=false;localStorage.setItem(STORAGE_WAKE,'0');stopWake();updateToggle()},isListening:()=>wake.listening,isEnabled:()=>wake.enabled};
