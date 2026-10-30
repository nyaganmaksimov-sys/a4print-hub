import {supabase} from './guard.js?v=20260905-netfix1';
// Spoken print-time alerts on the 3D-ARTPRINT home dashboard.
// Browser speech voice is system-provided, not an imitation of an actor.
const STORE='a4:3dartprint:voice-alert-enabled';
const button=document.getElementById('printVoiceToggle');
const status=document.getElementById('printVoiceStatus');
let enabled=false,jobs=[],runs=[],checking=false;
try{enabled=localStorage.getItem(STORE)==='1'}catch{}
function sync(){
 button.setAttribute('aria-pressed',String(enabled));
 button.textContent=enabled?'🔊 Звук включён':'🔇 Звук выключен';
 button.title=enabled?'Отключить голосовые сообщения':'Включить голосовые сообщения о печати';
 status.textContent=enabled?'Голосовые оповещения активны, если браузер разрешает воспроизведение':'Голосовые оповещения отключены';
}
let activeUtterance=null;
async function speak(message){
 // The global HUB Jarvis is intentionally disabled; production voice is separate.
 // Browser TTS works without the Jarvis backend or server credentials.
 if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window)){
  status.textContent='Браузер не поддерживает озвучивание. Попробуйте Chrome или Edge.';
  return false;
 }
 try{
  speechSynthesis.cancel();
  const voice=new SpeechSynthesisUtterance(message);
  activeUtterance=voice;
  voice.lang='ru-RU';voice.rate=.89;voice.pitch=.8;voice.volume=1;
  const available=speechSynthesis.getVoices();
  const ru=available.filter(v=>String(v.lang).toLowerCase().startsWith('ru'));
  voice.voice=ru.find(v=>/pavel|dmit|male|максим|дмитр|павел/i.test(v.name))||ru[0]||null;
  voice.onstart=()=>{status.textContent='🔊 Джарвис произносит сообщение…'};
  voice.onend=()=>{activeUtterance=null;status.textContent='✓ Голосовое сообщение воспроизведено'};
  voice.onerror=e=>{activeUtterance=null;status.textContent='Ошибка озвучивания ('+e.error+'). Проверьте звук и установленные голоса.'};
  speechSynthesis.speak(voice);
  return true;
 }catch(error){status.textContent='Не удалось запустить голос: '+error.message;return false}
}

button.addEventListener('click',()=>{
 enabled=!enabled;
 try{localStorage.setItem(STORE,enabled?'1':'0')}catch{}
 if(!enabled)window.speechSynthesis?.cancel?.();
 sync();
 if(enabled)void speak('Джарвис на связи. Голосовые уведомления о завершении печати включены.');
});
sync();
const testButton=document.getElementById('printVoiceTest');
testButton?.addEventListener('click',()=>{
 if(!enabled){status.textContent='Сначала включите звук';return}
 void speak('Внимание. Печать на принтере Флэшфордж завершена. Требуется проверить принтер и снять готовую модель.');
});
document.addEventListener('a4:3d-production-jobs-loaded',event=>{
 jobs=event.detail?.jobs||[];runs=event.detail?.runs||[];void check();
});
function secondsFor(id){
 const now=Date.now();
 return runs.filter(r=>r.production_job_id===id).reduce((sum,r)=>{
  const start=Date.parse(r.started_at),end=r.ended_at?Date.parse(r.ended_at):now;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return sum;
  return sum+(r.ended_at&&Number.isFinite(Number(r.elapsed_seconds))?Number(r.elapsed_seconds):(end-start)/1000);
 },0);
}
async function check(){
 if(!enabled||checking)return;
 const pending=jobs.filter(j=>j.status==='IN_PROGRESS'&&Number(j.planned_machine_minutes)>0&&secondsFor(j.id)>=Number(j.planned_machine_minutes)*60);
 if(!pending.length)return;
 checking=true;
 try{
  for(const j of pending){
   const runList=runs.filter(r=>r.production_job_id===j.id).sort((a,b)=>Date.parse(a.started_at)-Date.parse(b.started_at));
   const runKey=runList.map(r=>r.started_at).join(',')||String(j.started_at||'');
   const key='3dartprint:voice:'+j.id+':'+runKey+':'+j.planned_machine_minutes;
   if(sessionStorage.getItem(key))continue;
   // Confirm the job is still active before delivering a potentially stale alert.
   const {data,error}=await supabase.from('production_jobs').select('status,planned_machine_minutes').eq('id',j.id).maybeSingle();
   if(error||data?.status!=='IN_PROGRESS'||Number(data?.planned_machine_minutes)!==Number(j.planned_machine_minutes))continue;
   sessionStorage.setItem(key,'1');
   const message='Внимание. Печать по заказу номер '+(j.order_number||'без номера')+' завершила расчётное время. Требуется проверить принтер и снять модель, если печать действительно окончена.';
   status.textContent='🔔 '+message;
   await speak(message);
   break; // One voice message per poll prevents speech overlap.
  }
 }catch(error){console.warn('3D voice alert',error)}
 finally{checking=false}
}
setInterval(()=>void check(),15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void check()});
