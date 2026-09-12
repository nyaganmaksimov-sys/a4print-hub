(()=>{
  if(window.__A4_DASHBOARD_PANELS__)return;
  window.__A4_DASHBOARD_PANELS__=true;

  const STORAGE_PREFIX='a4hub.dashboard.collapse.';

  function installStyles(){
    if(document.getElementById('a4-dashboard-panels-style'))return;
    const s=document.createElement('style');
    s.id='a4-dashboard-panels-style';
    s.textContent=`
      .dash-collapse-btn{
        display:inline-grid;place-items:center;width:34px;height:34px;flex:0 0 34px;
        border:1px solid #dbe3ee;border-radius:10px;background:#f8fafc;color:#64748b;
        cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease,transform .15s ease;
      }
      .dash-collapse-btn:hover{background:#eef4ff;border-color:#c7d5e7;color:#2563eb}
      .dash-collapse-btn svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease}
      .dash-card.is-collapsed>.dash-card-head .dash-collapse-btn svg{transform:rotate(-90deg)}
      .dash-card.is-collapsed>:not(.dash-card-head){display:none!important}
      .dash-card.is-collapsed .dash-card-head{border-bottom:0!important}
      .dash-card-head-actions{display:flex;align-items:center;gap:8px;min-width:0}
      .dash-card-head-actions>.dashboard-quick{margin-left:0}

      /* Cash journal: compact, readable and aligned. */
      .dash-cash-journal{
        margin:12px 14px 14px!important;padding:0!important;border:1px solid #e2e8f0!important;
        border-radius:14px!important;background:#fbfdff!important;overflow:hidden!important;
      }
      .dash-cash-journal-head{
        display:flex;align-items:center;justify-content:space-between;gap:12px;
        padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e7edf5;
      }
      .dash-cash-journal-title{display:flex;align-items:center;gap:10px;min-width:0}
      .dash-cash-journal-title h3{margin:0!important;color:#172033;font-size:13.5px!important;line-height:1.2;font-weight:850}
      .dash-cash-journal-count{display:inline-flex;align-items:center;min-height:23px;padding:0 8px;border-radius:999px;background:#eaf1fb;color:#52657f;font-size:9.5px;font-weight:800;white-space:nowrap}
      .dash-cash-journal.is-collapsed>.dash-cash-op,
      .dash-cash-journal.is-collapsed>.dash-empty{display:none!important}
      .dash-cash-journal.is-collapsed .dash-cash-journal-head{border-bottom:0}
      .dash-cash-journal.is-collapsed .dash-collapse-btn svg{transform:rotate(-90deg)}

      .dash-cash-op{
        display:grid!important;grid-template-columns:112px minmax(0,1fr) 116px!important;
        gap:14px!important;align-items:center!important;padding:11px 14px!important;
        min-height:58px;border-bottom:1px solid #edf2f7!important;font-size:12px!important;
      }
      .dash-cash-op:last-child{border-bottom:0!important}
      .dash-cash-op:hover{background:#fff}
      .dash-cash-op>b{
        display:inline-flex;align-items:center;justify-content:center;width:max-content;min-width:82px;
        min-height:27px;padding:0 9px;border-radius:999px;font-size:10.5px!important;font-weight:850!important;
      }
      .dash-cash-op>b.in{color:#15803d!important;background:#ecfdf5}
      .dash-cash-op>b.out{color:#b91c1c!important;background:#fef2f2}
      .dash-cash-op>span{min-width:0;color:#263449;font-size:12.5px;line-height:1.35;overflow-wrap:anywhere}
      .dash-cash-op small{display:block!important;margin-top:4px!important;color:#94a3b8!important;font-size:10px!important;line-height:1.3}
      .dash-cash-op>strong{justify-self:end;color:#0f172a;font-size:13px;font-weight:900;white-space:nowrap;text-align:right}
      .dash-cash-op>b.in~strong{color:#15803d}
      .dash-cash-op>b.out~strong{color:#b91c1c}

      @media(max-width:1100px){
        .dash-cash-op{grid-template-columns:100px minmax(0,1fr) 100px!important;gap:10px!important}
      }
      @media(max-width:700px){
        .dash-card-head{align-items:flex-start!important}
        .dash-card-head-actions{flex-wrap:wrap;justify-content:flex-end}
        .dash-cash-op{grid-template-columns:minmax(0,1fr) auto!important;gap:7px 10px!important;padding:11px 12px!important}
        .dash-cash-op>b{grid-column:1;justify-self:start}
        .dash-cash-op>span{grid-column:1/-1;grid-row:2}
        .dash-cash-op>strong{grid-column:2;grid-row:1;align-self:center}
      }
    `;
    document.head.appendChild(s);
  }

  function safeKey(value){
    return String(value||'block').toLowerCase().trim().replace(/[^a-zа-яё0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,80)||'block';
  }

  function stored(key){
    try{return localStorage.getItem(STORAGE_PREFIX+key)==='1'}catch{return false}
  }
  function store(key,value){
    try{localStorage.setItem(STORAGE_PREFIX+key,value?'1':'0')}catch{}
  }

  function button(label){
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='dash-collapse-btn';
    btn.setAttribute('aria-label',label);
    btn.title=label;
    btn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';
    return btn;
  }

  function enhanceCard(card,index){
    if(card.dataset.a4Collapsible==='1')return;
    const head=card.querySelector(':scope > .dash-card-head');
    if(!head)return;
    const title=head.querySelector('h2')?.textContent?.trim()||`Блок ${index+1}`;
    const key='card-'+safeKey(title);
    const btn=button(`Свернуть или развернуть: ${title}`);

    let actions=head.querySelector(':scope > .dash-card-head-actions');
    if(!actions){
      actions=document.createElement('div');
      actions.className='dash-card-head-actions';
      const candidates=[...head.children].filter(x=>x!==head.firstElementChild);
      candidates.forEach(x=>actions.appendChild(x));
      head.appendChild(actions);
    }
    actions.appendChild(btn);
    card.dataset.a4Collapsible='1';
    card.dataset.collapseKey=key;
    if(stored(key))card.classList.add('is-collapsed');
    btn.setAttribute('aria-expanded',String(!card.classList.contains('is-collapsed')));
    btn.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();
      const collapsed=card.classList.toggle('is-collapsed');
      btn.setAttribute('aria-expanded',String(!collapsed));
      store(key,collapsed);
    });
  }

  function enhanceCashJournal(){
    const journal=document.getElementById('cashJournal');
    if(!journal||journal.dataset.a4Enhanced==='1')return;
    const oldTitle=journal.querySelector(':scope > h3');
    if(!oldTitle)return;
    const rows=journal.querySelectorAll(':scope > .dash-cash-op').length;
    const key='cash-journal';
    const head=document.createElement('div');
    head.className='dash-cash-journal-head';
    const title=document.createElement('div');
    title.className='dash-cash-journal-title';
    oldTitle.remove();
    title.appendChild(oldTitle);
    const count=document.createElement('span');
    count.className='dash-cash-journal-count';
    count.textContent=rows?`${rows} ${rows===1?'операция':rows>=2&&rows<=4?'операции':'операций'}`:'нет операций';
    title.appendChild(count);
    const btn=button('Свернуть или развернуть движения наличных');
    head.append(title,btn);
    journal.prepend(head);
    journal.dataset.a4Enhanced='1';
    if(stored(key))journal.classList.add('is-collapsed');
    btn.setAttribute('aria-expanded',String(!journal.classList.contains('is-collapsed')));
    btn.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();
      const collapsed=journal.classList.toggle('is-collapsed');
      btn.setAttribute('aria-expanded',String(!collapsed));
      store(key,collapsed);
    });
  }

  function enhance(){
    document.querySelectorAll('.dash-card').forEach(enhanceCard);
    enhanceCashJournal();
  }

  function init(){
    installStyles();
    enhance();
    let queued=false;
    const observer=new MutationObserver(()=>{
      if(queued)return;queued=true;
      requestAnimationFrame(()=>{queued=false;enhance()});
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
