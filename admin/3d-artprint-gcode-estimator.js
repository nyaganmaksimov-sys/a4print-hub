import {unpackGcode3mf} from './3d-artprint-3mf-reader.js?v=1';
// Parse recognized slicer annotations only; don't infer time from raw G-code movement.
export function parseGcodeMetadata(text){
 const lines=text.split(/\r?\n/);const found={grams:null,hours:null,material:null,layerHeight:null,source:[]};
 const patterns=[
  {key:'grams',rx:/^;\s*(?:total filament used \[g\]|filament used \[g\]|filament used \(g\)|filament used \[g\]|filament weight(?: \[g\])?|total filament weight(?: \[g\])?)\s*[:=]\s*([\d.,]+)/i},
  {key:'grams',rx:/^;\s*filament used\s*:\s*[\d.,]+\s*m\s*\(([\d.,]+)\s*g\)/i},
  {key:'hours',rx:/^;\s*(?:estimated printing time \(normal mode\)|estimated printing time|print time|total estimated time|printing time)\s*[:=]\s*(.+)$/i},
  {key:'material',rx:/^;\s*(?:right_extruder_material|left_extruder_material)\s*:\s*(PLA|PETG|ABS|ASA|TPU|PA|PC|NYLON)\b/i},
  {key:'material',rx:/^;\s*(?:filament_type|filament type|material_type|material)\s*[:=]\s*(PLA|PETG|ABS|ASA|TPU|PA|PC|NYLON)(?:\b|$)/i},
  {key:'layerHeight',rx:/^;\s*(?:layer_height|layer height)\s*[:=]\s*([\d.,]+)/i}
 ];
 const toNum=v=>Number(v.replace(',','.'));
 const time=value=>{
  const h=value.match(/(\d+)\s*h/i),m=value.match(/(\d+)\s*m/i),s=value.match(/(\d+)\s*s/i);
  if(h||m||s)return ((h?Number(h[1]):0)*3600+(m?Number(m[1]):0)*60+(s?Number(s[1]):0))/3600;
  const hhmm=value.match(/^(\d+):(\d+):(\d+)\b/);
  if(hhmm)return Number(hhmm[1])+Number(hhmm[2])/60+Number(hhmm[3])/3600;
  const seconds=value.match(/^(\d+(?:[.,]\d+)?)\s*(?:sec|seconds|s)\b/i);
  return seconds?toNum(seconds[1])/3600:null;
 };
 for(const line of lines){
  if(!line.startsWith(';'))continue;
  for(const p of patterns){
   if(found[p.key]!=null)continue;
   const m=line.match(p.rx);if(!m)continue;
   const val=p.key==='hours'?time(m[1]):p.key==='material'?m[1].toUpperCase():toNum(m[1]);
   if(val===null||typeof val==='number'&&(!Number.isFinite(val)||val<=0))continue;
   found[p.key]=val;found.source.push(p.key);
  }
 }
 return found;
}
export async function setupGcodeCalculator(form,supabase){
 const stl=form.querySelector('.stl-calc');
 if(!stl)return;
 const div=document.createElement('div');
 div.className='gcode-calc';
 div.innerHTML=`<h3>Расчёт по G-code после слайсинга</h3>
 <p>Используются комментарии, записанные слайсером. Если расход или время отсутствуют, введите их вручную. G-code анализируется локально.</p>
 <label>G-code из OrcaSlicer (.gcode, .gcode.3mf, до 50 МБ)<input type="file" name="gcode" accept=".gcode,.gco,.gc,.3mf" /></label>
 <div class="order-entry-grid"><label>Принтер 3D-ARTPRINT<select name="gcodePrinter"><option value="">Ручной тариф</option></select></label><label>Тариф принтера <small data-printer-tariff>Выберите станок</small></label>
 <label>Расход филамента, г<input name="gcodeGrams" type="number" step="0.01" min="0" placeholder="Из G-code или вручную"></label>
 <label>Время печати, ч<input name="gcodeHours" type="number" step="0.01" min="0" placeholder="Из G-code или вручную"></label>
 <label>Стоимость филамента, ₽/кг<input name="gcodeKg" type="number" step="1" min="0" value="1500"></label>
 <label>Стоимость станка, ₽/ч<input name="gcodeHourly" type="number" step="1" min="0" value="0"></label>
 <label>Подготовка / обработка, ₽<input name="gcodeLabor" type="number" step="1" min="0" value="150"></label>
 <label>Наценка, %<input name="gcodeMarkup" type="number" step="1" min="0" value="70"></label><label>Доля владельца принтера, % от цены заказа<input name="gcodeRent" type="number" step="1" min="15" max="30" value="15"></label><div><button type="button" data-save-rent disabled>Сохранить процент принтера</button><small data-rent-status>Выберите принтер, чтобы сохранить его ставку.</small></div>
 </div>
 <div class="stl-result" data-gcode-result role="status">Загрузите G-code или заполните поля вручную.</div>
 <button type="button" data-gcode-apply disabled>Подставить цену по G-code</button>`;
 stl.append(div);
 const get=n=>div.querySelector('[name="'+n+'"]'),info=div.querySelector('[data-gcode-result]'),apply=div.querySelector('[data-gcode-apply]');let filename='',meta={};
 const printer=get('gcodePrinter'),tariff=div.querySelector('[data-printer-tariff]'),saveRent=div.querySelector('[data-save-rent]'),rentStatus=div.querySelector('[data-rent-status]');
 const rentKey=id=>'a4print:3d-artprint:rent-share:v1:'+id;
 const readRent=id=>{try{const value=Number(localStorage.getItem(rentKey(id)));return Number.isFinite(value)&&value>=15&&value<=30?value:null}catch{return null}};
 const recalc=()=>{
  apply.disabled=true;
  const grams=Number(get('gcodeGrams').value),hours=Number(get('gcodeHours').value),kg=Number(get('gcodeKg').value),hourly=Number(get('gcodeHourly').value),labor=Number(get('gcodeLabor').value),markup=Number(get('gcodeMarkup').value),rent=Number(get('gcodeRent').value);
  if(!get('gcodeGrams').value||!get('gcodeHours').value){info.textContent='Укажите расход и время печати — из файла либо вручную.';return}
  if(![grams,hours,kg,hourly,labor,markup,rent].every(Number.isFinite)||grams<=0||hours<=0||kg<0||hourly<0||labor<0||(markup<0||rent<15||rent>30)){info.textContent='Проверьте значения расхода, времени и цены.';return}
  const cost=grams/1000*kg+hours*hourly+labor,price=Math.round(cost*(1+markup/100)/(1-rent/100)*100)/100;
  const ownerShare=Math.round(price*rent)/100,remaining=Math.round((price-ownerShare-cost)*100)/100;
  if(!Number.isFinite(price)||price>1e9){info.textContent='Параметры расчёта превышают лимит.';return}
  info.textContent='Материал: '+(meta.material||'не указан')+' · Расход: '+grams.toLocaleString('ru-RU')+' г · Время: '+hours.toLocaleString('ru-RU')+' ч · Себестоимость: '+cost.toFixed(2)+' ₽ · Аренда владельцу ('+rent+'%): '+ownerShare.toFixed(2)+' ₽ · Остаток после расходов: '+remaining.toFixed(2)+' ₽ · Цена заказа: '+price.toFixed(2)+' ₽';
  apply.disabled=false;
  apply.onclick=()=>{
   form.querySelector('[name="price"]').value=price.toFixed(2);
   const comment=form.querySelector('[name="comment"]');
   const note='G-code: '+(filename||'параметры вручную')+'; расход: '+grams+' г; время: '+hours+' ч; материал: '+(meta.material||'уточняется')+'; доля владельца: '+rent+'% ('+ownerShare.toFixed(2)+' ₽); расчёт по данным слайсинга.';
   if(!comment.value.includes('G-code: '))comment.value=(comment.value?comment.value+'\n':'')+note;
   form.querySelector('[name="price"]').dispatchEvent(new Event('input',{bubbles:true}));
  };
 };
 div.addEventListener('input',e=>{if(e.target.type!=='file')recalc()});
 const inventory=['A4-EQ-00054','A4-EQ-00055','A4-EQ-00056','A4-EQ-00057'];
 try{
  const {data:org,error:orgError}=await supabase.from('organizations').select('id').eq('code','3DARTPRINT').maybeSingle();
  if(orgError||!org?.id)throw Error('Оборудование организации недоступно');
  const {data:assets,error:assetsError}=await supabase.from('equipment_assets').select('id,name,inventory_number,purchase_price').eq('organization_id',org.id).in('inventory_number',inventory);
  if(assetsError)throw assetsError;
  const available=(assets||[]).filter(a=>inventory.includes(a.inventory_number));
  for(const a of available)printer.add(new Option((a.inventory_number||'')+' · '+(a.name||''),a.id));
  const assetMap=new Map(available.map(a=>[a.id,a]));
  saveRent.addEventListener('click',()=>{
   if(!assetMap.has(printer.value))return;
   const value=Number(get('gcodeRent').value);
   if(!Number.isFinite(value)||value<15||value>30){rentStatus.textContent='Укажите процент от 15 до 30.';return}
   try{localStorage.setItem(rentKey(printer.value),String(value));rentStatus.textContent='Для выбранного принтера сохранено '+value+'% в этом браузере.'}
   catch{rentStatus.textContent='Не удалось сохранить. Проверьте настройки браузера.'}
  });
  printer.addEventListener('change',()=>{
   const asset=assetMap.get(printer.value);
   saveRent.disabled=!asset;
   if(!asset){rentStatus.textContent='Выберите принтер, чтобы сохранить его ставку.';tariff.textContent='Укажите эксплуатационные расходы вручную';recalc();return}
   const savedRent=readRent(asset.id);
   get('gcodeRent').value=String(savedRent??15);
   rentStatus.textContent=savedRent===null?'У этого принтера нет сохранённой ставки — временно 15%.':'Ставка '+savedRent+'% загружена из этого браузера.';
   const key='a4print:3d-artprint:machine-cost:v1:'+asset.id;
   let preset=null;
   try{preset=JSON.parse(localStorage.getItem(key)||'null')}catch{}
   const running=Number(preset?.calcRunning);
   if(!preset||!Number.isFinite(running)||running<0){
     get('gcodeHourly').value='0';tariff.textContent='У станка нет эксплуатационного тарифа. Укажите ₽/ч вручную; арендная доля считается отдельно.';recalc();return
   }
   // Rented machines: acquisition value belongs to owner and is not our depreciation.
   const rate=Math.round(running*100)/100;
   get('gcodeHourly').value=String(rate);
   tariff.textContent='Эксплуатационные расходы из профиля: '+rate.toLocaleString('ru-RU')+' ₽/ч; доля аренды считается отдельно';
   recalc();
  });
  tariff.textContent=available.length?'Выберите принтер; тарифы берутся из сохранённых профилей':'Принтеры пока не доступны';
 }catch(error){tariff.textContent='Реестр принтеров не загружен — доступен ручной тариф';}

 get('gcode').addEventListener('change',async e=>{
  const file=e.target.files?.[0];apply.disabled=true;
  if(!file)return;
  if(!/\.(gcode|gco|gc|gcode\.3mf)$/i.test(file.name)||file.size>50*1024*1024){info.textContent='Нужен G-code до 50 МБ';return}
  try{
   const text=/\.gcode\.3mf$/i.test(file.name)?await unpackGcode3mf(file):await file.text();meta=parseGcodeMetadata(text);filename=file.name;
   if(meta.grams!=null)get('gcodeGrams').value=String(meta.grams);
   if(meta.hours!=null)get('gcodeHours').value=String(Math.round(meta.hours*100)/100);
   recalc();
   if(meta.grams==null||meta.hours==null)info.textContent+=' Часть данных отсутствует в комментариях файла; требуется ручной ввод.';
  }catch(error){info.textContent='Не удалось прочитать файл: '+error.message}
 });
 recalc();
}
