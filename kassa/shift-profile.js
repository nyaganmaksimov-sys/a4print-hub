(()=>{
  'use strict';
  if(window.__A4_KASSA_SHIFT_PROFILE__)return;
  window.__A4_KASSA_SHIFT_PROFILE__=true;
  const cfg=window.A4PRINT_CONFIG||{};
  const createClient=window.supabase?.createClient;
  if(!createClient)return;
  const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{global:{fetch:window.A4SupabaseFetch||fetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const dt=v=>v?new Date(v).toLocaleString('ru-RU'):'—';
  let current=null,busy=false,timer=null;

  async function accessToken(){const r=await supabase.auth.getSession();const s=r.data?.session;if(!s)throw new Error('Сессия завершена. Войдите снова.');return s.access_token}
  async function api(path,opt={},retry=true){let token=await accessToken();const run=async()=>{const r=await fetch(API+path,{...opt,cache:'no-store',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json',...(opt.headers||{})}});const text=await r.text();let d={};try{d=text?JSON.parse(text):{}}catch{}if(r.status===401&&retry){const rr=await supabase.auth.refreshSession();if(rr.data?.session){token=rr.data.session.access_token;return api(path,opt,false)}}if(!r.ok)throw new Error(d.message||d.error||`HTTP ${r.status}`);return d};return run()}

  function ensure(){
    const view=$('shiftView');if(!view)return null;
    let card=$('shiftProfileCard');if(card)return card;
    card=document.createElement('section');card.id='shiftProfileCard';card.className='shift-profile-card';card.innerHTML=`<div class="shift-profile-head"><div><h3>Профиль смены</h3><p>HUB ↔ KASSA ↔ МойСклад</p></div><button id="shiftProfileRefresh" class="shift-profile-refresh" type="button">↻ Обновить</button></div><div id="shiftProfileLoading" class="shift-profile-loading">Загрузка профиля смены…</div><div id="shiftProfileBody" hidden><div class="shift-sync-row"><span id="shiftSyncMs" class="shift-sync-pill">МойСклад</span><span id="shiftSyncHub" class="shift-sync-pill">HUB</span><span id="shiftSyncKassa" class="shift-sync-pill">KASSA</span></div><div class="shift-profile-grid"><label class="shift-profile-field"><span>Официальная смена МойСклад</span><div id="shiftOfficialName" class="shift-profile-value">—</div></label><label class="shift-profile-field"><span>Точка продаж</span><div id="shiftStoreName" class="shift-profile-value">—</div></label><label class="shift-profile-field"><span>Оператор</span><div id="shiftProfileOperator" class="shift-profile-value">—</div></label><label class="shift-profile-field"><span>Открыта</span><div id="shiftProfileOpened" class="shift-profile-value">—</div></label><label class="shift-profile-field"><span>Денег в кассе</span><div id="shiftProfileCash" class="shift-profile-value">—</div></label><label class="shift-profile-field"><span>Источник остатка</span><div id="shiftProfileCashSource" class="shift-profile-value">—</div></label><label class="shift-profile-field full"><span>Название смены в HUB / KASSA</span><input id="shiftDisplayName" class="shift-profile-input" maxlength="120" placeholder="Например: Утренняя смена"></label><label class="shift-profile-field full"><span>Комментарий к смене</span><textarea id="shiftOpeningNote" class="shift-profile-note" maxlength="2000" placeholder="Комментарий, ответственный, особенности смены…"></textarea></label><div class="shift-profile-help">Пользовательское название хранится только в A4PRINT HUB и не меняет официальный номер смены в МойСклад.</div></div><div class="shift-profile-actions"><button id="shiftProfileSave" class="shift-profile-save" type="button">Сохранить</button><button id="shiftProfileReconcile" class="shift-profile-reconcile" type="button">Синхронизировать</button><button id="shiftProfileHistoryToggle" class="shift-profile-history-toggle" type="button">Последние смены</button><span id="shiftProfileMessage" class="shift-profile-message"></span></div><div id="shiftProfileHistory" class="shift-history" hidden></div></div><div id="shiftProfileError" class="shift-profile-error" hidden></div>`;
    const anchor=$('shiftOperatorBar')||view.querySelector('.shift-topline');anchor?.insertAdjacentElement('afterend',card);
    $('shiftProfileRefresh').onclick=()=>load(true);
    $('shiftProfileSave').onclick=save;
    $('shiftProfileReconcile').onclick=reconcile;
    $('shiftProfileHistoryToggle').onclick=()=>{const h=$('shiftProfileHistory');h.hidden=!h.hidden;$('shiftProfileHistoryToggle').textContent=h.hidden?'Последние смены':'Скрыть историю'};
    return card;
  }

  function operatorName(){const select=$('shiftOperatorSelect')||$('operatorSelect');return select?.selectedOptions?.[0]?.textContent?.replace(' · вы','').trim()||'—'}
  function setPill(id,text,state){const el=$(id);if(!el)return;el.textContent=text;el.className='shift-sync-pill '+state}
  function renderHistory(rows){const h=$('shiftProfileHistory');if(!h)return;h.innerHTML=(rows||[]).slice(0,8).map(x=>`<div class="shift-history-row"><div><div class="shift-history-name">${esc(x.display_name||('Смена '+(x.moysklad_shift_name||'—')))}</div><div class="shift-history-meta">МойСклад ${esc(x.moysklad_shift_name||'—')} · ${esc(x.store_name||'Точка не указана')}</div></div><span class="shift-history-status ${x.status==='OPEN'?'':'closed'}">${x.status==='OPEN'?'Открыта':'Закрыта'}</span><span class="shift-history-time">${esc(dt(x.opened_at))}${x.closed_at?' → '+esc(dt(x.closed_at)):''}</span></div>`).join('')||'<div class="shift-profile-loading">История смен пока пуста.</div>'}

  function render(control,balance){
    current=control;const session=control.hub_session,ms=control.ms_shift,diag=control.diagnostics||{},perm=control.permissions||{};
    $('shiftProfileLoading').hidden=true;$('shiftProfileBody').hidden=false;$('shiftProfileError').hidden=true;
    setPill('shiftSyncMs',ms?`МойСклад · ${ms.name||'OPEN'}`:'МойСклад · закрыта',ms?'ok':'warn');
    setPill('shiftSyncHub',diag.synchronized?'HUB · синхронизирован':'HUB · требуется сверка',diag.synchronized?'ok':'bad');
    const local=!!window.A4KassaShiftSession?.active;setPill('shiftSyncKassa',local?'KASSA · смена активна':'KASSA · смена закрыта',local?'ok':'warn');
    $('shiftOfficialName').textContent=ms?.name||'—';$('shiftStoreName').textContent=control.store?.name||session?.store_name||'—';$('shiftProfileOperator').textContent=session?.opened_by?.name||operatorName();$('shiftProfileOpened').textContent=ms?.openDate?dt(ms.openDate):(session?.opened_at?dt(session.opened_at):'—');
    if(balance?.success&&balance.available){$('shiftProfileCash').textContent=money(balance.cash);$('shiftProfileCashSource').textContent=balance.stale?'Кэш МойСклад':(balance.source==='MOYSKLAD_LEDGER'?'МойСклад ledger':balance.source||'МойСклад')}else{$('shiftProfileCash').textContent='—';$('shiftProfileCashSource').textContent=balance?.message||'Недоступно'}
    const input=$('shiftDisplayName'),note=$('shiftOpeningNote');input.value=session?.display_name||'';note.value=session?.opening_note||'';input.disabled=!perm.edit_profile||!session;note.disabled=!perm.edit_profile||!session;$('shiftProfileSave').hidden=!perm.edit_profile;$('shiftProfileSave').disabled=!session;$('shiftProfileReconcile').hidden=!perm.reconcile;$('shiftProfileReconcile').disabled=diag.synchronized;
    renderHistory(control.recent||[]);
    window.A4KassaShiftProfileDisplayName=session?.display_name||'';
    const display=session?.display_name||ms?.name||'';
    if(display&&window.A4KassaShiftSession?.active){if($('shiftHeading'))$('shiftHeading').textContent=`Смена ${display}`;if($('shiftInfo'))$('shiftInfo').textContent=`Смена ${display}`;if($('footerShift'))$('footerShift').textContent=`Смена ${display}`}
  }

  async function load(showMessage=false){
    ensure();if(busy)return;busy=true;const msg=$('shiftProfileMessage');if(msg&&showMessage){msg.textContent='Обновляю…';msg.className='shift-profile-message'}
    try{const [control,balance]=await Promise.all([api('/api/v1/pos/shift/control'),api('/api/v1/pos/cash-balance').catch(e=>({success:false,message:e.message}))]);render(control,balance);if(msg&&showMessage){msg.textContent='Обновлено ✓';msg.className='shift-profile-message ok'}}catch(e){$('shiftProfileLoading').hidden=true;$('shiftProfileError').hidden=false;$('shiftProfileError').textContent='Не удалось загрузить профиль смены: '+String(e?.message||e);if(msg){msg.textContent='Ошибка';msg.className='shift-profile-message err'}}finally{busy=false}}

  async function save(){const session=current?.hub_session;if(!session)return;const btn=$('shiftProfileSave'),msg=$('shiftProfileMessage');btn.disabled=true;msg.textContent='Сохраняю…';msg.className='shift-profile-message';try{await api('/api/v1/pos/shift/control/'+encodeURIComponent(session.id),{method:'PATCH',body:JSON.stringify({display_name:$('shiftDisplayName').value.trim(),opening_note:$('shiftOpeningNote').value.trim()})});msg.textContent='Сохранено ✓';msg.className='shift-profile-message ok';await load(false)}catch(e){msg.textContent=String(e?.message||e);msg.className='shift-profile-message err'}finally{btn.disabled=false}}
  async function reconcile(){const btn=$('shiftProfileReconcile'),msg=$('shiftProfileMessage');btn.disabled=true;msg.textContent='Сверяю HUB и МойСклад…';msg.className='shift-profile-message';try{await api('/api/v1/pos/shift/reconcile',{method:'POST',body:'{}'});msg.textContent='Синхронизировано ✓';msg.className='shift-profile-message ok';await load(false)}catch(e){msg.textContent=String(e?.message||e);msg.className='shift-profile-message err'}finally{btn.disabled=false}}
  function schedule(delay=120){clearTimeout(timer);timer=setTimeout(()=>{const view=$('shiftView');if(view&&!view.hidden)load(false)},delay)}
  function init(){ensure();document.addEventListener('click',e=>{if(e.target?.closest?.('#navShift,#shiftChip'))schedule(180)},true);window.addEventListener('a4:kassa-shift',()=>schedule(250));setInterval(()=>{if(!document.hidden&&$('shiftView')&&!$('shiftView').hidden)load(false)},60000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
