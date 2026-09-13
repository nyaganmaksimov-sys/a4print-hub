(()=>{
  if(window.__A4_PARTNERS_SEARCH_V4__)return;
  window.__A4_PARTNERS_SEARCH_V4__=true;

  function loadWorkspace(){
    if(document.querySelector('script[data-a4-partners-workspace-v4]'))return;
    const script=document.createElement('script');
    script.src='./partners-workspace-v4.js?v=20260913-workspace4';
    script.async=false;
    script.dataset.a4PartnersWorkspaceV4='1';
    document.head.appendChild(script);
  }

  function initServiceSearch(){
    const select=document.getElementById('outService');
    if(!select||document.getElementById('outServiceSearch'))return;
    const label=select.closest('label');
    if(!label)return;

    const input=document.createElement('input');
    input.id='outServiceSearch';
    input.type='search';
    input.placeholder='Быстрый поиск услуги: название, категория…';
    input.autocomplete='off';
    input.style.marginBottom='8px';
    input.style.padding='10px 11px';
    input.style.border='1px solid #dbe1ea';
    input.style.borderRadius='9px';
    input.style.width='100%';
    label.insertBefore(input,select);

    let snapshot=[];
    const take=()=>{
      snapshot=[...select.options].map(option=>({
        value:option.value,
        text:option.textContent||'',
        disabled:option.disabled
      }));
    };
    const apply=()=>{
      const query=input.value.trim().toLowerCase();
      const current=select.value;
      if(!snapshot.length)take();
      const list=query?snapshot.filter((option,index)=>index===0||option.text.toLowerCase().includes(query)):snapshot;
      select.innerHTML='';
      for(const option of list){
        const el=document.createElement('option');
        el.value=option.value;
        el.textContent=option.text;
        el.disabled=option.disabled;
        select.appendChild(el);
      }
      if([...select.options].some(option=>option.value===current))select.value=current;
      else if(query&&select.options.length===2)select.selectedIndex=1;
      select.dispatchEvent(new Event('change',{bubbles:true}));
    };

    input.addEventListener('input',apply);
    const observer=new MutationObserver(()=>{
      if(document.activeElement!==input){
        take();
        if(input.value)apply();
      }
    });
    observer.observe(select,{childList:true});
    take();
  }

  loadWorkspace();
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',initServiceSearch,{once:true});
  }else{
    initServiceSearch();
  }
  setTimeout(initServiceSearch,800);
})();
