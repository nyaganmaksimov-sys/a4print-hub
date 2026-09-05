(()=>{
  if(window.__A4_MANAGER_RUNTIME__)return;
  window.__A4_MANAGER_RUNTIME__=true;

  const fallback3d={
    '3D-печать':['3D-печать по готовой модели','3D-печать детали на заказ','3D-печать прототипа','Мелкосерийная 3D-печать'],
    '3D-моделирование':['Создание 3D-модели по чертежу','Моделирование детали по образцу','Подготовка и доработка модели к печати'],
    '3D-сканирование':['3D-сканирование детали','Оцифровка объекта для последующего моделирования'],
    'Индивидуальные изделия':['Сувенир по индивидуальному заказу','Макет или прототип','Запчасть или крепёж по образцу']
  };

  function start(){
    const $=id=>document.getElementById(id);
    if(!$('calculator')||!$('clientForm'))return;
    const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
    const money=v=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(Number(v||0));
    const cfg=window.A4PRINT_CONFIG||{};
    const base=String(cfg.supabaseUrl||'').replace(/\/$/,'');
    const key=cfg.supabasePublishableKey||'';
    let projectRef='qgakliolffnwkymoqvzn';
    try{projectRef=new URL(base).hostname.split('.')[0]||projectRef}catch{}
    const storageKey=`sb-${projectRef}-auth-token`;
    let customers=[];
    let priceGroups=[];
    let selectedPriceGroup=null;
    let refreshPromise=null;

    function storedSession(){
      try{
        const parsed=JSON.parse(localStorage.getItem(storageKey)||'null');
        if(!parsed)return null;
        if(parsed.currentSession)return parsed.currentSession;
        if(parsed.session)return parsed.session;
        return parsed;
      }catch{return null}
    }
    function saveSession(next){
      if(!next?.access_token)return;
      const old=storedSession()||{};
      const value={...old,...next};
      if(!value.expires_at&&value.expires_in)value.expires_at=Math.floor(Date.now()/1000)+Number(value.expires_in||0);
      localStorage.setItem(storageKey,JSON.stringify(value));
    }
    async function refreshSession(){
      if(refreshPromise)return refreshPromise;
      refreshPromise=(async()=>{
        const current=storedSession();
        if(!current?.refresh_token)return null;
        const r=await fetch(`${base}/auth/v1/token?grant_type=refresh_token`,{
          method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'},
          body:JSON.stringify({refresh_token:current.refresh_token}),cache:'no-store'
        });
        const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={message:text}}
        if(!r.ok||!data?.access_token)return null;
        saveSession(data);return data;
      })().finally(()=>{refreshPromise=null});
      return refreshPromise;
    }
    async function token(){
      let s=storedSession();
      const exp=Number(s?.expires_at||0);
      if(s?.access_token&&(!exp||exp-Math.floor(Date.now()/1000)>90))return s.access_token;
      s=await refreshSession();
      return s?.access_token||storedSession()?.access_token||'';
    }
    async function request(path,{method='GET',body,prefer,retry=true}={}){
      const access=await token();
      if(!access){const e=new Error('Требуется повторный вход в A4PRINT HUB.');e.status=401;throw e}
      const headers={apikey:key,Authorization:`Bearer ${access}`,Accept:'application/json'};
      if(body!==undefined)headers['Content-Type']='application/json';
      if(prefer)headers.Prefer=prefer;
      const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
      if(r.status===401&&retry&&await refreshSession())return request(path,{method,body,prefer,retry:false});
      const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
      if(!r.ok){const e=new Error(data?.message||data?.hint||data?.details||data?.error_description||data?.error||`HTTP ${r.status}`);e.status=r.status;throw e}
      return data;
    }

    function isCalculatorItem(item){
      if(Number(item.sale_price)<=0)return false;
      if(String(item.item_type||'').toUpperCase()==='SERVICE')return true;
      const n=String(item.name||'').toLowerCase();
      return /(печать|ксерокоп|скан|ламинир|брош|визит|листов|буклет|календар|плакат|постер|баннер|накле|штамп|оттиск|оснастк|перевод|набор текста|запись на флеш|ретуш|фотопечать|фото печать|фото на |фнд|диплом|презентац|сувенир|кружк|футбол)/i.test(n);
    }
    function categoryFor(name){
      const n=String(name||'').toLowerCase();
      if(/3d|моделир|прототип/.test(n))return '3D-ARTPRINT';
      if(/штамп|печати ип|печати ооо|печать по оттиску|оттиск|оснастк/.test(n))return 'Печати и штампы';
      if(/фотопечать|фото печать|фото на |фнд|ретуш|электронная версия фото/.test(n))return 'Фото';
      if(/ламинир|брош/.test(n))return 'Ламинирование и брошюровка';
      if(/визит|листов|буклет|накле|баннер|плакат|постер|календар|сувенир|кружк|футбол/.test(n))return 'Полиграфия и сувениры';
      if(/перевод/.test(n))return 'Переводы';
      if(/скан|набор текста|запись на флеш/.test(n))return 'Документы и оцифровка';
      if(/печать|ксерокоп|диплом|презентац/.test(n))return 'Печать документов';
      return 'Прочие услуги';
    }
    function parseTier(name){
      const s=String(name||'').trim();
      let m=s.match(/\((\d+)\s*-\s*(\d+)\)\s*$/);
      if(m)return {min:Number(m[1]),max:Number(m[2]),label:`${m[1]}–${m[2]}`};
      m=s.match(/\((\d+)\s*(?:и\s*выше|\+)\)\s*$/i);
      if(m)return {min:Number(m[1]),max:Infinity,label:`${m[1]}+`};
      return null;
    }
    function baseName(name,tier){
      let s=String(name||'').trim();
      if(tier){
        s=s.replace(/\s*\([^()]+\)\s*$/,'').trim();
        s=s.replace(/\s*-\s*(?:\d+\s*-\s*\d+|\d+\s*и\s*выше)\s*$/i,'').trim();
      }
      return s;
    }
    function buildPriceGroups(items){
      const dedup=new Map();
      [...items].sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||''))).forEach(item=>{
        const exact=String(item.name||'').trim().toLowerCase();
        if(!dedup.has(exact))dedup.set(exact,item);
      });
      const groups=new Map();
      [...dedup.values()].filter(isCalculatorItem).forEach(item=>{
        const tier=parseTier(item.name);
        const base=baseName(item.name,tier);
        const cat=categoryFor(base);
        if(cat==='3D-ARTPRINT')return;
        const k=`${cat}::${base.toLowerCase()}`;
        if(!groups.has(k))groups.set(k,{id:k,category:cat,name:base,items:[]});
        groups.get(k).items.push({...item,tier});
      });
      return [...groups.values()].map(g=>{
        g.items.sort((a,b)=>(a.tier?.min??0)-(b.tier?.min??0));
        g.minPrice=Math.min(...g.items.map(x=>Number(x.sale_price)||0).filter(x=>x>0));
        return g;
      }).sort((a,b)=>a.category.localeCompare(b.category,'ru')||a.name.localeCompare(b.name,'ru'));
    }
    function chooseItem(group,qty){
      if(!group?.items?.length)return null;
      const tiered=group.items.filter(x=>x.tier);
      if(!tiered.length)return group.items[0];
      const hit=tiered.find(x=>qty>=x.tier.min&&qty<=x.tier.max);
      if(hit)return hit;
      const below=[...tiered].filter(x=>qty>=x.tier.min).sort((a,b)=>b.tier.min-a.tier.min)[0];
      return below||tiered[0];
    }
    function setPriceMode(){
      const isA4=$('direction').value==='A4_PRINT';
      $('unitPrice').readOnly=isA4;
      $('unitPrice').title=isA4?'Цена берётся автоматически из действующего прайса A4PRINT HUB':'Для 3D-ARTPRINT цена пока вводится вручную';
      const label=$('unitPrice').closest('label');
      if(label&&label.firstChild?.nodeType===3)label.firstChild.nodeValue=isA4?'Цена по прайсу, ₽':'Цена за единицу, ₽';
    }
    function renderCategories(){
      if($('direction').value==='3D_ARTPRINT'){
        $('category').innerHTML=Object.keys(fallback3d).map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
        renderServices();setPriceMode();return;
      }
      const cats=[...new Set(priceGroups.map(x=>x.category))];
      $('category').innerHTML=cats.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
      renderServices();setPriceMode();
    }
    function renderServices(){
      selectedPriceGroup=null;
      if($('direction').value==='3D_ARTPRINT'){
        const list=fallback3d[$('category').value]||[];
        $('service').innerHTML='<option value="">Выберите услугу</option>'+list.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
        $('unitPrice').value=0;
        $('serviceHint').textContent='Для 3D-ARTPRINT в базе пока нет заполненного прайса. До его заполнения цена вводится вручную.';
        calc();return;
      }
      const list=priceGroups.filter(x=>x.category===$('category').value);
      $('service').innerHTML='<option value="">Выберите услугу</option>'+list.map(g=>`<option value="${esc(g.id)}">${esc(g.name)} — от ${esc(money(g.minPrice))}</option>`).join('');
      $('unitPrice').value=0;
      $('serviceHint').textContent=list.length?'Выберите услугу. Цена подставится автоматически из действующего каталога, а для тиражных услуг изменится по количеству.':'В этой категории пока нет цен.';
      calc();
    }
    function applySelectedPrice(){
      if($('direction').value!=='A4_PRINT'){calc();return}
      selectedPriceGroup=priceGroups.find(x=>x.id===$('service').value)||null;
      if(!selectedPriceGroup){$('unitPrice').value=0;calc();return}
      const qty=Math.max(1,Number($('qty').value)||1);
      const item=chooseItem(selectedPriceGroup,qty);
      const price=Number(item?.sale_price)||0;
      $('unitPrice').value=price;
      const tier=item?.tier?` · тариф ${item.tier.label} шт.`:'';
      const fallback=item?.tier&&!(qty>=item.tier.min&&qty<=item.tier.max)?' · использован ближайший доступный тариф':'';
      $('serviceHint').textContent=`${selectedPriceGroup.name}: ${money(price)} за ${item?.unit||'шт'}${tier}${fallback}. Цена взята из каталога A4PRINT HUB.`;
      calc();
    }
    function calc(){
      const qty=Math.max(1,Number($('qty').value)||1),price=Math.max(0,Number($('unitPrice').value)||0),extras=Math.max(0,Number($('extras').value)||0),discount=Math.min(100,Math.max(0,Number($('discount').value)||0)),urgency=Math.max(0,Number($('urgency').value)||0),markup=Math.max(0,Number($('markup').value)||0);
      let total=qty*price+extras;total*=1+markup/100;total*=1+urgency/100;total*=1-discount/100;
      $('calcTotal').textContent=money(total);
    }
    async function loadPriceCatalog(){
      const data=await request('/rest/v1/catalog_items?select=id,sku,name,item_type,category,unit,sale_price,description,updated_at&is_active=eq.true&sale_price=gt.0&order=updated_at.desc&limit=1000');
      priceGroups=buildPriceGroups(Array.isArray(data)?data:[]);
      renderCategories();
    }

    $('direction').onchange=renderCategories;
    $('category').onchange=renderServices;
    $('service').onchange=applySelectedPrice;
    $('qty').oninput=()=>{if(selectedPriceGroup)applySelectedPrice();else calc()};
    ['extras','discount','urgency','markup'].forEach(id=>$(id).oninput=calc);
    $('unitPrice').oninput=calc;
    $('resetCalc').onclick=()=>{
      $('direction').value='A4_PRINT';$('qty').value=1;$('unitPrice').value=0;$('extras').value=0;$('discount').value=0;$('urgency').value=0;$('markup').value=0;
      renderCategories();calc();
    };

    function setClientType(){const business=$('clientType').value!=='PERSON';$('businessFields').classList.toggle('hidden',!business);if(business&&!$('clientSignatoryName').value)$('clientSignatoryName').value=$('clientFullName').value}
    function renderCustomers(){const q=$('customerSearch').value.trim().toLowerCase();const rows=customers.filter(c=>`${c.full_name||''} ${c.company_name||''} ${c.phone||''} ${c.email||''} ${c.inn||''}`.toLowerCase().includes(q)).slice(0,8);$('customers').innerHTML=rows.map(c=>`<a class="customer-mini" href="./customer.html?id=${encodeURIComponent(c.id)}" style="text-decoration:none;color:inherit"><b>${esc(c.full_name||c.company_name||'Без имени')}${c.inn?'<span class="billing-badge">Реквизиты</span>':''}</b><small>${esc(c.company_name||'Частный клиент')} · ${esc(c.phone||'телефон не указан')} ${c.email?'· '+esc(c.email):''}${c.inn?' · ИНН '+esc(c.inn):''}</small></a>`).join('')||'<div class="empty-mini">Клиенты не найдены</div>'}
    async function loadCustomers(){try{const data=await request('/rest/v1/customers?select=id,full_name,company_name,email,phone,inn,customer_type,updated_at,created_at&order=updated_at.desc&limit=100');customers=Array.isArray(data)?data:[];renderCustomers()}catch(ex){$('customers').innerHTML=`<div class="empty-mini">Не удалось загрузить клиентов: ${esc(ex.message)}</div>`;throw ex}}
    async function loadOrders(){try{const data=await request('/rest/v1/orders?select=id,order_number,status,total,created_at,customers(full_name,company_name)&order=created_at.desc&limit=8');const rows=Array.isArray(data)?data:[];$('orders').innerHTML=rows.map(o=>`<a class="order-mini" href="./order.html?id=${encodeURIComponent(o.id)}" style="text-decoration:none;color:inherit"><b>Заказ №${esc(o.order_number||'—')} · ${money(o.total)}</b><small>${esc(o.customers?.full_name||o.customers?.company_name||'Клиент не указан')} · ${esc(o.status||'')}</small></a>`).join('')||'<div class="empty-mini">Заказов пока нет</div>'}catch(ex){$('orders').innerHTML=`<div class="empty-mini">Не удалось загрузить заказы: ${esc(ex.message)}</div>`;throw ex}}

    $('toggleClientForm').onclick=()=>{$('clientCreate').classList.toggle('open');if($('clientCreate').classList.contains('open'))$('clientFullName').focus()};
    $('cancelClient').onclick=()=>{$('clientCreate').classList.remove('open');$('clientFormMsg').textContent=''};
    $('clientType').onchange=setClientType;
    $('clientFullName').oninput=()=>{if($('clientType').value!=='PERSON'&&!$('clientSignatoryName').value)$('clientSignatoryName').value=$('clientFullName').value};
    $('customerSearch').oninput=renderCustomers;setClientType();setPriceMode();calc();

    $('clientForm').onsubmit=async e=>{
      e.preventDefault();const form=e.currentTarget,btn=$('saveClient'),msg=$('clientFormMsg'),type=$('clientType').value,full=$('clientFullName').value.trim(),phone=$('clientPhone').value.trim(),email=$('clientEmail').value.trim(),inn=$('clientInn').value.trim();
      msg.className='client-form-msg';if(!full){msg.className='client-form-msg err';msg.textContent='Укажите ФИО или контактное лицо.';return}
      const duplicate=customers.find(c=>(phone&&c.phone===phone)||(email&&c.email===email)||(inn&&c.inn===inn));if(duplicate&&!confirm(`Похожий клиент уже есть: ${duplicate.full_name||duplicate.company_name}. Всё равно создать нового?`))return;
      const payload={customer_type:type,full_name:full,phone:phone||null,email:email||null,notes:$('clientNotes').value.trim()||null,company_name:type==='PERSON'?null:($('clientCompany').value.trim()||$('clientLegalName').value.trim()||null),legal_name:type==='PERSON'?null:($('clientLegalName').value.trim()||null),inn:type==='PERSON'?null:(inn||null),kpp:type==='PERSON'?null:($('clientKpp').value.trim()||null),ogrn:type==='PERSON'?null:($('clientOgrn').value.trim()||null),legal_address:type==='PERSON'?null:($('clientLegalAddress').value.trim()||null),actual_address:type==='PERSON'?null:($('clientActualAddress').value.trim()||null),bank_name:type==='PERSON'?null:($('clientBankName').value.trim()||null),bik:type==='PERSON'?null:($('clientBik').value.trim()||null),settlement_account:type==='PERSON'?null:($('clientSettlement').value.trim()||null),correspondent_account:type==='PERSON'?null:($('clientCorrespondent').value.trim()||null),signatory_name:type==='PERSON'?null:($('clientSignatoryName').value.trim()||null),signatory_title:type==='PERSON'?null:($('clientSignatoryTitle').value.trim()||null),signatory_basis:type==='PERSON'?null:($('clientSignatoryBasis').value.trim()||null),updated_at:new Date().toISOString()};
      btn.disabled=true;msg.textContent='Сохранение…';try{await request('/rest/v1/customers',{method:'POST',body:payload,prefer:'return=representation'});msg.className='client-form-msg ok';msg.textContent='Клиент сохранён.';form.reset();$('clientType').value='PERSON';setClientType();await loadCustomers();setTimeout(()=>{$('clientCreate').classList.remove('open');msg.textContent=''},900)}catch(ex){msg.className='client-form-msg err';msg.textContent='Ошибка: '+ex.message}finally{btn.disabled=false}
    };

    (async()=>{
      const s=storedSession();if(s?.user?.email)$('userEmail').textContent=s.user.email;
      try{
        const profile=await request('/rest/v1/rpc/get_my_staff_profile',{method:'POST',body:{}});if(profile?.status&&profile.status!=='ACTIVE')throw new Error('Учётная запись сотрудника не активна.');if(profile?.email)$('userEmail').textContent=profile.email;
        const results=await Promise.allSettled([loadPriceCatalog(),loadCustomers(),loadOrders()]);
        if(results[0].status==='rejected'){$('serviceHint').textContent='Не удалось загрузить прайс: '+results[0].reason.message;console.error(results[0].reason)}
      }catch(ex){const msg=ex?.status===401?'Сессия завершена. Войдите снова.':ex.message;if($('customers').textContent.includes('Загрузка'))$('customers').innerHTML=`<div class="empty-mini">${esc(msg)}</div>`;if($('orders').textContent.includes('Загрузка'))$('orders').innerHTML=`<div class="empty-mini">${esc(msg)}</div>`;console.error('A4 manager runtime:',ex)}
    })();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
