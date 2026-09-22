(()=>{
  if(window.__A4_TOPBAR_MODERN__)return;
  window.__A4_TOPBAR_MODERN__=true;

  let busy=false;
  let observer=null;

  const gearIcon=`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1.03-1.56V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.56 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"></path></svg>`;

  // Visual rules live in admin/ui/components.css. This module handles behavior only.


  function titleNode(top){
    const direct=[...top.children];
    return direct.find(el=>el.matches?.('div,section')&&el.querySelector?.(':scope > h1,:scope > h2'))||direct.find(el=>el.matches?.('h1,h2'))||direct.find(el=>!el.classList?.contains('a4-mobile-menu')&&!el.classList?.contains('a4-topbar-tools'))||null;
  }
  function isUtility(el){return !!el?.matches?.('.a4-workspace-actions,.user,.layout-tools,.a4-block-layout-toolbar,#hubChatNotifyCenter,.a4-top-notify,[data-a4-topbar-utility="1"]')}
  function positionPopover(wrap){
    if(!wrap?.classList.contains('a4-tools-open'))return;
    const gear=wrap.querySelector(':scope > .a4-tools-gear'),pop=wrap.querySelector(':scope > .a4-tools-popover');if(!gear||!pop)return;
    const r=gear.getBoundingClientRect(),vw=document.documentElement.clientWidth||window.innerWidth,panelWidth=Math.min(760,Math.max(280,vw-24)),left=Math.max(12,Math.min(vw-panelWidth-12,r.right-panelWidth)),top=Math.max(8,r.bottom+9);
    pop.style.setProperty('--a4-tools-left',`${left}px`);pop.style.setProperty('--a4-tools-top',`${top}px`);pop.style.setProperty('--a4-notify-top',`${Math.min(window.innerHeight-90,top+48)}px`);
  }
  function setOpen(wrap,open){if(!wrap)return;wrap.classList.toggle('a4-tools-open',!!open);const gear=wrap.querySelector(':scope > .a4-tools-gear');if(gear){gear.setAttribute('aria-expanded',open?'true':'false');gear.title=open?'Закрыть панель управления':'Открыть панель управления';gear.setAttribute('aria-label',gear.title)}if(open)requestAnimationFrame(()=>positionPopover(wrap))}

  function ensure(top){
    if(!top||busy)return;busy=true;
    try{
      let wrap=top.querySelector(':scope > .a4-topbar-tools'),content=wrap?.querySelector(':scope > .a4-tools-popover > .a4-tools-popover-content');
      if(!wrap){
        wrap=document.createElement('div');wrap.className='a4-topbar-tools';
        const gear=document.createElement('button');gear.type='button';gear.className='a4-tools-gear';gear.innerHTML=gearIcon;gear.setAttribute('aria-expanded','false');gear.title='Открыть панель управления';gear.setAttribute('aria-label',gear.title);
        const pop=document.createElement('div');pop.className='a4-tools-popover';pop.setAttribute('role','dialog');pop.setAttribute('aria-label','Панель управления страницей');content=document.createElement('div');content.className='a4-tools-popover-content';pop.appendChild(content);
        gear.onclick=e=>{e.stopPropagation();setOpen(wrap,!wrap.classList.contains('a4-tools-open'))};pop.onclick=e=>e.stopPropagation();wrap.append(gear,pop);top.appendChild(wrap);
      }
      const title=titleNode(top);
      [...top.children].forEach(el=>{
        if(el===wrap||el===title||el.classList?.contains('a4-mobile-menu')||el.tagName==='SCRIPT'||el.tagName==='STYLE')return;
        // Only utility/profile controls belong under the gear. Page-specific
        // actions stay visible so users do not have to hunt for core commands.
        if(isUtility(el))content.appendChild(el);
      });
      const actions=top.querySelector(':scope > .a4-workspace-actions');if(actions&&!actions.closest('.a4-tools-popover-content'))content.appendChild(actions);
      wrap.hidden=content.children.length===0;
      if(wrap.hidden)setOpen(wrap,false);
    }finally{busy=false}
  }
  function scan(){document.querySelectorAll('.topbar').forEach(ensure)}
  function closeAll(){document.querySelectorAll('.a4-topbar-tools.a4-tools-open').forEach(w=>setOpen(w,false))}
  const init=()=>{
    scan();document.addEventListener('click',e=>{const wrap=e.target.closest?.('.a4-topbar-tools');if(!wrap)closeAll()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAll()});
    const reposition=()=>document.querySelectorAll('.a4-topbar-tools.a4-tools-open').forEach(positionPopover);window.addEventListener('resize',reposition,{passive:true});window.addEventListener('scroll',reposition,{passive:true,capture:true});
    // Avoid a permanent body-wide MutationObserver. Topbar utilities mount during boot;
    // one delayed pass covers late controls without keeping a hot observer alive.
    setTimeout(scan,350);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();