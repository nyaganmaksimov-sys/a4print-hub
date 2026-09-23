import {supabase} from './guard.js?v=20260923-commerce1';
const cfg=window.A4PRINT_CONFIG||{},$=id=>document.getElementById(id);let session,state={plans:[],settings:{},gateway:{},promos:[],subscriptions:[],payments:[]},loading=false,pendingPromoDelete='';
const apiBase=String(cfg.apiBaseUrl||'https://a4print-hub-api.onrender.com').replace(/\/$/,'');
const COMMERCE_API_TIMEOUT_MS=7000;
const money=n=>(Number(n||0)).toLocaleString('ru-RU')+' ₽';const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function msg(id,text,ok=true){const el=$(id);if(!el)return;el.textContent=text;el.className='msg '+(ok?'ok':'err');setTimeout(()=>{if(el.textContent===text)el.textContent=''},4500)}
function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}
async function api(path,opt={}){
  if(!session?.access_token)throw new Error('Нет активной сессии');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),COMMERCE_API_TIMEOUT_MS);
  try{
    const r=await fetch(apiBase+path,{...opt,cache:'no-store',signal:opt.signal||controller.signal,headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json',Accept:'application/json',...(opt.headers||{})}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){const e=new Error(d.message||d.error||`HTTP ${r.status}`);e.status=r.status;e.code=d.error||'';throw e}
    return d;
  }catch(e){
    if(e?.name==='AbortError')throw new Error('Коммерческий API отвечает слишком долго. Повторите попытку.');
    throw e;
  }finally{clearTimeout(timer)}
}
function openTab(name){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));document.querySelectorAll('.pane').forEach(x=>x.classList.toggle('active',x.dataset.pane===name));location.hash=name==='overview'?'':name}
function renderOverview(){const active=state.subscriptions.filter(x=>x.status==='active').length,trial=state.subscriptions.filter(x=>x.status==='trial').length,paid=state.payments.filter(x=>x.status==='paid').reduce((a,x)=>a+Number(x.amount||0),0);$('kPlans').textContent=state.plans.filter(x=>x.is_active).length;$('kSubs').textContent=active;$('kTrial').textContent=trial;$('kPaid').textContent=money(paid);const g=state.gateway||{};$('overviewStatus').innerHTML=`<div class="switch"><span><b>Публичные тарифы</b><br><small class="muted">${state.plans.filter(x=>x.is_active).length} активных тарифа</small></span><span class="status on">Работают</span></div><div class="switch"><span><b>Платежный шлюз</b><br><small class="muted">${esc(g.provider||'manual')}</small></span><span class="status ${g.enabled?'on':'warn'}">${g.enabled?'Включён':'Выключен'}</span></div><div class="switch"><span><b>Trial</b><br><small class="muted">${state.settings.trial_days||0} дней</small></span><span class="status on">Настроен</span></div><div class="switch"><span><b>Стартовые привилегии</b><br><small class="muted">фиксация ${state.settings.early_adopter_months||0} мес.</small></span><span class="status ${state.settings.early_adopter_enabled?'on':''}">${state.settings.early_adopter_enabled?'Включены':'Выключены'}</span></div>`}
function planForm(p){let pretty='{}';try{pretty=JSON.stringify(p.features||{},null,2)}catch{}return `<article class="plan ${p.is_featured?'featured':''}" data-code="${esc(p.code)}"><div class="plan-head"><h3>${esc(p.name)}</h3><span class="plan-code">${esc(p.code)}</span></div><div class="price-preview">${money(p.monthly_price)} <small class="muted">/ мес</small></div><label class="field"><span>Название</span><input data-k="name" value="${esc(p.name)}"></label><label class="field"><span>Описание</span><textarea data-k="description">${esc(p.description)}</textarea></label><div class="two"><label class="field"><span>Цена / мес, ₽</span><input data-k="monthly_price" type="number" min="0" value="${p.monthly_price}"></label><label class="field"><span>Цена / год, ₽</span><input data-k="annual_price" type="number" min="0" value="${p.annual_price}"></label></div><div class="three"><label class="field"><span>Сотрудники</span><input data-k="employee_limit" type="number" min="0" value="${p.employee_limit??''}" placeholder="∞"></label><label class="field"><span>Точки</span><input data-k="location_limit" type="number" min="0" value="${p.location_limit??''}" placeholder="∞"></label><label class="field"><span>Заказы/мес</span><input data-k="monthly_order_limit" type="number" min="0" value="${p.monthly_order_limit??''}" placeholder="∞"></label></div><label class="field"><span>Текст кнопки</span><input data-k="button_label" value="${esc(p.button_label||'')}"></label><label class="field"><span>Функции JSON</span><textarea class="features-editor" data-k="features">${esc(pretty)}</textarea></label><div class="switch"><span>Активен</span><input data-k="is_active" type="checkbox" ${p.is_active?'checked':''}></div><div class="switch"><span>Выделенный тариф</span><input data-k="is_featured" type="checkbox" ${p.is_featured?'checked':''}></div><button class="btn save-plan">Сохранить ${esc(p.name)}</button></article>`}
function renderPlans(){$('plansGrid').innerHTML=state.plans.map(planForm).join('')||'<div class="empty">Тарифов нет</div>';document.querySelectorAll('.save-plan').forEach(b=>b.onclick=()=>savePlan(b.closest('.plan')))}
async function savePlan(card){
  try{
    const p=state.plans.find(x=>x.code===card.dataset.code),body={};
    if(!p)throw new Error('Тариф не найден. Обновите страницу.');
    card.querySelectorAll('[data-k]').forEach(el=>{
      const k=el.dataset.k;
      if(k==='is_active'||k==='is_featured')body[k]=el.checked;
      else if(k==='features')body[k]=JSON.parse(el.value||'{}');
      else if(['monthly_price','annual_price','employee_limit','location_limit','monthly_order_limit'].includes(k))body[k]=el.value===''?null:Number(el.value);
      else body[k]=el.value;
    });
    body.sort_order=p.sort_order;
    await api('/api/v1/admin/commerce/plans/'+encodeURIComponent(p.code),{method:'PUT',body:JSON.stringify(body)});
    msg('plansMsg','Тариф сохранён ✓');notify('success','Тариф сохранён',p.name||p.code);await load();
  }catch(e){msg('plansMsg',e instanceof SyntaxError?'Ошибка JSON в функциях тарифа':e.message,false);notify('error','Не удалось сохранить тариф',e instanceof SyntaxError?'Проверьте JSON в функциях тарифа.':e.message)}
}
function fillSettings(){const s=state.settings||{};['trial_days','annual_discount_percent','early_adopter_months','hero_badge','hero_title','hero_text','pricing_title','pricing_text','currency'].forEach(k=>{if($(k))$(k).value=s[k]??''});$('free_after_trial').checked=s.free_after_trial!==false;$('early_adopter_enabled').checked=!!s.early_adopter_enabled}
async function saveSettings(){const body={trial_days:+$('trial_days').value,annual_discount_percent:+$('annual_discount_percent').value,early_adopter_months:+$('early_adopter_months').value,hero_badge:$('hero_badge').value,hero_title:$('hero_title').value,hero_text:$('hero_text').value,pricing_title:$('pricing_title').value,pricing_text:$('pricing_text').value,currency:$('currency').value,free_after_trial:$('free_after_trial').checked,early_adopter_enabled:$('early_adopter_enabled').checked};try{await api('/api/v1/admin/commerce/settings',{method:'PUT',body:JSON.stringify(body)});msg('landingMsg','Настройки сохранены ✓');await load()}catch(e){msg('landingMsg',e.message,false)}}
const PROVIDERS={manual:[],yookassa:[['shop_id','Shop ID'],['secret_key','Secret key']],tbank:[['terminal_key','Terminal Key'],['password','Password']],cloudpayments:[['public_id','Public ID'],['api_secret','API Secret']],robokassa:[['merchant_login','Merchant Login'],['password1','Password #1'],['password2','Password #2']]};
function renderProviderFields(){const p=$('gwProvider').value,preview=state.gateway?.credential_preview||{},rows=PROVIDERS[p]||[];$('providerFields').innerHTML=rows.length?`<div class="two">${rows.map(([k,l])=>`<label class="field"><span>${esc(l)}</span><input type="password" data-cred="${k}" autocomplete="new-password" placeholder="${esc(preview[k]||'Введите новый ключ')}"></label>`).join('')}</div>`:'<div class="notice">Ручной режим: администратор отмечает оплату вручную. Секретные ключи не требуются.</div>'}
function fillGateway(){const g=state.gateway||{};$('gwProvider').value=g.provider||'manual';$('gwEnabled').checked=!!g.enabled;$('gwTest').checked=g.test_mode!==false;$('gwReturnUrl').value=g.public_config?.return_url||'https://a4print-hub.ru/account/billing';$('gwDescription').value=g.public_config?.description||'Подписка A4PRINT HUB';renderProviderFields();$('gatewayStatus').innerHTML=`<div class="switch"><span><b>Провайдер</b></span><span class="status">${esc(g.provider||'manual')}</span></div><div class="switch"><span><b>Ключи</b></span><span class="status ${g.credentials_configured?'on':'warn'}">${g.credentials_configured?'Сохранены':'Не заданы'}</span></div><div class="switch"><span><b>Режим</b></span><span class="status ${g.test_mode?'warn':'on'}">${g.test_mode?'Тестовый':'Боевой'}</span></div>`}
async function saveGateway(){const credentials={};document.querySelectorAll('[data-cred]').forEach(x=>{if(x.value.trim())credentials[x.dataset.cred]=x.value.trim()});const body={provider:$('gwProvider').value,enabled:$('gwEnabled').checked,test_mode:$('gwTest').checked,public_config:{return_url:$('gwReturnUrl').value.trim(),description:$('gwDescription').value.trim()},credentials,webhook_secret:$('gwWebhookSecret').value.trim()};try{await api('/api/v1/admin/commerce/gateway',{method:'PUT',body:JSON.stringify(body)});$('gwWebhookSecret').value='';msg('gatewayMsg','Шлюз сохранён ✓');await load()}catch(e){msg('gatewayMsg',e.message,false)}}
async function testGateway(){try{const d=await api('/api/v1/admin/commerce/gateway/test',{method:'POST',body:'{}'});msg('gatewayMsg',d.message||'Конфигурация готова ✓')}catch(e){msg('gatewayMsg',e.message,false)}}
function renderPromos(){const rows=state.promos||[];$('promoTable').innerHTML=rows.length?`<table class="tbl"><thead><tr><th>Код</th><th>Скидка</th><th>Использовано</th><th>Статус</th><th></th></tr></thead><tbody>${rows.map(p=>`<tr><td><b>${esc(p.code)}</b><br><small>${esc(p.description)}</small></td><td>${p.discount_type==='percent'?p.discount_value+'%':money(p.discount_value)}</td><td>${p.used_count||0}${p.max_uses?' / '+p.max_uses:''}</td><td><span class="status ${p.active?'on':''}">${p.active?'Активен':'Выключен'}</span></td><td><button class="btn danger del-promo" data-code="${esc(p.code)}">Удалить</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Промокодов пока нет</div>';document.querySelectorAll('.del-promo').forEach(b=>b.onclick=()=>deletePromo(b.dataset.code))}
async function savePromo(){const body={code:$('promoCode').value,description:$('promoDescription').value,discount_type:$('promoType').value,discount_value:+$('promoValue').value,max_uses:$('promoMax').value||null,active:true};try{await api('/api/v1/admin/commerce/promos',{method:'POST',body:JSON.stringify(body)});['promoCode','promoDescription','promoValue','promoMax'].forEach(k=>$(k).value='');msg('promoMsg','Промокод сохранён ✓');await load()}catch(e){msg('promoMsg',e.message,false)}}
function deletePromo(code){
  pendingPromoDelete=String(code||'');
  $('promoDeleteText').textContent=pendingPromoDelete?`Промокод «${pendingPromoDelete}» будет удалён. Это действие нельзя отменить.`:'Промокод будет удалён.';
  $('promoDeleteDlg').showModal();
}
async function confirmDeletePromo(event){
  event.preventDefault();
  if(!pendingPromoDelete)return $('promoDeleteDlg').close();
  const code=pendingPromoDelete,button=$('promoDeleteConfirm');button.disabled=true;
  try{
    await api('/api/v1/admin/commerce/promos/'+encodeURIComponent(code),{method:'DELETE'});
    pendingPromoDelete='';$('promoDeleteDlg').close();notify('success','Промокод удалён',code);await load();
  }catch(e){notify('error','Не удалось удалить промокод',e.message)}
  finally{button.disabled=false}
}
function renderSubs(){const r=state.subscriptions||[];$('subsTable').innerHTML=r.length?`<table class="tbl"><thead><tr><th>Тариф</th><th>Статус</th><th>Период</th><th>Trial до</th><th>Цена</th><th>Создана</th></tr></thead><tbody>${r.map(x=>`<tr><td><b>${esc(x.plan_code)}</b></td><td><span class="status ${x.status==='active'?'on':x.status==='trial'?'warn':''}">${esc(x.status)}</span></td><td>${esc(x.billing_period)}</td><td>${x.trial_ends_at?new Date(x.trial_ends_at).toLocaleDateString('ru-RU'):'—'}</td><td>${x.price_amount!=null?money(x.price_amount):'—'}</td><td>${new Date(x.created_at).toLocaleString('ru-RU')}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Подписок пока нет — появятся с первыми клиентами.</div>'}
function renderPayments(){const r=state.payments||[];$('paymentsTable').innerHTML=r.length?`<table class="tbl"><thead><tr><th>Дата</th><th>Сумма</th><th>Статус</th><th>Провайдер</th><th>ID платежа</th><th>Описание</th></tr></thead><tbody>${r.map(x=>`<tr><td>${new Date(x.created_at).toLocaleString('ru-RU')}</td><td><b>${money(x.amount)}</b></td><td><span class="status ${x.status==='paid'?'on':x.status==='pending'?'warn':''}">${esc(x.status)}</span></td><td>${esc(x.provider)}</td><td>${esc(x.provider_payment_id||'—')}</td><td>${esc(x.description||'')}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Платежей пока нет.</div>'}
function render(){renderOverview();renderPlans();fillSettings();fillGateway();renderPromos();renderSubs();renderPayments()}
async function load(){
  if(loading)return;
  loading=true;if($('refresh'))$('refresh').disabled=true;
  try{const d=await api('/api/v1/admin/commerce');state=d;render()}
  finally{loading=false;if($('refresh'))$('refresh').disabled=false}
}
function renderAccessError(error){
  const host=document.querySelector('.commerce');
  if(!host)return;
  const platform=error?.code==='PLATFORM_ADMIN_REQUIRED';
  host.innerHTML=`<div class="a4-error" style="margin-top:20px"><b>${platform?'Нет доступа к глобальной коммерции':'Не удалось открыть коммерческий центр'}</b><div style="margin-top:6px">${esc(platform?'Этот раздел доступен только администраторам управляющей организации A4PRINT HUB.':error?.message||String(error))}</div><button id="commerceRetry" class="btn secondary" type="button" style="margin-top:12px">Повторить</button></div>`;
  $('commerceRetry')?.addEventListener('click',()=>location.reload());
}
async function init(){
  const s=await supabase.auth.getSession();session=s.data.session;if(!session){location.replace('./login.html');return}
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>openTab(b.dataset.tab)));
  document.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>openTab(b.dataset.open)));
  $('saveLanding').addEventListener('click',saveSettings);
  $('gwProvider').addEventListener('change',renderProviderFields);
  $('saveGateway').addEventListener('click',saveGateway);
  $('testGateway').addEventListener('click',testGateway);
  $('savePromo').addEventListener('click',savePromo);
  $('refresh').addEventListener('click',()=>load().catch(e=>notify('error','Не удалось обновить коммерцию',e.message,{actionLabel:'Повторить',onAction:()=>load()})));
  $('logout').addEventListener('click',async()=>{await supabase.auth.signOut();location.replace('./login.html')});
  $('promoDeleteCancel').addEventListener('click',()=>{pendingPromoDelete='';$('promoDeleteDlg').close()});
  $('promoDeleteForm').addEventListener('submit',confirmDeletePromo);
  openTab(location.hash.slice(1)||'overview');
  await load();
}
void init().catch(e=>{console.error(e);renderAccessError(e);notify('error','Коммерческий центр недоступен',e.message||String(e),{duration:0})});