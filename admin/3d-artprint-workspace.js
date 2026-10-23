import {supabase} from './guard.js?v=20260905-netfix1';
const section=new URLSearchParams(location.search).get('section')||'orders';
const titles={orders:['Заказы','Заказы направления 3D-ARTPRINT, полученные из HUB.'],production:['Производство','Задания и этапы выполнения изделий.'],materials:['Материалы','Склад пластика, смолы и расходных материалов.'],equipment:['Оборудование','Инвентарные карточки, обслуживание и эксплуатация.'],clients:['Клиенты','Клиенты заказов производства 3D-ARTPRINT.'],finance:['Финансы и отчёты','Экономика производства и отчётность.'],staff:['Сотрудники','Команда и доступы к производству.']};
const key=Object.hasOwn(titles,section)?section:'orders';
const title=document.getElementById('sectionTitle'),intro=document.getElementById('sectionIntro'),root=document.getElementById('sectionContent'),notice=document.getElementById('sectionNotice');
title.textContent=titles[key][0];intro.textContent=titles[key][1];
document.querySelectorAll('.nav nav a').forEach(a=>{if(new URL(a.href).searchParams.get('section')===key){a.classList.add('current');a.setAttribute('aria-current','page')}});
function empty(message){root.replaceChildren();const p=document.createElement('p');p.className='empty';p.textContent=message;root.append(p)}
function showError(message){notice.hidden=false;notice.textContent=message}
function item(name,detail){const el=document.createElement('article');el.className='workspace-row';const block=document.createElement('div'),b=document.createElement('strong'),small=document.createElement('small');b.textContent=name;small.textContent=detail;block.append(b,small);el.append(block);return el}
async function orderData(){
 const {data,error}=await supabase.rpc('get_orders_workspace_page',{p_query:'',p_status:'',p_unit:'3D_ARTPRINT',p_attention:'',p_page:1,p_page_size:50});
 if(error)throw error;
 return (Array.isArray(data)?data:[]).filter(o=>o.business_unit==='3D_ARTPRINT');
}
async function renderOrders(rows){
 root.replaceChildren();
 if(!rows.length){empty('Заказов в доступной выборке пока нет.');return;}
 if(key==='clients'){
  const unique=new Map();
  for(const o of rows){const name=o.customer_full_name||o.customer_company_name;if(name){const id=o.customer_id||name;if(!unique.has(id))unique.set(id,name)}}
  if(!unique.size)return empty('Клиентов в доступных заказах пока нет.');
  for(const name of unique.values())root.append(item(name,'Клиент заказа 3D-ARTPRINT'));
  return;
 }
 const wanted=new URLSearchParams(location.search).get('status')||'';
 const list=wanted?rows.filter(o=>o.status===wanted):rows;
 if(!list.length)return empty('Заказов с выбранным статусом нет в загруженной выборке.');
 for(const o of list){
  const number=o.order_number||String(o.id).slice(0,8);
  const el=item('№'+number+' · '+(o.item_name||o.model_name||'Заказ'),(o.customer_full_name||o.customer_company_name||'Клиент не указан')+' · '+(o.status||'Без статуса'));
  if(o.status==='NEW'&&o.id){
   const btn=document.createElement('button');btn.type='button';btn.textContent='Подтвердить и передать в производство';
   btn.addEventListener('click',async()=>{
    if(!confirm('Подтвердить заказ №'+number+' и создать производственное задание?'))return;
    btn.disabled=true;
    try{
     const {data,error}=await supabase.from('orders').update({status:'CONFIRMED'}).eq('id',o.id).eq('business_unit','3D_ARTPRINT').eq('status','NEW').select('id');
     if(error)throw error;
     if(!data?.length)throw Error('Заказ не обновлён: проверьте доступ или текущий статус');
     const {data:jobs,error:jobsError}=await supabase.from('production_jobs').select('id').eq('order_id',o.id).limit(1);
     if(jobsError)throw jobsError;
     notice.hidden=false;notice.textContent=jobs?.length?'Заказ подтверждён, производственное задание создано.':'Заказ подтверждён. Задание ещё не появилось — проверьте раздел производства.';
     await renderOrders(await orderData());
    }catch(error){notice.hidden=false;notice.textContent='Не удалось подтвердить заказ: '+(error?.message||String(error));btn.disabled=false}
   });el.append(btn);
  }
  root.append(el)
}
 
}
async function start(){
 try{
  const {data:{session},error:e}=await supabase.auth.getSession();
  if(e||!session){location.replace('./login.html?returnTo='+encodeURIComponent(location.pathname+location.search));return}
  const {data:profile,error:pe}=await supabase.rpc('get_my_staff_profile');
  if(pe||profile?.status!=='ACTIVE')throw new Error('Нет подтверждённого доступа к кабинету');
  if(key==='staff'){const {renderStaffAdmin}=await import('./3d-artprint-staff.js?v=1');await renderStaffAdmin({supabase,root,profile});return}
  if(key==='orders'||key==='clients'){
    if(key==='orders'){
      const {installOrderEntry}=await import('./3d-artprint-orders.js?v=20261023-fix1');
      await installOrderEntry({supabase,root,refresh:async()=>renderOrders(await orderData()),notify:message=>{notice.hidden=false;notice.textContent=message}});
    }
    await renderOrders(await orderData());return
  }
  if(key==='production'){
   const {renderProduction}=await import('./3d-artprint-production.js?v=6');
   await renderProduction({supabase,root,notify:message=>{notice.hidden=false;notice.textContent=message}});
   return;
  }
  empty('Раздел имеет собственную страницу 3D-ARTPRINT. Рабочие формы и данные подключим на следующем этапе. Пока действия здесь недоступны.');
 }catch(err){empty('Не удалось загрузить данные.');showError(err?.message||String(err))}
}
start();