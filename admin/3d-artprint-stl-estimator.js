// Local STL estimate only: no upload, no persistence, no automatic order submission.
// STL coordinates assumed millimeters. Closed watertight meshes required for trustworthy volume.
const materials={PLA:1.24,PETG:1.27,ABS:1.04,TPU:1.21,ASA:1.07,RESIN:1.15};
function calculateTriangles(triangles) {
 let signed=0, absolute=0, count=0, bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
 for(const verts of triangles){
  if(verts.length!==9||verts.some(v=>!Number.isFinite(v)))throw Error('Повреждённые координаты STL');
  for(let i=0;i<9;i+=3){for(let j=0;j<3;j++){bounds[j]=Math.min(bounds[j],verts[i+j]);bounds[j+3]=Math.max(bounds[j+3],verts[i+j]);}}
  const [ax,ay,az,bx,by,bz,cx,cy,cz]=verts;
  const six=ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx);
  signed+=six/6;absolute+=Math.abs(six)/6;count++;
 }
 if(!count)throw Error('STL не содержит треугольников');
 const dims=bounds.slice(0,3).map((v,i)=>bounds[i+3]-v);
 if(dims.some(v=>!Number.isFinite(v)||v<=0))throw Error('Некорректные размеры модели');
 const volume=Math.abs(signed)/1000;// mm3 -> cm3
 if(!Number.isFinite(volume)||volume<=0)throw Error('Объём модели не определён. Проверьте герметичность STL');
 return {triangles:count,dimensions:dims,volumeCm3:volume,warning:absolute>0&&Math.abs(signed)/absolute<0.1};
}
export function parseSTL(buffer){
 const bytes=new Uint8Array(buffer),view=new DataView(buffer);
 if(bytes.length<84)throw Error('STL слишком маленький');
 const n=view.getUint32(80,true);
 // Binary detection by exact length; binary STL may start with 'solid'.
 if(n>0 && n<=3000000 && 84+n*50===bytes.length){
  return calculateTriangles((function*(){
   for(let i=0;i<n;i++){
    const o=84+i*50,points=[];
    for(let k=0;k<9;k++)points.push(view.getFloat32(o+12+k*4,true));
    yield points;
   }
  })());
 }
 const text=new TextDecoder('utf-8',{fatal:false}).decode(bytes);
 if(!/^\s*solid\b/i.test(text))throw Error('Неподдерживаемый формат STL');
 const pattern=/\bvertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)/gi;
 return calculateTriangles((function*(){
  let part=[],match;while((match=pattern.exec(text))!==null){
   part.push(Number(match[1]),Number(match[2]),Number(match[3]));
   if(part.length===9){yield part;part=[]}
  }
  if(part.length)throw Error('Незавершённый треугольник STL');
 })());
}
export function setupSTLCalculator(form){
 const panel=document.createElement('section');
 panel.className='stl-calc';
 panel.innerHTML=`<h3>STL для менеджера — дополнительный просмотр</h3>
 <p>Файл анализируется только в браузере. STL не содержит материала, заполнения, поддержек и времени печати — расчёт предварительный.</p>
 <label>Модель STL (до 30 МБ)<input type="file" name="stl" accept=".stl" /></label>
 <div class="order-entry-grid">
 <label>Материал<select name="stlMaterial"><option value="PLA">PLA</option><option value="PETG" selected>PETG</option><option value="ABS">ABS</option><option value="ASA">ASA</option><option value="TPU">TPU</option><option value="RESIN">Фотополимер</option></select></label>
 <label>Оценочная доля пластика от сплошной модели, %<input name="stlFactor" type="number" min="1" max="100" step="1" value="30"></label>
 <label>Стоимость материала, ₽/кг<input name="stlKg" type="number" min="0" step="1" value="1500"></label>
 <label>Работа станка, часов (ввести после слайсинга)<input name="stlHours" type="number" min="0" step="0.1" value="0"></label>
 <label>Стоимость работы станка, ₽/час<input name="stlHourly" type="number" min="0" step="1" value="100"></label>
 <label>Подготовка и постобработка, ₽<input name="stlLabor" type="number" min="0" step="1" value="150"></label>
 <label>Наценка, %<input name="stlMarkup" type="number" min="0" step="1" value="70"></label>
 </div>
 <div class="stl-result" aria-live="polite">Загрузите STL для анализа.</div>
 <button type="button" data-apply-estimate disabled>Подставить цену в заказ</button>`;
 form.querySelector('.order-entry-grid').after(panel);
 let geometry=null,filename='';
 const result=panel.querySelector('.stl-result'),button=panel.querySelector('[data-apply-estimate]');
 const f=n=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2});
 const field=name=>Number(panel.querySelector('[name="'+name+'"]').value);
 const recalc=()=>{
  button.disabled=true;
  if(!geometry)return;
  const factor=field('stlFactor'),kg=field('stlKg'),hours=field('stlHours'),hourly=field('stlHourly'),labor=field('stlLabor'),markup=field('stlMarkup');
  if(![factor,kg,hours,hourly,labor,markup].every(Number.isFinite)||factor<1||factor>100||[kg,hours,hourly,labor,markup].some(v=>v<0)){result.textContent='Проверьте параметры расчёта';return}
  const density=materials[panel.querySelector('[name="stlMaterial"]').value];
  const grams=geometry.volumeCm3*density*factor/100;
  const estimatedCost=grams*kg/1000+hours*hourly+labor;
  const price=Math.round(estimatedCost*(1+markup/100)*100)/100;
  if(!Number.isFinite(price)||price<0||price>1e9){result.textContent='Параметры слишком велики';return}
  result.textContent='Габариты: '+geometry.dimensions.map(f).join(' × ')+' мм · Объём сплошной модели: '+f(geometry.volumeCm3)+' см³ · Условный расход: '+f(grams)+' г · Предварительная цена за штуку: '+f(price)+' ₽'+(geometry.warning?' · Внимание: возможны ошибки сетки STL':'');
  button.disabled=false;
  button.onclick=()=>{
   form.querySelector('[name="price"]').value=price.toFixed(2);
   const comment=form.querySelector('[name="comment"]');
   const note='STL: '+filename+'; материал: '+panel.querySelector('[name="stlMaterial"]').value+'; габариты: '+geometry.dimensions.map(f).join('×')+' мм; расчёт предварительный, подтверждается слайсингом.';
   if(!comment.value.includes('STL: '))comment.value=(comment.value?comment.value+'\n':'')+note;
   form.querySelector('[name="price"]').dispatchEvent(new Event('input',{bubbles:true}));
  };
 };
 panel.addEventListener('input',event=>{if(event.target.type!=='file')recalc()});
 panel.querySelector('[name="stl"]').addEventListener('change',async event=>{
  geometry=null;button.disabled=true;
  const file=event.target.files?.[0];
  if(!file){result.textContent='Выберите STL';return}
  if(!/\.stl$/i.test(file.name)||file.size>30*1024*1024){result.textContent='Требуется STL размером до 30 МБ';return}
  result.textContent='Анализируем геометрию…';
  try{geometry=parseSTL(await file.arrayBuffer());filename=file.name;recalc()}
  catch(error){result.textContent='Не удалось рассчитать: '+error.message}
 });
}
