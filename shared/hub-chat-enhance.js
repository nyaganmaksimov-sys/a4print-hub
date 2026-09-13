(()=>{
  if(window.__A4_HUB_CHAT_ENHANCE__)return;
  window.__A4_HUB_CHAT_ENHANCE__=true;
  if(/\/partner\//.test(location.pathname))return;

  let mode='ALL';
  let queued=false;

  function install(){
    const root=document.getElementById('hubChatApp');
    const head=root?.querySelector('.hc-sidebar-head');
    const contacts=root?.querySelector('#hcContacts');
    if(!head||!contacts)return false;

    let filters=head.querySelector('.hc-filters');
    if(!filters){
      filters=document.createElement('div');
      filters.className='hc-filters';
      filters.innerHTML=`
        <button type="button" data-hc-filter="ALL" class="active">Все</button>
        <button type="button" data-hc-filter="STAFF">Персонал</button>
        <button type="button" data-hc-filter="PARTNER">Партнёры</button>`;
      head.appendChild(filters);
      filters.querySelectorAll('[data-hc-filter]').forEach(btn=>btn.onclick=()=>{
        mode=btn.dataset.hcFilter||'ALL';
        filters.querySelectorAll('[data-hc-filter]').forEach(x=>x.classList.toggle('active',x===btn));
        apply();
      });
    }
    apply();
    return true;
  }

  function apply(){
    const host=document.getElementById('hcContacts');
    if(!host)return;
    const rows=[...host.querySelectorAll('.hc-contact[data-contact]')];
    rows.forEach(row=>{
      const key=String(row.dataset.contact||'');
      const show=mode==='ALL'||(mode==='STAFF'&&(key.startsWith('STAFF:')||key.startsWith('GENERAL:')))||(mode==='PARTNER'&&(key.startsWith('PARTNER:')||key.startsWith('HUB:')));
      row.classList.toggle('hc-filter-hidden',!show);
    });
    [...host.querySelectorAll('.hc-section-title')].forEach(section=>{
      let next=section.nextElementSibling,visible=false;
      while(next&&!next.classList.contains('hc-section-title')){
        if(next.matches?.('.hc-contact')&&!next.classList.contains('hc-filter-hidden'))visible=true;
        next=next.nextElementSibling;
      }
      section.classList.toggle('hc-filter-hidden',!visible);
    });
  }

  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;install()})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
