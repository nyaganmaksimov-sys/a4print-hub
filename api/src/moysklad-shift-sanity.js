const originalFetch=globalThis.fetch;

function toTime(value){
  const s=String(value||'').trim();
  if(!s)return NaN;
  const d=new Date(s.replace(' ','T'));
  return d.getTime();
}

function sanitizeShift(shift){
  if(!shift||typeof shift!=='object')return shift;
  const open=toTime(shift.openDate||shift.moment||shift.created);
  const close=toTime(shift.closeDate);
  if(Number.isFinite(open)&&Number.isFinite(close)&&close<open){
    shift={...shift,closeDate:null};
  }
  return shift;
}

function moscowNow(){
  const parts=new Intl.DateTimeFormat('sv-SE',{
    timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }).format(new Date());
  return parts.replace('T',' ');
}

function isRetailShiftUrl(url){
  try{
    const u=new URL(url);
    return u.hostname==='api.moysklad.ru'&&u.pathname.includes('/entity/retailshift');
  }catch{return false}
}

globalThis.fetch=async function patchedMoySkladFetch(input,init={}){
  const url=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
  let options=init||{};
  const method=String(options.method||input?.method||'GET').toUpperCase();

  if(isRetailShiftUrl(url)&&method==='PUT'&&typeof options.body==='string'){
    try{
      const body=JSON.parse(options.body);
      if(body&&Object.prototype.hasOwnProperty.call(body,'closeDate')&&body.closeDate){
        body.closeDate=moscowNow();
        options={...options,body:JSON.stringify(body)};
      }
    }catch{}
  }

  const response=await originalFetch(input,options);
  if(!isRetailShiftUrl(url)||method!=='GET'||!response.ok)return response;

  try{
    const data=await response.clone().json();
    if(Array.isArray(data?.rows))data.rows=data.rows.map(sanitizeShift);
    else if(data&&typeof data==='object')Object.assign(data,sanitizeShift(data));
    const headers=new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});
  }catch{
    return response;
  }
};
