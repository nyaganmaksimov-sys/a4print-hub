import {supabase} from './guard.js?v=20260905-netfix1';
import {riskParam,installRiskCockpitReturnLink,focusRiskElement,showRiskLinkMissing} from './production-farm-deep-link.js?v=20260919-phase55-1';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const dateTime=value=>value?new Date(value).toLocaleString('ru-RU'):'—';
const typeLabel={OWNER_SETTLEMENT:'Расчёт владельца',LEASE_CHARGE:'Арендное начисление',CONTRACT_DOCUMENT:'Документ договора'};
const state={rows:[],loading:false};
const riskResponseId=riskParam('response');
installRiskCockpitReturnLink();

installStyles();bind();load();

function installStyles(){
  if(document.getElementById('epr-style'))return;
  const style=document.createElement('style');style.id='epr-style';style.textContent=`
    .epr-shell{padding:22px;max-width:1240px;margin:0 auto}.epr-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:14px}.epr-kpis article,.epr-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px}.epr-kpis span,.epr-kpis small{display:block;color:#64748b}.epr-kpis strong{display:block;font-size:26px;margin:5px 0}.epr-toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:14px}.epr-toolbar label{display:flex;gap:8px;align-items:center;color:#334155;font-weight:700}.epr-toolbar input[type=search]{min-width:300px;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px}.epr-list{display:grid;gap:10px}.epr-row{border:1px solid #e2e8f0;border-radius:14px;padding:14px;display:grid;grid-template-columns:minmax(0,1.5fr) minmax(150px,.7fr) minmax(180px,.8fr) auto;gap:12px;align-items:center}.epr-row h3{margin:0 0 4px;font-size:15px}.epr-row p{margin:0;color:#64748b;font-size:12px}.epr-comment{margin-top:8px;padding:9px 10px;border-radius:9px;background:#fef2f2;color:#991b1b;font-size:13px}.epr-resolution{margin-top:8px;padding:9px 10px;border-radius:9px;background:#eff6ff;color:#1d4ed8;font-size:13px}.epr-badge{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:11px;font-weight:800}.epr-badge.open{background:#fee2e2;color:#991b1b}.epr-badge.done{background:#dcfce7;color:#166534}.epr-row button{border:1px solid #0f172a;background:#0f172a;color:#fff;border-radius:9px;padding:9px 12px;font-weight:800;cursor:pointer}.epr-empty{padding:30px;text-align:center;color:#64748b;border:1px dashed #cbd5e1;border-radius:12px}.epr-error{padding:10px 12px;margin-bottom:12px;border-radius:10px;background:#fef2f2;color:#991b1b}.topbar .button{display:inline-flex;align-items:center;text-decoration:none;border:1px solid #cbd5e1;border-radius:10px;padding:9px 12px;color:#0f172a;background:#fff;font-weight:700}@media(max-width:850px){.epr-row{grid-template-columns:1fr 1fr}.epr-row>div:first-child{grid-column:1/-1}.epr-toolbar{align-items:stretch;flex-direction:column}.epr-toolbar input[type=search]{min-width:0;width:100%}}@media(max-width:540px){.epr-shell{padding:12px}.epr-kpis,.epr-row{grid-template-columns:1fr}.epr-row>div:first-child{grid-column:auto}}
  `;document.head.appendChild(style);
}

function bind(){
  $('eprRefresh')?.addEventListener('click',load);
  $('eprResolved')?.addEventListener('change',load);
  $('eprSearch')?.addEventListener('input',render);
  $('eprList')?.addEventListener('click',handleClick);
}

async function load(){
  if(state.loading)return;state.loading=true;$('eprRefresh').disabled=true;$('eprError').innerHTML='';
  try{
    const {data,error}=await supabase.rpc('list_equipment_partner_disputes',{p_include_resolved:$('eprResolved').checked});
    if(error)throw error;state.rows=Array.isArray(data)?data:[];render();
  }catch(error){$('eprError').innerHTML=`<div class="epr-error">${esc(friendly(error))}</div>`}
  finally{state.loading=false;$('eprRefresh').disabled=false}
}

function render(){
  const q=String($('eprSearch')?.value||'').trim().toLowerCase();
  const rows=state.rows.filter(r=>riskResponseId?r.id===riskResponseId:(!q||`${r.partner_name} ${r.partner_user_name} ${r.comment} ${r.entity_type}`.toLowerCase().includes(q)));
  $('eprOpen').textContent=state.rows.filter(r=>!r.resolved_at).length;$('eprShown').textContent=rows.length;
  $('eprList').innerHTML=rows.length?rows.map(row=>`<article class="epr-row" data-risk-response="${esc(row.id)}">
    <div><h3>${esc(row.partner_name||'Партнёр')}</h3><p>${esc(typeLabel[row.entity_type]||row.entity_type)} · ${esc(row.partner_user_name||'пользователь')} · ${dateTime(row.created_at)}</p><div class="epr-comment">${esc(row.comment||'Комментарий не указан')}</div>${row.resolution_note?`<div class="epr-resolution"><b>Решение HUB:</b> ${esc(row.resolution_note)}<br>${dateTime(row.resolved_at)}</div>`:''}</div>
    <div><span class="epr-badge ${row.resolved_at?'done':'open'}">${row.resolved_at?'Рассмотрено':'Открыто'}</span></div>
    <div><small>ID объекта</small><p>${esc(row.entity_id)}</p></div>
    <div>${row.resolved_at?'':`<button data-resolve="${row.id}">Закрыть расхождение</button>`}</div>
  </article>`).join(''):'<div class="epr-empty">Расхождений по выбранному фильтру нет.</div>';
  if(riskResponseId){const target=[...$('eprList').querySelectorAll('[data-risk-response]')].find(el=>el.dataset.riskResponse===riskResponseId);if(!focusRiskElement(target))showRiskLinkMissing($('eprList'),'Спор из cockpit уже недоступен или закрыт.')}
}

async function handleClick(event){
  const button=event.target.closest('[data-resolve]');if(!button)return;
  const note=prompt('Зафиксируйте результат рассмотрения и договорённость с владельцем:');if(note===null)return;
  const value=note.trim();if(!value){alert('Итоговое решение обязательно.');return}
  button.disabled=true;
  const {error}=await supabase.rpc('resolve_equipment_partner_dispute',{p_response_id:button.dataset.resolve,p_resolution_note:value});
  if(error){alert(friendly(error));button.disabled=false;return}
  await load();
}

function friendly(error){const msg=String(error?.message||error||'Ошибка');if(msg.includes('PERMISSION_DENIED'))return 'Недостаточно прав для просмотра или обработки расхождений.';if(msg.includes('RESOLUTION_NOTE_REQUIRED'))return 'Укажите итог рассмотрения.';if(msg.includes('DISPUTE_ALREADY_RESOLVED'))return 'Это расхождение уже рассмотрено.';return msg;}
