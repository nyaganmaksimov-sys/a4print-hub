(()=>{
  if(window.__A4_POS_RUNTIME_GUARD__)return;
  window.__A4_POS_RUNTIME_GUARD__=true;
  const cfg=window.A4PRINT_CONFIG||{};
  let saleReady=null;
  let lastBuild='';
  let timer=null;

  function notice(text,error=false,sticky=false){
    const n=document.getElementById('notice');if(!n)return;
    n.textContent=text;n.className='notice'+(error?' error':'');n.style.display='block';
    clearTimeout(notice.t);
    if(!sticky)notice.t=setTimeout(()=>n.style.display='none',3600);
  }

  function setBackendChip(state,text){
    let el=document.getElementById('posBackendState');
    const actions=document.querySelector('.top-actions');
    if(!actions)return;
    if(!el){
      el=document.createElement('div');
      el.id='posBackendState';
      el.className='chip';
      actions.insertBefore(el,actions.firstChild);
    }
    const cls=state==='ok'?'ok':state==='bad'?'bad':'';
    el.innerHTML=`<span class="dot ${cls}"></span><b>${text}</b>`;
  }

  async function check(){
    if(!cfg.apiBaseUrl)return;
    try{
      const r=await fetch(`${cfg.apiBaseUrl}/api/v1/health?pos_guard=${Date.now()}`,{cache:'no-store'});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.message||d.error||`HTTP ${r.status}`);
      lastBuild=String(d.build||'');
      const explicit=d?.capabilities?.posSale;
      if(explicit===true){
        const wasBlocked=saleReady===false;
        saleReady=true;
        setBackendChip('ok','Сервер кассы готов');
        if(wasBlocked)notice('Сервер кассы обновлён. Продажи снова доступны.');
        return;
      }
      if(explicit===false||(!explicit&&!lastBuild)){
        saleReady=false;
        setBackendChip('bad','Сервер кассы устарел');
        notice('Сервер кассы обновляется. Чек сохранён на экране — повторите оплату после обновления.',true,true);
        return;
      }
      saleReady=null;
      setBackendChip('','Проверка сервера');
    }catch(e){
      saleReady=null;
      setBackendChip('bad','Связь с сервером');
    }
  }

  document.addEventListener('click',e=>{
    const pay=e.target?.closest?.('#pay');
    if(pay&&saleReady===false){
      e.preventDefault();e.stopImmediatePropagation();
      notice('Продажа временно заблокирована: сервер кассы ещё не обновился. Корзина не потеряется.',true,true);
      check();
      return;
    }
    if(document.body.classList.contains('nav-open')){
      const side=e.target?.closest?.('.pos-side');
      const menu=e.target?.closest?.('#mobileMenu');
      if(!side&&!menu)document.body.classList.remove('nav-open');
    }
  },true);

  function start(){
    check();
    timer=setInterval(()=>{if(!document.hidden)check()},10000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('beforeunload',()=>timer&&clearInterval(timer));
})();
