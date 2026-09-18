import{supabase}from'./guard.js?v=20260905-netfix1';

const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=(v,c='RUB')=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:c||'RUB',maximumFractionDigits:2}).format(Number(v||0));
const date=v=>v?new Date(String(v).slice(0,10)+'T00:00:00').toLocaleDateString('ru-RU'):'—';
const dateTime=v=>v?new Date(v).toLocaleString('ru-RU'):'—';
const statusLabel={DRAFT:'Черновик',APPROVED:'Согласовано',PAID:'Выплачено',CANCELLED:'Отменено'};
const basisLabel={RECEIVED_REVENUE:'Полученная выручка',OPERATION_REVENUE:'Выручка операции',NET_AFTER_DIRECT_COSTS:'После прямых расходов'};
const state={rows:[],contracts:new Map(),partners:new Map(),loading:false};

function style(){
  if(document.getElementById('osaAdminStyle'))return;
  const s=document.createElement('style');s.id='osaAdminStyle';s.textContent=`
  .osa-btn{white-space:nowrap}.osa-dlg{width:min(1220px,96vw);max-height:92vh;border:0;border-radius:18px;padding:0;box-shadow:0 24px 80px #0f172a42}
  .osa-dlg::backdrop{background:#0f172a8c}.osa-shell{background:#fff;min-height:420px}.osa-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:18px 20px;border-bottom:1px solid #e2e8f0}
  .osa-head h2{margin:0 0 4px}.osa-head p{margin:0;color:#64748b;font-size:12px}.osa-head button,.osa-toolbar button,.osa-row button{border:1px solid #cbd5e1;background:#fff;border-radius:9px;padding:8px 10px;cursor:pointer}
  .osa-body{padding:18px 20px;overflow:auto;max-height:calc(92vh - 78px)}.osa-toolbar{display:flex;gap:8px;justify-content:flex-end;margin-bottom:12px}
  .osa-list{display:grid;gap:9px}.osa-row{display:grid;grid-template-columns:minmax(0,1.5fr) .85fr .85fr .65fr auto;gap:12px;align-items:center;border:1px solid #e2e8f0;border-radius:13px;padding:12px}
  .osa-row span,.osa-row small{display:block;color:#64748b;font-size:11px}.osa-row b{display:block;margin-top:3px}.osa-pill{display:inline-flex;padding:5px 8px;border-radius:999px;background:#f1f5f9;font-size:11px;font-weight:800}.osa-pill.locked{background:#dcfce7;color:#166534}.osa-pill.preview{background:#fef3c7;color:#92400e}
  .osa-empty{padding:28px;text-align:center;color:#64748b;border:1px dashed #cbd5e1;border-radius:13px}.osa-note{padding:10px 12px;border-radius:10px;margin-bottom:12px;font-size:12px}.osa-note.preview{background:#fff7ed;color:#9a3412}.osa-note.locked{background:#ecfdf5;color:#166534}
  .osa-totals{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-bottom:12px}.osa-totals span{padding:8px 10px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;font-size:11px}.osa-totals b{display:block;margin-top:3px;font-size:13px}
  .osa-table{display:grid;gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}.osa-table>div{display:grid;grid-template-columns:1.5fr 1fr .85fr .85fr .85fr .85fr .85fr;background:#fff}.osa-table>div.head{background:#f8fafc;font-weight:800}
  .osa-table span{padding:9px;font-size:12px;min-width:0}.osa-table small{display:block;color:#64748b;margin-top:3px}.osa-doc{margin-top:12px;padding:10px 12px;background:#eff6ff;border-radius:10px;color:#1e40af;font-size:12px}
  @media(max-width:900px){.osa-row{grid-template-columns:1fr 1fr}.osa-row>div:first-child{grid-column:1/-1}.osa-totals{grid-template-columns:repeat(2,1fr)}.osa-table{overflow:auto}.osa-table>div{min-width:980px}}
  `;document.head.appendChild(s);
}
function install(){
  style();const actions=document.querySelector('.production-top-actions');if(!actions||document.getElementById('osaAdminBtn'))return;
  const b=document.createElement('button');b.id='osaAdminBtn';b.className='osa-btn';b.type='button';b.textContent='📋 Аудит доли';b.onclick=openList;
  const anchor=document.getElementById('farmSettlementsBtn');anchor?.after(b);if(!anchor)actions.appendChild(b);
  const dlg=document.createElement('dialog');dlg.id='osaAdminDlg';dlg.className='osa-dlg';dlg.innerHTML=`<div class="osa-shell"><header class="osa-head"><div><h2>Расшифровка доли владельца</h2><p>Production jobs → выручка / расходы → база → доля владельца / HUB. После согласования snapshot неизменяем.</p></div><button data-osa-close>Закрыть</button></header><div class="osa-body"><div class="osa-toolbar"><button id="osaReload">↻ Обновить</button></div><div id="osaAdminBody" class="osa-list"><div class="osa-empty">Загрузка…</div></div></div></div>`;document.body.appendChild(dlg);
  dlg.querySelector('[data-osa-close]').onclick=()=>dlg.close();document.getElementById('osaReload').onclick=loadList;dlg.addEventListener('click',e=>{const x=e.target.closest('[data-osa-detail]');if(x)openDetail(x.dataset.osaDetail)});
}
async function openList(){document.getElementById('osaAdminDlg').showModal();await loadList()}
async function loadList(){
  if(state.loading)return;state.loading=true;const box=document.getElementById('osaAdminBody');box.innerHTML='<div class="osa-empty">Загрузка…</div>';
  try{
    const[rows,contracts,partners]=await Promise.all([
      supabase.from('equipment_owner_settlements').select('id,contract_id,partner_id,period_start,period_end,status,calculation_basis,split_base,owner_amount,hub_amount,currency,settlement_snapshot,settlement_snapshot_at,settlement_document_id').order('period_end',{ascending:false}).limit(200),
      supabase.from('equipment_contracts').select('id,contract_number').order('contract_number'),
      supabase.from('partners').select('id,name,legal_name')
    ]);
    if(rows.error)throw rows.error;if(contracts.error)throw contracts.error;if(partners.error)throw partners.error;
    state.rows=rows.data||[];state.contracts=new Map((contracts.data||[]).map(x=>[x.id,x]));state.partners=new Map((partners.data||[]).map(x=>[x.id,x]));
    box.innerHTML=state.rows.length?state.rows.map(row).join(''):'<div class="osa-empty">Расчётов доли владельца пока нет.</div>';
  }catch(e){box.innerHTML=`<div class="osa-empty">${esc(e.message||e)}</div>`}finally{state.loading=false}
}
function row(x){const c=state.contracts.get(x.contract_id),p=state.partners.get(x.partner_id),locked=!!x.settlement_snapshot;return `<article class="osa-row"><div><b>${esc(c?.contract_number||x.contract_id)} · ${esc(p?.legal_name||p?.name||'Владелец')}</b><span>${date(x.period_start)} — ${date(x.period_end)} · ${esc(basisLabel[x.calculation_basis]||x.calculation_basis)}</span></div><div><span>База</span><b>${money(x.split_base,x.currency)}</b></div><div><span>Владельцу / HUB</span><b>${money(x.owner_amount,x.currency)} / ${money(x.hub_amount,x.currency)}</b></div><div><span class="osa-pill ${locked?'locked':'preview'}">${locked?'snapshot':'live preview'}</span><small>${esc(statusLabel[x.status]||x.status)}</small></div><button data-osa-detail="${x.id}">${locked?'Раскладка':'Предпросмотр'}</button></article>`}
async function openDetail(id){const box=document.getElementById('osaAdminBody');box.innerHTML='<div class="osa-empty">Расчёт…</div>';try{const{data,error}=await supabase.rpc('get_equipment_owner_settlement_detail',{p_settlement_id:id});if(error)throw error;box.innerHTML=detail(data)+`<div class="osa-toolbar"><button id="osaBack">← К списку</button></div>`;document.getElementById('osaBack').onclick=loadList}catch(e){box.innerHTML=`<div class="osa-empty">${esc(e.message||e)}</div>`}}
function detail(data){const s=data?.snapshot||{},rows=Array.isArray(s.lines)?s.lines:[],currency=data?.currency||s.currency||'RUB',preview=data?.mode==='LIVE_PREVIEW';return `<div class="osa-note ${preview?'preview':'locked'}">${preview?'Предварительный расчёт: строки могут измениться до согласования периода.':'Зафиксированный settlement snapshot'+(data.settlement_snapshot_at?' от '+esc(dateTime(data.settlement_snapshot_at)):'')+'. После согласования header и lines неизменяемы.'}</div><div class="osa-totals"><span>Операции<b>${money(s.gross_revenue,currency)}</b></span><span>Получено<b>${money(s.received_revenue,currency)}</b></span><span>Прямые расходы<b>${money(s.direct_costs,currency)}</b></span><span>База<b>${money(s.split_base,currency)}</b></span><span>Владельцу<b>${money(s.owner_amount,currency)}</b></span><span>HUB<b>${money(s.hub_amount,currency)}</b></span></div>${rows.length?table(rows,currency):'<div class="osa-empty">Нет строк расчёта.</div>'}${data.settlement_document_id?`<div class="osa-doc">Архивный документ расчёта создан · ID ${esc(data.settlement_document_id)}</div>`:''}`}
function table(rows,currency){return `<div class="osa-table"><div class="head"><span>Задание / оборудование</span><span>Заказ / завершено</span><span>Операция</span><span>Получено</span><span>Расходы</span><span>База</span><span>Владелец / HUB</span></div>${rows.map(x=>`<div><span><b>${esc(x.job_title||x.production_job_id)}</b><small>${esc([x.inventory_number,x.equipment_name].filter(Boolean).join(' · ')||x.equipment_id)}</small></span><span>${x.order_number?'№ '+esc(x.order_number):'Без заказа'}<small>${esc(dateTime(x.completed_at))}</small></span><span>${money(x.operation_revenue,currency)}</span><span>${money(x.received_revenue,currency)}</span><span>${money(x.direct_costs,currency)}</span><span><b>${money(x.split_base,currency)}</b></span><span><b>${money(x.owner_amount,currency)}</b><small>HUB ${money(x.hub_amount,currency)}</small></span></div>`).join('')}</div>`}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',install,{once:true}):install();
