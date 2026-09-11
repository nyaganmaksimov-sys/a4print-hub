import { supabase } from './guard.js?v=20260905-netfix1';

const cfg=window.A4PRINT_CONFIG||{};
const busy=new Set();

function apiBase(){return String(cfg.apiBaseUrl||'').replace(/\/$/,'')}
async function token(){const {data:{session}}=await supabase.auth.getSession();return session?.access_token||''}
async function api(path,options={}){
  const access=await token();if(!access)throw new Error('AUTH_REQUIRED');
  const response=await fetch(`${apiBase()}${path}`,{...options,cache:'no-store',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json',Accept:'application/json',...(options.headers||{})}});
  const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||body.error||`HTTP ${response.status}`);return body;
}
function safeId(v){return String(v||'').replace(/[^a-z0-9_-]/gi,'')}
function ensureStyle(){
  if(document.getElementById('jarvisSentinelAiStyle'))return;
  const style=document.createElement('style');style.id='jarvisSentinelAiStyle';style.textContent=`
    .jarvis-sentinel-ai-box{margin-top:9px;padding:9px 10px;border:1px solid #bfdbfe;border-radius:9px;background:#f8fbff;color:#334155;font-size:11px;line-height:1.5;white-space:pre-wrap}
    .jarvis-sentinel-ai-box b{display:block;margin-bottom:4px;color:#0f172a}.jarvis-sentinel-ai-box .ai-source-list{margin-top:7px;white-space:normal;color:#64748b}.jarvis-sentinel-ai-box .ai-source-list a{color:#2563eb;text-decoration:none}.jarvis-sentinel-ai-box .ai-source-list a:hover{text-decoration:underline}
  `;document.head.appendChild(style);
}
function appendSources(box,sources=[]){
  const rows=(Array.isArray(sources)?sources:[]).filter(x=>x?.url).slice(0,6);if(!rows.length)return;
  const wrap=document.createElement('div');wrap.className='ai-source-list';const label=document.createElement('b');label.textContent='Внешние источники:';wrap.appendChild(label);
  rows.forEach((source,index)=>{try{const url=new URL(source.url);if(!/^https?:$/.test(url.protocol))return;const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=source.title||url.hostname;wrap.appendChild(a);if(index<rows.length-1)wrap.appendChild(document.createTextNode(' · '))}catch{}});box.appendChild(wrap);
}
function renderAnalysis(card,data){
  let box=card.querySelector('.jarvis-sentinel-ai-box');if(!box){box=document.createElement('div');box.className='jarvis-sentinel-ai-box';card.appendChild(box)}box.innerHTML='';
  const title=document.createElement('b');title.textContent='Диагностика облачного Джарвиса';const text=document.createElement('div');text.textContent=data?.text||'Анализ пока не сформирован.';box.append(title,text);appendSources(box,data?.sources||[]);
}
async function analyze(item,button){
  if(!item?.id||busy.has(item.id))return;busy.add(item.id);button.disabled=true;const old=button.textContent;button.textContent='ИИ анализирует…';
  try{const data=await api(`/api/v1/jarvis/incidents/${encodeURIComponent(item.id)}/analysis`);renderAnalysis(button.closest('.jarvis-sentinel-card'),data.analysis||{})}
  catch(error){let box=button.closest('.jarvis-sentinel-card')?.querySelector('.jarvis-sentinel-ai-box');if(!box){box=document.createElement('div');box.className='jarvis-sentinel-ai-box';button.closest('.jarvis-sentinel-card')?.appendChild(box)}box.textContent=`Не удалось получить AI-разбор: ${error.message||error}`}
  finally{busy.delete(item.id);button.disabled=false;button.textContent=old}
}
function decorate(){
  ensureStyle();const items=window.A4JarvisSentinel?.items?.()||[];
  for(const item of items){
    const card=document.getElementById(`sentinel-${safeId(item.id)}`);if(!card||card.querySelector('[data-sentinel-ai]'))continue;
    let actions=card.querySelector('.jarvis-sentinel-actions');if(!actions){actions=document.createElement('div');actions.className='jarvis-sentinel-actions';card.appendChild(actions)}
    const button=document.createElement('button');button.type='button';button.dataset.sentinelAi='1';button.textContent='🤖 Разобрать с ИИ';button.onclick=()=>analyze(item,button);actions.appendChild(button);
  }
}
function init(){ensureStyle();decorate();const observer=new MutationObserver(()=>decorate());observer.observe(document.body,{childList:true,subtree:true});window.addEventListener('a4:jarvis-sentinel',()=>setTimeout(decorate,0));setInterval(decorate,5000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
