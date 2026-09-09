(()=>{
  'use strict';
  if(window.__A4_KASSA_CATALOG_QUICK_ADD__)return;
  window.__A4_KASSA_CATALOG_QUICK_ADD__=true;

  const cfg=window.A4PRINT_CONFIG||{};
  const createClient=window.supabase?.createClient;
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const $=id=>document.getElementById(id);
  const supabase=createClient?createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
    global:{fetch:window.A4SupabaseFetch||fetch},
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  }):null;

  function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
  function notify(text,error=false){
    const node=$('toast');
    if(node){node.textContent=text;node.className='toast show'+(error?' error':'');setTimeout(()=>{if(node.textContent===text)node.className='toast'},3600);return}
    if(error)alert(text);
  }

  function ensureStyle(){
    if($('kassaCatalogQuickStyle'))return;
    const style=document.createElement('style');style.id='kassaCatalogQuickStyle';
    style.textContent=`
      .kassa-quick-empty-add{margin-top:16px;min-height:40px;padding:0 16px;border:1px solid #8ddbe1;border-radius:8px;background:#eafafb;color:#078c99;font-weight:800;cursor:pointer}
      .kassa-quick-empty-add:hover{background:#d8f5f7}.kassa-catalog-dialog{width:min(560px,calc(100vw - 26px));border:0;border-radius:16px;padding:0;background:#fff;color:#102033;box-shadow:0 28px 80px rgba(15,23,42,.3);overflow:hidden}
      .kassa-catalog-dialog::backdrop{background:rgba(15,23,42,.55);backdrop-filter:blur(2px)}
      .kassa-catalog-form{display:flex;flex-direction:column;max-height:90vh}.kassa-catalog-head{display:flex;justify-content:space-between;gap:14px;padding:17px 19px;border-bottom:1px solid #e7edf3}
      .kassa-catalog-head h2{margin:0;font-size:18px}.kassa-catalog-head p{margin:5px 0 0;color:#718096;font-size:11px;line-height:1.45}.kassa-catalog-close{width:34px;height:34px;border:1px solid #d8e0e8;border-radius:9px;background:#fff;font-size:20px;cursor:pointer}
      .kassa-catalog-body{padding:16px 19px;display:grid;grid-template-columns:1fr 1fr;gap:11px;overflow:auto}.kassa-catalog-field{display:grid;gap:5px}.kassa-catalog-field.full{grid-column:1/-1}.kassa-catalog-field span{font-size:10px;font-weight:850;color:#516174;text-transform:uppercase;letter-spacing:.03em}
      .kassa-catalog-field input,.kassa-catalog-field select,.kassa-catalog-field textarea{width:100%;box-sizing:border-box;min-height:40px;padding:9px 10px;border:1px solid #d6dfe8;border-radius:9px;background:#fff;color:#142033;font:inherit;font-size:12px}.kassa-catalog-field textarea{min-height:68px;resize:vertical}
      .kassa-catalog-ms-note{grid-column:1/-1;padding:10px 11px;border-radius:10px;background:#eefafa;color:#087d88;font-size:10px;line-height:1.45}.kassa-catalog-error{grid-column:1/-1;min-height:16px;color:#b42318;font-size:10px}
      .kassa-catalog-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 19px 16px;border-top:1px solid #e7edf3}.kassa-catalog-foot button{min-height:39px;padding:0 14px;border:1px solid #d6dfe8;border-radius:9px;background:#fff;color:#344054;font-weight:800;cursor:pointer}.kassa-catalog-foot .primary{background:#11a7b4;border-color:#11a7b4;color:#fff}.kassa-catalog-foot button:disabled{opacity:.55;cursor:wait}
      @media(max-width:620px){.kassa-catalog-body{grid-template-columns:1fr}.kassa-catalog-field.full,.kassa-catalog-ms-note,.kassa-catalog-error{grid-column:auto}}
    `;
    document.head.appendChild(style);
  }

  function ensureDialog(){
    if($('kassaCatalogQuickDlg'))return;
    const dialog=document.createElement('dialog');dialog.id='kassaCatalogQuickDlg';dialog.className='kassa-catalog-dialog';
    dialog.innerHTML=`<form id="kassaCatalogQuickForm" class="kassa-catalog-form">
      <div class="kassa-catalog-head"><div><h2>Добавить позицию</h2><p>Товар или услуга будет создана в МойСклад и сразу добавлена в каталог KASSA.</p></div><button id="kassaCatalogQuickClose" class="kassa-catalog-close" type="button" aria-label="Закрыть">×</button></div>
      <div class="kassa-catalog-body">
        <label class="kassa-catalog-field"><span>Тип *</span><select id="kassaCatalogQuickType"><option value="SERVICE">Услуга</option><option value="PRODUCT">Товар</option></select></label>
        <label class="kassa-catalog-field"><span>Цена продажи, ₽ *</span><input id="kassaCatalogQuickPrice" type="number" min="0" step="0.01" value="0" required></label>
        <label class="kassa-catalog-field full"><span>Название *</span><input id="kassaCatalogQuickName" maxlength="500" required placeholder="Например: Оцифровка видеокассеты"></label>
        <label class="kassa-catalog-field"><span>Категория</span><input id="kassaCatalogQuickCategory" maxlength="160" placeholder="Например: Оцифровка"></label>
        <label class="kassa-catalog-field"><span>Единица</span><select id="kassaCatalogQuickUnit"><option value="шт">шт</option><option value="лист">лист</option><option value="м">м</option><option value="м²">м²</option><option value="мин">мин</option><option value="час">час</option></select></label>
        <label class="kassa-catalog-field full"><span>Артикул (необязательно)</span><input id="kassaCatalogQuickArticle" maxlength="160" placeholder="Можно оставить пустым"></label>
        <label class="kassa-catalog-field full"><span>Описание</span><textarea id="kassaCatalogQuickDescription" maxlength="2000" placeholder="Короткое описание позиции"></textarea></label>
        <div class="kassa-catalog-ms-note"><b>Синхронизация:</b> сначала позиция создаётся в МойСклад, затем её идентификатор и ссылка сохраняются в HUB. Поэтому новая позиция сразу пригодна для продажи через кассу.</div>
        <div id="kassaCatalogQuickError" class="kassa-catalog-error"></div>
      </div>
      <div class="kassa-catalog-foot"><button id="kassaCatalogQuickCancel" type="button">Отмена</button><button id="kassaCatalogQuickSave" class="primary" type="submit">Добавить</button></div>
    </form>`;
    document.body.appendChild(dialog);
    $('kassaCatalogQuickClose').onclick=()=>dialog.close();
    $('kassaCatalogQuickCancel').onclick=()=>dialog.close();
    $('kassaCatalogQuickForm').addEventListener('submit',save);
  }

  function guessCategory(name){
    const text=String(name||'').trim();
    if(!text)return'';
    const first=text.split(/[\s,;:/()-]+/).filter(Boolean)[0]||'';
    return first.length>=4?first.charAt(0).toUpperCase()+first.slice(1):'';
  }

  function openDialog(prefill=''){
    ensureStyle();ensureDialog();
    const search=String(prefill||$('search')?.value||'').trim();
    $('kassaCatalogQuickName').value=search;
    $('kassaCatalogQuickType').value='SERVICE';
    $('kassaCatalogQuickPrice').value='0';
    $('kassaCatalogQuickCategory').value=guessCategory(search);
    $('kassaCatalogQuickUnit').value='шт';
    $('kassaCatalogQuickArticle').value='';
    $('kassaCatalogQuickDescription').value='';
    $('kassaCatalogQuickError').textContent='';
    $('kassaCatalogQuickDlg').showModal();
    setTimeout(()=>{const target=search?$('kassaCatalogQuickPrice'):$('kassaCatalogQuickName');target?.focus();target?.select?.()},0);
  }

  async function accessToken(){
    if(!supabase)throw new Error('Не удалось инициализировать авторизацию кассы.');
    let {data}=await supabase.auth.getSession();
    let session=data?.session;
    if(!session?.access_token){const refreshed=await supabase.auth.refreshSession();session=refreshed.data?.session}
    if(!session?.access_token)throw new Error('Сессия кассира истекла. Войдите заново.');
    return session.access_token;
  }

  async function createItem(payload){
    const token=await accessToken();
    const response=await fetch(`${API}/api/v1/pos/catalog/items`,{
      method:'POST',cache:'no-store',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)
    });
    const text=await response.text();let data={};try{data=text?JSON.parse(text):{}}catch{}
    if(!response.ok)throw new Error(data.message||data.error||`HTTP ${response.status}`);
    return data;
  }

  async function refreshAndShow(name){
    const all=document.querySelector('[data-category="ALL"]');
    if(all)all.click();
    const search=$('search');
    if(search){search.value=name;search.dispatchEvent(new Event('input',{bubbles:true}))}
    $('refreshCatalog')?.click();
    await new Promise(r=>setTimeout(r,650));
    if(search){search.value=name;search.dispatchEvent(new Event('input',{bubbles:true}))}
  }

  async function save(event){
    event.preventDefault();
    const errorNode=$('kassaCatalogQuickError'),button=$('kassaCatalogQuickSave');
    const name=$('kassaCatalogQuickName').value.trim();
    const price=Number($('kassaCatalogQuickPrice').value||0);
    if(!name){errorNode.textContent='Укажите название позиции.';return}
    if(!Number.isFinite(price)||price<0){errorNode.textContent='Укажите корректную цену.';return}
    errorNode.textContent='';button.disabled=true;button.textContent='Создание в МойСклад…';
    try{
      const result=await createItem({
        name,item_type:$('kassaCatalogQuickType').value,sale_price:price,
        category:$('kassaCatalogQuickCategory').value.trim()||null,unit:$('kassaCatalogQuickUnit').value||'шт',
        article:$('kassaCatalogQuickArticle').value.trim()||null,description:$('kassaCatalogQuickDescription').value.trim()||null
      });
      $('kassaCatalogQuickDlg').close();
      await refreshAndShow(result?.item?.name||name);
      notify(result?.already_exists?'Позиция уже была в МойСклад — каталог KASSA обновлён':'Позиция создана в МойСклад и добавлена в KASSA');
    }catch(error){
      console.error('KASSA quick catalog create failed',error);
      errorNode.textContent=`Не удалось добавить: ${error?.message||error}`;
    }finally{button.disabled=false;button.textContent='Добавить'}
  }

  function enhanceEmpty(){
    const grid=$('catalogGrid'),search=$('search');
    if(!grid||!search)return;
    const empty=grid.querySelector('.empty-grid');
    const q=search.value.trim();
    if(!empty||!q||grid.querySelector('.kassa-quick-empty-add'))return;
    const button=document.createElement('button');
    button.type='button';button.className='kassa-quick-empty-add';button.textContent=`＋ Добавить «${q.length>45?q.slice(0,45)+'…':q}»`;
    button.addEventListener('click',()=>openDialog(q));
    empty.appendChild(button);
  }

  function bind(){
    ensureStyle();ensureDialog();
    const quick=$('quickAdd');
    if(quick)quick.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();openDialog($('search')?.value||'')},{capture:true});
    $('search')?.addEventListener('input',()=>setTimeout(enhanceEmpty,0));
    const grid=$('catalogGrid');if(grid)new MutationObserver(()=>queueMicrotask(enhanceEmpty)).observe(grid,{childList:true,subtree:true});
    setTimeout(enhanceEmpty,0);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
