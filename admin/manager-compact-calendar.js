(()=>{
  if(window.__A4_MANAGER_COMPACT_CALENDAR__)return;
  window.__A4_MANAGER_COMPACT_CALENDAR__=true;
  if(!/\/admin\/manager\.html$/.test(location.pathname))return;
  document.documentElement.classList.add('a4-manager-compact');

  const style=document.createElement('style');
  style.id='a4-manager-compact-calendar-style';
  style.textContent=`
    html.a4-manager-compact body{background:#f6f8fb}
    html.a4-manager-compact .main{padding-top:14px!important}
    html.a4-manager-compact .topbar{margin-bottom:9px!important}
    html.a4-manager-compact .topbar h1{font-size:27px!important}
    html.a4-manager-compact .topbar p{font-size:12px!important}

    html.a4-manager-compact .quick{gap:8px!important;margin-bottom:9px!important}
    html.a4-manager-compact .quick a{min-height:54px!important;padding:8px 12px!important;border-radius:13px!important}
    html.a4-manager-compact .quick a span{font-size:10px!important;margin-top:2px!important}

    html.a4-manager-compact .manager-kpis{gap:7px!important;margin-bottom:9px!important}
    html.a4-manager-compact .manager-kpi{min-height:56px!important;padding:8px 11px!important;border-radius:13px!important}
    html.a4-manager-compact .manager-kpi small{font-size:9.5px!important}
    html.a4-manager-compact .manager-kpi b{font-size:18px!important;margin-top:2px!important}

    html.a4-manager-compact #managerCalendarWrap.manager-workspace-v3{margin-bottom:10px!important}
    html.a4-manager-compact .manager-event-card{padding:10px 12px!important;margin-bottom:9px!important;border-radius:14px!important}
    html.a4-manager-compact .manager-event-card .mgr-head{margin-bottom:6px!important}
    html.a4-manager-compact .manager-event-card .mgr-head h3{font-size:14px!important}
    html.a4-manager-compact .manager-event-card .event-form{gap:6px 8px!important}
    html.a4-manager-compact .manager-event-card .event-form input,
    html.a4-manager-compact .manager-event-card .event-form select,
    html.a4-manager-compact .manager-event-card .event-form textarea{min-height:34px!important;height:34px!important;padding:6px 8px!important;font-size:11px!important}
    html.a4-manager-compact .manager-event-card .event-form label{font-size:9px!important;gap:3px!important}
    html.a4-manager-compact .manager-event-card .field-msg{display:none!important}

    html.a4-manager-compact .manager-workspace-columns{grid-template-columns:minmax(430px,1.05fr) minmax(300px,.72fr)!important;gap:10px!important}
    html.a4-manager-compact .manager-left-flow,
    html.a4-manager-compact .manager-right-flow{gap:10px!important}
    html.a4-manager-compact .manager-side-stack{gap:9px!important}
    html.a4-manager-compact .manager-side-stack>.mgr-card{padding:10px 12px!important;border-radius:14px!important}

    html.a4-manager-compact .manager-calendar-card{padding:10px 12px!important;border-radius:14px!important;overflow:visible!important}
    html.a4-manager-compact .manager-calendar-card .mgr-head{margin-bottom:5px!important}
    html.a4-manager-compact .manager-calendar-card .mgr-head h2{font-size:16px!important}
    html.a4-manager-compact .manager-calendar-card .mgr-note{font-size:9px!important;margin-top:1px!important}
    html.a4-manager-compact .manager-calendar-card .mgr-btn{min-height:28px!important;padding:4px 7px!important;font-size:10px!important}
    html.a4-manager-compact .manager-calendar-card .calendar-week div{padding:2px!important;font-size:8px!important}
    html.a4-manager-compact .manager-calendar-card .calendar-grid{grid-auto-rows:42px!important}
    html.a4-manager-compact .manager-calendar-card .calendar-day{position:relative!important;min-height:42px!important;height:42px!important;padding:3px 4px!important;overflow:visible!important;background:#fff;transition:background .12s ease,border-color .12s ease}
    html.a4-manager-compact .manager-calendar-card .calendar-day:hover{background:#f8fbff!important;z-index:8}
    html.a4-manager-compact .manager-calendar-card .calendar-day.out{background:#f8fafc!important}
    html.a4-manager-compact .manager-calendar-card .day-num{width:18px!important;height:18px!important;font-size:8.5px!important;margin:0!important}
    html.a4-manager-compact .manager-calendar-card .day-chip,
    html.a4-manager-compact .manager-calendar-card .calendar-more{display:none!important}
    html.a4-manager-compact .calendar-markers{position:absolute;left:4px;right:4px;bottom:4px;display:flex;align-items:center;gap:3px;min-height:8px;pointer-events:none}
    html.a4-manager-compact .calendar-marker{width:5px;height:5px;border-radius:999px;background:#2563eb;box-shadow:0 0 0 1px rgba(255,255,255,.9)}
    html.a4-manager-compact .calendar-marker.order{background:#16a34a}
    html.a4-manager-compact .calendar-marker.overdue{background:#dc2626}
    html.a4-manager-compact .calendar-count{margin-left:auto;font-size:8px;line-height:1;color:#64748b;font-weight:900}

    #managerDayHover{position:fixed;z-index:2147482500;width:min(290px,calc(100vw - 24px));padding:10px;background:#fff;border:1px solid #dbe5f0;border-radius:13px;box-shadow:0 18px 48px rgba(15,23,42,.2);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:none}
    #managerDayHover.show{display:block}
    #managerDayHover .hover-title{font-size:12px;font-weight:900;color:#0f172a;margin-bottom:7px}
    #managerDayHover .hover-empty{font-size:11px;color:#94a3b8;padding:3px 0}
    #managerDayHover .hover-item{display:block;width:100%;border:0;border-top:1px solid #eef2f7;background:#fff;padding:7px 3px;text-align:left;cursor:pointer;color:#0f172a;font:inherit}
    #managerDayHover .hover-item:first-of-type{border-top:0}
    #managerDayHover .hover-item b{display:block;font-size:11px;line-height:1.25;white-space:normal}
    #managerDayHover .hover-item small{display:block;font-size:9.5px;color:#64748b;margin-top:2px}
    #managerDayHover .hover-item:hover{background:#f8fbff}
    #managerDayHover .hover-item.order b{color:#166534}
    #managerDayHover .hover-item.overdue b{color:#b91c1c}

    html.a4-manager-compact .manager-panel{padding:11px 13px!important;border-radius:14px!important}
    html.a4-manager-compact .panel-head2{margin-bottom:8px!important}
    html.a4-manager-compact .panel-head2 h2{font-size:15px!important}
    html.a4-manager-compact #customers{max-height:190px!important;overflow:auto!important}
    html.a4-manager-compact #orders{max-height:150px!important;overflow:auto!important}
    html.a4-manager-compact .customer-mini,
    html.a4-manager-compact .order-mini{padding:7px 2px!important}
    html.a4-manager-compact .customer-mini b,
    html.a4-manager-compact .order-mini b{font-size:11.5px!important}
    html.a4-manager-compact .customer-mini small,
    html.a4-manager-compact .order-mini small{font-size:9.5px!important}
    html.a4-manager-compact .searchbox{padding:7px 9px!important;font-size:11px!important}
    html.a4-manager-compact .manager-side-stack .mgr-notifications{max-height:150px!important}
    html.a4-manager-compact .manager-side-stack .nearest-orders{max-height:100px!important}

    @media(max-width:1220px){
      html.a4-manager-compact .manager-workspace-columns{grid-template-columns:1fr!important}
      html.a4-manager-compact .manager-calendar-card .calendar-grid{grid-auto-rows:38px!important}
      html.a4-manager-compact .manager-calendar-card .calendar-day{height:38px!important;min-height:38px!important}
    }
    @media(max-width:700px){
      html.a4-manager-compact .manager-calendar-card{overflow-x:auto!important}
      html.a4-manager-compact .manager-calendar-card .calendar-week,
      html.a4-manager-compact .manager-calendar-card .calendar-grid{min-width:560px!important}
    }
  `;
  document.head.appendChild(style);

  let hideTimer=0;
  let hover=null;
  const ownMutationClass=new Set(['calendar-markers','calendar-marker','calendar-count']);
  function hoverBox(){
    if(hover)return hover;
    hover=document.createElement('div');
    hover.id='managerDayHover';
    hover.addEventListener('mouseenter',()=>clearTimeout(hideTimer));
    hover.addEventListener('mouseleave',scheduleHide);
    document.body.appendChild(hover);
    return hover;
  }
  function dateLabel(key){
    try{return new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long'}).format(new Date(`${key}T12:00:00+03:00`)).replace(/^./,x=>x.toUpperCase())}catch{return key}
  }
  function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function positionHover(day){
    const box=hoverBox(),r=day.getBoundingClientRect(),w=290,h=Math.max(90,box.offsetHeight||90),gap=7;
    const left=Math.min(window.innerWidth-w-10,Math.max(10,r.left+r.width/2-w/2));
    let top=r.bottom+gap;
    if(top+h>window.innerHeight-10)top=Math.max(10,r.top-h-gap);
    box.style.left=`${Math.round(left)}px`;box.style.top=`${Math.round(top)}px`;
  }
  function showHover(day){
    clearTimeout(hideTimer);
    const box=hoverBox();
    const key=day.dataset.day||'';
    const chips=[...day.querySelectorAll('.day-chip')];
    box.innerHTML=`<div class="hover-title">${escapeHtml(dateLabel(key))}</div>${chips.length?chips.map((chip,i)=>{
      const isOrder=chip.matches('[data-order]');
      const overdue=chip.classList.contains('overdue');
      const title=(chip.getAttribute('title')||chip.textContent||'').trim();
      const meta=(chip.textContent||'').trim();
      return `<button type="button" class="hover-item ${isOrder?'order':''} ${overdue?'overdue':''}" data-hover-index="${i}"><b>${escapeHtml(title||meta)}</b>${title&&meta&&title!==meta?`<small>${escapeHtml(meta)}</small>`:''}</button>`;
    }).join(''):'<div class="hover-empty">На этот день записей нет</div>'}`;
    box.querySelectorAll('[data-hover-index]').forEach(btn=>btn.addEventListener('click',e=>{
      e.stopPropagation();
      const source=chips[Number(btn.dataset.hoverIndex)];
      box.classList.remove('show');
      source?.click();
    }));
    box.classList.add('show');
    requestAnimationFrame(()=>positionHover(day));
  }
  function scheduleHide(){clearTimeout(hideTimer);hideTimer=setTimeout(()=>hoverBox().classList.remove('show'),130)}

  function decorateCalendar(){
    const grid=document.getElementById('managerCalendarGrid');
    if(!grid)return;
    const days=[...grid.querySelectorAll('.calendar-day')];
    days.forEach(day=>{
      day.querySelector(':scope > .calendar-markers')?.remove();
      const chips=[...day.querySelectorAll('.day-chip')];
      if(chips.length){
        const marks=document.createElement('div');
        marks.className='calendar-markers';
        chips.slice(0,3).forEach(chip=>{
          const dot=document.createElement('span');
          dot.className='calendar-marker'+(chip.matches('[data-order]')?' order':'')+(chip.classList.contains('overdue')?' overdue':'');
          marks.appendChild(dot);
        });
        const count=document.createElement('span');count.className='calendar-count';count.textContent=String(chips.length);marks.appendChild(count);
        day.appendChild(marks);
      }
      day.tabIndex=0;
      if(day.dataset.a4HoverBound!=='1'){
        day.dataset.a4HoverBound='1';
        day.addEventListener('mouseenter',()=>showHover(day));
        day.addEventListener('mouseleave',scheduleHide);
        day.addEventListener('focus',()=>showHover(day));
        day.addEventListener('blur',scheduleHide);
      }
    });
    for(let start=days.length-7;start>=0;start-=7){
      const week=days.slice(start,start+7);if(week.length!==7)continue;
      const useful=week.some(day=>!day.classList.contains('out')||day.querySelector('.day-chip'));
      if(useful)break;
      week.forEach(day=>day.classList.add('compact-week-hidden'));
    }
  }

  let queued=false;
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;decorateCalendar()})}
  function isOwnNode(node){return node instanceof HTMLElement&&[...ownMutationClass].some(cls=>node.classList.contains(cls))}
  function init(){
    schedule();
    const observer=new MutationObserver(muts=>{
      const relevant=muts.some(m=>{
        if(m.type!=='childList'||!m.target.closest?.('#managerCalendarGrid'))return false;
        return [...m.addedNodes,...m.removedNodes].some(n=>n.nodeType===1&&!isOwnNode(n));
      });
      if(relevant)schedule();
    });
    observer.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('scroll',()=>hoverBox().classList.remove('show'),{passive:true});
    window.addEventListener('resize',()=>hoverBox().classList.remove('show'));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
