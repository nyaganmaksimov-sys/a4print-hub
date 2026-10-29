import {setupGcodeCalculator} from './3d-artprint-gcode-estimator.js?v=1';
import {setupSTLCalculator} from './3d-artprint-stl-estimator.js?v=1';
// Native, organization-scoped 3D-ARTPRINT order entry.
// Uses the existing audited RPC, with no direct table mutations or database changes.
const rub=value=>Number(value).toLocaleString('ru-RU',{style:'currency',currency:'RUB'});
export async function installOrderEntry({supabase,root,refresh,notify}){
  const wrapper=document.createElement('div');
  wrapper.className='order-entry';
  const toggle=document.createElement('button');
  toggle.type='button';toggle.className='order-entry-toggle';
  toggle.textContent='+ Создать заказ 3D-ARTPRINT';
  const form=document.createElement('form');
  form.className='order-entry-form';form.hidden=true;
  form.innerHTML=`<h2>Новый заказ 3D-ARTPRINT</h2>
  <p>Основой производственного заказа служит G-code из слайсера. STL — дополнительный файл для менеджера, не нужен для запуска печати.</p>
  <div class="order-entry-grid">
    <label>ФИО / название клиента *<input name="customer" maxlength="200" autocomplete="name" required></label>
    <label>Телефон<input name="phone" maxlength="40" autocomplete="tel" type="tel"></label>
    <label>Изделие / работа *<input name="item" maxlength="250" required placeholder="Например, печать детали PETG"></label>
    <label>Количество *<input name="qty" type="number" min="0.01" step="0.01" value="1" required></label>
    <label>Цена за единицу, ₽ *<input name="price" type="number" min="0" step="0.01" value="0" required></label>
    <label>Итого <output id="orderNewTotal">0 ₽</output></label>
  </div>
  <label>Комментарий / материал / требования<textarea name="comment" rows="3" maxlength="2000" placeholder="Материал, цвет, сроки, примечания"></textarea></label>
  <p class="order-entry-note">G-code — основной рабочий файл; STL — дополнительный, для менеджера. Оба файла прикрепляются только после создания заказа. Ошибка вложения не создаёт повторный заказ.</p>
  <div class="row-controls"><button type="submit">Сохранить заказ</button><button type="button" data-cancel>Отмена</button></div>
  <div class="order-entry-status" role="status" aria-live="polite"></div>`;
  setupSTLCalculator(form);
  // Show the form immediately; equipment lookup can complete afterwards.
  void setupGcodeCalculator(form,supabase).catch(error=>console.warn('3D printer rates unavailable',error));
  wrapper.append(toggle,form);
  root.before(wrapper);
  const status=form.querySelector('.order-entry-status');
  const setState=message=>{status.textContent=message};
  const update=()=>{const fd=new FormData(form);const qty=Number(fd.get('qty'));const price=Number(fd.get('price'));form.querySelector('output').textContent=rub(Number.isFinite(qty*price)?qty*price:0)};
  form.addEventListener('input',update);
  const params=new URLSearchParams(location.search);
  const reveal=()=>{form.hidden=false;toggle.setAttribute('aria-expanded','true');form.querySelector('[name="customer"]').focus()};
  const hide=()=>{form.hidden=true;toggle.setAttribute('aria-expanded','false');setState('')};
  toggle.addEventListener('click',()=>form.hidden?reveal():hide());
  form.querySelector('[data-cancel]').addEventListener('click',hide);
  if(params.has('new'))reveal();else toggle.setAttribute('aria-expanded','false');
  let saving=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(saving||!form.reportValidity())return;
    const fd=new FormData(form);
    const name=String(fd.get('customer')||'').trim(),item=String(fd.get('item')||'').trim();
    const qty=Number(fd.get('qty')),price=Number(fd.get('price'));
    if(!name||!item||!Number.isFinite(qty)||qty<=0||!Number.isFinite(price)||price<0){
      setState('Проверьте клиента, изделие, количество и цену.');return;
    }
    saving=true;form.querySelector('[type="submit"]').disabled=true;setState('Проверяем организацию…');
    try{
      const {data:organization,error:orgError}=await supabase.from('organizations').select('id,code').eq('code','3DARTPRINT').maybeSingle();
      if(orgError||!organization?.id)throw new Error('Для создания заказов требуется учётная запись организации 3D-ARTPRINT.');
      setState('Создаём заказ…');
      const {data,error}=await supabase.rpc('create_hub_manual_order',{
        p_customer_id:null,p_customer_name:name,p_customer_phone:String(fd.get('phone')||'').trim(),
        p_business_unit:'3D_ARTPRINT',p_item_name:item,p_quantity:qty,p_unit_price:price,
        p_comment:String(fd.get('comment')||'').trim(),p_source:'3D_ARTPRINT'
      });
      if(error)throw error;
      const selected=[
        {file:form.querySelector('input[name="gcode"]')?.files?.[0],type:'application/octet-stream',label:'G-code'},
        {file:form.querySelector('input[name="stl"]')?.files?.[0],type:'model/stl',label:'STL'}
      ].filter(x=>x.file);
      const failures=[];
      for(const entry of selected){
        if(!data?.id){failures.push(entry.label+': заказ не вернул ID');break}
        setState('Заказ создан. Сохраняем '+entry.label+'…');
        const filename=entry.file.name.normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'-').slice(-120);
        const path=data.id+'/'+crypto.randomUUID()+'-'+filename;
        try{
          const up=await supabase.storage.from('order-files').upload(path,entry.file,{contentType:entry.type,upsert:false});
          if(up.error)throw up.error;
          const record=await supabase.from('order_files').insert({order_id:data.id,file_name:entry.file.name,file_url:path,mime_type:entry.type});
          if(record.error){await supabase.storage.from('order-files').remove([path]);throw record.error}
        }catch(err){failures.push(entry.label+': '+(err?.message||String(err)))}
      }
      notify(failures.length?'Заказ №'+data.order_number+' создан, но вложения не сохранились: '+failures.join('; '):'Заказ №'+data.order_number+' создан'+(selected.length?' с файлами':''));
      form.reset();update();await refresh();hide();
    }catch(error){setState('Не удалось создать заказ: '+(error?.message||String(error)))}
    finally{saving=false;form.querySelector('[type="submit"]').disabled=false}
  });
  update();
}
