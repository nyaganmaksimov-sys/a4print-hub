import './voice-engine.js?v=20260911-voice3';
import { supabase } from './guard.js?v=20260905-netfix1';

const cfg=window.A4PRINT_CONFIG||{};
const STORAGE_VOICE='a4_jarvis_voice_enabled_v2';
let pendingSpeech='';
let speaking=false;

function apiBase(){return String(cfg.apiBaseUrl||'').replace(/\/$/,'')}
function moscowDate(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function daypart(){const h=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',hour:'2-digit',hour12:false}).format(new Date()));return h<12?'Доброе утро':h<18?'Добрый день':'Добрый вечер'}
function voiceEnabled(){return localStorage.getItem(STORAGE_VOICE)!=='0'}
async function token(){const {data:{session}}=await supabase.auth.getSession();return session?.access_token||''}
async function api(path){const access=await token();if(!access)throw new Error('AUTH_REQUIRED');const r=await fetch(`${apiBase()}${path}`,{cache:'no-store',headers:{Authorization:`Bearer ${access}`,Accept:'application/json'}});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||body.message||`HTTP ${r.status}`);return body}
function rub(v){return new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(Number(v||0))}
function greetingText(data){
  const s=data.summary||{},name=data.profile?.first_name||'коллега';
  let phrase=`${daypart()}, ${name}. Джарвис на связи. Желаю продуктивного дня.`;
  if(data.orders_available!==false){phrase+=` Сейчас активных заказов: ${Number(s.active_orders||0)}. В работе: ${Number(s.in_progress||0)}. Готовы к выдаче: ${Number(s.ready||0)}. Просрочены: ${Number(s.overdue||0)}.`;if(Number(s.due_today||0)>0)phrase+=` На сегодня срок у ${Number(s.due_today)} заказов.`;}
  if(Number(s.production_delayed||0)>0)phrase+=` Производственных задержек: ${Number(s.production_delayed)}.`;
  if(Number(s.sentinel_critical||0)>0)phrase+=` Внимание: критических событий Sentinel — ${Number(s.sentinel_critical)}.`;
  else if(Number(s.sentinel_warning||0)>0)phrase+=` Предупреждений Sentinel: ${Number(s.sentinel_warning)}.`;
  return phrase;
}
function cardText(data){const s=data.summary||{};return {title:`${daypart()}, ${data.profile?.first_name||'коллега'}`,body:`Активные заказы: ${s.active_orders||0} · В работе: ${s.in_progress||0} · Готовы: ${s.ready||0} · Просрочены: ${s.overdue||0} · Сегодня: ${s.due_today||0}${Number(s.active_value||0)?` · Сумма активных: ${rub(s.active_value)}`:''}`}}
function ensureStyle(){if(document.getElementById('jarvisLoginBriefingStyle'))return;const style=document.createElement('style');style.id='jarvisLoginBriefingStyle';style.textContent=`#jarvisLoginBriefing{position:fixed;right:20px;top:18px;z-index:12080;width:min(430px,calc(100vw - 28px));padding:15px 16px;border-radius:16px;background:#0f172a;color:#fff;box-shadow:0 18px 50px rgba(15,23,42,.28);font:500 12px/1.5 system-ui;opacity:0;transform:translateY(-8px);pointer-events:none;transition:.2s ease}#jarvisLoginBriefing.show{opacity:1;transform:none;pointer-events:auto}#jarvisLoginBriefing b{display:block;font-size:14px;margin-bottom:4px}#jarvisLoginBriefing small{display:block;color:#cbd5e1;margin-top:6px}`;document.head.appendChild(style)}
function showCard(data){ensureStyle();let el=document.getElementById('jarvisLoginBriefing');if(!el){el=document.createElement('div');el.id='jarvisLoginBriefing';document.body.appendChild(el)}const c=cardText(data);el.innerHTML='';const b=document.createElement('b');b.textContent=`🤖 ${c.title}`;const div=document.createElement('div');div.textContent=c.body;const small=document.createElement('small');small.textContent='Джарвис · оперативная сводка HUB';el.append(b,div,small);el.classList.add('show');el.onclick=()=>{document.getElementById('jarvisLauncher')?.click();el.classList.remove('show')};setTimeout(()=>el.classList.remove('show'),18000)}
function appendToJarvis(data,phrase){let tries=0;const timer=setInterval(()=>{tries++;const log=document.getElementById('jarvisLog');if(log){clearInterval(timer);const card=document.createElement('div');card.className='jarvis-msg assistant';const span=document.createElement('span');span.textContent='Джарвис · сводка при входе';const p=document.createElement('p');p.textContent=phrase;card.append(span,p);log.appendChild(card);log.scrollTop=log.scrollHeight}else if(tries>40)clearInterval(timer)},150)}
async function speakPending(){if(speaking||!pendingSpeech||!voiceEnabled()||!window.A4VoiceEngine)return false;speaking=true;try{const ok=await window.A4VoiceEngine.speak(pendingSpeech,{profile:'male',apiBaseUrl:apiBase(),tokenProvider:token,priority:'normal'});if(ok)pendingSpeech='';return ok}catch{return false}finally{speaking=false}}
async function init(){
  try{
    const {data:{session}}=await supabase.auth.getSession();if(!session?.user?.id)return;
    const mark=`a4_jarvis_greeted_v1:${session.user.id}:${moscowDate()}`;if(localStorage.getItem(mark)==='1')return;
    const data=await api('/api/v1/jarvis/briefing');if(!data?.success)return;
    localStorage.setItem(mark,'1');const phrase=greetingText(data);showCard(data);appendToJarvis(data,phrase);pendingSpeech=phrase;
    await speakPending();
    const retry=()=>speakPending();window.addEventListener('a4:voice-unlocked',retry,{once:true});document.addEventListener('pointerdown',retry,{once:true,capture:true});document.addEventListener('keydown',retry,{once:true,capture:true});
    window.dispatchEvent(new CustomEvent('a4:jarvis-login-briefing',{detail:data}));
  }catch(error){console.warn('Jarvis login briefing:',error)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
