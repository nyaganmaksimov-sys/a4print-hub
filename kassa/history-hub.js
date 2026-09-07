(()=>{
  'use strict';
  if(window.__A4_KASSA_HISTORY_HUB__)return;
  window.__A4_KASSA_HISTORY_HUB__=true;

  const cfg=window.A4PRINT_CONFIG||{};
  const createClient=window.supabase?.createClient;
  if(!createClient)return;
  const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
    global:{fetch:window.A4SupabaseFetch||fetch},
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const dt=v=>v?new Date(v).toLocaleString('ru-RU'):'—';
  let rows=[];
  let selected=null;
  let search='';

  function installStyles(){
    if(document.getElementById('a4HistoryHubStyle'))return;
    const style=document.createElement('style');
    style.id='a4HistoryHubStyle';
    style.textContent=`
      #utilityDrawer.a4-history-mode{background:rgba(18,31,45,.3)}
      #utilityDrawer.a4-history-mode .utility-card{width:min(1280px,calc(100vw - 255px));max-width:none}
      #utilityDrawer.a4-history-mode .utility-head{padding:16px 22px}
      #utilityDrawer.a4-history-mode .utility-body{padding:16px 20px;overflow:hidden;background:#f5f8fa}
      .a4-history-shell{display:grid;grid-template-columns:minmax(360px,38%) minmax(520px,62%);gap:16px;height:calc(100vh - 105px);min-height:0;width:100%;max-width:none}
      .a4-history-left,.a4-history-detail{min-width:0;min-height:0}
      .a4-history-left{display:flex;flex-direction:column}
      .a4-history-search{display:flex;gap:8px;margin-bottom:12px;flex:0 0 auto}.a4-history-search input{width:100%;padding:12px 14px;border:1px solid #d6dfeb;border-radius:10px;font:inherit;outline:none;background:#fff}.a4-history-search input:focus{border-color:#10aeb9;box-shadow:0 0 0 3px rgba(16,174,185,.12)}.a4-history-search .utility-action{width:48px;min-width:48px;margin:0;text-align:center;border-radius:10px}
      .a4-history-list{display:grid;align-content:start;gap:8px;overflow:auto;padding:0 4px 4px 0;min-height:0;flex:1}.a4-history-row{border:1px solid #dbe3ec;background:#fff;border-radius:11px;padding:13px 14px;text-align:left;cursor:pointer;font:inherit;color:#10213a;min-height:78px}.a4-history-row:hover,.a4-history-row.active{border-color:#10aeb9;background:#f1fcfd}.a4-history-row.active{box-shadow:inset 4px 0 0 #10aeb9}.a4-history-row-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.a4-history-row-top b{font-size:15px}.a4-history-row-top strong{font-size:16px;white-space:nowrap}.a4-history-row small{display:block;color:#718097;margin-top:5px;line-height:1.35}.a4-history-return{color:#c33!important;font-weight:700}
      .a4-history-detail{border:1px solid #dbe3ec;border-radius:12px;background:#fff;padding:20px 22px;overflow:auto;height:100%}.a4-history-empty{display:grid;place-items:center;min-height:320px;color:#7b899e;text-align:center}.a4-history-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;border-bottom:1px solid #e7ecf2;padding-bottom:16px;margin-bottom:16px}.a4-history-head h3{margin:0;font-size:25px}.a4-history-head p{margin:5px 0 0;color:#718097}.a4-history-total{font-size:27px;font-weight:850;white-space:nowrap}
      .a4-history-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 18px;background:#f7f9fc;border:1px solid #e4e9f0;border-radius:11px;padding:15px 16px;margin-bottom:16px}.a4-history-meta span{display:block;font-size:12px;color:#8491a4;margin-bottom:4px}.a4-history-meta b{display:block;overflow-wrap:anywhere;font-size:14px}
      .a4-history-items{display:grid;gap:0;border-top:1px solid #e8edf3}.a4-history-item{display:flex;justify-content:space-between;gap:18px;padding:13px 2px;border-bottom:1px solid #e8edf3}.a4-history-item div{min-width:0}.a4-history-item b{display:block;font-size:14px}.a4-history-item small{color:#718097;display:block;margin-top:3px}.a4-history-item strong{white-space:nowrap;font-size:14px}.a4-history-actions{display:flex;gap:10px;margin-top:18px}.a4-history-actions button{flex:1;padding:13px 14px;border-radius:10px;border:1px solid #d5dfea;background:#fff;font:inherit;font-weight:750;cursor:pointer}.a4-history-actions .primary{background:#10aeb9;color:#fff;border-color:#10aeb9}
      .a4-history-summary{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:15px 0 0;font-size:18px}.a4-history-summary strong{font-size:25px}.a4-history-note{font-size:12px;color:#718097;margin-top:10px}
      @media(max-width:1180px){#utilityDrawer.a4-history-mode .utility-card{width:calc(100vw - 90px)}.a4-history-shell{grid-template-columns:minmax(320px,42%) minmax(430px,58%)}.a4-history-meta{grid-template-columns:1fr 1fr}}
      @media(max-width:900px){#utilityDrawer.a4-history-mode .utility-card{width:100vw}.a4-history-shell{grid-template-columns:1fr;height:auto;min-height:calc(100vh - 120px)}#utilityDrawer.a4-history-mode .utility-body{overflow:auto}.a4-history-list{max-height:42vh}.a4-history-detail{height:auto;min-height:420px}.a4-history-meta{grid-template-columns:1fr 1fr}}
      @media(max-width:600px){.a4-history-meta{grid-template-columns:1fr}.a4-history-head{flex-direction:column}.a4-history-total{font-size:24px}}
      @media print{body>*{display:none!important}#a4HistoryPrint{display:block!important}}
    `;
    document.head.appendChild(style);
  }

  function openDrawer(){
    installStyles();
    const drawer=$('utilityDrawer');
    if(!drawer)return false;
    drawer.classList.add('a4-history-mode');
    $('utilityTitle').textContent='История чеков';
    $('utilitySubtitle').textContent='A4PRINT HUB · синхронизированные продажи';
    drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');
    return true;
  }

  function rowHaystack(r){
    return `${r.sale_name||''} ${r.operator||''} ${r.customer||''} ${r.payment_method||''} ${r.total||''} ${(r.items||[]).map(i=>`${i.name||''} ${i.article||''}`).join(' ')}`.toLowerCase();
  }

  function visibleRows(){
    const q=search.trim().toLowerCase();
    return q?rows.filter(r=>rowHaystack(r).includes(q)):rows;
  }

  function render(){
    const body=$('utilityBody');if(!body)return;
    const list=visibleRows();
    if(selected&&!rows.some(x=>String(x.id)===String(selected.id)))selected=null;
    body.innerHTML=`<div class="a4-history-shell"><section class="a4-history-left"><div class="a4-history-search"><input id="a4HistorySearch" value="${esc(search)}" placeholder="Номер чека, покупатель, оператор, товар…"><button id="a4HistoryReload" class="utility-action" type="button" title="Обновить историю">↻</button></div><div class="a4-history-list">${list.map(r=>`<button class="a4-history-row ${selected?.id===r.id?'active':''}" data-a4-history-id="${esc(r.id)}" type="button"><div class="a4-history-row-top"><b>Чек ${esc(r.sale_name||'—')}</b><strong>${money(r.total)}</strong></div><small>${dt(r.sold_at)} · ${esc(r.operator||'Оператор')} · ${esc(r.payment_method||'—')}</small>${Number(r.returned_total||0)>0?`<small class="a4-history-return">Возвращено: ${money(r.returned_total)}</small>`:''}</button>`).join('')||'<div class="a4-history-empty">Чеки не найдены</div>'}</div></section><section id="a4HistoryDetail" class="a4-history-detail">${detailHtml(selected)}</section></div>`;
    const input=$('a4HistorySearch');if(input){input.oninput=()=>{search=input.value;render()};setTimeout(()=>{if(document.activeElement?.id==='a4HistorySearch')input.focus()},0)}
    $('a4HistoryReload')?.addEventListener('click',()=>load(true));
    document.querySelectorAll('[data-a4-history-id]').forEach(b=>b.onclick=()=>{selected=rows.find(x=>String(x.id)===String(b.dataset.a4HistoryId))||null;render()});
    $('a4HistoryPrint')?.addEventListener('click',()=>printReceipt(selected));
  }

  function detailHtml(r){
    if(!r)return '<div class="a4-history-empty"><div><b>Выберите чек слева</b><br><span>Здесь появится состав продажи и повторная печать.</span></div></div>';
    const items=Array.isArray(r.items)?r.items:[];
    return `<div class="a4-history-head"><div><h3>Чек ${esc(r.sale_name||'—')}</h3><p>${dt(r.sold_at)}</p></div><div class="a4-history-total">${money(r.total)}</div></div><div class="a4-history-meta"><div><span>Оператор</span><b>${esc(r.operator||'—')}</b></div><div><span>Покупатель</span><b>${esc(r.customer||'Не указан')}</b></div><div><span>Оплата</span><b>${esc(r.payment_method||'—')}</b></div><div><span>Смена</span><b>${esc(r.shift_name||r.shift_id||'—')}</b></div><div><span>Счёт</span><b>${esc(r.cash_account||'—')}</b></div><div><span>Статус</span><b>${esc(r.sync_status||'SYNCED')}</b></div></div><div class="a4-history-items">${items.map(i=>{const qty=Number(i.qty??i.quantity??0);const price=Number(i.price||0);return `<div class="a4-history-item"><div><b>${esc(i.name||'Позиция')}</b><small>${qty.toLocaleString('ru-RU')} × ${money(price)}</small></div><strong>${money(qty*price)}</strong></div>`}).join('')||'<div class="a4-history-empty" style="min-height:120px">Состав чека не сохранён</div>'}</div>${Number(r.returned_total||0)>0?`<div class="a4-history-summary"><span>Возвращено</span><strong style="color:#c33">−${money(r.returned_total)}</strong></div>`:''}<div class="a4-history-summary"><span>Итого по продаже</span><strong>${money(r.total)}</strong></div><div class="a4-history-actions"><button id="a4HistoryPrint" class="primary" type="button">Печать чека</button></div><div class="a4-history-note">Данные загружены из A4PRINT HUB и доступны на любом рабочем месте с правами кассы.</div>`;
  }

  function printReceipt(r){
    if(!r)return;
    const items=Array.isArray(r.items)?r.items:[];
    const w=window.open('','_blank','width=520,height=720');if(!w)return;
    const itemHtml=items.map(i=>{const qty=Number(i.qty??i.quantity??0);const price=Number(i.price||0);return `<tr><td>${esc(i.name||'Позиция')}<br><small>${qty.toLocaleString('ru-RU')} × ${money(price)}</small></td><td style="text-align:right;white-space:nowrap">${money(qty*price)}</td></tr>`}).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Чек ${esc(r.sale_name||'')}</title><style>body{font-family:Arial,sans-serif;color:#111;margin:24px;max-width:390px}h1{font-size:20px;margin:0 0 4px}p{margin:4px 0;color:#444}.meta{border-top:1px dashed #999;border-bottom:1px dashed #999;padding:10px 0;margin:12px 0;font-size:13px}.meta div{display:flex;justify-content:space-between;gap:12px;margin:4px 0}table{width:100%;border-collapse:collapse}td{padding:9px 0;border-bottom:1px solid #ddd;vertical-align:top}.total{display:flex;justify-content:space-between;font-size:22px;font-weight:700;margin-top:14px}.foot{text-align:center;margin-top:20px;font-size:12px;color:#666}@media print{button{display:none}}</style></head><body><h1>A4PRINT KASSA</h1><p>Чек ${esc(r.sale_name||'—')}</p><div class="meta"><div><span>Дата</span><b>${dt(r.sold_at)}</b></div><div><span>Оператор</span><b>${esc(r.operator||'—')}</b></div><div><span>Оплата</span><b>${esc(r.payment_method||'—')}</b></div><div><span>Смена</span><b>${esc(r.shift_name||r.shift_id||'—')}</b></div>${r.customer?`<div><span>Покупатель</span><b>${esc(r.customer)}</b></div>`:''}</div><table>${itemHtml}</table><div class="total"><span>Итого</span><span>${money(r.total)}</span></div>${Number(r.returned_total||0)>0?`<p style="color:#b22;text-align:right">Возвращено: ${money(r.returned_total)}</p>`:''}<div class="foot">A4PRINT HUB · МойСклад</div><script>window.onload=()=>{window.print()}<\/script></body></html>`);w.document.close();
  }

  async function load(force=false){
    const body=$('utilityBody');if(!body)return;
    if(!rows.length||force)body.innerHTML='<div class="a4-history-empty">Загрузка истории из A4PRINT HUB…</div>';
    const result=await supabase.rpc('get_pos_receipt_history',{p_limit:150,p_search:null});
    if(result.error){body.innerHTML=`<div class="a4-history-empty"><div><b>Не удалось загрузить историю</b><br><span>${esc(result.error.message||'Ошибка')}</span></div></div>`;return}
    rows=Array.isArray(result.data)?result.data:[];
    if(selected)selected=rows.find(x=>String(x.id)===String(selected.id))||null;
    render();
  }

  function openHistory(event){
    if(event){event.preventDefault();event.stopImmediatePropagation()}
    document.getElementById('appView')?.classList.remove('nav-open');
    if(!openDrawer())return;
    document.querySelectorAll('.main-nav .nav-item').forEach(x=>x.classList.remove('active'));
    $('navHistory')?.classList.add('active');
    load(false).catch(err=>{const b=$('utilityBody');if(b)b.innerHTML=`<div class="a4-history-empty">${esc(err?.message||err)}</div>`});
  }

  document.addEventListener('click',event=>{
    if(event.target?.closest?.('#navHistory')){openHistory(event);return}
    if(event.target?.closest?.('#navHeld,#navSettings,#navHelp'))$('utilityDrawer')?.classList.remove('a4-history-mode');
  },true);
})();
