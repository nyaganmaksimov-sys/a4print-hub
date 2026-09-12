(()=>{
  if(window.__A4_MANAGER_LAYOUT_V2__)return;
  window.__A4_MANAGER_LAYOUT_V2__=true;

  function installStyles(){
    if(document.getElementById('a4-manager-layout-v2-style'))return;
    const s=document.createElement('style');
    s.id='a4-manager-layout-v2-style';
    s.textContent=`
      body{background:#f6f8fb}
      .main{max-width:none!important;padding-top:18px!important}
      .topbar{margin-bottom:12px!important;align-items:flex-start!important}
      .topbar h1{font-size:28px!important;line-height:1.12!important;margin-bottom:4px!important}
      .topbar p{margin-top:0!important;font-size:13px!important}

      .quick{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:9px!important;margin-bottom:12px!important}
      .quick a{min-height:66px!important;padding:11px 13px!important;border-radius:14px!important;display:flex!important;flex-direction:column!important;justify-content:center!important;box-sizing:border-box!important}
      .quick a span{font-size:10.5px!important;margin-top:3px!important}

      .manager-kpis{gap:8px!important;margin:0 0 12px!important}
      .manager-kpi{min-height:66px!important;padding:10px 12px!important;border-radius:14px!important;box-sizing:border-box!important}
      .manager-kpi small{font-size:10px!important}
      .manager-kpi b{font-size:20px!important;margin-top:3px!important}

      #managerCalendarWrap.manager-calendar-wrap.manager-workspace-v2{
        display:grid!important;
        grid-template-columns:minmax(0,1.55fr) minmax(300px,.65fr)!important;
        grid-template-areas:"event event" "calendar side"!important;
        gap:12px!important;margin:0 0 14px!important;align-items:start!important;
      }
      .manager-event-card{grid-area:event!important;padding:13px 14px!important;border-radius:16px!important}
      .manager-calendar-card{grid-area:calendar!important;padding:13px 14px!important;border-radius:16px!important;min-width:0!important}
      .manager-side-stack{grid-area:side!important;display:grid!important;gap:12px!important;align-content:start!important;min-width:0!important}
      .manager-side-stack>.mgr-card{margin:0!important;padding:13px 14px!important;border-radius:16px!important}
      .manager-side-stack .workspace-section{margin-top:0!important}

      .mgr-head{margin-bottom:9px!important;gap:8px!important}
      .mgr-head h2{font-size:18px!important;line-height:1.15!important}
      .mgr-head h3{font-size:15px!important;line-height:1.2!important}
      .mgr-actions{gap:6px!important}
      .mgr-btn{min-height:32px!important;padding:6px 9px!important;border-radius:9px!important;font-size:11px!important}

      .manager-event-card .event-form{
        display:grid!important;
        grid-template-columns:minmax(190px,1.55fr) minmax(280px,2fr) minmax(170px,1.2fr) minmax(135px,.8fr)!important;
        gap:8px 10px!important;align-items:end!important;
      }
      .manager-event-card .event-form label{gap:4px!important;font-size:10px!important}
      .manager-event-card .event-form input,
      .manager-event-card .event-form select,
      .manager-event-card .event-form textarea{min-height:38px!important;padding:7px 9px!important;border-radius:9px!important;font-size:12px!important}
      .manager-event-card .event-form textarea{height:38px!important;min-height:38px!important;max-height:38px!important;resize:none!important}
      .manager-event-card .field-title{grid-column:1!important}
      .manager-event-card .field-time{grid-column:2!important;display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px!important}
      .manager-event-card .field-order{grid-column:3!important}
      .manager-event-card .field-reminder{grid-column:4!important}
      .manager-event-card .field-desc{grid-column:1/4!important}
      .manager-event-card .field-actions{grid-column:4!important;align-self:end!important;display:flex!important;flex-wrap:wrap!important;justify-content:flex-end!important}
      .manager-event-card .field-msg{grid-column:1/-1!important;margin:0!important;min-height:12px!important}

      .manager-calendar-card .mgr-head{align-items:center!important}
      .manager-calendar-card .mgr-note{margin-top:3px!important;font-size:9.5px!important}
      .manager-calendar-card .calendar-week div{padding:4px!important;font-size:9px!important}
      .manager-calendar-card .calendar-day{min-height:70px!important;padding:4px!important;box-sizing:border-box!important}
      .manager-calendar-card .day-num{width:21px!important;height:21px!important;font-size:9.5px!important;margin-bottom:2px!important}
      .manager-calendar-card .day-chip{padding:3px 4px!important;margin:2px 0!important;font-size:8px!important;line-height:1.15!important;border-radius:5px!important}
      .manager-calendar-card .calendar-more{font-size:8px!important;color:#64748b!important;font-weight:800!important;line-height:1!important;margin-top:2px!important}

      .manager-side-stack .mgr-notifications,
      .manager-side-stack .nearest-orders{max-height:214px!important;overflow:auto!important;gap:6px!important}
      .manager-side-stack .notify-item,
      .manager-side-stack .nearest-item{padding:8px 9px!important;border-radius:9px!important;font-size:10.5px!important}
      .manager-side-stack .notify-item small,
      .manager-side-stack .nearest-item small{font-size:9.5px!important;line-height:1.35!important}
      #browserNotify{font-size:9.5px!important;padding:5px 7px!important}

      .manager-grid{grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr)!important;gap:12px!important;align-items:start!important}
      .manager-panel{padding:14px!important;border-radius:16px!important}
      .section-gap{margin-top:12px!important}
      .panel-head2{margin-bottom:10px!important}
      .panel-head2 h2{font-size:17px!important}
      #customers{max-height:330px!important;overflow:auto!important}
      #orders{max-height:310px!important;overflow:auto!important}
      .customer-mini,.order-mini{padding:9px 2px!important}
      .customer-mini b,.order-mini b{font-size:12.5px!important}
      .customer-mini small,.order-mini small{font-size:10.5px!important;line-height:1.35!important}
      .searchbox{padding:9px 10px!important;font-size:12px!important}
      .calc-grid{gap:8px!important}
      .calc-grid label{font-size:11px!important;gap:4px!important}
      .calc-grid input,.calc-grid select{padding:8px 9px!important;font-size:12px!important}
      .calc-total{margin-top:10px!important;padding:11px 13px!important}
      .calc-total strong{font-size:21px!important}
      .calc-note{font-size:10.5px!important;margin-top:7px!important}
      .chat-cards{gap:8px!important}
      .chat-card{padding:10px 11px!important;border-radius:11px!important;font-size:12px!important}
      .chat-card small{font-size:9.5px!important;margin-top:2px!important}

      @media(max-width:1220px){
        #managerCalendarWrap.manager-calendar-wrap.manager-workspace-v2{grid-template-columns:1fr!important;grid-template-areas:"event" "calendar" "side"!important}
        .manager-side-stack{grid-template-columns:1fr 1fr!important}
        .manager-event-card .event-form{grid-template-columns:1fr 1fr!important}
        .manager-event-card .field-title,.manager-event-card .field-time,.manager-event-card .field-order,.manager-event-card .field-reminder{grid-column:auto!important}
        .manager-event-card .field-desc{grid-column:1!important}
        .manager-event-card .field-actions{grid-column:2!important}
      }
      @media(max-width:900px){
        .quick{grid-template-columns:1fr 1fr!important}
        .manager-grid{grid-template-columns:1fr!important}
        .manager-side-stack{grid-template-columns:1fr!important}
      }
      @media(max-width:650px){
        .main{padding-left:10px!important;padding-right:10px!important}
        .quick{grid-template-columns:1fr 1fr!important}
        .manager-event-card .event-form{grid-template-columns:1fr!important}
        .manager-event-card .field-title,.manager-event-card .field-time,.manager-event-card .field-order,.manager-event-card .field-reminder,.manager-event-card .field-desc,.manager-event-card .field-actions{grid-column:1!important}
        .manager-event-card .field-actions{justify-content:flex-start!important}
        .manager-calendar-card{overflow-x:auto!important}
        .manager-calendar-card .calendar-week,.manager-calendar-card .calendar-grid{min-width:620px!important}
      }
    `;
    document.head.appendChild(s);
  }

  function compactCalendar(){
    const grid=document.getElementById('managerCalendarGrid');
    if(!grid)return;
    grid.querySelectorAll('.calendar-day').forEach(day=>{
      const chips=[...day.querySelectorAll('.day-chip')];
      const oldNote=[...day.querySelectorAll('.mgr-note,.calendar-more')].find(x=>/^\+\d+/.test((x.textContent||'').trim()));
      const extraFromNote=oldNote?Number((oldNote.textContent||'').replace(/\D/g,''))||0:0;
      chips.forEach((chip,index)=>{chip.style.display=index<2?'':'none'});
      const hidden=Math.max(0,chips.length-2)+extraFromNote;
      if(oldNote)oldNote.remove();
      if(hidden>0){
        const more=document.createElement('div');
        more.className='calendar-more';
        more.textContent=`+${hidden}`;
        day.appendChild(more);
      }
    });
  }

  function arrange(){
    installStyles();
    const wrap=document.getElementById('managerCalendarWrap');
    if(!wrap||wrap.classList.contains('manager-workspace-v2'))return false;
    const calendar=wrap.querySelector(':scope > article.mgr-card');
    const aside=wrap.querySelector(':scope > aside');
    if(!calendar||!aside||aside.children.length<1)return false;
    const form=aside.children[0];
    const rest=[...aside.children].slice(1);
    const stack=document.createElement('div');
    stack.className='manager-side-stack';
    rest.forEach(node=>stack.appendChild(node));
    form.classList.add('manager-event-card');
    calendar.classList.add('manager-calendar-card');
    wrap.insertBefore(form,calendar);
    wrap.appendChild(stack);
    aside.remove();
    wrap.classList.add('manager-workspace-v2');

    document.getElementById('eventTitle')?.closest('label')?.classList.add('field-title');
    document.querySelector('.manager-event-card .form-row')?.classList.add('field-time');
    document.getElementById('eventOrder')?.closest('label')?.classList.add('field-order');
    document.getElementById('eventReminder')?.closest('label')?.classList.add('field-reminder');
    document.getElementById('eventDescription')?.closest('label')?.classList.add('field-desc');
    document.querySelector('.manager-event-card .mgr-actions')?.classList.add('field-actions');
    document.getElementById('eventFormMsg')?.classList.add('field-msg');

    const title=document.getElementById('eventFormTitle');
    if(title&&title.textContent.trim()==='Новая запись')title.textContent='Новая запись / задача';
    compactCalendar();
    return true;
  }

  function init(){
    installStyles();
    arrange();
    let queued=false;
    const observer=new MutationObserver(()=>{
      if(queued)return;
      queued=true;
      requestAnimationFrame(()=>{
        queued=false;
        arrange();
        compactCalendar();
      });
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
