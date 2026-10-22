// Presentation-only mapping of confirmed physical printers to existing HUB assets.
// No INSERT or UPDATE of equipment_assets. All choices are drawn from RLS-visible assets.
const fleet=[
 {key:'kobra-x',name:'Anycubic Kobra X',image:'./assets/3d-artprint/kobra-x.png',profiles:['Anycubic Kobra X · 0,4 мм (профиль из OrcaSlicer)','Anycubic Kobra X']},
 {key:'kobra-2-max',name:'Anycubic Kobra 2 Max',image:'./assets/3d-artprint/kobra-2-max.png',profiles:['Anycubic Kobra 2 Max']},
 {key:'ender-v3-se',name:'Creality Ender-3 V3 SE',image:'./assets/3d-artprint/ender-v3-se.png',profiles:['Creality Ender-3 V3 SE']},
 {key:'ad5x',name:'Flashforge AD5X',image:'./assets/3d-artprint/ad5x.png',profiles:['Flashforge AD5X']}
];
const root=document.getElementById('printerFleet');
let assets=[],orgId='';
const storeKey=()=> 'a4:3dartprint:fleet-mapping:v1:'+orgId;
function readMap(){try{const obj=JSON.parse(localStorage.getItem(storeKey())||'{}');return obj&&typeof obj==='object'?obj:{}}catch{return {}}}
function writeMap(value){try{localStorage.setItem(storeKey(),JSON.stringify(value));return true}catch{return false}}
function render(){
 if(!root)return;
 const saved=orgId?readMap():{};
 root.replaceChildren();
 for(const device of fleet){
  const card=document.createElement('article');card.className='fleet-card';
  const art=document.createElement('div');art.className='fleet-art';const img=document.createElement('img');img.src=device.image;img.alt='Иллюстрация принтера '+device.name;img.loading='lazy';img.decoding='async';img.onerror=()=>{img.hidden=true;art.classList.add('missing-art')};art.append(img);card.append(art);
  const title=document.createElement('h3');title.textContent=device.name;card.append(title);
  const note=document.createElement('p');note.textContent=device.profiles.length+' профиль(я) OrcaSlicer · одно физическое устройство';card.append(note);
  const profiles=document.createElement('ul');profiles.className='fleet-profiles';
  for(const profile of device.profiles){const li=document.createElement('li');li.textContent=profile;profiles.append(li)}
  card.append(profiles);
  const label=document.createElement('label');label.textContent='Привязать к оборудованию HUB';
  const select=document.createElement('select');select.setAttribute('aria-label','Оборудование для '+device.name);
  select.add(new Option(orgId?'Не привязано':'Загрузка реестра…',''));
  for(const a of assets)select.add(new Option((a.inventory_number||'Без номера')+' · '+(a.name||a.model||'Станок'),a.id));
  const mapped=assets.find(a=>a.id===saved[device.key]);
  if(mapped)select.value=mapped.id;
  else if(saved[device.key]){const warning=document.createElement('small');warning.textContent='Прежняя привязка не найдена или недоступна';card.append(warning)}
  select.disabled=!orgId;
  const status=document.createElement('small');status.className='fleet-status';
  status.textContent=mapped?'Связано с реестром этого кабинета':'Требуется сопоставление';
  select.addEventListener('change',()=>{
    const next=readMap();
    if(select.value&&Object.entries(next).some(([key,val])=>key!==device.key&&val===select.value)){
      status.textContent='Этот станок уже назначен другому устройству. Выберите другой.';select.value=next[device.key]||'';return;
    }
    if(select.value)next[device.key]=select.value;else delete next[device.key];
    if(!writeMap(next)){status.textContent='Не удалось сохранить привязку в браузере';return;}
    status.textContent=select.value?'Привязка сохранена в этом браузере':'Привязка очищена';
  });
  label.append(select);card.append(label,status);root.append(card);
 }
}
document.addEventListener('a4:3d-equipment-loaded',event=>{
 const detail=event.detail||{};
 if(typeof detail.orgId!=='string'||!Array.isArray(detail.assets))return;
 orgId=detail.orgId;
 assets=detail.assets.filter(a=>a&&typeof a.id==='string');
 render();
});
render();
