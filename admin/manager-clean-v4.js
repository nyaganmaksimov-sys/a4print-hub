(()=>{
  'use strict';
  if(window.__A4_MANAGER_CLEAN_V4__)return;
  window.__A4_MANAGER_CLEAN_V4__=true;

  function installStyles(){
    if(document.getElementById('a4-manager-clean-v4-style'))return;
    const style=document.createElement('style');
    style.id='a4-manager-clean-v4-style';
    style.textContent=`
      html,body{overflow-x:hidden!important}
      body .main{min-width:0!important}
      #managerCalendarWrap.manager-workspace-v4{display:block!important;min-width:0!important;margin-bottom:14px!important}

      #managerCalendarWrap.manager-workspace-v4 .manager-workspace-columns{
        display:grid!important;
        grid-template-columns:minmax(0,1.55fr) minmax(300px,.65fr)!important;
        gap:10px!important;
        align-items:start!important;
        min-width:0!important;
      }
      #managerCalendarWrap.manager-workspace-v4 .manager-left-flow,
      #managerCalendarWrap.manager-workspace-v4 .manager-right-flow,
      #managerCalendarWrap.manager-workspace-v4 .manager-side-stack{min-width:0!important;gap:10px!important}
      #managerCalendarWrap.manager-workspace-v4 .manager-left-flow>.manager-flow-section,
      #managerCalendarWrap.manager-workspace-v4 .manager-right-flow>.manager-flow-section{display:none!important}

      #managerCalendarWrap.manager-workspace-v4 .manager-event-card{margin-bottom:10px!important}
      #managerCalendarWrap.manager-workspace-v4 .manager-calendar-card{margin:0!important}
      #managerCalendarWrap.manager-workspace-v4 .manager-side-stack>.mgr-card{margin:0!important}

      .manager-operations-grid{
        display:grid!important;
        grid-template-columns:minmax(0,1fr) minmax(0,.82fr) minmax(360px,1.1fr)!important;
        gap:10px!important;
        align-items:stretch!important;
        margin-top:10px!important;
        min-width:0!important;
      }
      .manager-operations-grid>.manager-panel{
        margin:0!important;
        min-width:0!important;
        height:100%!important;
        box-sizing:border-box!important;
        padding:13px 14px!important;
        border-radius:15px!important;
        overflow:hidden!important;
      }
      .manager-operations-grid .panel-head2{margin-bottom:9px!important;min-height:32px!important}
      .manager-operations-grid .panel-head2 h2{font-size:16px!important;line-height:1.15!important}
      .manager-operations-grid .panel-actions{gap:5px!important}
      .manager-operations-grid .panel-actions button,
      .manager-operations-grid .panel-actions a,
      .manager-operations-grid #resetCalc{font-size:10px!important;min-height:30px!important;padding:5px 8px!important}
      .manager-operations-grid .searchbox{min-height:36px!important;padding:8px 9px!important;font-size:11px!important;margin-bottom:2px!important}
      .manager-operations-grid #customers,
      .manager-operations-grid #orders{max-height:226px!important;overflow:auto!important;scrollbar-width:thin}
      .manager-operations-grid .customer-mini,
      .manager-operations-grid .order-mini{padding:8px 2px!important;gap:2px!important}
      .manager-operations-grid .customer-mini b,
      .manager-operations-grid .order-mini b{font-size:11.5px!important;line-height:1.25!important}
      .manager-operations-grid .customer-mini small,
      .manager-operations-grid .order-mini small{font-size:9.5px!important;line-height:1.3!important}

      .manager-operations-grid #calculator .calc-grid{
        display:grid!important;
        grid-template-columns:repeat(3,minmax(0,1fr))!important;
        gap:6px 7px!important;
      }
      .manager-operations-grid #calculator .calc-grid .full{grid-column:auto!important}
      .manager-operations-grid #calculator .calc-grid label{font-size:9.5px!important;gap:3px!important;min-width:0!important}
      .manager-operations-grid #calculator .calc-grid input,
      .manager-operations-grid #calculator .calc-grid select{
        min-height:34px!important;height:34px!important;padding:5px 7px!important;border-radius:8px!important;font-size:10.5px!important;min-width:0!important
      }
      .manager-operations-grid #calculator .calc-total{margin-top:8px!important;padding:8px 10px!important;border-radius:10px!important}
      .manager-operations-grid #calculator .calc-total strong{font-size:19px!important}
      .manager-operations-grid #calculator .calc-note{
        margin-top:6px!important;font-size:9px!important;line-height:1.3!important;
        display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:2!important;overflow:hidden!important
      }

      .manager-chat-strip{margin-top:10px!important;min-width:0!important}
      .manager-chat-strip>.manager-panel{margin:0!important;padding:11px 13px!important;border-radius:15px!important;min-width:0!important}
      .manager-chat-strip .panel-head2{margin-bottom:8px!important}
      .manager-chat-strip .panel-head2 h2{font-size:15px!important}
      .manager-chat-strip .chat-cards{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:7px!important}
      .manager-chat-strip .chat-card{padding:8px 10px!important;min-height:46px!important;border-radius:10px!important;font-size:10.5px!important;box-sizing:border-box!important}
      .manager-chat-strip .chat-card small{font-size:8.5px!important;line-height:1.2!important;margin-top:2px!important}

      #managerCalendarWrap.manager-workspace-v4 .manager-side-stack .mgr-notifications{max-height:150px!important}
      #managerCalendarWrap.manager-workspace-v4 .manager-side-stack .nearest-orders{max-height:116px!important}

      body #a4ChatLauncher,body .a4-chat-launcher,body [data-a4-chat-launcher]{right:18px!important;bottom:18px!important}

      @media(max-width:1350px){
        .manager-operations-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important}
        .manager-operations-grid #calculator{grid-column:1/-1!important;height:auto!important}
        .manager-operations-grid #calculator .calc-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important}
      }
      @media(max-width:1180px){
        #managerCalendarWrap.manager-workspace-v4 .manager-workspace-columns{grid-template-columns:1fr!important}
        #managerCalendarWrap.manager-workspace-v4 .manager-side-stack{grid-template-columns:repeat(3,minmax(0,1fr))!important}
        .manager-chat-strip .chat-cards{grid-template-columns:repeat(2,minmax(0,1fr))!important}
      }
      @media(max-width:820px){
        .manager-operations-grid{grid-template-columns:1fr!important}
        .manager-operations-grid #calculator{grid-column:auto!important}
        .manager-operations-grid #calculator .calc-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
        #managerCalendarWrap.manager-workspace-v4 .manager-side-stack{grid-template-columns:1fr!important}
      }
      @media(max-width:620px){
        .manager-operations-grid #calculator .calc-grid{grid-template-columns:1fr!important}
        .manager-chat-strip .chat-cards{grid-template-columns:1fr 1fr!important}
        .manager-operations-grid>.manager-panel{height:auto!important}
      }
    `;
    document.head.appendChild(style);
  }

  function panelByInner(id){return document.getElementById(id)?.closest('.manager-panel')||null}

  function reorganize(){
    installStyles();
    const wrap=document.getElementById('managerCalendarWrap');
    const columns=wrap?.querySelector('.manager-workspace-columns');
    const left=columns?.querySelector('.manager-left-flow');
    const right=columns?.querySelector('.manager-right-flow');
    if(!wrap||!columns||!left||!right)return false;

    wrap.classList.add('manager-workspace-v3','manager-workspace-v4');

    const clients=panelByInner('customers');
    const orders=panelByInner('orders');
    const calculator=document.getElementById('calculator')?.closest('.manager-panel')||document.getElementById('calculator');
    let chat=[...document.querySelectorAll('.manager-panel')].find(panel=>panel.querySelector('.chat-cards'))||null;

    let ops=document.getElementById('managerOperationsGrid');
    if(!ops){
      ops=document.createElement('section');
      ops.id='managerOperationsGrid';
      ops.className='manager-operations-grid';
      columns.insertAdjacentElement('afterend',ops);
    }
    [clients,orders,calculator].filter(Boolean).forEach(panel=>{
      if(panel.parentElement!==ops)ops.appendChild(panel);
    });

    let chatStrip=document.getElementById('managerChatStrip');
    if(!chatStrip){
      chatStrip=document.createElement('section');
      chatStrip.id='managerChatStrip';
      chatStrip.className='manager-chat-strip';
      ops.insertAdjacentElement('afterend',chatStrip);
    }
    if(chat&&chat.parentElement!==chatStrip)chatStrip.appendChild(chat);

    left.querySelectorAll(':scope > .manager-flow-section').forEach(section=>{if(!section.children.length)section.remove()});
    right.querySelectorAll(':scope > .manager-flow-section').forEach(section=>{if(!section.children.length)section.remove()});

    const legacy=document.querySelector('.manager-grid.manager-grid-absorbed');
    if(legacy&&!legacy.querySelector('.manager-panel'))legacy.remove();
    return true;
  }

  function init(){
    installStyles();
    reorganize();
    let queued=false;
    const observer=new MutationObserver(()=>{
      if(queued)return;
      queued=true;
      requestAnimationFrame(()=>{queued=false;reorganize()});
    });
    observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(reorganize,180);
    setTimeout(reorganize,650);
    setTimeout(reorganize,1400);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
