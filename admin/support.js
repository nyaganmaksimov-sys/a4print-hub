import { supabase } from './guard.js';

const cfg=window.A4PRINT_CONFIG||{};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=v=>v?new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const statusLabel=s=>({NEW:'Новое',OPEN:'В работе',WAITING:'Ждём пользователя',RESOLVED:'Решено',CLOSED:'Закрыто'}[s]||s);

let profile=null;
let roles=[];
let faq=[];
let currentTicket=null;
let operatorTickets=[];
let operatorTicket=null;
let pollTimer=null;
let canOperate=false;
let isAdmin=false;
let aiBusy=false;

function apiBase(){return String(cfg.apiBaseUrl||'').replace(/\/$/,'')}
async function hubApi(path,options={}){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)throw new Error('AUTH_REQUIRED');
  const response=await fetch(`${apiBase()}${path}`,{...options,cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json',Accept:'application/json',...(options.headers||{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.message||body.error||`HTTP ${response.status}`);
  return body;
}
function normalize(text){return String(text||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9\s]/gi,' ').replace(/\s+/g,' ').trim()}
function words(text){return new Set(normalize(text).split(' ').filter(x=>x.length>2))}
function faqScore(item,q){
  const query=normalize(q);if(!query)return 0;
  const hay=normalize([item.question,item.answer,...(item.keywords||[])].join(' '));
  let score=hay.includes(query)?14:0;
  const qWords=words(query);for(const w of qWords)if(hay.includes(w))score+=2;
  for(const k of item.keywords||[]){const nk=normalize(k);if(nk&&query.includes(nk))score+=5}
  if(normalize(item.question).includes(query))score+=8;
  return score;
}
function sourceLinks(sources=[]){
  const rows=(Array.isArray(sources)?sources:[]).filter(x=>x?.url).slice(0,6);
  if(!rows.length)return'';
  return `<div class="jarvis-ai-sources"><b>Источники:</b> ${rows.map(x=>{try{const u=new URL(x.url);if(!/^https?:$/.test(u.protocol))return'';return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${esc(x.title||u.hostname)}</a>`}catch{return''}}).filter(Boolean).join(' · ')}</div>`;
}
function ensureAiStyles(){
  if($('supportJarvisAiStyle'))return;
  const style=document.createElement('style');style.id='supportJarvisAiStyle';style.textContent=`
    .jarvis-support-ai{margin:10px 0;padding:12px 13px;border:1px solid #bfdbfe;border-radius:13px;background:#f8fbff;color:#334155;font-size:12px;line-height:1.55;white-space:pre-wrap}
    .jarvis-support-ai[data-kind="research"]{border-color:#c4b5fd;background:#faf8ff}.jarvis-support-ai b{color:#0f172a}.jarvis-ai-sources{margin-top:8px;white-space:normal;color:#64748b}.jarvis-ai-sources a{color:#2563eb;text-decoration:none}.jarvis-ai-sources a:hover{text-decoration:underline}.jarvis-ai-busy{opacity:.65;pointer-events:none}
  `;document.head.appendChild(style);
}

async function loadIdentity(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){location.replace('./login.html');return false}
  const [pRes,rRes,aRes,sRes]=await Promise.all([
    supabase.from('users').select('id,full_name,email,is_active').eq('auth_user_id',session.user.id).maybeSingle(),
    supabase.rpc('get_my_roles'),
    supabase.rpc('has_role',{required_role:'ADMIN'}),
    supabase.rpc('has_role',{required_role:'SUPPORT'})
  ]);
  if(pRes.error)throw pRes.error;
  if(!pRes.data||pRes.data.is_active===false)throw new Error('Профиль сотрудника не найден или отключён.');
  profile=pRes.data;
  roles=Array.isArray(rRes.data)?rRes.data:[];
  isAdmin=aRes.data===true||roles.includes('ADMIN');
  canOperate=isAdmin||sRes.data===true||roles.includes('SUPPORT');
  window.__A4_CURRENT_ROLES__=roles;
  return true;
}

async function loadFaq(){
  const {data,error}=await supabase.from('support_faq').select('id,category,question,answer,keywords,sort_order').eq('is_active',true).order('sort_order');
  if(error)throw error;faq=data||[];renderFaq();
}
function renderFaq(){
  const q=normalize($('faqSearch')?.value||'');
  const rows=faq.filter(x=>!q||normalize([x.category,x.question,x.answer,...(x.keywords||[])].join(' ')).includes(q));
  const host=$('faqList');if(!host)return;
  host.innerHTML=rows.map(x=>`<article class="faq-item"><button class="faq-q" type="button"><span><span class="faq-cat">${esc(x.category)}</span><br>${esc(x.question)}</span><span>⌄</span></button><div class="faq-a">${esc(x.answer)}</div></article>`).join('')||'<div class="empty">Ничего не найдено. Можно позвать оператора поддержки.</div>';
  host.querySelectorAll('.faq-q').forEach(b=>b.onclick=()=>b.closest('.faq-item').classList.toggle('open'));
}
function showBotAnswer(html){const el=$('botAnswer');if(!el)return;el.innerHTML=html;el.classList.add('show')}
function localBotFallback(q){
  const ranked=faq.map(x=>({item:x,score:faqScore(x,q)})).sort((a,b)=>b.score-a.score);const best=ranked[0];
  if(best&&best.score>=4)return `<b>${esc(best.item.question)}</b><div>${esc(best.item.answer)}</div>`;
  return '<b>Точного ответа в базе знаний не нашёл.</b><div>Можно передать вопрос оператору поддержки.</div>';
}
async function askBot(){
  const input=$('botQuestion'),button=$('askBot');if(!input)return;const q=input.value.trim();if(!q||aiBusy)return;
  aiBusy=true;if(button){button.disabled=true;button.textContent='Джарвис думает…'};showBotAnswer('<b>Джарвис анализирует вопрос…</b><div>Проверяю базу знаний и, если это техническая проблема, могу использовать внешний поиск.</div>');
  try{
    const data=await hubApi('/api/v1/jarvis/support/ask',{method:'POST',body:JSON.stringify({question:q})});
    const answer=data.answer||data.text||'Не удалось сформировать ответ.';
    showBotAnswer(`<b>Джарвис</b><div style="white-space:pre-wrap">${esc(answer)}</div>${sourceLinks(data.sources)}<div class="bot-fallback"><button type="button" class="btn secondary" data-still-help>Не помогло — позвать оператора</button></div>`);
  }catch(error){
    console.warn('Jarvis support ask:',error);
    showBotAnswer(`${localBotFallback(q)}<div class="bot-fallback"><button type="button" class="btn green" data-still-help>Позвать оператора</button></div>`);
  }finally{
    aiBusy=false;if(button){button.disabled=false;button.textContent='Спросить Джарвиса'};
    document.querySelector('[data-still-help]')?.addEventListener('click',()=>openOperator(q));
  }
}

async function findOwnTicket(){
  const {data,error}=await supabase.from('support_tickets').select('id,subject,status,priority,created_at,updated_at').eq('requester_id',profile.id).in('status',['NEW','OPEN','WAITING']).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;currentTicket=data||null;renderOwnTicketHead();if(currentTicket)await loadOwnMessages();
}
function renderOwnTicketHead(){
  if(!currentTicket){
    if($('ticketTitle'))$('ticketTitle').textContent='Оператор не вызван';
    if($('ticketStatus'))$('ticketStatus').textContent='Сначала задайте вопрос Джарвису или нажмите «Позвать оператора»';
    if($('ticketText'))$('ticketText').disabled=true;if($('ticketSend'))$('ticketSend').disabled=true;return;
  }
  $('ticketTitle').textContent=currentTicket.subject||'Обращение в поддержку';
  $('ticketStatus').textContent=`${statusLabel(currentTicket.status)} · создано ${fmt(currentTicket.created_at)}`;
  const closed=['RESOLVED','CLOSED'].includes(currentTicket.status);$('ticketText').disabled=closed;$('ticketSend').disabled=closed;
}
async function loadOwnMessages(){
  if(!currentTicket)return;
  const {data,error}=await supabase.from('support_messages').select('id,sender_id,sender_kind,body,created_at').eq('ticket_id',currentTicket.id).order('created_at');
  if(error)throw error;renderMessages($('ticketMessages'),data||[]);
}
function renderMessages(host,rows){
  if(!host)return;
  host.innerHTML=rows.map(m=>{
    const mine=m.sender_id===profile.id;
    const cls=mine?'mine':m.sender_kind==='OPERATOR'?'operator':m.sender_kind==='BOT'?'bot':'';
    const who=mine?'Вы':m.sender_kind==='OPERATOR'?'Поддержка':m.sender_kind==='BOT'?'Помощник':'Система';
    return `<div class="support-msg ${cls}"><small>${who} · ${fmt(m.created_at)}</small><div>${esc(m.body)}</div></div>`;
  }).join('')||'<div class="empty">Сообщений пока нет.</div>';
  host.scrollTop=host.scrollHeight;
}
async function openOperator(initialText=''){
  try{
    const subject=initialText?`Вопрос: ${initialText.slice(0,90)}`:'Обращение в поддержку';
    const {data:id,error}=await supabase.rpc('open_support_ticket',{p_subject:subject});if(error)throw error;
    currentTicket={id,subject,status:'NEW',created_at:new Date().toISOString()};
    renderOwnTicketHead();
    if(initialText){const {error:e}=await supabase.rpc('send_support_message',{p_ticket_id:id,p_body:initialText});if(e)throw e}
    await findOwnTicket();$('ticketText')?.focus();
  }catch(e){alert('Не удалось открыть поддержку: '+(e.message||e))}
}
async function sendOwn(e){
  e.preventDefault();const text=$('ticketText').value.trim();if(!text)return;
  if(!currentTicket)await openOperator();if(!currentTicket)return;
  $('ticketSend').disabled=true;
  try{const {error}=await supabase.rpc('send_support_message',{p_ticket_id:currentTicket.id,p_body:text});if(error)throw error;$('ticketText').value='';await findOwnTicket()}catch(x){alert(x.message||x)}finally{$('ticketSend').disabled=false}
}

async function loadOperatorTickets(keep=true){
  const {data,error}=await supabase.from('support_tickets').select('id,requester_id,subject,status,priority,source,created_at,updated_at,users:requester_id(full_name,email)').order('updated_at',{ascending:false}).limit(300);
  if(error)throw error;operatorTickets=data||[];renderOperatorTickets();
  if(keep&&operatorTicket){const fresh=operatorTickets.find(x=>x.id===operatorTicket.id);if(fresh){operatorTicket=fresh;await loadOperatorMessages()}}
}
function filteredTickets(){
  const q=normalize($('ticketSearch')?.value||''),st=$('ticketFilter')?.value||'';
  return operatorTickets.filter(t=>(!st||t.status===st)&&(!q||normalize([t.subject,t.users?.full_name,t.users?.email,t.status].join(' ')).includes(q)));
}
function renderOperatorTickets(){
  const host=$('operatorTicketList');if(!host)return;
  const rows=filteredTickets();host.innerHTML=rows.map(t=>`<button type="button" class="ticket-item ${operatorTicket?.id===t.id?'active':''}" data-ticket="${t.id}"><b>${esc(t.users?.full_name||t.users?.email||'Сотрудник')}</b><small>${esc(t.subject||'Обращение')}</small><span class="ticket-chip">${statusLabel(t.status)} · ${fmt(t.updated_at)}</span></button>`).join('')||'<div class="empty">Обращений нет.</div>';
  host.querySelectorAll('[data-ticket]').forEach(b=>b.onclick=()=>openOperatorTicket(b.dataset.ticket));
}
function aiPanel(){
  let panel=$('operatorJarvisAi');if(panel)return panel;
  panel=document.createElement('div');panel.id='operatorJarvisAi';panel.className='jarvis-support-ai';panel.hidden=true;
  const box=$('operatorMessages')?.closest('.ticket-box');if(box)box.before(panel);return panel;
}
function ensureOperatorAiControls(){
  ensureAiStyles();const toolbar=document.querySelector('#operatorSupport .operator-toolbar');if(!toolbar||$('jarvisDraft'))return;
  const draft=document.createElement('button');draft.id='jarvisDraft';draft.type='button';draft.className='btn';draft.textContent='✨ Ответ Джарвиса';draft.onclick=()=>generateOperatorAi('draft');
  const research=document.createElement('button');research.id='jarvisResearch';research.type='button';research.className='btn secondary';research.textContent='🌐 Разобрать с интернетом';research.onclick=()=>generateOperatorAi('research');
  toolbar.append(draft,research);aiPanel();
}
function setAiButtons(disabled){for(const id of ['jarvisDraft','jarvisResearch'])if($(id))$(id).disabled=disabled}
async function generateOperatorAi(mode='draft'){
  if(!operatorTicket||aiBusy)return;if(!['draft','research'].includes(mode))mode='draft';
  aiBusy=true;setAiButtons(true);const panel=aiPanel();panel.hidden=false;panel.dataset.kind=mode;panel.innerHTML='<b>Джарвис анализирует обращение…</b>';
  try{
    const data=await hubApi('/api/v1/jarvis/support/draft',{method:'POST',body:JSON.stringify({ticket_id:operatorTicket.id,mode})});
    const text=data.text||'Ответ не сформирован.';
    if(mode==='draft'){
      $('operatorText').value=text;$('operatorText').focus();
      panel.innerHTML=`<b>Черновик готов.</b> Я вставил его в поле ответа. Проверьте текст перед отправкой.${sourceLinks(data.sources)}`;
    }else{
      panel.innerHTML=`<b>Диагностика Джарвиса</b><div style="margin-top:6px;white-space:pre-wrap">${esc(text)}</div>${sourceLinks(data.sources)}`;
    }
  }catch(error){panel.innerHTML=`<b>Не удалось получить ответ Джарвиса.</b><div>${esc(error.message||error)}</div>`}
  finally{aiBusy=false;setAiButtons(false)}
}
async function openOperatorTicket(id){
  operatorTicket=operatorTickets.find(x=>x.id===id)||null;if(!operatorTicket)return;
  renderOperatorTickets();$('operatorTicketTitle').textContent=operatorTicket.users?.full_name||operatorTicket.users?.email||'Обращение';
  $('operatorTicketMeta').textContent=`${operatorTicket.subject} · ${fmt(operatorTicket.created_at)} · общая очередь`;$('operatorStatus').value=operatorTicket.status;
  $('operatorText').disabled=false;$('operatorSend').disabled=false;const panel=aiPanel();if(panel){panel.hidden=true;panel.innerHTML=''}await loadOperatorMessages();
}
async function loadOperatorMessages(){
  if(!operatorTicket)return;const {data,error}=await supabase.from('support_messages').select('id,sender_id,sender_kind,body,created_at').eq('ticket_id',operatorTicket.id).order('created_at');if(error)throw error;renderMessages($('operatorMessages'),data||[]);
}
async function sendOperator(e){
  e.preventDefault();if(!operatorTicket)return;const text=$('operatorText').value.trim();if(!text)return;$('operatorSend').disabled=true;
  try{const {error}=await supabase.rpc('send_support_message',{p_ticket_id:operatorTicket.id,p_body:text});if(error)throw error;$('operatorText').value='';const panel=aiPanel();if(panel)panel.hidden=true;await loadOperatorTickets(true)}catch(x){alert(x.message||x)}finally{$('operatorSend').disabled=false}
}
async function saveOperatorStatus(){
  if(!operatorTicket)return;const status=$('operatorStatus').value;const patch={status,updated_at:new Date().toISOString(),closed_at:['RESOLVED','CLOSED'].includes(status)?new Date().toISOString():null};
  const {error}=await supabase.from('support_tickets').update(patch).eq('id',operatorTicket.id);if(error)return alert(error.message);operatorTicket={...operatorTicket,...patch};await loadOperatorTickets(true);
}

async function init(){
  ensureAiStyles();if($('askBot'))$('askBot').textContent='Спросить Джарвиса';
  const botTitle=document.querySelector('.bot-head b');if(botTitle)botTitle.textContent='Джарвис · поддержка';
  if(!await loadIdentity())return;
  if($('supportRole'))$('supportRole').textContent=canOperate?(isAdmin?'Администратор · общая очередь поддержки':'Поддержка · общая очередь'):(profile.full_name||profile.email||'Сотрудник');
  await loadFaq();
  if(canOperate){
    $('userSupport')?.classList.add('hidden');$('operatorSupport')?.classList.remove('hidden');ensureOperatorAiControls();await loadOperatorTickets(false);
    pollTimer=setInterval(()=>{if(!document.hidden)loadOperatorTickets(true).catch(console.warn)},6000);
  }else{
    $('operatorSupport')?.classList.add('hidden');$('userSupport')?.classList.remove('hidden');await findOwnTicket();
    pollTimer=setInterval(()=>{if(!document.hidden&&currentTicket)findOwnTicket().catch(console.warn)},6000);
  }
}

$('faqSearch')?.addEventListener('input',renderFaq);
$('askBot')?.addEventListener('click',askBot);
$('botQuestion')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();askBot()}});
$('callOperatorTop')?.addEventListener('click',()=>openOperator($('botQuestion')?.value.trim()||''));
$('ticketComposer')?.addEventListener('submit',sendOwn);
$('ticketSearch')?.addEventListener('input',renderOperatorTickets);
$('ticketFilter')?.addEventListener('change',renderOperatorTickets);
$('reloadTickets')?.addEventListener('click',()=>loadOperatorTickets(true).catch(e=>alert(e.message)));
$('operatorComposer')?.addEventListener('submit',sendOperator);
$('saveTicketStatus')?.addEventListener('click',saveOperatorStatus);
window.addEventListener('beforeunload',()=>pollTimer&&clearInterval(pollTimer));
init().catch(e=>{console.error(e);alert('Не удалось открыть поддержку: '+(e.message||e))});
