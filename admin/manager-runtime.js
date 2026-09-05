(()=>{
  if(window.__A4_MANAGER_RUNTIME__)return;
  window.__A4_MANAGER_RUNTIME__=true;

  const services={
    A4_PRINT:{
      'Полиграфия':['Визитки','Листовки и флаеры','Буклеты','Календари','Плакаты и постеры','Широкоформатная печать'],
      'Сувенирная продукция':['Печать на кружках','Печать на футболках и текстиле','Фото-сувениры','Подарочная продукция с нанесением'],
      'Печати и штампы':['Изготовление печати','Изготовление штампа','Оснастка для печати'],
      'Фото и интерьер':['Фотокерамика','Фото для памятников','Интерьерная фотопечать']
    },
    '3D_ARTPRINT':{
      '3D-печать':['3D-печать по готовой модели','3D-печать детали на заказ','3D-печать прототипа','Мелкосерийная 3D-печать'],
      '3D-моделирование':['Создание 3D-модели по чертежу','Моделирование детали по образцу','Подготовка и доработка модели к печати'],
      '3D-сканирование':['3D-сканирование детали','Оцифровка объекта для последующего моделирования'],
      'Индивидуальные изделия':['Сувенир по индивидуальному заказу','Макет или прототип','Запчасть или крепёж по образцу']
    }
  };
  const hints={
    A4_PRINT:'Выберите категорию и услугу, затем укажите количество и цену. Дополнительные работы, скидка, срочность и наценка пересчитываются автоматически.',
    '3D_ARTPRINT':'Для 3D-заказов стоимость обычно зависит от модели, материала, массы и времени печати. Укажите согласованную цену за единицу вручную.'
  };

  function start(){
    const $=id=>document.getElementById(id);
    if(!$('calculator')||!$('clientForm'))return;
    const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    const money=v=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(Number(v||0));
    const cfg=window.A4PRINT_CONFIG||{};
    const base=String(cfg.supabaseUrl||'').replace(/\/$/,'');
    const key=cfg.supabasePublishableKey||'';
    let projectRef='qgakliolffnwkymoqvzn';
    try{projectRef=new URL(base).hostname.split('.')[0]||projectRef}catch{}
    const storageKey=`sb-${projectRef}-auth-token`;
    let customers=[];
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
          method:'POST',
          headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'},
          body:JSON.stringify({refresh_token:current.refresh_token}),
          cache:'no-store'
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

    function fillCategories(){
      const d=$('direction').value in services?$('direction').value:'A4_PRINT';
      const cats=Object.keys(services[d]||{});
      $('category').innerHTML=cats.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
      $('serviceHint').textContent=hints[d]||'';
      fillServices();
    }
    function fillServices(){
      const d=$('direction').value;
      const c=$('category').value;
      const list=services[d]?.[c]||[];
      $('service').innerHTML='<option value="">Выберите услугу</option>'+list.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
      calc();
    }
    function calc(){
      const qty=Math.max(1,Number($('qty').value)||1);
      const price=Math.max(0,Number($('unitPrice').value)||0);
      const extras=Math.max(0,Number($('extras').value)||0);
      const discount=Math.min(100,Math.max(0,Number($('discount').value)||0));
      const urgency=Math.max(0,Number($('urgency').value)||0);
      const markup=Math.max(0,Number($('markup').value)||0);
      let total=qty*price+extras;
      total*=1+markup/100;
      total*=1+urgency/100;
      total*=1-discount/100;
      $('calcTotal').textContent=money(total);
    }
    $('direction').onchange=fillCategories;
    $('category').onchange=fillServices;
    ['qty','unitPrice','extras','discount','urgency','markup'].forEach(id=>$(id).oninput=calc);
    $('resetCalc').onclick=()=>{
      $('direction').value='A4_PRINT';
      $('qty').value=1;$('unitPrice').value=0;$('extras').value=0;$('discount').value=0;$('urgency').value=0;$('markup').value=0;
      fillCategories();calc();
    };
    fillCategories();calc();

    function setClientType(){
      const business=$('clientType').value!=='PERSON';
      $('businessFields').classList.toggle('hidden',!business);
      if(business&&!$('clientSignatoryName').value)$('clientSignatoryName').value=$('clientFullName').value;
    }
    function renderCustomers(){
      const q=$('customerSearch').value.trim().toLowerCase();
      const rows=customers.filter(c=>`${c.full_name||''} ${c.company_name||''} ${c.phone||''} ${c.email||''} ${c.inn||''}`.toLowerCase().includes(q)).slice(0,8);
      $('customers').innerHTML=rows.map(c=>`<a class="customer-mini" href="./customer.html?id=${encodeURIComponent(c.id)}" style="text-decoration:none;color:inherit"><b>${esc(c.full_name||c.company_name||'Без имени')}${c.inn?'<span class="billing-badge">Реквизиты</span>':''}</b><small>${esc(c.company_name||'Частный клиент')} · ${esc(c.phone||'телефон не указан')} ${c.email?'· '+esc(c.email):''}${c.inn?' · ИНН '+esc(c.inn):''}</small></a>`).join('')||'<div class="empty-mini">Клиенты не найдены</div>';
    }
    async function loadCustomers(){
      try{
        const data=await request('/rest/v1/customers?select=id,full_name,company_name,email,phone,inn,customer_type,updated_at,created_at&order=updated_at.desc&limit=100');
        customers=Array.isArray(data)?data:[];renderCustomers();
      }catch(ex){$('customers').innerHTML=`<div class="empty-mini">Не удалось загрузить клиентов: ${esc(ex.message)}</div>`;throw ex}
    }
    async function loadOrders(){
      try{
        const data=await request('/rest/v1/orders?select=id,order_number,status,total,created_at,customers(full_name,company_name)&order=created_at.desc&limit=8');
        const rows=Array.isArray(data)?data:[];
        $('orders').innerHTML=rows.map(o=>`<a class="order-mini" href="./order.html?id=${encodeURIComponent(o.id)}" style="text-decoration:none;color:inherit"><b>Заказ №${esc(o.order_number||'—')} · ${money(o.total)}</b><small>${esc(o.customers?.full_name||o.customers?.company_name||'Клиент не указан')} · ${esc(o.status||'')}</small></a>`).join('')||'<div class="empty-mini">Заказов пока нет</div>';
      }catch(ex){$('orders').innerHTML=`<div class="empty-mini">Не удалось загрузить заказы: ${esc(ex.message)}</div>`;throw ex}
    }

    $('toggleClientForm').onclick=()=>{
      $('clientCreate').classList.toggle('open');
      if($('clientCreate').classList.contains('open'))$('clientFullName').focus();
    };
    $('cancelClient').onclick=()=>{$('clientCreate').classList.remove('open');$('clientFormMsg').textContent=''};
    $('clientType').onchange=setClientType;
    $('clientFullName').oninput=()=>{if($('clientType').value!=='PERSON'&&!$('clientSignatoryName').value)$('clientSignatoryName').value=$('clientFullName').value};
    $('customerSearch').oninput=renderCustomers;
    setClientType();

    $('clientForm').onsubmit=async e=>{
      e.preventDefault();
      const form=e.currentTarget,btn=$('saveClient'),msg=$('clientFormMsg');
      const type=$('clientType').value;
      const full=$('clientFullName').value.trim();
      const phone=$('clientPhone').value.trim();
      const email=$('clientEmail').value.trim();
      const inn=$('clientInn').value.trim();
      msg.className='client-form-msg';
      if(!full){msg.className='client-form-msg err';msg.textContent='Укажите ФИО или контактное лицо.';return}
      const duplicate=customers.find(c=>(phone&&c.phone===phone)||(email&&c.email===email)||(inn&&c.inn===inn));
      if(duplicate&&!confirm(`Похожий клиент уже есть: ${duplicate.full_name||duplicate.company_name}. Всё равно создать нового?`))return;
      const payload={
        customer_type:type,full_name:full,phone:phone||null,email:email||null,notes:$('clientNotes').value.trim()||null,
        company_name:type==='PERSON'?null:($('clientCompany').value.trim()||$('clientLegalName').value.trim()||null),
        legal_name:type==='PERSON'?null:($('clientLegalName').value.trim()||null),inn:type==='PERSON'?null:(inn||null),
        kpp:type==='PERSON'?null:($('clientKpp').value.trim()||null),ogrn:type==='PERSON'?null:($('clientOgrn').value.trim()||null),
        legal_address:type==='PERSON'?null:($('clientLegalAddress').value.trim()||null),actual_address:type==='PERSON'?null:($('clientActualAddress').value.trim()||null),
        bank_name:type==='PERSON'?null:($('clientBankName').value.trim()||null),bik:type==='PERSON'?null:($('clientBik').value.trim()||null),
        settlement_account:type==='PERSON'?null:($('clientSettlement').value.trim()||null),correspondent_account:type==='PERSON'?null:($('clientCorrespondent').value.trim()||null),
        signatory_name:type==='PERSON'?null:($('clientSignatoryName').value.trim()||null),signatory_title:type==='PERSON'?null:($('clientSignatoryTitle').value.trim()||null),
        signatory_basis:type==='PERSON'?null:($('clientSignatoryBasis').value.trim()||null),updated_at:new Date().toISOString()
      };
      btn.disabled=true;msg.textContent='Сохранение…';
      try{
        await request('/rest/v1/customers',{method:'POST',body:payload,prefer:'return=representation'});
        msg.className='client-form-msg ok';msg.textContent='Клиент сохранён.';
        form.reset();$('clientType').value='PERSON';setClientType();
        await loadCustomers();
        setTimeout(()=>{$('clientCreate').classList.remove('open');msg.textContent=''},900);
      }catch(ex){msg.className='client-form-msg err';msg.textContent='Ошибка: '+ex.message}
      finally{btn.disabled=false}
    };

    (async()=>{
      const s=storedSession();
      if(s?.user?.email)$('userEmail').textContent=s.user.email;
      try{
        const profile=await request('/rest/v1/rpc/get_my_staff_profile',{method:'POST',body:{}});
        if(profile?.status&&profile.status!=='ACTIVE')throw new Error('Учётная запись сотрудника не активна.');
        if(profile?.email)$('userEmail').textContent=profile.email;
        await Promise.allSettled([loadCustomers(),loadOrders()]);
      }catch(ex){
        const msg=ex?.status===401?'Сессия завершена. Войдите снова.':ex.message;
        if($('customers').textContent.includes('Загрузка'))$('customers').innerHTML=`<div class="empty-mini">${esc(msg)}</div>`;
        if($('orders').textContent.includes('Загрузка'))$('orders').innerHTML=`<div class="empty-mini">${esc(msg)}</div>`;
        console.error('A4 manager runtime:',ex);
      }
    })();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
