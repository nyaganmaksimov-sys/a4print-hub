// A4PRINT HUB UI foundation — runtime states / notifications.
// No framework dependency. Exposes a small stable API as window.A4UI.
(()=>{
  if(window.A4UI?.version)return;

  const ready=fn=>{
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fn,{once:true});
    else fn();
  };

  const text=value=>value==null?'':String(value);

  function ensureToastRegion(){
    let region=document.getElementById('a4ToastRegion');
    if(region)return region;
    region=document.createElement('div');
    region.id='a4ToastRegion';
    region.className='a4-toast-region';
    region.setAttribute('role','region');
    region.setAttribute('aria-label','Уведомления');
    document.body.appendChild(region);
    return region;
  }

  function toast(options={}){
    const cfg=typeof options==='string'?{message:options}:options;
    const tone=['success','warning','error','info'].includes(cfg.tone)?cfg.tone:'info';
    const duration=Number.isFinite(cfg.duration)?Math.max(0,cfg.duration):(tone==='error'?7000:4200);
    const region=ensureToastRegion();

    const node=document.createElement('div');
    node.className='a4-toast';
    node.dataset.tone=tone;
    node.setAttribute('role',tone==='error'?'alert':'status');

    const copy=document.createElement('div');
    copy.className='a4-toast-copy';

    if(cfg.title){
      const title=document.createElement('strong');
      title.className='a4-toast-title';
      title.textContent=text(cfg.title);
      copy.appendChild(title);
    }

    if(cfg.message){
      const message=document.createElement('span');
      message.className='a4-toast-message';
      message.textContent=text(cfg.message);
      copy.appendChild(message);
    }

    if(Array.isArray(cfg.actions)&&cfg.actions.length){
      const actions=document.createElement('div');
      actions.className='a4-toast-actions';
      cfg.actions.slice(0,2).forEach(action=>{
        if(!action?.label)return;
        const button=document.createElement('button');
        button.type='button';
        button.textContent=text(action.label);
        if(action.primary)button.classList.add('primary');
        button.addEventListener('click',async()=>{
          try{await action.onClick?.()}finally{if(action.keepOpen!==true)node.remove()}
        });
        actions.appendChild(button);
      });
      copy.appendChild(actions);
    }

    const close=document.createElement('button');
    close.type='button';
    close.className='a4-toast-close';
    close.setAttribute('aria-label','Закрыть уведомление');
    close.textContent='×';
    close.addEventListener('click',()=>node.remove());

    node.append(document.createElement('i'),copy,close);
    region.appendChild(node);

    if(duration>0)setTimeout(()=>node.remove(),duration);
    return node;
  }

  function state(target,options={}){
    const node=typeof target==='string'?document.querySelector(target):target;
    if(!node)return null;
    node.classList.add('a4-state');
    const tone=options.tone||'neutral';
    if(tone!=='neutral')node.dataset.tone=tone;
    else delete node.dataset.tone;
    node.replaceChildren();

    if(options.title){
      const title=document.createElement('b');
      title.textContent=text(options.title);
      node.appendChild(title);
    }
    if(options.message){
      const message=document.createElement('span');
      message.textContent=text(options.message);
      node.appendChild(message);
    }
    if(options.action?.label){
      const button=document.createElement('button');
      button.type='button';
      button.textContent=text(options.action.label);
      button.addEventListener('click',()=>options.action.onClick?.());
      node.appendChild(button);
    }
    return node;
  }

  function skeleton(target,{rows=3}={}){
    const node=typeof target==='string'?document.querySelector(target):target;
    if(!node)return null;
    node.replaceChildren();
    const wrap=document.createElement('div');
    wrap.style.cssText='display:grid;gap:8px;width:100%;padding:4px 0';
    for(let i=0;i<Math.max(1,rows);i++){
      const line=document.createElement('div');
      line.className='a4-skeleton';
      line.style.height=i===0?'14px':'11px';
      line.style.width=i===rows-1?'72%':'100%';
      wrap.appendChild(line);
    }
    node.appendChild(wrap);
    return node;
  }

  function setSaveState(target,status='idle',message=''){
    const node=typeof target==='string'?document.querySelector(target):target;
    if(!node)return null;
    node.classList.add('a4-save-state');
    node.dataset.state=status;
    const defaults={
      saving:'Сохранение…',
      saved:'Сохранено',
      error:'Ошибка сохранения',
      idle:''
    };
    node.textContent=message||defaults[status]||'';
    return node;
  }

  function ensureNetworkBanner(){
    let node=document.getElementById('a4NetworkBanner');
    if(node)return node;
    node=document.createElement('div');
    node.id='a4NetworkBanner';
    node.className='a4-network-banner';
    node.hidden=true;
    node.setAttribute('role','status');
    document.body.appendChild(node);
    return node;
  }

  function renderNetwork(){
    const node=ensureNetworkBanner();
    if(navigator.onLine){
      node.hidden=true;
      node.textContent='';
      document.documentElement.dataset.network='online';
    }else{
      document.documentElement.dataset.network='offline';
      node.hidden=false;
      node.textContent='○ Нет подключения · данные могут быть не обновлены';
    }
  }

  function clearLocalUiCache(){
    try{
      const keep=new Set(['a4print_hub_logo']);
      const keys=[];
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);
        if(key&&/^a4(?:print)?[_-]/i.test(key)&&!keep.has(key))keys.push(key);
      }
      keys.forEach(key=>localStorage.removeItem(key));
    }catch{}
    try{
      if('caches'in window)caches.keys().then(keys=>Promise.all(keys.map(key=>caches.delete(key))));
    }catch{}
  }

  function showRecovery(error){
    if(document.getElementById('a4Recovery'))return;
    const root=document.createElement('div');
    root.id='a4Recovery';
    root.className='a4-recovery';

    const card=document.createElement('section');
    card.className='a4-recovery-card';
    const title=document.createElement('h1');
    title.textContent='A4PRINT HUB не удалось запустить один из модулей.';
    const message=document.createElement('p');
    message.textContent='Рабочие данные не удалены. Можно перезапустить интерфейс или очистить локальный UI-кэш.';
    const actions=document.createElement('div');
    actions.className='a4-recovery-actions';

    const reload=document.createElement('button');
    reload.type='button';
    reload.className='primary';
    reload.textContent='Перезапустить интерфейс';
    reload.onclick=()=>location.reload();

    const cache=document.createElement('button');
    cache.type='button';
    cache.textContent='Очистить локальный кэш';
    cache.onclick=()=>{clearLocalUiCache();location.reload()};

    const diag=document.createElement('button');
    diag.type='button';
    diag.textContent='Открыть диагностику';
    diag.onclick=()=>{
      const details=document.createElement('pre');
      details.style.cssText='margin:14px 0 0;padding:10px;max-height:220px;overflow:auto;background:#f5f6f8;border:1px solid #e2e5e9;border-radius:6px;font:11px/1.45 var(--a4-font-mono);white-space:pre-wrap';
      details.textContent=text(error?.stack||error?.message||error||'Нет дополнительных данных');
      if(!card.querySelector('pre'))card.appendChild(details);
    };

    actions.append(reload,cache,diag);
    card.append(title,message,actions);
    root.appendChild(card);
    document.body.appendChild(root);
  }

  function fromError(error,fallback='Не удалось выполнить действие'){
    const message=text(error?.message||error||fallback);
    return toast({tone:'error',title:fallback,message});
  }

  const api={
    version:'2026.09.22',
    toast,
    state,
    skeleton,
    setSaveState,
    fromError,
    showRecovery,
    clearLocalUiCache,
    network:{refresh:renderNetwork}
  };
  window.A4UI=api;

  ready(()=>{
    renderNetwork();
    window.addEventListener('online',()=>{
      renderNetwork();
      toast({tone:'success',title:'Соединение восстановлено',message:'HUB снова в сети.',duration:2200});
    });
    window.addEventListener('offline',renderNetwork);
  });

  window.addEventListener('a4:fatal',event=>ready(()=>showRecovery(event.detail?.error||event.detail)));
})();
