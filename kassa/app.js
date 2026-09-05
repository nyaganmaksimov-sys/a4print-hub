(()=>{
  'use strict';
  const cfg=window.A4PRINT_CONFIG||{};
  const DB=window.A4KassaDB;
  const createClient=window.supabase?.createClient;
  if(!createClient||!DB){console.error('Kassa bootstrap modules missing');return}

  const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
    global:{fetch:window.A4SupabaseFetch||fetch},
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})+' ₽';
  const nowIso=()=>new Date().toISOString();
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  const state={
    session:null,profile:null,isAdmin:false,isOperator:false,backendOnline:false,syncing:false,
    catalog:[],filtered:[],stock:{},accounts:[],operators:[],cart:[],customer:null,
    category:'ALL',payment:'Наличные',shift:null,queue:[],favorites:new Set(),search:'',
    catalogUpdated:null,installPrompt:null
  };

  let toastTimer=null,customerTimer=null,healthTimer=null,syncTimer=null;
  function toast(text,error=false){const n=$('toast');n.textContent=text;n.className='toast show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>n.className='toast',3200)}
  function friendly(e,fallback='Ошибка'){const m=String(e?.message||e||'').trim();if(!m)return fallback;if(/invalid login credentials|invalid_credentials/i.test(m))return'Неверный email или пароль.';if(/failed to fetch|network|load failed|abort|socket|fetch failed/i.test(m))return'Нет связи с сервером.';if(/POS_ACCESS_REQUIRED|ADMIN_REQUIRED|Нет доступа/i.test(m))return'У этой учётной записи нет доступа к кассе.';return m}
  function uuid(){return crypto.randomUUID?crypto.randomUUID():`k2-${Date.now()}-${Math.random().toString(36).slice(2)}`}
  function total(){return state.cart.reduce((s,x)=>s+Number(x.price||0)*Number(x.qty||0),0)}
  function count(){return state.cart.reduce((s,x)=>s+Number(x.qty||0),0)}
  function favoritesKey(){return `a4_kassa_favorites_${state.profile?.id||'default'}`}
  function loadFavorites(){try{state.favorites=new Set(JSON.parse(localStorage.getItem(favoritesKey())||'[]'))}catch{state.favorites=new Set()}}
  function saveFavorites(){try{localStorage.setItem(favoritesKey(),JSON.stringify([...state.favorites]))}catch{}}

  async function api(path,opt={},retry=true){
    if(!state.session?.access_token)throw new Error('AUTH_REQUIRED');
    const controller=new AbortController();const t=setTimeout(()=>controller.abort(),8000);
    try{
      const r=await fetch(API+path,{...opt,cache:'no-store',signal:controller.signal,headers:{Authorization:`Bearer ${state.session.access_token}`,'Content-Type':'application/json','Accept':'application/json',...(opt.headers||{})}});
      const text=await r.text();let d={};try{d=text?JSON.parse(text):{}}catch{}
      if(r.status===401&&retry){const refreshed=await supabase.auth.refreshSession();if(refreshed.data?.session){state.session=refreshed.data.session;return api(path,opt,false)}}
      if(!r.ok)throw new Error(d.message||d.error||`HTTP ${r.status}`);
      state.backendOnline=true;return d;
    }catch(e){if(/AbortError|fetch|network|socket/i.test(String(e?.name||'')+' '+String(e?.message||'')))state.backendOnline=false;throw e}finally{clearTimeout(t)}
  }

  async function backendPasswordLogin(email,password){
    let serverError=null;
    if(API){
      try{
        const r=await fetch(`${API}/api/v1/mobile/auth/password`,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({email,password}),cache:'no-store'});
        const d=await r.json().catch(()=>({}));
        if(r.ok&&d?.success&&d?.session?.access_token&&d?.session?.refresh_token){
          const s=await supabase.auth.setSession({access_token:d.session.access_token,refresh_token:d.session.refresh_token});
          if(s.error)throw s.error;return s.data.session;
        }
        const err=new Error(d.message||d.error||`HTTP ${r.status}`);err.status=r.status;
        if(r.status>=400&&r.status<500&&r.status!==408&&r.status!==429)throw err;
        serverError=err;
      }catch(e){if(e?.status>=400&&e?.status<500&&e?.status!==408&&e?.status!==429)throw e;serverError=e}
    }
    const direct=await supabase.auth.signInWithPassword({email,password});
    if(direct.error)throw direct.error||serverError;
    return direct.data.session;
  }

  async function checkAccess(){
    const [a,o,p]=await Promise.all([
      supabase.rpc('has_role',{required_role:'ADMIN'}),
      supabase.rpc('has_role',{required_role:'POS_OPERATOR'}),
      supabase.from('users').select('id,full_name,email,is_active').eq('auth_user_id',state.session.user.id).maybeSingle()
    ]);
    if(a.error)throw a.error;if(o.error)throw o.error;if(p.error)throw p.error;
    state.isAdmin=!!a.data;state.isOperator=!!o.data;state.profile=p.data;
    if(!state.isAdmin&&!state.isOperator)throw new Error('Нет доступа к кассе.');
    if(state.profile?.is_active===false)throw new Error('Учётная запись сотрудника отключена.');
  }

  function showAuth(error=''){$('appView').hidden=true;$('authView').hidden=false;$('loginError').textContent=error}
  function showApp(){$('authView').hidden=true;$('appView').hidden=false}

  async function loginSubmit(e){
    e.preventDefault();$('loginError').textContent='';$('loginSubmit').disabled=true;$('loginSubmit').textContent='Входим…';
    try{
      state.session=await backendPasswordLogin($('loginEmail').value.trim().toLowerCase(),$('loginPassword').value);
      if(!state.session)throw new Error('Сессия не создана.');
      await checkAccess();showApp();await startApp();
    }catch(e2){showAuth(friendly(e2,'Не удалось войти.'))}
    finally{$('loginSubmit').disabled=false;$('loginSubmit').textContent='Войти'}
  }
  async function googleLogin(){
    $('loginError').textContent='';$('googleLogin').disabled=true;
    try{const redirectTo=new URL('./',location.href).href;const r=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo}});if(r.error)throw r.error}
    catch(e){$('loginError').textContent=friendly(e,'Не удалось открыть Google.');$('googleLogin').disabled=false}
  }

  function authStorageKey(k){k=String(k||'');return /^sb-.*-auth-token$/i.test(k)||/^a4print_mobile_(access|refresh|expires)$/i.test(k)||k==='a4print_auth_return_to'}
  function clearStore(store){try{const ks=[];for(let i=0;i<store.length;i++)ks.push(store.key(i));ks.filter(authStorageKey).forEach(k=>store.removeItem(k))}catch{}}
  function logout(){clearStore(localStorage);clearStore(sessionStorage);supabase.auth.signOut({scope:'local'}).catch(()=>{});location.replace(`./?logout=1&t=${Date.now()}`)}

  async function loadCached(){
    try{
      const [catalog,shift,updated]=await Promise.all([DB.getAll('catalog'),DB.getMeta('shift'),DB.getMeta('catalogUpdated')]);
      if(catalog.length){state.catalog=catalog;state.catalogUpdated=updated;renderCategories();filterCatalog()}
      if(shift?.id&&Date.now()-new Date(shift.checked_at||0).getTime()<18*3600*1000)state.shift=shift;
      await refreshQueue();renderShift();renderNetwork();
    }catch(e){console.warn('Local cache:',e)}
  }

  async function refreshRemoteData(force=false){
    if(!state.session)return;
    try{
      const org=await supabase.from('organizations').select('id').eq('code','A4PRINT').single();if(org.error)throw org.error;
      const [g,a,o]=await Promise.all([
        supabase.from('catalog_items').select('id,name,sku,article,barcode,item_type,category,unit,sale_price,external_id,last_synced_at').eq('organization_id',org.data.id).eq('is_active',true).order('name'),
        supabase.from('cash_accounts').select('id,name,account_type,is_active').eq('organization_id',org.data.id).eq('is_active',true).order('name'),
        supabase.rpc('get_pos_operators')
      ]);
      if(g.error)throw g.error;if(a.error)throw a.error;if(o.error)throw o.error;
      state.catalog=(g.data||[]).filter(x=>Number(x.sale_price||0)>=0);state.accounts=a.data||[];state.operators=o.data||[];
      state.catalogUpdated=nowIso();await DB.replaceAll('catalog',state.catalog);await DB.setMeta('catalogUpdated',state.catalogUpdated);
      renderCategories();renderAccounts();renderOperators();filterCatalog();
      $('catalogMeta').textContent=`${state.catalog.length} позиций · обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
      if(force)toast('Каталог обновлён');
    }catch(e){if(!state.catalog.length)toast(friendly(e,'Не удалось загрузить каталог'),true);console.warn(e)}
  }

  async function loadShift(){
    try{
      const d=await api('/api/v1/pos/shift');
      state.shift=d.shift?{...d.shift,store:d.store||null,checked_at:nowIso()}:null;
      await DB.setMeta('shift',state.shift);renderShift();
    }catch(e){renderShift();console.warn('Shift:',e)}
  }
  async function toggleShift(){
    if(!state.backendOnline){toast('Для открытия или закрытия смены нужна связь с сервером.',true);return}
    await refreshQueue();
    if(state.shift&&state.queue.length){openQueue();toast('Сначала синхронизируйте чеки в очереди.',true);return}
    $('shiftButton').disabled=true;
    try{
      const operatorId=$('operatorSelect').value||state.profile?.id||null;
      if(state.shift){await api('/api/v1/pos/shift/close',{method:'POST',body:JSON.stringify({operator_id:operatorId})});state.shift=null;await DB.setMeta('shift',null);toast('Смена закрыта')}
      else{const d=await api('/api/v1/pos/shift/open',{method:'POST',body:JSON.stringify({operator_id:operatorId})});state.shift={...(d.shift||{}),store:d.store||null,checked_at:nowIso()};await DB.setMeta('shift',state.shift);toast(d.alreadyOpen?'Подключились к открытой смене':'Смена открыта')}
      renderShift();
    }catch(e){toast(friendly(e,'Ошибка смены'),true)}finally{$('shiftButton').disabled=false}
  }

  async function loadStock(){try{const d=await api('/api/v1/integrations/moysklad/stock');state.stock=d.stock||{};filterCatalog()}catch(e){console.warn('Stock:',e)}}

  function categoryLabel(row){const raw=String(row.category||'').trim();if(raw)return raw;return row.item_type==='SERVICE'?'Услуги':'Товары'}
  function renderCategories(){
    const counts=new Map();state.catalog.forEach(x=>{const k=categoryLabel(x);counts.set(k,(counts.get(k)||0)+1)});
    const rows=[...counts].sort((a,b)=>a[0].localeCompare(b[0],'ru')).slice(0,20);
    $('dynamicCategories').innerHTML=rows.map(([name,n])=>`<button class="category" data-category="${esc(name)}"><span>${name==='Услуги'?'◆':'□'}</span>${esc(name)} <small>${n}</small></button>`).join('');
    document.querySelectorAll('.category').forEach(b=>b.onclick=()=>setCategory(b.dataset.category,b));
  }
  function setCategory(cat,button){state.category=cat;document.querySelectorAll('.category').forEach(x=>x.classList.toggle('active',x===button));$('catalogTitle').textContent=cat==='ALL'?'Все позиции':cat==='FAVORITES'?'Избранное':cat;filterCatalog()}
  function filterCatalog(){
    const q=state.search.trim().toLowerCase();
    state.filtered=state.catalog.filter(x=>{
      if(state.category==='FAVORITES'&&!state.favorites.has(x.id))return false;
      if(state.category!=='ALL'&&state.category!=='FAVORITES'&&categoryLabel(x)!==state.category)return false;
      if(!q)return true;
      return `${x.name||''} ${x.sku||''} ${x.article||''} ${x.barcode||''} ${x.category||''}`.toLowerCase().includes(q);
    });
    renderCatalog();
  }
  function renderCatalog(){
    $('catalogMeta').textContent=`${state.filtered.length} из ${state.catalog.length}${state.catalogUpdated?' · данные '+new Date(state.catalogUpdated).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):''}`;
    if(!state.filtered.length){$('catalogGrid').innerHTML='<div class="empty-grid">Ничего не найдено</div>';return}
    $('catalogGrid').innerHTML=state.filtered.slice(0,400).map(x=>{
      const st=state.stock[x.external_id];const meta=[x.article||x.sku||x.barcode,categoryLabel(x)].filter(Boolean).join(' · ');
      return `<article class="product-card" data-add="${x.id}"><button class="fav ${state.favorites.has(x.id)?'on':''}" data-fav="${x.id}" title="Избранное">★</button><div><div class="name">${esc(x.name)}</div><div class="meta">${esc(meta)}</div></div><div><div class="price">${money(x.sale_price)}</div>${st!=null?`<div class="stock">Остаток: ${Number(st).toLocaleString('ru-RU')}</div>`:''}</div></article>`
    }).join('');
    document.querySelectorAll('[data-add]').forEach(el=>el.onclick=()=>addToCart(el.dataset.add));
    document.querySelectorAll('[data-fav]').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFavorite(b.dataset.fav)});
  }
  function toggleFavorite(id){state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id);saveFavorites();filterCatalog()}

  function addToCart(id){const g=state.catalog.find(x=>x.id===id);if(!g)return;const row=state.cart.find(x=>x.id===id&&Number(x.price)===Number(g.sale_price));if(row)row.qty+=1;else state.cart.push({key:uuid(),id:g.id,name:g.name,qty:1,price:Number(g.sale_price||0),article:g.article||g.sku||''});renderCart()}
  function renderCart(){
    $('cartCount').textContent=`${count()} поз.`;$('cartTotal').textContent=money(total());
    const pay=$('payButton');pay.querySelector('strong').textContent=money(total());pay.disabled=!state.cart.length||!state.shift;
    if(!state.cart.length){$('cartItems').innerHTML='<div class="empty-cart"><div>🧾</div><b>Чек пока пуст</b><span>Нажмите на товар или услугу слева</span></div>';return}
    $('cartItems').innerHTML=state.cart.map((x,i)=>`<div class="cart-row"><div class="cart-row-head"><div class="cart-row-name">${esc(x.name)}</div><div class="cart-row-total">${money(x.price*x.qty)}</div></div><div class="cart-row-actions"><div class="qty"><button data-minus="${i}">−</button><span>${x.qty}</span><button data-plus="${i}">+</button></div><button class="price-edit" data-price="${i}">${money(x.price)} / шт</button><button class="remove" data-remove="${i}">×</button></div></div>`).join('');
    document.querySelectorAll('[data-minus]').forEach(b=>b.onclick=()=>{const x=state.cart[+b.dataset.minus];x.qty-=1;if(x.qty<1)state.cart.splice(+b.dataset.minus,1);renderCart()});
    document.querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>{state.cart[+b.dataset.plus].qty+=1;renderCart()});
    document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{state.cart.splice(+b.dataset.remove,1);renderCart()});
    document.querySelectorAll('[data-price]').forEach(b=>b.onclick=()=>{const i=+b.dataset.price;const v=prompt('Цена за единицу, ₽',String(state.cart[i].price));if(v===null)return;const n=Number(String(v).replace(',','.'));if(n>=0){state.cart[i].price=n;renderCart()}else toast('Укажите корректную цену',true)});
  }

  function renderAccounts(){const el=$('cashAccount');const prev=el.value;el.innerHTML=state.accounts.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');if(state.accounts.some(x=>x.id===prev))el.value=prev}
  function renderOperators(){const el=$('operatorSelect');const own=state.operators.find(x=>x.is_self)?.id||state.profile?.id||'';el.innerHTML=state.operators.map(x=>`<option value="${x.id}">${esc(x.full_name)}${x.is_self?' · вы':''}</option>`).join('');el.value=state.isAdmin?(own||state.operators[0]?.id||''):own;el.disabled=!state.isAdmin||state.operators.length<2}
  function renderShift(){const chip=$('shiftChip');if(state.shift){chip.className='status-chip ok';chip.querySelector('span').textContent='Смена открыта';$('shiftInfo').textContent=`Смена ${state.shift.name||''}`;$('shiftButton').textContent='Закрыть смену'}else{chip.className='status-chip warn';chip.querySelector('span').textContent='Смена закрыта';$('shiftInfo').textContent='Смена не открыта';$('shiftButton').textContent='Открыть смену'}renderCart()}
  function renderNetwork(){const online=navigator.onLine&&state.backendOnline;$('offlineBanner').hidden=online;const chip=$('networkChip');chip.className='status-chip '+(online?'ok':'bad');chip.querySelector('span').textContent=online?'Онлайн':'Офлайн'}

  async function choosePayment(method,button){state.payment=method;document.querySelectorAll('.pay-tab').forEach(x=>x.classList.toggle('active',x===button))}
  function toggleCustomerPanel(){const p=$('customerPanel');p.hidden=!p.hidden;if(!p.hidden)setTimeout(()=>$('customerSearch').focus(),0)}
  async function searchCustomers(){const q=$('customerSearch').value.trim();if(q.length<2){$('customerResults').innerHTML='';return}try{const d=await api('/api/v1/pos/customers?q='+encodeURIComponent(q));$('customerResults').innerHTML=(d.customers||[]).map(c=>`<button data-customer="${c.id}"><b>${esc(c.full_name)}</b><small>${esc(c.phone||c.email||c.company_name||'')}</small></button>`).join('')||'<small>Не найдено</small>';document.querySelectorAll('[data-customer]').forEach(b=>b.onclick=()=>{state.customer=(d.customers||[]).find(x=>x.id===b.dataset.customer)||null;$('customerName').textContent=state.customer?.full_name||'Не выбран';$('customerPanel').hidden=true})}catch(e){$('customerResults').innerHTML=`<small>${esc(friendly(e))}</small>`}}

  async function queueSale(){
    if(!state.cart.length)return;if(!state.shift){toast('Сначала откройте смену.',true);return}
    const sale={id:uuid(),created_at:nowIso(),stage:'queued',tries:0,last_error:null,items:state.cart.map(x=>({...x})),payment_method:state.payment,customer_id:state.customer?.id||null,customer_name:state.customer?.full_name||null,operator_id:$('operatorSelect').value||state.profile?.id||null,operator_name:$('operatorSelect').selectedOptions[0]?.textContent||state.profile?.full_name||'',cash_account_id:$('cashAccount').value||null,total:total(),shift:{id:state.shift.id,name:state.shift.name||null,openDate:state.shift.openDate||null}};
    await DB.put('queue',sale);state.cart=[];state.customer=null;$('customerName').textContent='Не выбран';renderCart();await refreshQueue();toast(state.backendOnline?'Продажа сохранена. Синхронизируем…':'Продажа сохранена локально. Уйдёт после восстановления связи.');syncQueue();
  }

  async function refreshQueue(){state.queue=(await DB.getAll('queue')).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));const chip=$('queueChip');chip.querySelector('span').textContent=`Очередь ${state.queue.length}`;chip.className='status-chip '+(state.queue.length?'warn':'ok');renderQueueList()}
  function renderQueueList(){if(!state.queue.length){$('queueList').innerHTML='<div class="empty-grid">Очередь пуста. Все чеки синхронизированы.</div>';return}$('queueList').innerHTML=state.queue.map(x=>`<div class="queue-item ${x.last_error?'error':''}"><div class="row"><b>${new Date(x.created_at).toLocaleString('ru-RU')}</b><strong>${money(x.total)}</strong></div><small>${esc(x.operator_name||'Оператор')} · ${esc(x.payment_method||'')}</small><small>${x.stage==='backend_done'?'МойСклад: создан, сохраняем в HUB':'Ожидает отправки'}${x.last_error?` · ${esc(x.last_error)}`:''}</small></div>`).join('')}
  function openQueue(){$('queueDrawer').classList.add('open');$('queueDrawer').setAttribute('aria-hidden','false');renderQueueList()}
  function closeQueue(){$('queueDrawer').classList.remove('open');$('queueDrawer').setAttribute('aria-hidden','true')}

  async function syncQueue(){
    if(state.syncing||!navigator.onLine||!state.backendOnline||!state.session)return;state.syncing=true;
    try{
      await refreshQueue();
      for(const sale of [...state.queue]){
        try{
          let current=sale;
          if(current.stage==='queued'){
            const d=await api('/api/v1/pos/sale',{method:'POST',body:JSON.stringify({items:current.items,payment_method:current.payment_method,customer_id:current.customer_id,operator_id:current.operator_id,client_operation_id:current.id})});
            current={...current,stage:'backend_done',backend_result:d,tries:Number(current.tries||0)+1,last_error:null};await DB.put('queue',current);
          }
          if(current.stage==='backend_done'){
            const d=current.backend_result||{};
            const r=await supabase.rpc('record_pos_sale',{p_moysklad_sale_id:d.moysklad?.id,p_moysklad_sale_name:d.moysklad?.name||null,p_moysklad_shift_id:current.shift?.id||null,p_operator_id:current.operator_id||null,p_customer_id:current.customer_id||null,p_cash_account_id:current.cash_account_id||null,p_payment_method:current.payment_method,p_total:Number(d.sum??current.total),p_items:current.items});
            if(r.error&&!/duplicate|unique/i.test(String(r.error.message||'')))throw r.error;
            await DB.put('receipts',{...current,id:current.id,stage:'done',synced_at:nowIso(),backend_result:d});await DB.del('queue',current.id);await DB.trimReceipts(100);
          }
        }catch(e){sale.tries=Number(sale.tries||0)+1;sale.last_error=friendly(e);await DB.put('queue',sale);if(/AUTH_REQUIRED|INVALID_SESSION|401/i.test(String(e?.message||'')))break}
      }
    }finally{state.syncing=false;await refreshQueue()}
  }

  async function health(){
    if(!navigator.onLine){state.backendOnline=false;renderNetwork();return false}
    const controller=new AbortController();const t=setTimeout(()=>controller.abort(),4500);
    try{const r=await fetch(`${API}/api/v1/health?kassa=${Date.now()}`,{cache:'no-store',signal:controller.signal});state.backendOnline=r.ok}catch{state.backendOnline=false}finally{clearTimeout(t)}
    renderNetwork();if(state.backendOnline){syncQueue();if(!state.shift)loadShift().catch(()=>{})}return state.backendOnline
  }

  function bind(){
    $('loginForm').addEventListener('submit',loginSubmit);$('googleLogin').onclick=googleLogin;$('logout').onclick=logout;
    $('search').oninput=()=>{state.search=$('search').value;filterCatalog()};$('search').onkeydown=e=>{if(e.key==='Enter'){const exact=state.filtered.filter(x=>[x.barcode,x.article,x.sku].filter(Boolean).some(v=>String(v).toLowerCase()===state.search.trim().toLowerCase()));if(exact.length===1){addToCart(exact[0].id);$('search').select()}}};
    $('clearCart').onclick=()=>{if(state.cart.length&&confirm('Очистить текущий чек?')){state.cart=[];renderCart()}};
    document.querySelectorAll('.pay-tab').forEach(b=>b.onclick=()=>choosePayment(b.dataset.payment,b));$('payButton').onclick=queueSale;
    $('shiftButton').onclick=toggleShift;$('shiftChip').onclick=toggleShift;$('queueChip').onclick=openQueue;$('closeQueue').onclick=closeQueue;$('queueDrawer').onclick=e=>{if(e.target===$('queueDrawer'))closeQueue()};$('retryQueue').onclick=async()=>{await health();await syncQueue();toast(state.queue.length?'Не все чеки отправлены':'Очередь синхронизирована',!!state.queue.length)};
    $('refreshCatalog').onclick=()=>refreshRemoteData(true);$('syncNow').onclick=async()=>{await health();await Promise.allSettled([refreshRemoteData(true),loadShift(),loadStock(),syncQueue()])};$('toggleFavoritesOnly').onclick=()=>{const b=document.querySelector('[data-category="FAVORITES"]');setCategory('FAVORITES',b)};
    $('customerToggle').onclick=toggleCustomerPanel;$('customerSearch').oninput=()=>{clearTimeout(customerTimer);customerTimer=setTimeout(searchCustomers,250)};$('clearCustomer').onclick=()=>{state.customer=null;$('customerName').textContent='Не выбран';$('customerPanel').hidden=true};
    $('openOldPos').onclick=()=>location.href='../pos/';
    window.addEventListener('online',()=>health());window.addEventListener('offline',()=>{state.backendOnline=false;renderNetwork()});
    window.addEventListener('keydown',e=>{if(e.key==='F2'){e.preventDefault();$('search').focus();$('search').select()}if(e.key==='F8'){e.preventDefault();if(!$('payButton').disabled)queueSale()}if(e.key==='Escape'){closeQueue();$('customerPanel').hidden=true}});
    if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(console.warn),{once:true});
  }

  async function startApp(){
    if(!state.profile)await checkAccess();loadFavorites();renderOperators();renderAccounts();renderCart();renderShift();
    await loadCached();
    await Promise.allSettled([health(),refreshRemoteData(false)]);
    if(state.backendOnline)await Promise.allSettled([loadShift(),loadStock(),syncQueue()]);
    clearInterval(healthTimer);clearInterval(syncTimer);healthTimer=setInterval(()=>{if(!document.hidden)health()},15000);syncTimer=setInterval(()=>{if(!document.hidden)syncQueue()},5000);
  }

  async function boot(){
    bind();await DB.open();
    const s=await supabase.auth.getSession();state.session=s.data.session;
    if(!state.session){showAuth();return}
    try{await checkAccess();showApp();await startApp()}catch(e){showAuth(friendly(e,'Не удалось проверить доступ.'))}
  }
  boot().catch(e=>showAuth(friendly(e,'Ошибка запуска кассы.')));
})();