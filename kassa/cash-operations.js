(()=>{
  'use strict';
  if(window.__A4_KASSA_CASH_OPERATIONS__)return;
  window.__A4_KASSA_CASH_OPERATIONS__=true;
  const cfg=window.A4PRINT_CONFIG||{};
  const createClient=window.supabase?.createClient;
  if(!createClient)return;
  const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{global:{fetch:window.A4SupabaseFetch||fetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const DB=window.A4KassaDB;
  const $=id=>document.getElementById(id);
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const toast=(text,error=false)=>{const n=$('toast');if(!n)return;n.textContent=text;n.className='toast show'+(error?' error':'');clearTimeout(toast.t);toast.t=setTimeout(()=>n.className='toast',3500)};
  let liveCash=Number.NaN;
  let balanceBusy=false;
  let balanceTimer=null;
  let applyingBalance=false;

  function currentCash(){
    if(Number.isFinite(liveCash))return liveCash;
    const raw=String($('shiftCashRegister')?.textContent||'').replace(/\s/g,'').replace('₽','').replace(',','.');
    const n=Number(raw);return Number.isFinite(n)?n:Number.NaN;
  }
  function ensureStyles(){
    if($('cashOperationsStyle'))return;
    const s=document.createElement('style');s.id='cashOperationsStyle';s.textContent=`
      .shift-cash-actions{display:flex;gap:10px;padding:14px 16px 2px;justify-content:flex-end}
      .cashout-btn{border:1px solid #d8e1ea;background:#fff;color:#13233b;border-radius:10px;padding:10px 16px;font-weight:800;font-size:14px;cursor:pointer}
      .cashout-btn:hover{background:#f5f8fb}.cashout-btn:disabled{opacity:.45;cursor:not-allowed}
      .cashop-overlay{position:fixed;inset:0;z-index:1200;background:rgba(15,23,42,.48);display:flex;align-items:center;justify-content:center;padding:20px}
      .cashop-card{width:min(520px,100%);background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.24);overflow:hidden}
      .cashop-head{display:flex;align-items:flex-start;justify-content:space-between;padding:22px 24px 16px;border-bottom:1px solid #e5eaf0}.cashop-head h2{margin:0;font-size:24px;color:#11213a}.cashop-head p{margin:5px 0 0;color:#75849a}.cashop-close{border:0;background:#f4f6f8;border-radius:10px;width:38px;height:38px;font-size:24px;cursor:pointer}
      .cashop-body{padding:22px 24px}.cashop-balance{background:#f4f9fb;border:1px solid #d9e7ec;border-radius:12px;padding:14px 16px;margin-bottom:18px;display:flex;justify-content:space-between;gap:15px}.cashop-balance strong{font-size:20px}.cashop-field{display:block;margin:14px 0}.cashop-field span{display:block;font-weight:700;margin-bottom:7px}.cashop-field input,.cashop-field textarea{width:100%;box-sizing:border-box;border:1px solid #ccd7e3;border-radius:10px;padding:12px 13px;font:inherit}.cashop-field textarea{min-height:86px;resize:vertical}.cashop-error{min-height:20px;color:#c62828;font-size:13px;margin-top:8px}
      .cashop-actions{display:flex;gap:10px;justify-content:flex-end;padding:0 24px 22px}.cashop-actions button{border-radius:10px;padding:12px 18px;font-weight:800;font-size:15px;cursor:pointer}.cashop-cancel{border:1px solid #d5dde7;background:#fff}.cashop-submit{border:0;background:#10b981;color:#fff;min-width:180px}.cashop-submit:disabled{opacity:.5;cursor:not-allowed}
    `;document.head.append(s);
  }
  function close(){const o=$('cashOpOverlay');if(o)o.remove()}
  async function token(){
    let s=(await supabase.auth.getSession()).data?.session;
    if(!s)throw new Error('Сессия завершена. Войдите снова.');
    return s.access_token;
  }
  async function authorizedFetch(url,options={},retry=true){
    let access=await token();
    const run=async()=>{
      const r=await fetch(url,{...options,cache:'no-store',headers:{Authorization:`Bearer ${access}`,Accept:'application/json',...(options.headers||{})}});
      if(r.status===401&&retry){const rr=await supabase.auth.refreshSession();if(rr.data?.session){access=rr.data.session.access_token;return authorizedFetch(url,options,false)}}
      return r;
    };return run();
  }
  function applyExactBalance(data){
    const available=Boolean(data?.available)&&Number.isFinite(Number(data?.cash));
    liveCash=available?Number(data.cash):Number.NaN;
    window.A4KassaCashBalance=available?{cash:liveCash,shift:data?.shift||null,store:data?.store||null,updatedAt:data?.updated_at||new Date().toISOString(),source:data?.source||'MOYSKLAD_RETAILSTORE_CASH'}:null;
    applyingBalance=true;
    try{
      const shiftValue=$('shiftCashRegister');if(shiftValue)shiftValue.textContent=available?money(liveCash):'—';
      const reportValue=$('reportCashRegister');if(reportValue)reportValue.textContent=available?money(liveCash):'—';
      const reportNote=$('reportCashRegisterNote');
      if(reportNote){
        if(!available)reportNote.textContent='Остаток МойСклад недоступен';
        else if(data?.shift)reportNote.textContent=`Смена ${data.shift.name||''} · МойСклад`.trim();
        else reportNote.textContent='МойСклад · смена не открыта';
      }
    }finally{queueMicrotask(()=>{applyingBalance=false})}
    window.dispatchEvent(new CustomEvent('a4:kassa-cash-balance',{detail:{cash:available?liveCash:null,available,data}}));
  }
  async function refreshBalance(){
    if(balanceBusy||!API)return window.A4KassaCashBalance||null;
    balanceBusy=true;
    try{
      const r=await authorizedFetch(`${API}/api/v1/pos/cash-balance?ts=${Date.now()}`);
      const data=await r.json().catch(()=>({}));
      if(r.ok&&data?.success){applyExactBalance(data);return data}
      applyExactBalance({available:false,cash:null,shift:data?.shift||null,source:data?.source||data?.error||'CASH_BALANCE_UNAVAILABLE'});
      return data;
    }catch(error){console.warn('A4PRINT cash balance:',error);return null}
    finally{balanceBusy=false}
  }
  function scheduleBalance(delay=250){clearTimeout(balanceTimer);balanceTimer=setTimeout(()=>refreshBalance().catch(()=>{}),delay)}
  async function api(body,retry=true){
    let access=await token();
    const run=async()=>{
      const r=await fetch(`${API}/api/v1/pos/cashout`,{method:'POST',cache:'no-store',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
      const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{}
      if(r.status===401&&retry){const rr=await supabase.auth.refreshSession();if(rr.data?.session){access=rr.data.session.access_token;return api(body,false)}}
      if(!r.ok)throw new Error(data.message||data.error||`HTTP ${r.status}`);return data;
    };return run();
  }
  async function open(){
    close();ensureStyles();
    await refreshBalance().catch(()=>{});
    const available=currentCash();
    const hasShift=Boolean(window.A4KassaCashBalance?.shift?.id);
    const canWithdraw=Number.isFinite(available)&&available>0&&hasShift;
    const initialError=!Number.isFinite(available)
      ?'Не удалось получить точный остаток из МойСклад. Изъятие временно заблокировано.'
      :!hasShift
        ?'Для изъятия сначала откройте смену.'
        :available<=0?'В кассе нет наличных для изъятия.':'';
    const overlay=document.createElement('div');overlay.id='cashOpOverlay';overlay.className='cashop-overlay';overlay.innerHTML=`<div class="cashop-card" role="dialog" aria-modal="true" aria-labelledby="cashOpTitle"><div class="cashop-head"><div><h2 id="cashOpTitle">Изъятие денег</h2><p>Выплата будет создана в текущей смене МойСклад.</p></div><button class="cashop-close" type="button" aria-label="Закрыть">×</button></div><div class="cashop-body"><div class="cashop-balance"><span>Наличных сейчас</span><strong>${Number.isFinite(available)?money(available):'—'}</strong></div><label class="cashop-field"><span>Сумма изъятия</span><input id="cashOpAmount" inputmode="decimal" autocomplete="off" placeholder="0,00"></label><label class="cashop-field"><span>Причина / комментарий</span><textarea id="cashOpReason" placeholder="Например: инкассация, передано руководителю"></textarea></label><div id="cashOpError" class="cashop-error">${initialError}</div></div><div class="cashop-actions"><button class="cashop-cancel" type="button">Отмена</button><button id="cashOpSubmit" class="cashop-submit" type="button" ${canWithdraw?'':'disabled'}>Изъять деньги</button></div></div>`;
    document.body.append(overlay);
    overlay.querySelector('.cashop-close').onclick=close;overlay.querySelector('.cashop-cancel').onclick=close;overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
    const amount=$('cashOpAmount');amount.focus();
    $('cashOpSubmit').onclick=async()=>{
      const exact=currentCash();
      const shiftOpen=Boolean(window.A4KassaCashBalance?.shift?.id);
      const value=Number(String(amount.value||'').replace(/\s/g,'').replace(',','.'));
      const reason=String($('cashOpReason').value||'').trim();const err=$('cashOpError');err.textContent='';
      if(!Number.isFinite(exact)){err.textContent='Точный остаток кассы недоступен. Обновите данные и повторите.';return}
      if(!shiftOpen){err.textContent='Для изъятия сначала откройте смену.';return}
      if(exact<=0){err.textContent='В кассе нет наличных для изъятия.';return}
      if(!Number.isFinite(value)||value<=0){err.textContent='Введите сумму больше нуля.';return}
      if(value>exact){err.textContent=`В кассе сейчас ${money(exact)}. Нельзя изъять больше.`;return}
      const operator=$('operatorSelect')?.value||null;const btn=$('cashOpSubmit');btn.disabled=true;btn.textContent='Провожу…';
      try{
        const result=await api({amount:value,reason,operator_id:operator});
        if(Number.isFinite(Number(result.cash_after)))applyExactBalance({available:true,cash:Number(result.cash_after),shift:result.shift||window.A4KassaCashBalance?.shift,store:window.A4KassaCashBalance?.store,source:'MOYSKLAD_RETAILSTORE_CASH'});
        close();toast(`Изъято ${money(value)}${result.operation?.name?` · ${result.operation.name}`:''}`);
        setTimeout(()=>$('shiftRefresh')?.click(),250);
        window.dispatchEvent(new CustomEvent('a4:kassa-cash-operation',{detail:{type:'CASH_OUT',amount:value}}));
        scheduleBalance(500);setTimeout(()=>scheduleBalance(0),1600);
      }catch(e){btn.disabled=false;btn.textContent='Изъять деньги';err.textContent=String(e?.message||e)}
    };
  }
  function inject(){
    ensureStyles();const card=$('shiftSummaryWrap')?.querySelector('.shift-summary-card');if(!card||$('shiftCashOut'))return;
    const row=document.createElement('div');row.className='shift-cash-actions';row.innerHTML='<button id="shiftCashOut" class="cashout-btn" type="button">− Изъять деньги</button>';card.append(row);$('shiftCashOut').onclick=open;
  }
  function watchMoneyChanges(){
    const observer=new MutationObserver(mutations=>{
      if(applyingBalance)return;
      if(mutations.some(m=>m.target?.id==='shiftCashRegister'||m.target?.id==='reportCashRegister'||m.target?.parentElement?.id==='shiftCashRegister'||m.target?.parentElement?.id==='reportCashRegister'))scheduleBalance(120);
      inject();
    });
    observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
    if(DB?.put){
      const nativePut=DB.put.bind(DB);
      DB.put=async function(name,value){
        const result=await nativePut(name,value);
        if((name==='queue'&&(value?.stage==='done'||value?.stage==='backend_done'))||name==='receipts')scheduleBalance(350);
        return result;
      };
    }
    const previousFetch=window.fetch.bind(window);
    window.fetch=async function a4CashBalanceFetch(input,init={}){
      const response=await previousFetch(input,init);
      try{
        const url=new URL(input instanceof Request?input.url:String(input),location.href);
        const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
        if(response.ok&&method==='POST'&&/\/api\/v1\/pos\/returns\/?$/.test(url.pathname))scheduleBalance(350);
      }catch{}
      return response;
    };
  }
  document.addEventListener('click',e=>{if(e.target?.closest?.('#navShift,#shiftChip,[data-section="reports"]')){setTimeout(inject,100);scheduleBalance(180)}},true);
  window.addEventListener('a4:kassa-cash-operation',()=>scheduleBalance(250));
  window.addEventListener('a4:kassa-shift',()=>scheduleBalance(250));
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('cashOpOverlay'))close()});
  watchMoneyChanges();
  inject();
  scheduleBalance(700);
})();
