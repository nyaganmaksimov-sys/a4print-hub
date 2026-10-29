// Sampled extrusion paths and approximate travel time; input remains client-side.
self.onmessage=e=>{
 try{
  const source=e.data.text;if(typeof source!=='string'||source.length>55*1024*1024)throw Error('Файл слишком большой или не текстовый');
  let x=0,y=0,z=0,extruder=0,feed=1800,absolute=true,eAbsolute=true,time=0,layer=0;
  const paths=[],bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity],levels=new Map();
  const rx=/([XYZEF])\s*(-?\d+(?:\.\d+)?)/gi;
  for(const line of source.split(/\r?\n/)){
   const cmd=line.split(';')[0].trim().toUpperCase();
   if(/^G90(?:\s|$)/.test(cmd)){absolute=true;continue}
   if(/^G91(?:\s|$)/.test(cmd)){absolute=false;continue}
   if(/^M82(?:\s|$)/.test(cmd)){eAbsolute=true;continue}
   if(/^M83(?:\s|$)/.test(cmd)){eAbsolute=false;continue}
   if(/^G92(?:\s|$)/.test(cmd)){for(const m of cmd.matchAll(rx)){const v=Number(m[2]);if(m[1]==='E')extruder=v;else if(m[1]==='X')x=v;else if(m[1]==='Y')y=v;else if(m[1]==='Z')z=v}continue}
   if(!/^G0?[01](?:\s|$)/.test(cmd))continue;
   let nx=x,ny=y,nz=z,ne=extruder,nf=feed;
   for(const m of cmd.matchAll(rx)){const v=Number(m[2]),k=m[1];if(!Number.isFinite(v))continue;
    if(k==='X')nx=absolute?v:x+v;else if(k==='Y')ny=absolute?v:y+v;else if(k==='Z')nz=absolute?v:z+v;else if(k==='E')ne=eAbsolute?v:extruder+v;else if(k==='F'&&v>0)nf=v;
   }
   feed=nf;const length=Math.hypot(nx-x,ny-y,nz-z);
   if(ne>extruder+1e-5&&length>0){
    const key=nz.toFixed(3);if(!levels.has(key))levels.set(key,levels.size);layer=levels.get(key);
    const a=[x,y,z],b=[nx,ny,nz];if(paths.length<120000)paths.push([...a,...b,time,layer]);
    for(const p of [a,b])for(let j=0;j<3;j++){bounds[j]=Math.min(bounds[j],p[j]);bounds[j+3]=Math.max(bounds[j+3],p[j])}
   }
   time+=Math.min(600,length/Math.max(1,feed)*60);
   x=nx;y=ny;z=nz;extruder=ne;
  }
  if(!paths.length)throw Error('Нет распознанных движений экструзии');
  self.postMessage({segments:paths,bounds,total:Math.max(1,time)});
 }catch(err){self.postMessage({error:String(err.message||err)})}
};