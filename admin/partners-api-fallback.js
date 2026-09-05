(()=>{
  if(window.__A4_PARTNERS_API_FALLBACK__) return;
  window.__A4_PARTNERS_API_FALLBACK__=true;

  const cfg=window.A4PRINT_CONFIG||{};
  const apiBase=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const supabaseUrl=String(cfg.supabaseUrl||'').replace(/\/$/,'');
  const publishableKey=cfg.supabasePublishableKey||'';
  if(!apiBase||!supabaseUrl||!publishableKey||typeof window.fetch!=='function') return;

  const nativeFetch=window.fetch.bind(window);
  const jsonResponse=(body,status=200)=>new Response(JSON.stringify(body),{
    status,
    headers:{'Content-Type':'application/json; charset=utf-8'}
  });
  const authHeader=init=>{
    const h=new Headers(init?.headers||{});
    return h.get('Authorization')||'';
  };
  const restHeaders=(authorization,extra={})=>({
    apikey:publishableKey,
    Authorization:authorization,
    Accept:'application/json',
    ...extra
  });
  const parseBody=init=>{
    try{return typeof init?.body==='string'?JSON.parse(init.body):init?.body||{}}catch{return {}}
  };
  const timeoutFetch=async(input,init={},ms=4500)=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),ms);
    try{return await nativeFetch(input,{...init,signal:controller.signal})}
    finally{clearTimeout(timer)}
  };
  async function readJson(response){
    const text=await response.text();
    try{return text?JSON.parse(text):null}catch{return text}
  }
  async function directPartnersList(authorization){
    const fields='id,name,legal_name,tax_id,contact_name,email,phone,address,discount_percent,credit_limit,payment_terms_days,notes,is_active,created_at';
    const pRes=await nativeFetch(`${supabaseUrl}/rest/v1/partners?select=${encodeURIComponent(fields)}&order=created_at.desc`,{
      headers:restHeaders(authorization),cache:'no-store'
    });
    const pData=await readJson(pRes);
    if(!pRes.ok) return jsonResponse({success:false,error:pData?.message||pData?.error||`HTTP ${pRes.status}`},pRes.status);

    let counts={};
    try{
      const oRes=await nativeFetch(`${supabaseUrl}/rest/v1/orders?select=partner_id&partner_id=not.is.null`,{
        headers:restHeaders(authorization),cache:'no-store'
      });
      if(oRes.ok){
        const rows=await readJson(oRes);
        counts=(Array.isArray(rows)?rows:[]).reduce((acc,row)=>{
          if(row?.partner_id) acc[row.partner_id]=(acc[row.partner_id]||0)+1;
          return acc;
        },{});
      }
    }catch{}
    const partners=(Array.isArray(pData)?pData:[]).map(p=>({...p,orders_count:counts[p.id]||0}));
    return jsonResponse({success:true,partners});
  }
  async function directPartnerPatch(id,body,authorization){
    if(body?.is_active===true){
      return jsonResponse({
        success:false,
        error:'Сервис управления доступом партнёров временно недоступен. Для включения партнёра нужен сервер A4PRINT HUB. Повторите попытку чуть позже.'
      },503);
    }
    const safe={};
    for(const key of ['name','legal_name','tax_id','contact_name','email','phone','address','notes']){
      if(typeof body?.[key]==='string') safe[key]=body[key].trim()||null;
    }
    if(body?.discount_percent!==undefined) safe.discount_percent=Math.max(0,Math.min(100,Number(body.discount_percent)||0));
    if(body?.credit_limit!==undefined) safe.credit_limit=Math.max(0,Number(body.credit_limit)||0);
    if(body?.payment_terms_days!==undefined) safe.payment_terms_days=Math.max(0,Math.floor(Number(body.payment_terms_days)||0));
    if(typeof body?.is_active==='boolean') safe.is_active=body.is_active;
    safe.updated_at=new Date().toISOString();

    const pRes=await nativeFetch(`${supabaseUrl}/rest/v1/partners?id=eq.${encodeURIComponent(id)}`,{
      method:'PATCH',
      headers:restHeaders(authorization,{'Content-Type':'application/json',Prefer:'return=representation'}),
      body:JSON.stringify(safe),cache:'no-store'
    });
    const pData=await readJson(pRes);
    if(!pRes.ok) return jsonResponse({success:false,error:pData?.message||pData?.error||`HTTP ${pRes.status}`},pRes.status);

    if(typeof body?.is_active==='boolean'){
      try{
        await nativeFetch(`${supabaseUrl}/rest/v1/partner_users?partner_id=eq.${encodeURIComponent(id)}`,{
          method:'PATCH',
          headers:restHeaders(authorization,{'Content-Type':'application/json'}),
          body:JSON.stringify({is_active:body.is_active,updated_at:new Date().toISOString()}),cache:'no-store'
        });
      }catch{}
    }
    return jsonResponse({success:true,partner:Array.isArray(pData)?pData[0]||null:pData});
  }
  async function directPartnerCreate(body,authorization){
    const hasAccessData=Boolean(String(body?.email||'').trim()||String(body?.password||'').trim());
    if(hasAccessData){
      return jsonResponse({
        success:false,
        error:'Сервер создания доступа партнёра сейчас недоступен. Карточка партнёров работает, но создание логина и пароля требует сервер A4PRINT HUB. Повторите попытку чуть позже.'
      },503);
    }
    const name=String(body?.name||'').trim();
    if(!name) return jsonResponse({success:false,error:'Укажите название партнёра.'},400);
    const payload={
      name,
      contact_name:String(body?.contact_name||'').trim()||null,
      phone:String(body?.phone||'').trim()||null,
      notes:String(body?.notes||'').trim()||null,
      discount_percent:Math.max(0,Math.min(100,Number(body?.discount_percent)||0)),
      payment_terms_days:Math.max(0,Math.floor(Number(body?.payment_terms_days)||0)),
      is_active:true
    };
    const r=await nativeFetch(`${supabaseUrl}/rest/v1/partners`,{
      method:'POST',
      headers:restHeaders(authorization,{'Content-Type':'application/json',Prefer:'return=representation'}),
      body:JSON.stringify(payload),cache:'no-store'
    });
    const data=await readJson(r);
    if(!r.ok) return jsonResponse({success:false,error:data?.message||data?.error||`HTTP ${r.status}`},r.status);
    return jsonResponse({success:true,partner:Array.isArray(data)?data[0]||null:data},201);
  }

  window.fetch=async function(input,init={}){
    const url=typeof input==='string'?input:input?.url||'';
    if(!url.startsWith(apiBase+'/api/v1/partners')) return nativeFetch(input,init);

    const method=String(init?.method||'GET').toUpperCase();
    const authorization=authHeader(init);
    const path=url.slice(apiBase.length).split('?')[0];

    if(method==='GET'&&path==='/api/v1/partners'){
      try{
        const live=await timeoutFetch(input,init,3500);
        if(live.ok) return live;
      }catch{}
      return directPartnersList(authorization);
    }

    if(method==='POST'&&path==='/api/v1/partners'){
      try{
        const live=await timeoutFetch(input,init,5500);
        if(live.ok||live.status<500) return live;
      }catch{}
      return directPartnerCreate(parseBody(init),authorization);
    }

    const patchMatch=path.match(/^\/api\/v1\/partners\/([^/]+)$/);
    if(method==='PATCH'&&patchMatch){
      try{
        const live=await timeoutFetch(input,init,4500);
        if(live.ok||live.status<500) return live;
      }catch{}
      return directPartnerPatch(decodeURIComponent(patchMatch[1]),parseBody(init),authorization);
    }

    return nativeFetch(input,init);
  };
})();
