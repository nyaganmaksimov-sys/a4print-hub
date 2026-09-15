import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg=window.A4PRINT_PARTNER_CONFIG||{};
const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
const esc=value=>String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=(value,currency='RUB')=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:currency||'RUB',maximumFractionDigits:2}).format(Number(value||0));
const date=value=>value?new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString('ru-RU'):'—';
const dateTime=value=>value?new Date(value).toLocaleString('ru-RU'):'—';
const state={cabinet:null,responses:[],busy:false};

function installStyle(){
  if(document.getElementById('eo-response-style'))return;
  const style=document.createElement('style');style.id='eo-response-style';style.textContent=`
    .eo-response-list{display:grid;gap:10px}.eo-response-row{background:#fff;border:1px solid #e5eaf1;border-radius:14px;padding:14px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center}.eo-response-row h3{margin:0 0 4px;font-size:15px}.eo-response-row p{margin:0;color:#64748b;font-size:12px}.eo-response-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.eo-response-actions button{border:1px solid #cbd5e1;background:#fff;border-radius:9px;padding:8px 11px;cursor:pointer;font-weight:800}.eo-response-actions .ack{background:#166534;color:#fff;border-color:#166534}.eo-response-actions .dispute{color:#991b1b;border-color:#fecaca}.eo-response-state{margin-top:8px;padding:8px 10px;border-radius:9px;background:#f8fafc;color:#475569;font-size:12px}.eo-response-state.good{background:#ecfdf5;color:#166534}.eo-response-state.bad{background:#fef2f2;color:#991b1b}.eo-response-state.done{background:#eff6ff;color:#1d4ed8}.eo-response-intro{background:#fff;border:1px solid #e5eaf1;border-radius:14px;padding:14px;margin-bottom:12px;color:#475569}.eo-response-intro b{color:#0f172a}.eo-response-row button:disabled{opacity:.45;cursor:not-allowed}@media(max-width:720px){.eo-response-row{grid-template-columns:1fr}.eo-response-actions{justify-content:stretch}.eo-response-actions button{flex:1}}
  `;document.head.appendChild(style);
}

function installTab(){
  const tabs=document.querySelector('.eo-tabs');if(!tabs||document.querySelector('[data-tab="responses"]'))return;
  const button=document.createElement('button');button.className='eo-tab';button.dataset.tab='responses';button.type='button';button.textContent='Подтверждения';tabs.appendChild(button);
  const panel=document.createElement('section');panel.className='eo-panel';panel.dataset.panel='responses';panel.innerHTML='<div class="eo-response-intro"><b>Подтверждение владельца</b><br>Здесь можно подтвердить опубликованный расчёт/документ или сообщить о расхождении. Исходные суммы и документы при этом не изменяются.</div><div id="eoResponses" class="eo-response-list"><div class="eo-empty">Загрузка…</div></div>';
  tabs.parentElement.appendChild(panel);
  button.addEventListener('click',()=>{document.querySelectorAll('.eo-tab').forEach(x=>x.classList.toggle('active',x===button));document.querySelectorAll('.eo-panel').forEach(x=>x.classList.toggle('active',x===panel));load();});
  panel.addEventListener('click',handleAction);
}

const key=(type,id)=>`${type}|${id}`;
function latestMap(){const map=new Map();for(const r of state.responses||[]){const k=key(r.entity_type,r.entity_id);if(!map.has(k))map.set(k,r)}return map;}
function responseState(type,id){
  const r=latestMap().get(key(type,id));if(!r)return '<div class="eo-response-state">Ответ владельца ещё не зафиксирован.</div>';
  if(r.response_status==='ACKNOWLEDGED')return `<div class="eo-response-state good">✓ Подтверждено вами · ${dateTime(r.created_at)}</div>`;
  if(r.resolved_at)return `<div class="eo-response-state done">Расхождение рассмотрено HUB · ${dateTime(r.resolved_at)}${r.resolution_note?`<br>${esc(r.resolution_note)}`:''}</div>`;
  return `<div class="eo-response-state bad">! Есть расхождение · ${dateTime(r.created_at)}${r.comment?`<br>${esc(r.comment)}`:''}</div>`;
}
function actionButtons(type,id){
  const r=latestMap().get(key(type,id));const ack=r?.response_status==='ACKNOWLEDGED';const disputed=r?.response_status==='DISPUTED'&&!r?.resolved_at;
  return `<div class="eo-response-actions"><button class="ack" data-response-action="ACKNOWLEDGED" data-entity-type="${type}" data-entity-id="${id}" ${ack?'disabled':''}>✓ Подтвердить</button><button class="dispute" data-response-action="DISPUTED" data-entity-type="${type}" data-entity-id="${id}" ${disputed?'disabled':''}>Есть расхождение</button></div>`;
}

