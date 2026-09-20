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
    session:null,profile:null,organizationId:null,isAdmin:false,isOperator:false,backendOnline:false,syncing:false,
    catalog:[],filtered:[],stock:{},accounts:[],operators:[],cart:[],customer:null,
    category:'CORE',payment:'Наличные',shift:null,queue:[],favorites:new Set(),search:'',catalogSort:'SMART',
    catalogUpdated:null,installPrompt:null,discount:{type:'PERCENT',value:0}
  };

  let toastTimer=null,customerTimer=null,healthTimer=null,syncTimer=null;
  function toast(text,error=false){const n=$('toast');n.textContent=text;n.className='toast show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>n.className='toast',3200)}
  function friendly(e,fallback='Ошибка'){const m=String(e?.message||e||'').trim();if(!m)return fallback;if(/invalid login credentials|invalid_credentials/i.test(m))return'Неверный email или пароль.';if(/failed to fetch|network|load failed|abort|socket|fetch failed/i.test(m))return'Нет связи с сервером.';if(/POS_ACCESS_REQUIRED|ADMIN_REQUIRED|Нет доступа/i.test(m))return'У этой учётной записи нет доступа к кассе.';return m}
  function uuid(){return crypto.randomUUID?crypto.randomUUID():`k2-${Date.now()}-${Math.random().toString(36).slice(2)}`}
  const round2=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,Number(value||0)));
  function subtotal(){return round2(state.cart.reduce((s,x)=>s+Number(x.price||0)*Number(x.qty||0),0))}
  function discountAmount(){
    const base=subtotal();
    if(!(base>0))return 0;
    const value=Math.max(0,Number(state.discount?.value||0));
    if(state.discount?.type==='RUB')return round2(Math.min(base,value));
    return round2(base*clamp(value,0,100)/100);
  }
  function discountPercent(){
    const base=subtotal();
    return base>0?clamp(discountAmount()/base*100,0,100):0;
  }
  function total(){return round2(Math.max(0,subtotal()-discountAmount()))}
  function count(){return state.cart.reduce((s,x)=>s+Number(x.qty||0),0)}
  function saleItems(){
    const discount=Math.round(discountPercent()*1000000)/1000000;
    return state.cart.map(x=>({...x,discount,base_price:Number(x.price||0)}));
  }
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
      supabase.from('users').select('id,full_name,email,is_active,organization_unit_id').eq('auth_user_id',state.session.user.id).maybeSingle()
    ]);
    if(a.error)throw a.error;if(o.error)throw o.error;if(p.error)throw p.error;
    state.isAdmin=!!a.data;state.isOperator=!!o.data;state.profile=p.data;
    if(!state.isAdmin&&!state.isOperator)throw new Error('Нет доступа к кассе.');
    if(state.profile?.is_active===false)throw new Error('Учётная запись сотрудника отключена.');
    const unitId=state.profile?.organization_unit_id;
    if(!unitId)throw new Error('Сотрудник не привязан к компании.');
    const unit=await supabase.from('organization_units').select('organization_id,is_active').eq('id',unitId).maybeSingle();
    if(unit.error)throw unit.error;
    if(!unit.data?.organization_id||unit.data.is_active===false)throw new Error('Компания сотрудника недоступна.');
    state.organizationId=unit.data.organization_id;
    // A4PRINT KASSA is a dedicated POS application. Keep its catalog/accounts pinned
    // to A4PRINT even when the signed-in staff profile also belongs to another HUB company.
    const a4=await supabase.from('organizations').select('id,code,is_active').eq('code','A4PRINT').maybeSingle();
    if(a4.data?.id&&a4.data.is_active!==false)state.organizationId=a4.data.id;
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
      if(!state.organizationId)throw new Error('Компания кассы не определена.');
      const [g,a,o]=await Promise.all([
        supabase.rpc('get_pos_catalog'),
        supabase.from('cash_accounts').select('id,name,account_type,is_active').eq('organization_id',state.organizationId).eq('is_active',true).order('name'),
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

  const CATALOG_GROUPS=[
    {id:'PRINT_BASIC',label:'Печать и копии',icon:'▤'},
    {id:'PRINT_COLOR',label:'Цветная печать',icon:'▨'},
    {id:'PRINT_SPECIAL',label:'Плотная / широкоформатная',icon:'▥'},
    {id:'PHOTO_DOCS',label:'Фото на документы',icon:'▣'},
    {id:'PHOTO_SMALL',label:'Фотопечать 10×15',icon:'▧'},
    {id:'PHOTO_LARGE',label:'Фотопечать A5 / A4 / A3',icon:'▦'},
    {id:'PHOTO_SPECIAL',label:'Фото на памятник и рамки',icon:'◇'},
    {id:'POST_PRINT',label:'Ламинация и переплёт',icon:'▥'},
    {id:'POLYGRAPHY',label:'Полиграфия',icon:'◇'},
    {id:'STAMP_MAKE',label:'Изготовление печатей',icon:'◉'},
    {id:'STAMP_EQUIPMENT',label:'Оснастки для печатей',icon:'▦'},
    {id:'STAMP_SUPPLIES',label:'Расходники для печатей',icon:'◌'},
    {id:'DESIGN',label:'Дизайн и обработка',icon:'✦'},
    {id:'TRANSLATIONS',label:'Переводы',icon:'≡'},
    {id:'DIGITAL',label:'Файлы и оцифровка',icon:'▱'},
    {id:'STATIONERY',label:'Канцтовары',icon:'□'},
    {id:'COUNTER_GOODS',label:'Товары у кассы',icon:'▰'},
    {id:'OTHER',label:'Прочее',icon:'•••'}
  ];
  const CATALOG_GROUP_BY_ID=Object.fromEntries(CATALOG_GROUPS.map(x=>[x.id,x]));
  const CORE_GROUPS=new Set(['PRINT_BASIC','PRINT_COLOR','PRINT_SPECIAL','PHOTO_DOCS','PHOTO_SMALL','PHOTO_LARGE','POST_PRINT','POLYGRAPHY','STAMP_MAKE','DIGITAL']);

  function catalogText(row){
    return String(row?.name||'').toLowerCase().replaceAll('ё','е').replace(/[×х]/g,'x').replace(/\s+/g,' ').trim();
  }
  function isSampleCatalogItem(row){
    const n=catalogText(row);
    if(n.startsWith('образец'))return true;
    if(/^изготовление печати ооо\s+.+/.test(n))return true;
    if(/изготовлени[ея]\s+(дубликата ключа|ключей дубликатов)\s+на\s+/.test(n))return true;
    if(/^факсимиле\s+.+\d[\d()\-\s]{5,}/.test(n))return true;
    if(/\(\s*\d+\s*шт\.?\s*\)/.test(n))return true;
    return false;
  }
  function isHiddenCatalogItem(row){
    const category=String(row?.category||'').trim().toLowerCase();
    const article=String(row?.article||'').trim().toUpperCase();
    if(article==='A4HUB-ORDER'||category==='заказы hub')return true;
    if(Number(row?.sale_price||0)<=0)return true;
    if(String(row?.item_type||'').toUpperCase()==='MATERIAL'&&category==='краски')return true;
    return false;
  }
  function catalogGroupId(row){
    const n=catalogText(row);
    if(/(штемпельн.*подушк|подушк.*печат|краск.*штемп)/.test(n))return 'STAMP_SUPPLIES';
    if(/(оснастк|датер|trodat|colop|printy|самонаборн.*штамп|стандартн.*штамп)/.test(n))return 'STAMP_EQUIPMENT';
    if(/(изготовлени[ея]\s+печат|за\s+штамп|факсимил|оттиск|печат[ьи]\s+(ооо|ип|врач|педагог|нотари|кадастр))/.test(n))return 'STAMP_MAKE';
    if(/(фото\s+на\s+(паспорт|загран|документ|удостовер|виз|анкет)|фнд\b|3\s*[x*]\s*4)/.test(n))return 'PHOTO_DOCS';
    if(/(фото\s+на\s+памятник|фото\s*рамк)/.test(n))return 'PHOTO_SPECIAL';
    if(/(10\s*x\s*15|фотопечат.*10\s*x\s*15|фото\s*печат.*10\s*x\s*15|печать\s+фото\s+10\s*x\s*15)/.test(n))return 'PHOTO_SMALL';
    if(/(15\s*x\s*21|21\s*x\s*30|30\s*x\s*42|фотопечат|фото\s*печат|печать\s+фото|печать\s+а[345].*фото|а[345]\s+глянцев)/.test(n))return 'PHOTO_LARGE';
    if(/(ламинир|броширов|переплет|переплёт|пружин|резк[аи]\s+бумаг)/.test(n))return 'POST_PRINT';
    if(/(визит|листов|буклет|флаер|накле|баннер|плакат|календар|открытк|грамот|сертификат|меню|табличк|изготовлени[ея]\s+карточ)/.test(n))return 'POLYGRAPHY';
    if(/(дизайн|макет|ретуш|цветокорр|набор\s+текст)/.test(n))return 'DESIGN';
    if(/(нотариальн.*перевод|перевод\s+(документ|паспорт|водитель|свидетель))/.test(n))return 'TRANSLATIONS';
    if(/(оцифров|запись\s+на\s+флеш|отправк.*email|электронн.*фото|сканир|скан\b)/.test(n))return 'DIGITAL';
    if(/(а0|широкоформат|плотн|самоклеящ|баннерн.*печат)/.test(n))return 'PRINT_SPECIAL';
    if(/(цветн|\bцв\.?\b)/.test(n)&&/(печат|копи)/.test(n))return 'PRINT_COLOR';
    if(/(черно-бел|чёрно-бел|\bч\/?б\b|\bчб\b|копи[яир]|ксерок|печать\/копия|печать\s*а[0-5]|а[0-5]\s+.*печат|печать\s+диплом|печать\s+презентац|печать\s+доп\.?\s*лист)/.test(n))return 'PRINT_BASIC';
    if(/(бумаг|папк|файл\b|ручк|карандаш|маркер|скотч|клей|конверт|тетрад)/.test(n))return 'STATIONERY';
    if(/(батарей|брелок|игрушк|статуэт|смартфон|кабель|заряд|наушник|сувенир)/.test(n))return 'COUNTER_GOODS';
    return 'OTHER';
  }
  function categoryLabel(row){return CATALOG_GROUP_BY_ID[catalogGroupId(row)]?.label||'Прочее'}
  function categoryTitle(cat){
    if(cat==='CORE')return 'Основные услуги';
    if(cat==='ALL')return 'Все позиции';
    if(cat==='FAVORITES')return 'Избранное';
    return CATALOG_GROUP_BY_ID[cat]?.label||'Каталог';
  }
  function regularCatalog(){return dedupeCatalogRows(state.catalog.filter(x=>!isHiddenCatalogItem(x)&&!isSampleCatalogItem(x)))}
  function isCoreCatalogItem(row){return CORE_GROUPS.has(catalogGroupId(row))}
  function renderCategories(){
    const regular=regularCatalog();
    const counts=new Map(CATALOG_GROUPS.map(x=>[x.id,0]));
    regular.forEach(x=>{const id=catalogGroupId(x);counts.set(id,(counts.get(id)||0)+1)});
    const favorites=state.catalog.filter(x=>!isHiddenCatalogItem(x)&&state.favorites.has(x.id)).length;
    const core=regular.filter(isCoreCatalogItem).length;
    if($('coreCategoryCount'))$('coreCategoryCount').textContent=String(core);
    if($('favoritesCategoryCount'))$('favoritesCategoryCount').textContent=String(favorites);
    if($('allCategoryCount'))$('allCategoryCount').textContent=String(regular.length);
    const visibleGroups=CATALOG_GROUPS.filter(x=>(counts.get(x.id)||0)>0);
    $('dynamicCategories').innerHTML=visibleGroups.map(x=>{
      const divider=
        x.id==='PRINT_BASIC'?'<div class="category-subhead">Печать и копирование</div>':
        x.id==='PHOTO_DOCS'?'<div class="category-subhead">Фото</div>':
        x.id==='STAMP_MAKE'?'<div class="category-subhead">Печати и штампы</div>':'';
      return divider+`<button class="category" data-category="${x.id}"><span>${x.icon}</span><b>${esc(x.label)}</b><small>${counts.get(x.id)}</small></button>`;
    }).join('');
    document.querySelectorAll('.category').forEach(b=>b.onclick=()=>setCategory(b.dataset.category,b));
    document.querySelectorAll('.category').forEach(b=>b.classList.toggle('active',b.dataset.category===state.category));
  }
  function setCategory(cat,button){
    state.category=cat;
    document.querySelectorAll('.category').forEach(x=>x.classList.toggle('active',x===button||x.dataset.category===cat));
    $('catalogTitle').textContent=categoryTitle(cat);
    if(state.search){state.search='';$('search').value=''}
    filterCatalog();
  }
  function searchableText(x){return `${x.name||''} ${x.sku||''} ${x.article||''} ${x.barcode||''} ${x.category||''}`.toLowerCase().replaceAll('ё','е').replace(/[×х]/g,'x')}
  function catalogSearchRank(x,q){
    const needle=q.toLowerCase().replaceAll('ё','е').replace(/[×х]/g,'x');
    const code=[x.barcode,x.article,x.sku].filter(Boolean).map(v=>String(v).toLowerCase());
    const name=String(x.name||'').toLowerCase().replaceAll('ё','е').replace(/[×х]/g,'x');
    if(code.some(v=>v===needle))return 0;
    if(name===needle)return 1;
    if(name.startsWith(needle))return 2;
    return 3;
  }
  function sortCatalogRows(rows,q=''){
    const groupRank=Object.fromEntries(CATALOG_GROUPS.map((x,i)=>[x.id,i]));
    return [...rows].sort((a,b)=>{
      if(q){const r=catalogSearchRank(a,q)-catalogSearchRank(b,q);if(r)return r}
      if(state.catalogSort==='PRICE_ASC')return Number(a.sale_price||0)-Number(b.sale_price||0)||String(a.name||'').localeCompare(String(b.name||''),'ru');
      if(state.catalogSort==='PRICE_DESC')return Number(b.sale_price||0)-Number(a.sale_price||0)||String(a.name||'').localeCompare(String(b.name||''),'ru');
      if(state.catalogSort==='NAME')return String(a.name||'').localeCompare(String(b.name||''),'ru');
      const fav=Number(state.favorites.has(b.id))-Number(state.favorites.has(a.id));if(fav)return fav;
      const gr=(groupRank[catalogGroupId(a)]??99)-(groupRank[catalogGroupId(b)]??99);if(gr)return gr;
      return String(a.name||'').localeCompare(String(b.name||''),'ru');
    });
  }
  function dedupeCatalogRows(rows){
    const seen=new Set(),out=[];
    for(const row of rows){
      const key=`${catalogText(row)}|${Number(row.sale_price||0).toFixed(2)}`;
      if(seen.has(key))continue;
      seen.add(key);out.push(row);
    }
    return out;
  }
  function filterCatalog(){
    const q=state.search.trim().toLowerCase().replaceAll('ё','е').replace(/[×х]/g,'x');
    const allUsable=state.catalog.filter(x=>!isHiddenCatalogItem(x));
    let rows;
    if(q){
      rows=allUsable.filter(x=>searchableText(x).includes(q));
      $('catalogTitle').textContent='Результаты поиска';
    }else{
      const regular=allUsable.filter(x=>!isSampleCatalogItem(x));
      if(state.category==='FAVORITES')rows=allUsable.filter(x=>state.favorites.has(x.id));
      else if(state.category==='CORE')rows=regular.filter(isCoreCatalogItem);
      else if(state.category==='ALL')rows=regular;
      else rows=regular.filter(x=>catalogGroupId(x)===state.category);
      $('catalogTitle').textContent=categoryTitle(state.category);
    }
    state.filtered=dedupeCatalogRows(sortCatalogRows(rows,q));
    renderCatalog();
  }
  function renderCatalog(){
    const q=state.search.trim();
    const regularCount=regularCatalog().length;
    $('catalogMeta').textContent=q
      ?`Найдено ${state.filtered.length} позиций по запросу «${q}»`
      :`${state.filtered.length} позиций${state.category!=='ALL'?` · всего в кассе ${regularCount}`:''}${state.catalogUpdated?' · обновлено '+new Date(state.catalogUpdated).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):''}`;
    if(!state.filtered.length){
      const text=state.category==='FAVORITES'&&!q?'Здесь пока пусто. Нажмите ★ у нужных товаров и услуг — они появятся в избранном.':'Ничего не найдено';
      $('catalogGrid').innerHTML=`<div class="empty-grid"><b>${esc(text)}</b>${q?'<span>Попробуйте название, артикул или штрихкод.</span>':''}</div>`;return
    }
    $('catalogGrid').innerHTML=state.filtered.slice(0,400).map(x=>{
      const st=state.stock[x.external_id],group=categoryLabel(x),code=x.article||x.sku||x.barcode||'';
      return `<article class="product-card ${state.favorites.has(x.id)?'is-favorite':''}" data-add="${x.id}"><button class="fav ${state.favorites.has(x.id)?'on':''}" data-fav="${x.id}" title="${state.favorites.has(x.id)?'Убрать из избранного':'Добавить в избранное'}">★</button><div><div class="name">${esc(x.name)}</div><div class="meta"><span class="product-group">${esc(group)}</span>${code?`<span class="product-code">${esc(code)}</span>`:''}</div></div><div><div class="price">${money(x.sale_price)}</div>${st!=null?`<div class="stock">Остаток: ${Number(st).toLocaleString('ru-RU')}</div>`:''}</div></article>`
    }).join('');
    document.querySelectorAll('[data-add]').forEach(el=>el.onclick=()=>addToCart(el.dataset.add));
    document.querySelectorAll('[data-fav]').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFavorite(b.dataset.fav)});
  }
  function toggleFavorite(id){
    state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id);
    saveFavorites();renderCategories();filterCatalog();
  }

  function addToCart(id){
    const g=state.catalog.find(x=>x.id===id);if(!g)return;
    const catalogPrice=Number(g.sale_price||0);
    const row=state.cart.find(x=>x.id===id&&Number(x.price)===catalogPrice&&!x.price_overridden);
    if(row)row.qty+=1;
    else state.cart.push({key:uuid(),id:g.id,name:g.name,qty:1,price:catalogPrice,catalog_price:catalogPrice,price_overridden:false,article:g.article||g.sku||''});
    renderCart();
  }

  let adjustMode='PRICE',adjustIndex=-1;
  function closeAdjustModal(){
    const modal=$('adjustModal');if(!modal)return;
    modal.classList.remove('open');modal.setAttribute('aria-hidden','true');
  }
  function setAdjustType(type){
    state.__adjustType=type==='RUB'?'RUB':'PERCENT';
    document.querySelectorAll('[data-adjust-type]').forEach(b=>b.classList.toggle('active',b.dataset.adjustType===state.__adjustType));
    $('adjustSuffix').textContent=state.__adjustType==='RUB'?'₽':'%';
    $('adjustValue').max=state.__adjustType==='PERCENT'?'100':String(subtotal());
    updateAdjustPreview();
  }
  function updateAdjustPreview(){
    const hint=$('adjustHint'),input=$('adjustValue');if(!hint||!input)return;
    const value=Math.max(0,Number(String(input.value||'0').replace(',','.'))||0);
    if(adjustMode==='PRICE'){
      const row=state.cart[adjustIndex];if(!row)return;
      hint.textContent=`Стоимость позиции: ${money(value*Number(row.qty||0))}${Number(row.catalog_price)!==value?` · цена каталога ${money(row.catalog_price)}`:''}`;
      return;
    }
    const base=subtotal();
    const amount=state.__adjustType==='RUB'?Math.min(base,value):base*clamp(value,0,100)/100;
    hint.textContent=`Подытог ${money(base)} · скидка ${money(amount)} · к оплате ${money(Math.max(0,base-amount))}`;
  }
  function openPriceEditor(index){
    const row=state.cart[index];if(!row)return;
    adjustMode='PRICE';adjustIndex=index;
    $('adjustTitle').textContent='Изменить цену';
    $('adjustProductName').textContent=row.name;
    $('adjustTypeRow').hidden=true;
    $('adjustValueLabel').textContent='Цена за единицу';
    $('adjustSuffix').textContent='₽';
    $('adjustValue').min='0';$('adjustValue').max='';$('adjustValue').step='0.01';$('adjustValue').value=String(Number(row.price||0));
    $('adjustReset').textContent='Цена из каталога';
    $('adjustModal').classList.add('open');$('adjustModal').setAttribute('aria-hidden','false');
    updateAdjustPreview();
    setTimeout(()=>{$('adjustValue').focus();$('adjustValue').select()},0);
  }
  function openDiscountEditor(){
    if(!state.cart.length){toast('Сначала добавьте позицию в чек.',true);return}
    adjustMode='DISCOUNT';adjustIndex=-1;
    $('adjustTitle').textContent='Скидка на чек';
    $('adjustProductName').textContent=`Подытог: ${money(subtotal())}`;
    $('adjustTypeRow').hidden=false;
    state.__adjustType=state.discount?.type==='RUB'?'RUB':'PERCENT';
    $('adjustValueLabel').textContent='Размер скидки';
    $('adjustValue').min='0';$('adjustValue').step='0.01';$('adjustValue').value=String(Number(state.discount?.value||0));
    $('adjustReset').textContent='Убрать скидку';
    $('adjustModal').classList.add('open');$('adjustModal').setAttribute('aria-hidden','false');
    setAdjustType(state.__adjustType);
    setTimeout(()=>{$('adjustValue').focus();$('adjustValue').select()},0);
  }
  function saveAdjustment(){
    const raw=Number(String($('adjustValue').value||'').replace(',','.'));
    if(!Number.isFinite(raw)||raw<0){toast('Укажите корректное значение.',true);return}
    if(adjustMode==='PRICE'){
      const row=state.cart[adjustIndex];if(!row)return;
      row.price=round2(raw);
      row.price_overridden=Math.abs(Number(row.price)-Number(row.catalog_price||0))>0.0001;
    }else{
      if(state.__adjustType==='PERCENT'&&raw>100){toast('Скидка не может быть больше 100%.',true);return}
      if(state.__adjustType==='RUB'&&raw>subtotal()){toast('Скидка не может быть больше суммы чека.',true);return}
      state.discount={type:state.__adjustType,value:round2(raw)};
    }
    closeAdjustModal();renderCart();
  }
  function resetAdjustment(){
    if(adjustMode==='PRICE'){
      const row=state.cart[adjustIndex];if(row){row.price=Number(row.catalog_price||0);row.price_overridden=false}
    }else state.discount={type:'PERCENT',value:0};
    closeAdjustModal();renderCart();
  }

  function renderCart(){
    if(state.discount?.type==='RUB'&&Number(state.discount.value||0)>subtotal())state.discount.value=subtotal();
    $('cartCount').textContent=`${count()} поз.`;$('cartTotal').textContent=money(total());
    const pay=$('payButton');pay.querySelector('strong').textContent=money(total());pay.disabled=!state.cart.length||!state.shift;
    const d=discountAmount();
    $('discountLabel').textContent=d>0?`Подытог ${money(subtotal())} · скидка −${money(d)}`:'Скидка на чек';
    $('discountButton').textContent=d>0?(state.discount.type==='RUB'?`−${money(state.discount.value)}`:`−${Number(state.discount.value).toLocaleString('ru-RU')}%`):'Добавить';
    if(!state.cart.length){state.discount={type:'PERCENT',value:0};$('cartItems').innerHTML='<div class="empty-cart"><div>🧾</div><b>Чек пока пуст</b><span>Нажмите на товар или услугу слева</span></div>';return}
    $('cartItems').innerHTML=state.cart.map((x,i)=>`<div class="cart-row"><div class="cart-row-head"><div class="cart-row-name">${esc(x.name)}</div><div class="cart-row-total">${money(x.price*x.qty)}</div></div><div class="cart-row-actions"><div class="qty"><button data-minus="${i}">−</button><span>${x.qty}</span><button data-plus="${i}">+</button></div><button class="price-edit${x.price_overridden?' overridden':''}" data-price="${i}" title="Изменить цену">${money(x.price)} / шт${x.price_overridden?' · изменена':''}</button><button class="remove" data-remove="${i}">×</button></div></div>`).join('');
    document.querySelectorAll('[data-minus]').forEach(b=>b.onclick=()=>{const x=state.cart[+b.dataset.minus];x.qty-=1;if(x.qty<1)state.cart.splice(+b.dataset.minus,1);renderCart()});
    document.querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>{state.cart[+b.dataset.plus].qty+=1;renderCart()});
    document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{state.cart.splice(+b.dataset.remove,1);renderCart()});
    document.querySelectorAll('[data-price]').forEach(b=>b.onclick=()=>openPriceEditor(+b.dataset.price));
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
    const sale={id:uuid(),created_at:nowIso(),stage:'queued',tries:0,last_error:null,items:saleItems(),payment_method:state.payment,customer_id:state.customer?.id||null,customer_name:state.customer?.full_name||null,operator_id:$('operatorSelect').value||state.profile?.id||null,operator_name:$('operatorSelect').selectedOptions[0]?.textContent||state.profile?.full_name||'',cash_account_id:$('cashAccount').value||null,subtotal:subtotal(),discount_type:state.discount.type,discount_value:state.discount.value,discount_amount:discountAmount(),total:total(),shift:{id:state.shift.id,name:state.shift.name||null,openDate:state.shift.openDate||null}};
    await DB.put('queue',sale);
    state.cart=[];state.discount={type:'PERCENT',value:0};state.customer=null;$('customerName').textContent='Не выбран';renderCart();
    // The durable IndexedDB write is the cashier commit point. Do not block the
    // next receipt on rescanning the queue or any network synchronization.
    state.queue=[...state.queue,sale].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
    const chip=$('queueChip');if(chip){chip.querySelector('span').textContent=`Очередь ${state.queue.length}`;chip.className='status-chip warn'}
    renderQueueList();
    toast(state.backendOnline?'Продажа сохранена. Синхронизируем…':'Продажа сохранена локально. Уйдёт после восстановления связи.');
    window.dispatchEvent(new CustomEvent('a4:kassa-queue-pending',{detail:{id:sale.id}}));
  }

  async function refreshQueue(){state.queue=(await DB.getAll('queue')).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));const chip=$('queueChip');chip.querySelector('span').textContent=`Очередь ${state.queue.length}`;chip.className='status-chip '+(state.queue.length?'warn':'ok');renderQueueList()}
  function renderQueueList(){if(!state.queue.length){$('queueList').innerHTML='<div class="empty-grid">Очередь пуста. Все чеки синхронизированы.</div>';return}$('queueList').innerHTML=state.queue.map(x=>`<div class="queue-item ${x.last_error?'error':''}"><div class="row"><b>${new Date(x.created_at).toLocaleString('ru-RU')}</b><strong>${money(x.total)}</strong></div><small>${esc(x.operator_name||'Оператор')} · ${esc(x.payment_method||'')}</small><small>${x.stage==='backend_done'?'МойСклад: создан, сохраняем в HUB':'Ожидает отправки'}${x.last_error?` · ${esc(x.last_error)}`:''}</small></div>`).join('')}
  function openQueue(){$('queueDrawer').classList.add('open');$('queueDrawer').setAttribute('aria-hidden','false');renderQueueList()}
  function closeQueue(){$('queueDrawer').classList.remove('open');$('queueDrawer').setAttribute('aria-hidden','true')}

  async function syncQueue(){
    if(window.A4KassaQueueRecovery?.run){
      await window.A4KassaQueueRecovery.run();
      await refreshQueue();
      return;
    }
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
    const wasOnline=state.backendOnline;
    if(!navigator.onLine){state.backendOnline=false;renderNetwork();return false}
    const controller=new AbortController();const t=setTimeout(()=>controller.abort(),4500);
    try{const r=await fetch(`${API}/api/v1/health?kassa=${Date.now()}`,{cache:'no-store',signal:controller.signal});state.backendOnline=r.ok}catch{state.backendOnline=false}finally{clearTimeout(t)}
    renderNetwork();
    if(state.backendOnline){
      // A heartbeat must not rescan IndexedDB every 15 seconds. Recovery is
      // event-driven; wake it only after connectivity returns or when memory
      // already says there is pending work.
      if(!wasOnline||state.queue.length)syncQueue().catch(()=>{});
      if(!state.shift)loadShift().catch(()=>{});
    }
    return state.backendOnline
  }

  function bind(){
    $('loginForm').addEventListener('submit',loginSubmit);$('googleLogin').onclick=googleLogin;$('logout').onclick=logout;
    $('search').oninput=()=>{state.search=$('search').value;filterCatalog()};$('search').onkeydown=e=>{if(e.key==='Enter'){const exact=state.filtered.filter(x=>[x.barcode,x.article,x.sku].filter(Boolean).some(v=>String(v).toLowerCase()===state.search.trim().toLowerCase()));if(exact.length===1){addToCart(exact[0].id);$('search').select()}}};
    $('clearCart').onclick=()=>{if(state.cart.length&&confirm('Очистить текущий чек?')){state.cart=[];state.discount={type:'PERCENT',value:0};renderCart()}};
    $('discountButton').onclick=openDiscountEditor;
    $('adjustClose').onclick=closeAdjustModal;$('adjustCancel').onclick=closeAdjustModal;$('adjustSave').onclick=saveAdjustment;$('adjustReset').onclick=resetAdjustment;
    $('adjustValue').oninput=updateAdjustPreview;$('adjustValue').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();saveAdjustment()}};
    document.querySelectorAll('[data-adjust-type]').forEach(b=>b.onclick=()=>setAdjustType(b.dataset.adjustType));
    $('adjustModal').onclick=e=>{if(e.target===$('adjustModal'))closeAdjustModal()};
    document.querySelectorAll('.pay-tab').forEach(b=>b.onclick=()=>choosePayment(b.dataset.payment,b));$('payButton').onclick=queueSale;
    $('shiftButton').onclick=toggleShift;$('shiftChip').onclick=toggleShift;$('queueChip').onclick=openQueue;$('closeQueue').onclick=closeQueue;$('queueDrawer').onclick=e=>{if(e.target===$('queueDrawer'))closeQueue()};$('retryQueue').onclick=async()=>{await health();await syncQueue();toast(state.queue.length?'Не все чеки отправлены':'Очередь синхронизирована',!!state.queue.length)};
    $('refreshCatalog').onclick=()=>refreshRemoteData(true);$('syncNow').onclick=async()=>{await health();await Promise.allSettled([refreshRemoteData(true),loadShift(),loadStock(),syncQueue()])};$('catalogSort').onchange=()=>{state.catalogSort=$('catalogSort').value||'SMART';filterCatalog()};
    $('customerToggle').onclick=toggleCustomerPanel;$('customerSearch').oninput=()=>{clearTimeout(customerTimer);customerTimer=setTimeout(searchCustomers,250)};$('clearCustomer').onclick=()=>{state.customer=null;$('customerName').textContent='Не выбран';$('customerPanel').hidden=true};
    $('openOldPos').onclick=()=>location.href='../pos/';
    window.addEventListener('online',()=>health());window.addEventListener('offline',()=>{state.backendOnline=false;renderNetwork()});
    window.addEventListener('keydown',e=>{if(e.key==='F2'){e.preventDefault();$('search').focus();$('search').select()}if(e.key==='F4'){e.preventDefault();openDiscountEditor()}if(e.key==='F8'){e.preventDefault();if(!$('payButton').disabled)queueSale()}if(e.key==='Escape'){closeAdjustModal();closeQueue();$('customerPanel').hidden=true}});
    if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(console.warn),{once:true});
  }

  async function startApp(){
    if(!state.profile)await checkAccess();loadFavorites();renderOperators();renderAccounts();renderCart();renderShift();
    await loadCached();
    health().catch(()=>{});refreshRemoteData(false).catch(()=>{});
    queueMicrotask(()=>{loadShift().catch(()=>{});if(!Object.keys(state.stock||{}).length)loadStock().catch(()=>{});if(state.queue.length)syncQueue().catch(()=>{})});
    clearInterval(healthTimer);clearInterval(syncTimer);
    healthTimer=setInterval(()=>{if(!document.hidden)health()},15000);
    syncTimer=window.A4KassaQueueRecovery?.run?null:setInterval(()=>{if(!document.hidden)syncQueue()},5000);
  }

  async function boot(){
    bind();await DB.open();
    const s=await supabase.auth.getSession();state.session=s.data.session;
    if(!state.session){showAuth();return}
    try{await checkAccess();showApp();await startApp()}catch(e){showAuth(friendly(e,'Не удалось проверить доступ.'))}
  }
  boot().catch(e=>showAuth(friendly(e,'Ошибка запуска кассы.')));
})();
