(()=>{
  'use strict';

  const cfg=window.A4PRINT_CONFIG||{};
  const createClient=window.supabase?.createClient;
  if(!createClient)return;
  const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
    global:{fetch:window.A4SupabaseFetch||fetch},
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})+' ₽';
  const dt=v=>v?new Date(v).toLocaleString('ru-RU'):'—';

  const state={section:'sale',session:null,profile:null,isAdmin:false,accounts:[],operators:[],referenceReady:false,referencePromise:null,returnSales:[],selectedReturn:null,reportPeriod:'today'};
  let noticeTimer=null;

  function notify(text,error=false){
    const n=$('toast');if(!n)return;
    n.textContent=text;n.className='toast show'+(error?' error':'');
    clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>n.className='toast',3600);
  }
  function friendly(e,fallback='Ошибка'){
    const m=String(e?.message||e||'').trim();if(!m)return fallback;
    if(/open.*shift|открыт.*смен|retail.*shift/i.test(m))return'Для возврата нужна открытая смена. Откройте смену в кассе и повторите.';
    if(/failed to fetch|network|abort|socket/i.test(m))return'Нет связи с сервером.';
    if(/POS_ACCESS_REQUIRED|403/i.test(m))return'Нет доступа к этой операции.';
    return m;
  }

  async function getSession(){
    const r=await supabase.auth.getSession();
    state.session=r.data?.session||null;
    if(!state.session)throw new Error('Сессия завершена. Войдите снова.');
    return state.session;
  }
  async function api(path,opt={},retry=true){
    let s=await getSession();
    const run=async()=>{
      const r=await fetch(API+path,{...opt,cache:'no-store',headers:{Authorization:`Bearer ${s.access_token}`,'Content-Type':'application/json','Accept':'application/json',...(opt.headers||{})}});
      const text=await r.text();let d={};try{d=text?JSON.parse(text):{}}catch{}
      if(r.status===401&&retry){const rr=await supabase.auth.refreshSession();if(rr.data?.session){state.session=s=rr.data.session;return api(path,opt,false)}}
      if(!r.ok)throw new Error(d.message||d.error||`HTTP ${r.status}`);
      return d;
    };
    return run();
  }

  async function loadReferenceData(){
    if(state.referenceReady)return;
    if(state.referencePromise)return state.referencePromise;
    state.referencePromise=(async()=>{
      const s=await getSession();
      const [admin,profile,org]=await Promise.all([
        supabase.rpc('has_role',{required_role:'ADMIN'}),
        supabase.from('users').select('id,full_name,email,is_active').eq('auth_user_id',s.user.id).maybeSingle(),
        supabase.from('organizations').select('id').eq('code','A4PRINT').single()
      ]);
      if(admin.error)throw admin.error;if(profile.error)throw profile.error;if(org.error)throw org.error;
      state.isAdmin=!!admin.data;state.profile=profile.data;
      const [accounts,operators]=await Promise.all([
        supabase.from('cash_accounts').select('id,name,account_type,is_active').eq('organization_id',org.data.id).eq('is_active',true).order('name'),
        supabase.rpc('get_pos_operators')
      ]);
      if(accounts.error)throw accounts.error;if(operators.error)throw operators.error;
      state.accounts=accounts.data||[];state.operators=operators.data||[];
      fillReportOperators();state.referenceReady=true;
    })().finally(()=>{state.referencePromise=null});
    return state.referencePromise;
  }

  function fillReportOperators(){
    const el=$('reportOperator');if(!el)return;
    const own=state.operators.find(x=>x.is_self)?.id||state.profile?.id||'';
    if(state.isAdmin){
      const prev=el.value;el.innerHTML='<option value="">Все операторы</option>'+state.operators.map(x=>`<option value="${x.id}">${esc(x.full_name)}</option>`).join('');
      if([...el.options].some(x=>x.value===prev))el.value=prev;el.hidden=false;
    }else{
      const me=state.operators.find(x=>x.id===own);el.innerHTML=`<option value="${own}">${esc(me?.full_name||state.profile?.full_name||'Мои продажи')}</option>`;el.value=own;el.hidden=true;
    }
  }

  function showSection(name){
    state.section=name;
    document.querySelectorAll('[data-section]').forEach(b=>b.classList.toggle('active',b.dataset.section===name));
    $('saleSidebar').hidden=name!=='sale';$('saleCatalog').hidden=name!=='sale';$('saleCart').hidden=name!=='sale';$('topSearch').hidden=name!=='sale';
    $('returnsView').hidden=name!=='returns';$('reportsView').hidden=name!=='reports';
    if(name==='returns')loadReturnSales().catch(e=>notify(friendly(e),true));
    if(name==='reports')loadReport(state.reportPeriod).catch(e=>notify(friendly(e),true));
  }

  async function loadReturnSales(){
    await loadReferenceData();
    $('returnsSales').innerHTML='<div class="module-empty">Загрузка продаж…</div>';
    const d=await api('/api/v1/pos/returns/sales');
    state.returnSales=d.sales||[];renderReturnSales();
  }
  function renderReturnSales(){
    const q=String($('returnsSearch').value||'').trim().toLowerCase();
    const rows=state.returnSales.filter(x=>`${x.name||''} ${x.description||''} ${x.sum||''} ${x.moment||''}`.toLowerCase().includes(q));
    $('returnsSales').innerHTML=rows.map(x=>`<button class="return-sale ${state.selectedReturn?.id===x.id?'active':''}" data-return-sale="${x.id}" type="button"><div class="return-sale-row"><b>${esc(x.name||x.id)}</b><strong>${money(x.sum)}</strong></div><small>${x.moment?dt(x.moment):''}${x.description?` · ${esc(x.description)}`:''}</small></button>`).join('')||'<div class="module-empty">Продажи не найдены</div>';
    document.querySelectorAll('[data-return-sale]').forEach(b=>b.onclick=()=>loadReturnSale(b.dataset.returnSale));
  }
  async function loadReturnSale(id){
    $('returnDetail').innerHTML='<div class="module-empty">Загрузка позиций…</div>';
    const d=await api('/api/v1/pos/returns/sales/'+encodeURIComponent(id));
    state.selectedReturn=d.sale||null;renderReturnSales();renderReturnDetail();
  }
  function renderReturnDetail(){
    const sale=state.selectedReturn;
    if(!sale){$('returnSaleLabel').textContent='Продажа не выбрана';$('returnDetail').innerHTML='<div class="module-empty">Выберите продажу слева</div>';return}
    $('returnSaleLabel').textContent=`Продажа ${sale.name||sale.id}`;
    const positions=Array.isArray(sale.positions)?sale.positions:[];
    const available=positions.filter(p=>Number(p.quantity||0)>0);
    if(!available.length){$('returnDetail').innerHTML='<div class="module-empty">Все позиции этой продажи уже возвращены</div>';return}
    $('returnDetail').innerHTML=`
      <div>${available.map(p=>`<div class="return-position"><div><b>${esc(p.name||'Позиция')}</b><small>Доступно: ${Number(p.quantity||0).toLocaleString('ru-RU')} × ${money(p.price)}${Number(p.returned_quantity||0)>0?` · уже возвращено ${Number(p.returned_quantity).toLocaleString('ru-RU')}`:''}</small></div><label class="return-qty">Вернуть <input data-return-qty="${esc(p.id)}" type="number" min="0" max="${Number(p.quantity||0)}" step="1" value="0"></label></div>`).join('')}</div>
      <div class="return-fields">
        <label class="module-field">Счёт возврата<select id="returnAccount">${state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>
        <label class="module-field">Способ возврата<select id="returnMethod"><option>Наличные</option><option>Карта</option><option>СБП</option><option>Банк</option></select></label>
        <label class="module-field full">Причина возврата<textarea id="returnReason" placeholder="Например: брак, ошибка в заказе, отказ клиента…"></textarea></label>
      </div>
      <div class="return-total"><span>К возврату</span><strong id="returnTotal">0 ₽</strong></div>
      <div class="return-actions"><button id="returnAll" class="btn light" type="button">Вернуть всё</button><button id="submitReturn" class="btn primary" type="button">Провести возврат</button></div>`;
    document.querySelectorAll('[data-return-qty]').forEach(i=>i.oninput=calcReturnTotal);
    $('returnAll').onclick=()=>{document.querySelectorAll('[data-return-qty]').forEach(i=>i.value=i.max);calcReturnTotal()};
    $('submitReturn').onclick=submitReturn;calcReturnTotal();
  }
  function returnPositions(){
    return [...document.querySelectorAll('[data-return-qty]')].map(i=>({id:i.dataset.returnQty,quantity:Number(i.value||0)})).filter(x=>x.quantity>0);
  }
  function calcReturnTotal(){
    if(!state.selectedReturn)return;
    const map=new Map((state.selectedReturn.positions||[]).map(x=>[String(x.id),x]));
    const total=returnPositions().reduce((sum,x)=>{const p=map.get(String(x.id));return sum+(p?Number(x.quantity)*Number(p.price||0)*(1-Number(p.discount||0)/100):0)},0);
    if($('returnTotal'))$('returnTotal').textContent=money(total);
  }
  async function submitReturn(){
    const sale=state.selectedReturn,positions=returnPositions(),reason=String($('returnReason')?.value||'').trim();
    if(!sale)return;if(!positions.length)return notify('Укажите количество возвращаемых позиций.',true);if(!reason)return notify('Укажите причину возврата.',true);
    const account=$('returnAccount')?.value;if(!account)return notify('Не найден счёт для возврата.',true);
    if(!confirm(`Провести возврат по продаже ${sale.name||sale.id}?`))return;
    const btn=$('submitReturn');btn.disabled=true;btn.textContent='Провожу…';
    try{
      const d=await api('/api/v1/pos/returns',{method:'POST',body:JSON.stringify({sale_id:sale.id,positions,account_id:account,payment_method:$('returnMethod').value,reason})});
      notify(`Возврат ${d.return?.name||''} создан · ${money(d.amount)}`);
      state.selectedReturn=null;renderReturnDetail();await loadReturnSales();
      if(!$('reportsView').hidden)await loadReport(state.reportPeriod);
    }catch(e){notify('Возврат не проведён: '+friendly(e),true)}finally{btn.disabled=false;btn.textContent='Провести возврат'}
  }

  async function rangeFor(key){
    const now=new Date(),end=new Date(now.getTime()+1000);let start;
    if(key==='shift'){
      try{const d=await api('/api/v1/pos/shift');if(d.shift?.openDate)start=new Date(d.shift.openDate);else throw new Error('Смена не открыта.')}catch(e){throw new Error(friendly(e,'Смена не открыта.'))}
    }else if(key==='today'){start=new Date(now);start.setHours(0,0,0,0)}
    else if(key==='7d'){start=new Date(now);start.setDate(start.getDate()-7)}
    else if(key==='30d'){start=new Date(now);start.setDate(start.getDate()-30)}
    else{start=new Date(now.getFullYear(),0,1)}
    return{start,end};
  }
  async function loadReport(key='today'){
    await loadReferenceData();state.reportPeriod=key;
    document.querySelectorAll('[data-report-period]').forEach(b=>b.classList.toggle('active',b.dataset.reportPeriod===key));
    const {start,end}=await rangeFor(key);$('reportRange').textContent=`${start.toLocaleDateString('ru-RU')} — ${end.toLocaleDateString('ru-RU')}`;
    const operator=state.isAdmin&&$('reportOperator')?.value?$('reportOperator').value:null;
    const r=await supabase.rpc('pos_dashboard',{p_from:start.toISOString(),p_to:end.toISOString(),p_operator_id:operator});
    if(r.error)throw r.error;renderReport(r.data||{});
  }
  function renderReport(d){
    $('reportSalesTotal').textContent=money(d.sales_total);$('reportSalesCount').textContent=Number(d.sales_count||0).toLocaleString('ru-RU');$('reportAvgCheck').textContent=money(d.avg_check);$('reportReturnsTotal').textContent=money(d.returns_total);$('reportReturnsCount').textContent=`${Number(d.returns_count||0).toLocaleString('ru-RU')} возврат(а)`;$('reportNetTotal').textContent=money(d.net_total);
    renderBars('reportPayments',d.payment_methods||[]);renderBars('reportOperatorsBars',d.operators||[]);
    $('reportTopItems').innerHTML=(d.top_items||[]).map(x=>`<tr><td>${esc(x.name)}</td><td>${Number(x.qty||0).toLocaleString('ru-RU')}</td><td><b>${money(x.amount)}</b></td></tr>`).join('')||'<tr><td colspan="3">Нет данных</td></tr>';
    $('reportRecentSales').innerHTML=(d.recent_sales||[]).map(x=>`<tr><td>${dt(x.sold_at)}</td><td>${esc(x.operator||'—')}</td><td>${esc(x.payment_method||'—')}</td><td><b>${money(x.total)}</b></td></tr>`).join('')||'<tr><td colspan="4">Нет продаж</td></tr>';
    $('reportRecentReturns').innerHTML=(d.recent_returns||[]).map(x=>`<tr><td>${dt(x.returned_at)}</td><td><b>${esc(x.return_name||'—')}</b></td><td>${esc(x.sale_name||'—')}</td><td>${esc(x.operator||'—')}</td><td>${esc(x.reason||'—')}</td><td>${esc(x.payment_method||'—')}</td><td class="negative">−${money(x.amount)}</td></tr>`).join('')||'<tr><td colspan="7">Возвратов за период нет</td></tr>';
  }
  function renderBars(id,rows){
    const max=Math.max(0,...rows.map(x=>Number(x.amount||0)));
    $(id).innerHTML=rows.map(x=>{const width=max>0?Math.max(3,Math.round(Number(x.amount||0)/max*100)):0;return `<div class="bar-row"><span title="${esc(x.name)}">${esc(x.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><b>${money(x.amount)}</b></div>`}).join('')||'<div class="module-empty">Нет данных за выбранный период</div>';
  }

  function bind(){
    document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>showSection(b.dataset.section));
    $('refreshReturns').onclick=()=>loadReturnSales().catch(e=>notify(friendly(e),true));$('returnsSearch').oninput=renderReturnSales;
    document.querySelectorAll('[data-report-period]').forEach(b=>b.onclick=()=>loadReport(b.dataset.reportPeriod).catch(e=>notify(friendly(e),true)));
    $('reportOperator').onchange=()=>loadReport(state.reportPeriod).catch(e=>notify(friendly(e),true));
    window.addEventListener('keydown',e=>{if(state.section!=='sale'&&e.key==='F2'){e.preventDefault();e.stopImmediatePropagation()}},{capture:true});
    window.addEventListener('focus',()=>{if(state.section==='returns')loadReturnSales().catch(()=>{});if(state.section==='reports')loadReport(state.reportPeriod).catch(()=>{})});
  }
  bind();showSection('sale');
})();