async function load(){
  if(state.busy)return;state.busy=true;const root=document.getElementById('eoResponses');if(root)root.innerHTML='<div class="eo-empty">Обновление…</div>';
  try{
    const [cab,res]=await Promise.all([supabase.rpc('get_partner_equipment_cabinet'),supabase.rpc('get_my_equipment_partner_responses')]);
    if(cab.error)throw cab.error;if(res.error)throw res.error;state.cabinet=cab.data||{};state.responses=Array.isArray(res.data)?res.data:[];render();
  }catch(error){if(root)root.innerHTML=`<div class="eo-alert">${esc(friendly(error))}</div>`}finally{state.busy=false}
}

function render(){
  const root=document.getElementById('eoResponses');if(!root)return;const d=state.cabinet||{};const rows=[];
  for(const s of d.settlements||[]){if(!['APPROVED','PAID'].includes(s.status))continue;rows.push(`<article class="eo-response-row"><div><h3>Расчёт по договору ${esc(s.contract_number)}</h3><p>${date(s.period_start)} — ${date(s.period_end)} · ваша сумма ${money(s.owner_amount,s.currency)}</p>${responseState('OWNER_SETTLEMENT',s.id)}</div>${actionButtons('OWNER_SETTLEMENT',s.id)}</article>`)}
  for(const l of d.lease_charges||[]){if(!['APPROVED','PAID'].includes(l.status))continue;rows.push(`<article class="eo-response-row"><div><h3>Арендное начисление · ${esc(l.contract_number)}</h3><p>${date(l.period_start)} — ${date(l.period_end)} · ${money(l.amount,l.currency)}${Number(l.buyout_credit_amount||0)>0?` · в выкуп ${money(l.buyout_credit_amount,l.currency)}`:''}</p>${responseState('LEASE_CHARGE',l.id)}</div>${actionButtons('LEASE_CHARGE',l.id)}</article>`)}
  for(const doc of d.documents||[]){rows.push(`<article class="eo-response-row"><div><h3>${esc(doc.document_type_name)}</h3><p>${esc(doc.document_number||'—')} · договор ${esc(doc.contract_number||'—')} · ${date(doc.issue_date)}</p>${responseState('CONTRACT_DOCUMENT',doc.document_id)}</div>${actionButtons('CONTRACT_DOCUMENT',doc.document_id)}</article>`)}
  root.innerHTML=rows.length?rows.join(''):'<div class="eo-empty">Пока нет опубликованных расчётов или документов, требующих ответа.</div>';
}

async function handleAction(event){
  const button=event.target.closest('[data-response-action]');if(!button||button.disabled)return;
  const status=button.dataset.responseAction;let comment=null;
  if(status==='DISPUTED'){
    comment=prompt('Опишите, что именно не совпадает или требует проверки:');
    if(comment===null)return;comment=comment.trim();if(!comment){alert('Для расхождения обязательно укажите комментарий.');return}
  }else if(!confirm('Подтвердить, что вы ознакомились и согласны с этой записью?'))return;
  button.disabled=true;
  const {error}=await supabase.rpc('submit_equipment_partner_response',{p_entity_type:button.dataset.entityType,p_entity_id:button.dataset.entityId,p_response_status:status,p_comment:comment});
  if(error){alert(friendly(error));button.disabled=false;return}
  await load();
}

function friendly(error){const msg=String(error?.message||error||'Ошибка');if(msg.includes('DISPUTE_COMMENT_REQUIRED'))return 'Для расхождения нужен комментарий.';if(msg.includes('RESPONSE_ALREADY_CURRENT'))return 'Такой ответ уже является текущим.';if(msg.includes('ENTITY_NOT_AVAILABLE'))return 'Эта запись пока недоступна для подтверждения.';if(msg.includes('PARTNER_ACCESS_REQUIRED'))return 'Нет активного партнёрского доступа.';return msg;}

function init(){installStyle();installTab();load()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
