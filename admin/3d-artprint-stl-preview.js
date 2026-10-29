// Client-side STL wireframe preview. No model data is uploaded.
export function installSTLPreview(panel){
 const input=panel.querySelector('input[name="stl"]');
 if(!input)return;
 const box=document.createElement('div');
 box.className='stl-preview';
 const canvas=document.createElement('canvas');canvas.width=700;canvas.height=380;
 canvas.style.cssText='display:block;width:100%;max-width:700px;background:#101722;border:1px solid #374151;border-radius:12px;touch-action:none';
 const note=document.createElement('p');note.textContent='Загрузите STL для просмотра. Вращение — перетаскиванием.';
 box.append(canvas,note);input.closest('label').after(box);
 const ctx=canvas.getContext('2d');let faces=[],scale=1,rx=.4,ry=.5,drag=null,seq=0;
 function draw(){
  const w=canvas.width,h=canvas.height;
  ctx.fillStyle='#101722';ctx.fillRect(0,0,w,h);
  if(!faces.length)return;
  const c=Math.cos(ry),s=Math.sin(ry),a=Math.cos(rx),b=Math.sin(rx);
  const xy=p=>{const x=p[0]*c+p[2]*s,z=-p[0]*s+p[2]*c,y=p[1]*a-z*b;return [w/2+x*scale,h/2-y*scale]};
  ctx.strokeStyle='rgba(98,205,241,.35)';ctx.lineWidth=.7;
  for(const f of faces){const [p,q,r]=f.map(xy);ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...q);ctx.lineTo(...r);ctx.closePath();ctx.stroke()}
 }
 function read(buffer){
  const bytes=new Uint8Array(buffer),view=new DataView(buffer),out=[];
  if(bytes.length>=84){
   const n=view.getUint32(80,true);
   if(n>0&&n<=3000000&&84+50*n===bytes.length){
    const step=Math.ceil(n/12000);
    for(let i=0;i<n;i+=step){const at=84+i*50;out.push([0,1,2].map(k=>[0,1,2].map(j=>view.getFloat32(at+12+k*12+j*4,true))))}
    return out;
   }
  }
  const str=new TextDecoder().decode(bytes);
  if(!/^\s*solid\b/i.test(str))throw Error('Неверный STL');
  let tri=[];const pattern=/\bvertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)/gi;
  for(const m of str.matchAll(pattern)){tri.push([+m[1],+m[2],+m[3]]);if(tri.length===3){out.push(tri);tri=[]}}
  if(!out.length)throw Error('Нет треугольников');
  return out.length>12000?out.filter((_,i)=>i%Math.ceil(out.length/12000)===0):out;
 }
 input.addEventListener('change',async()=>{
  const current=++seq;faces=[];draw();
  const file=input.files?.[0];if(!file){note.textContent='Выберите STL';return}
  if(!/\.stl$/i.test(file.name)||file.size>30*1024*1024){note.textContent='Требуется STL не более 30 МБ';return}
  note.textContent='Загружаем модель…';
  try{
   const raw=read(await file.arrayBuffer());if(current!==seq)return;
   const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
   for(const face of raw)for(const point of face)for(let j=0;j<3;j++){if(!Number.isFinite(point[j]))throw Error('Повреждённая геометрия');lo[j]=Math.min(lo[j],point[j]);hi[j]=Math.max(hi[j],point[j])}
   const size=Math.max(...hi.map((v,i)=>v-lo[i]));if(size<=0)throw Error('Пустая модель');
   const center=lo.map((v,i)=>(v+hi[i])/2);
   faces=raw.map(f=>f.map(p=>p.map((v,i)=>v-center[i])));
   scale=260/size;note.textContent=file.name+' · '+raw.length.toLocaleString('ru-RU')+' треугольников в предпросмотре · вращайте мышью';draw();
  }catch(error){note.textContent='Предпросмотр недоступен: '+error.message}
 });
 canvas.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)});
 canvas.addEventListener('pointermove',e=>{if(!drag)return;ry+=(e.clientX-drag[0])*.01;rx+=(e.clientY-drag[1])*.01;drag=[e.clientX,e.clientY];draw()});
 canvas.addEventListener('pointerup',()=>drag=null);canvas.addEventListener('pointercancel',()=>drag=null);
}
