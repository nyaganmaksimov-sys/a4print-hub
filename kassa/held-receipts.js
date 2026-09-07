(()=>{
  'use strict';
  if(window.__A4_KASSA_HELD_RECEIPTS__)return;
  window.__A4_KASSA_HELD_RECEIPTS__=true;

  const DB=window.A4KassaDB;
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const dt=v=>v?new Date(v).toLocaleString('ru-RU'):'—';
  let pollTimer=null;

  function stageLabel(row){if(row.stage==='backend_done')return 'Создан в МойСклад · сохраняется в HUB';if(row.last_error)return 'Ошибка отправки';return 'Ожидает отправки'}
  function stageClass(row){return row.last_error?'bad':row.stage==='backend_done'?'work':'wait'}
  function installStyles(){
    if($('a4HeldStyle'))return;
    const st=document.createElement('style');st.id='a4HeldStyle';st.textContent=`
      #utilityDrawer.a4-held-mode .utility-card{width:min(920px,calc(100vw - 255px));max-width:none}#utilityDrawer.a4-held-mode .utility-body{background:#f5f8fa;padding:18px 20px}
      .a4-held-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}.a4-held-stat{background:#fff;border:1px solid #dde5ed;border-radius:12px;padding:14px}.a4-held-stat span{display:block;color:#7d8ba0;font-size:12px}.a4-held-stat strong{display:block;font-size:23px;margin-top:4px;color:#14243c}
      .a4-held-actions{display:flex;gap:10px;margin-bottom:14px}.a4-held-actions button{border:1px solid #d5dfea;background:#fff;border-radius:10px;padding:11px 15px;font-weight:750;cursor:pointer}.a4-held-actions .primary{background:#0aaeba;color:#fff;border-color:#0aaeba}.a4-held-actions button:disabled{opacity:.55;cursor:not-allowed}
      .a4-held-list{display:grid;gap:10px}.a4-held-row{background:#fff;border:1px solid #dde5ed;border-radius:12px;padding:14px 16px}.a4-held-row.bad{border-color:#f0b4b0;background:#fffafa}.a4-held-row.work{border-color:#a8dfe4}.a4-held-top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.a4-held-top b{font-size:15px}.a4-held-top strong{font-size:18px;white-space:nowrap}.a4-held-meta{display:flex;flex-wrap:wrap;gap:6px 12px;color:#6f7e92;font-size:12px;margin-top:7px}.a4-held-status{display:inline-flex;align-items:center;gap:6px;margin-top:9px;font-size:12px;font-weight:750}.a4-held-status:before{content:'';width:8px;height:8px;border-radius:50%;background:#f2a51a}.a4-held-row.bad .a4-held-status{color:#b42318}.a4-held-row.bad .a4-held-status:before{background:#d92d20}.a4-held-row.work .a4-held-status{color:#087f89}.a4-held-row.work .a4-held-status:before{background:#0aaeba}.a4-held-error{margin-top:8px;color:#b42318;font-size:12px;line-height:1.4;word-break:break-word}.a4-held-items{margin-top:9px;padding-top:9px;border-top:1px solid #edf1f5;color:#5f6d7d;font-size:12px}.a4-held-empty{background:#fff;border:1px solid #dde5ed;border-radius:14px;padding:50px 20px;text-align:center;color:#718096}.a4-held-empty b{display:block;font-size:20px;color:#152238;margin-bottom:6px}
      @media(max-width:900px){#utilityDrawer.a4-held-mode .utility-card{width:100vw}.a4-held-summary{grid-template-columns:1fr}.a4-held-actions{flex-direction:column}}
    `;document.head.appendChild(st)
  }
  function openDrawer(){installStyles();const drawer=$('utilityDrawer');if(!drawer)return false;drawer.classList.remove('a4-history-mode');drawer.classList.add('a4-held-mode');$('utilityTitle').textContent='Отложенные чеки';$('utilitySubtitle').textContent='Локальная очередь · отправка в МойСклад и A4PRINT HUB';drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');return true}
  async function rows(){const list=DB?await DB.getAll('queue'):[];return list.sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')))}
  function itemNames(row){const list=Array.isArray(row.items)?row.items:[];return list.slice(0,4).map(i=>`${esc(i.name||'Позиция')} × ${Number(i.qty||0).toLocaleString('ru-RU')}`).join(' · ')+(list.length>4?` · ещё ${list.length-4}`:'')}
  async function render(){
    const body=$('utilityBody');if(!body)return;const list=await rows();const total=list.reduce((s,x)=>s+Number(x.total||0),0);const errors=list.filter(x=>x.last_error).length;const inHub=list.filter(x=>x.stage==='backend_done').length;
    body.innerHTML=`<div class="a4-held-summary"><div class="a4-held-stat"><span>В очереди</span><strong>${list.length}</strong></div><div class="a4-held-stat"><span>Сумма чеков</span><strong>${money(total)}</strong></div><div class="a4-held-stat"><span>Требуют внимания</span><strong>${errors}${inHub?` · ${inHub} на финальном этапе`:''}</strong></div></div><div class="a4-held-actions"><button id="a4HeldRetry" class="primary" type="button" ${list.length?'':'disabled'}>↻ Повторить синхронизацию</button><button id="a4HeldRefresh" type="button">Обновить список</button></div><div class="a4-held-list">${list.length?list.map(x=>`<article class="a4-held-row ${stageClass(x)}"><div class="a4-held-top"><div><b>${dt(x.created_at)}</b><div class="a4-held-meta"><span>${esc(x.operator_name||'Оператор')}</span><span>${esc(x.payment_method||'Оплата не указана')}</span><span>Попыток: ${Number(x.tries||0)}</span></div></div><strong>${money(x.total)}</strong></div><div class="a4-held-status">${stageLabel(x)}</div>${x.last_error?`<div class="a4-held-error">${esc(x.last_error)}</div>`:''}${x.items?.length?`<div class="a4-held-items">${itemNames(x)}</div>`:''}</article>`).join(''):`<div class="a4-held-empty"><b>Все чеки синхронизированы</b><span>Локальная очередь пуста. Ничего отправлять не нужно.</span></div>`}</div>`;
    $('a4HeldRefresh')?.addEventListener('click',render);$('a4HeldRetry')?.addEventListener('click',retry)
  }
  async function retry(){const btn=$('a4HeldRetry');if(btn){btn.disabled=true;btn.textContent='Синхронизация…'}$('retryQueue')?.click();clearInterval(pollTimer);let ticks=0;pollTimer=setInterval(async()=>{ticks++;await render().catch(()=>{});const list=await rows().catch(()=>[]);if(!list.length||ticks>=20){clearInterval(pollTimer);pollTimer=null}},750)}
  function openHeld(event){if(event){event.preventDefault();event.stopImmediatePropagation()}document.getElementById('appView')?.classList.remove('nav-open');if(!openDrawer())return;document.querySelectorAll('.main-nav .nav-item').forEach(x=>x.classList.remove('active'));$('navHeld')?.classList.add('active');const body=$('utilityBody');if(body)body.innerHTML='<div class="a4-held-empty">Читаю локальную очередь…</div>';render().catch(e=>{if(body)body.innerHTML=`<div class="a4-held-empty"><b>Не удалось открыть очередь</b><span>${esc(e?.message||e)}</span></div>`})}
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('#navHeld'))openHeld(event);
    else if(event.target?.closest?.('#navSettings,#navHelp'))$('utilityDrawer')?.classList.remove('a4-held-mode','a4-history-mode');
    else if(event.target?.closest?.('#navHistory'))$('utilityDrawer')?.classList.remove('a4-held-mode');
  },true)
})();
