// G-code visualization uses real extrusion paths, with estimated time only.
export function createGcodePlayer({root,file,estimatedSeconds=0}){
 root.replaceChildren();
 const canvas=document.createElement('canvas');canvas.width=840;canvas.height=440;canvas.style.cssText='display:block;max-width:100%;width:100%;border:1px solid #36516c;border-radius:12px;background:#101827;touch-action:none';
 const controls=document.createElement('div');controls.className='row-controls';
 const play=document.createElement('button');play.textContent='▶';play.type='button';
 const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='1000';slider.value='0';slider.setAttribute('aria-label','Время печати');slider.style.flex='1';
 const layer=document.createElement('select');layer.add(new Option('По времени','time'),new Option('По слоям','layer'));
 const status=document.createElement('span');status.textContent='Загружаем G-code…';
 controls.append(play,slider,layer,status);root.append(canvas,controls);
 const info=document.createElement('p');info.textContent='Расчётная анимация; не телеметрия принтера.';root.append(info);
 const ctx=canvas.getContext('2d');let segments=[],elapsed=0,total=1,rx=.45,ry=.6,scale=1,playing=false,last=0,frame=0,drag=null,active=true;
 function render(){
  ctx.fillStyle='#101827';ctx.fillRect(0,0,canvas.width,canvas.height);
  const ca=Math.cos(ry),sa=Math.sin(ry),cb=Math.cos(rx),sb=Math.sin(rx);
  const point=p=>{const x=p[0]*ca+p[2]*sa,z=-p[0]*sa+p[2]*ca,y=p[1]*cb-z*sb;return [canvas.width/2+x*scale,canvas.height/2-y*scale]};
  const maximumLayer=segments.length?segments[segments.length-1].layer:0;
  const selectedLayer=Math.floor(elapsed/total*(maximumLayer+1));
  ctx.strokeStyle='#65d5f5';ctx.lineWidth=.8;ctx.beginPath();let lastSegment=null;
  for(const segment of segments){
   if((layer.value==='time'&&segment.t>elapsed)||(layer.value==='layer'&&segment.layer>selectedLayer))break;
   const a=point(segment.a),b=point(segment.b);ctx.moveTo(...a);ctx.lineTo(...b);lastSegment=segment;
  }
  ctx.stroke();
  if(lastSegment){const p=point(lastSegment.b);ctx.fillStyle='#ffbc68';ctx.beginPath();ctx.arc(...p,4,0,Math.PI*2);ctx.fill()}
  const hours=s=>Math.floor(s/3600)+':'+String(Math.floor(s%3600/60)).padStart(2,'0')+':'+String(Math.floor(s%60)).padStart(2,'0');
  status.textContent=Math.round(elapsed/total*100)+'% · слой '+(lastSegment?lastSegment.layer+1:0)+' / '+(maximumLayer+1)+' · '+hours(elapsed)+' / '+hours(total);
 }
 const update=()=>{elapsed=Number(slider.value)/1000*total;render()};
 slider.addEventListener('input',update);layer.addEventListener('change',render);
 const stop=()=>{playing=false;play.textContent='▶';cancelAnimationFrame(frame)};
 const tick=t=>{if(!playing||!active)return;if(last){elapsed=Math.min(total,elapsed+(t-last)/1000*12);slider.value=String(Math.round(elapsed/total*1000));render()}last=t;if(elapsed>=total){stop();return}frame=requestAnimationFrame(tick)};
 play.addEventListener('click',()=>{if(playing){stop();return}if(elapsed>=total){elapsed=0;slider.value='0'}playing=true;last=0;play.textContent='⏸';frame=requestAnimationFrame(tick)});
 canvas.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)});
 canvas.addEventListener('pointermove',e=>{if(!drag)return;ry+=(e.clientX-drag[0])*.01;rx+=(e.clientY-drag[1])*.01;drag=[e.clientX,e.clientY];render()});
 canvas.addEventListener('pointerup',()=>drag=null);canvas.addEventListener('pointercancel',()=>drag=null);
 canvas.addEventListener('wheel',e=>{e.preventDefault();scale*=e.deltaY>0?.9:1.1;render()},{passive:false});
 const worker=new Worker(new URL('./3d-artprint-gcode-worker.js',import.meta.url),{type:'module'});
 worker.onmessage=e=>{if(!active)return;if(e.data.error){info.textContent=e.data.error;return}
  const result=e.data;segments=result.segments.map(s=>({a:s.slice(0,3),b:s.slice(3,6),t:s[6],layer:s[7]}));
  const timeRatio=estimatedSeconds>0&&result.total>0?estimatedSeconds/result.total:1;
  total=Math.max(1,result.total*timeRatio);
  const bounds=result.bounds,center=[0,1,2].map(i=>(bounds[i]+bounds[i+3])/2);
  segments.forEach(s=>{s.a=s.a.map((v,i)=>v-center[i]);s.b=s.b.map((v,i)=>v-center[i]);s.t*=timeRatio});
  scale=340/Math.max(1,...[0,1,2].map(i=>bounds[i+3]-bounds[i]));
  info.textContent='Траектории экструзии: '+segments.length.toLocaleString('ru-RU')+'. Временная шкала приблизительная.';render();
 };
 worker.onerror=e=>{info.textContent='Ошибка обработки G-code: '+e.message};
 file.text().then(text=>{if(active)worker.postMessage({text})}).catch(e=>{info.textContent=e.message});
 return ()=>{active=false;stop();worker.terminate();root.replaceChildren()};
}
