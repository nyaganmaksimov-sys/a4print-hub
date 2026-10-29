// STL preview for 3D-ARTPRINT order form. Browser-only; no uploads.
function mountPreview(input){
 if(input.dataset.previewReady)return;input.dataset.previewReady='1';
 const panel=document.createElement('section');panel.className='stl-preview-panel';panel.hidden=true;
 panel.innerHTML='<strong>3D-предпросмотр модели</strong><p>Вращайте модель мышью или пальцем. Цвет условный; исходный STL не отправляется на сервер.</p><canvas width="640" height="400" aria-label="Просмотр STL модели"></canvas><small class="stl-preview-name"></small>';
 input.closest('label').after(panel);
 const canvas=panel.querySelector('canvas'),ctx=canvas.getContext('2d');
 canvas.style.cssText='display:block;width:100%;max-width:640px;background:#101923;border-radius:12px;touch-action:none;cursor:grab';
 panel.style.cssText='margin:16px 0;padding:16px;border:1px solid #334252;border-radius:14px';
 let triangles=[],ax=.4,ay=.55,down=null,serial=0;
 function render(){
  const w=canvas.width,h=canvas.height;ctx.fillStyle='#101923';ctx.fillRect(0,0,w,h);
  const cx=Math.cos(ax),sx=Math.sin(ax),cy=Math.cos(ay),sy=Math.sin(ay);
  const faces=triangles.map(t=>{
   const pts=t.map(([x,y,z])=>{const a=x*cy+z*sy,b=z*cy-x*sy;return [w/2+a,h/2-(y*cx-b*sx),y*sx+b*cx]});
   return {pts,z:(pts[0][2]+pts[1][2]+pts[2][2])/3};
  }).sort((a,b)=>a.z-b.z);
  for(const {pts} of faces){
   const ux=pts[1][0]-pts[0][0],uy=pts[1][1]-pts[0][1],vx=pts[2][0]-pts[0][0],vy=pts[2][1]-pts[0][1];
   const cross=ux*vy-uy*vx;
   const light=Math.max(65,Math.min(205,120+cross/500));
   ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);ctx.lineTo(pts[1][0],pts[1][1]);ctx.lineTo(pts[2][0],pts[2][1]);ctx.closePath();
   ctx.fillStyle='rgb('+Math.round(light*.38)+','+Math.round(light*.7)+','+Math.round(light)+')';ctx.fill();
   ctx.strokeStyle='rgba(225,240,255,.12)';ctx.lineWidth=.4;ctx.stroke();
  }
 }
 canvas.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)});
 canvas.addEventListener('pointermove',e=>{if(!down)return;ay+=(e.clientX-down[0])*.008;ax+=(e.clientY-down[1])*.008;down=[e.clientX,e.clientY];render()});
 canvas.addEventListener('pointerup',()=>down=null);
 canvas.addEventListener('pointercancel',()=>down=null);
 input.addEventListener('change',async()=>{
  const ticket=++serial,file=input.files?.[0];panel.hidden=true;triangles=[];
  if(!file||!/\.stl$/i.test(file.name)||file.size>30*1024*1024)return;
  try{
   const buf=await file.arrayBuffer();if(ticket!==serial)return;
   const view=new DataView(buf),bytes=new Uint8Array(buf),raw=[];
   const n=buf.byteLength>=84?view.getUint32(80,true):0;
   if(n>0&&n<=3000000&&84+n*50===buf.byteLength){
    const step=Math.max(1,Math.ceil(n/6500));
    for(let i=0;i<n;i+=step){const base=84+i*50,t=[];for(let j=0;j<3;j++){const p=base+12+j*12;t.push([view.getFloat32(p,true),view.getFloat32(p+4,true),view.getFloat32(p+8,true)])}raw.push(t)}
   }else{
    const text=new TextDecoder().decode(bytes),re=/\bvertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)/gi;
    let m,t=[],i=0;const estimated=Math.max(1,Math.ceil(buf.byteLength/650000));
    while((m=re.exec(text))){t.push([Number(m[1]),Number(m[2]),Number(m[3])]);if(t.length===3){if(i++%estimated===0)raw.push(t);t=[]}}
   }
   if(!raw.length)throw Error('Файл не содержит геометрию');
   const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
   for(const t of raw)for(const p of t)for(let i=0;i<3;i++){low[i]=Math.min(low[i],p[i]);high[i]=Math.max(high[i],p[i])}
   const middle=low.map((v,i)=>(v+high[i])/2),max=Math.max(...low.map((v,i)=>high[i]-v));
   if(!Number.isFinite(max)||max<=0)throw Error('Некорректная геометрия');
   const scale=270/max;
   triangles=raw.map(t=>t.map(p=>p.map((v,i)=>(v-middle[i])*scale)));
   panel.querySelector('.stl-preview-name').textContent=file.name+' · '+raw.length.toLocaleString('ru-RU')+' треугольников в предпросмотре';
   panel.hidden=false;render();
  }catch(e){panel.hidden=false;panel.querySelector('.stl-preview-name').textContent='Не удалось показать модель: '+e.message}
 });
}
const observer=new MutationObserver(()=>document.querySelectorAll('.order-entry-form input[name="stl"]').forEach(mountPreview));
observer.observe(document.documentElement,{subtree:true,childList:true});
document.querySelectorAll('.order-entry-form input[name="stl"]').forEach(mountPreview);
