import{supabase}from'./guard.js?v=20260905-netfix1';

const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=(v,c='RUB')=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:c||'RUB',maximumFractionDigits:2}).format(Number(v||0));
const date=v=>v?new Date(String(v).slice(0,10)+'T00:00:00').toLocaleDateString('ru-RU'):'—';
const dateTime=v=>v?new Date(v).toLocaleString('ru-RU'):'—';
const statusLabel={DRAFT:'Черновик',APPROVED:'Согласовано',PAID:'Оплачено',CANCELLED:'Отменено'};
const state={charges:[],contracts:new Map(),loading:false};

function style(){
  if(document.getElementById('elaAdminStyle'))return;
  const s=document.createElement('style');s.id='elaAdminStyle';s.textContent=`
  .ela-btn{white-space:nowrap}.ela-dlg{width:min(1160px,96vw);max-height:92vh;border:0;border-radius:18px;padding:0;box-shadow:0 24px 80px #0f172a42}
  .ela-dlg::backdrop{background:#0f172a8c}.ela-shell{background:#fff;min-height:420px}.ela-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:18px 20px;border-bottom:1px solid #e2e8f0}
  .ela-head h2,.ela-head h3{margin:0 0 4px}.ela-head p{margin:0;color:#64748b;font-size:12px}.ela-head button{border:1px solid #cbd5e1;background:#fff;border-radius:9px;padding:8px 11px;cursor:pointer}
  .ela-body{padding:18px 20px;overflow:auto;max-height:calc(92vh - 78px)}.ela-toolbar{display:flex;gap:8px;justify-content:flex-end;margin-bottom:12px}.ela-toolbar button,.ela-row button{border:1px solid #cbd5e1;background:#fff;border-radius:9px;padding:8px 10px;cursor:pointer}
  .ela-list{display:grid;gap:9px}.ela-row{display:grid;grid-template-columns:minmax(0,1.5fr) 1fr .7fr .6fr auto;gap:12px;align-items:center;border:1px solid #e2e8f0;border-radius:13px;padding:12px}
  .ela-row span,.ela-row small{display:block;color:#64748b;font-size:11px}.ela-row b{display:block;margin-top:3px}.ela-pill{display:inline-flex;padding:5px 8px;border-radius:999px;background:#f1f5f9;font-size:11px;font-weight:800}.ela-pill.locked{background:#dcfce7;color:#166534}.ela-pill.preview{background:#fef3c7;color:#92400e}
  .ela-empty{padding:28px;text-align:center;color:#64748b;border:1px dashed #cbd5e1;border-radius:13px}.ela-note{padding:10px 12px;border-radius:10px;margin-bottom:12px;font-size:12px}.ela-note.preview{background:#fff7ed;color:#9a3412}.ela-note.locked{background:#ecfdf5;color:#166534}
  .ela-totals{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:12px}.ela-totals span{padding:8px 10px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px}.ela-table{display:grid;gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
  .ela-table>div{display:grid;grid-template-columns:1.5fr .8fr .7fr .7fr .8fr .8fr;background:#fff}.ela-table>div.head{background:#f8fafc;font-weight:800}.ela-table span{padding:9px;font-size:12px;min-width:0}.ela-table small{display:block;color:#64748b;margin-top:3px}.ela-doc{margin-top:12px;padding:10px 12px;background:#eff6ff;border-radius:10px;color:#1e40af;font-size:12px}
  @media(max-width:800px){.ela-row{grid-template-columns:1fr 1fr}.ela-row>div:first-child{grid-column:1/-1}.ela-table{overflow:auto}.ela-table>div{min-width:850px}}
  `;document.head.appendChild(s);
}
function install(){
  style();const actions=document.querySelector('.topbar .eq-actions');if(!actions||document.getElementById('elaAdminBtn'))return;
  const b=document.createElement('button');b.id='elaAdminBtn';b.className='ela-btn';b.type='button';b.textContent='📊 Раскладка аренды';b.onclick=openList;
  const anchor=document.getElementById('farmBuyoutBtn');anchor?.after(b);if(!anchor)actions.appendChild(b);
  const dlg=document.createElement('dialog');dlg.id='elaAdminDlg';dlg.className='ela-dlg';dlg.innerHTML=`<div class="ela-shell"><header class="ela-head"><div><h2>Раскладка аренды по оборудованию</h2><p>Active days × allocation weight. После согласования расчёт фиксируется immutable snapshot.</p></div><button data-ela-close>Закрыть</button></header><div class="ela-body"><div class="ela-toolbar"><button id="elaReload">↻ Обновить</button></div><div id="elaAdminBody" class="ela-list"><div class="ela-empty">Загрузка…</div></div></div></div>`;document.body.appendChild(dlg);
  dlg.querySelector('[data-ela-close]').onclick=()=>dlg.close();document.getElementById('elaReload').onclick=loadList;dlg.addEventListener('click',e=>{const x=e.target.closest('[data-ela-detail]');if(x)openDetail(x.dataset.elaDetail)});
}
async function openList(){const dlg=document.getElementById('elaAdminDlg');dlg.showModal();await loadList()}
async function loadList(){
  if(state.loading)return;state.loading=true;const box=document.getElementById('elaAdminBody');box.innerHTML='<div class="ela-empty">Загрузка…</div>';
  try{
    const[charges,contracts]=await Promise.all([
      supabase.from('equipment_lease_charges').select('id,contract_id,period_start,period_end,amount,buyout_credit_amount,status,currency,allocation_snapshot,allocation_snapshot_at,allocation_document_id').eq('charge_type','LEASE').order('period_end',{ascending:false}).limit(200),
      supabase.from('equipment_contracts').select('id,contract_number').order('contract_number')
    ]);
    if(charges.error)throw charges.error;if(contracts.error)throw contracts.error;state.charges=charges.data||[];state.contracts=new Map((contracts.data||[]).map(x=>[x.id,x]));
    box.innerHTML=state.charges.length?state.charges.map(row).join(''):'<div class="ela-empty">Арендных начислений пока нет.</div>';
  }catch(e){box.innerHTML=`<div class="ela-empty">${esc(e.message||e)}</div>`}finally{state.loading=false}
}
function row(x){const c=state.contracts.get(x.contract_id);const locked=!!x.allocation_snapshot;return `<article class="ela-row"><div><b>${esc(c?.contract_number||x.contract_id)}</b><span>${date(x.period_start)} — ${date(x.period_end)}</span></div><div><span>Начислено</span><b>${money(x.amount,x.currency)}</b><small>в выкуп ${money(x.buyout_credit_amount,x.currency)}</small></div><div><span>Статус</span><b>${esc(statusLabel[x.status]||x.status)}</b></div><div><span class="ela-pill ${locked?'locked':'preview'}">${locked?'snapshot':'live preview'}</span></div><button data-ela-detail="${x.id}">${locked?'Раскладка':'Предпросмотр'}</button></article>`}
async function openDetail(id){
  const box=document.getElementById('elaAdminBody');box.innerHTML='<div class="ela-empty">Расчёт…</div>';
  try{const{data,error}=await supabase.rpc('get_equipment_lease_charge_allocation',{p_charge_id:id});if(error)throw error;box.innerHTML=detail(data)+`<div class="ela-toolbar"><button id="elaBack">← К списку</button></div>`;document.getElementById('elaBack').onclick=loadList}catch(e){box.innerHTML=`<div class="ela-empty">${esc(e.message||e)}</div>`}
}
function detail(data){const s=data?.snapshot||{},rows=Array.isArray(s.allocations)?s.allocations:[],currency=data?.currency||s.currency||'RUB';const preview=data?.mode==='LIVE_PREVIEW';return `<div class="ela-note ${preview?'preview':'locked'}">${preview?'Предварительный расчёт: ещё не является финансовым snapshot.':'Зафиксированный snapshot'+(data.allocation_snapshot_at?' от '+esc(dateTime(data.allocation_snapshot_at)):'')+'. После согласования начисления он неизменяем.'}</div><div class="ela-totals"><span>Договор <b>${esc(data.contract_number||'—')}</b></span><span>Период <b>${date(data.period_start)} — ${date(data.period_end)}</b></span><span>Начислено <b>${money(s.allocated_amount_total??data.amount,currency)}</b></span><span>В выкуп <b>${money(s.allocated_buyout_credit_total??data.buyout_credit_amount,currency)}</b></span></div>${rows.length?table(rows,currency):'<div class="ela-empty">Нет строк распределения.</div>'}${data.allocation_document_id?`<div class="ela-doc">Архивный документ начисления создан · ID ${esc(data.allocation_document_id)}</div>`:''}`}
function table(rows,currency){return `<div class="ela-table"><div class="head"><span>Оборудование</span><span>Активность</span><span>Вес</span><span>Доля</span><span>Аренда</span><span>В выкуп</span></div>${rows.map(x=>`<div><span><b>${esc([x.inventory_number,x.equipment_name].filter(Boolean).join(' · ')||x.equipment_id)}</b><small>${esc([x.brand,x.model].filter(Boolean).join(' ')||'')}</small></span><span><b>${Number(x.active_days||0)} дн.</b><small>${Number(x.period_count||0)} период(а)</small></span><span>${Number(x.effective_weight||0).toLocaleString('ru-RU',{maximumFractionDigits:2})}</span><span>${(Number(x.allocation_ratio||0)*100).toFixed(2)}%</span><span><b>${money(x.allocated_amount,currency)}</b></span><span>${money(x.allocated_buyout_credit_amount,currency)}</span></div>`).join('')}</div>`}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',install,{once:true}):install();
