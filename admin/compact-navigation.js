/* A4PRINT HUB — full-width content and compact navigation, all admin pages */
(function(){
 'use strict';
 if(window.__A4_COMPACT_NAV_V1__)return;
 window.__A4_COMPACT_NAV_V1__=true;
 const css=document.createElement('style');
 css.id='a4-compact-no-sidebar-css';
 css.textContent=`
 html body .sidebar,
 html body.dashboard-home .sidebar,
 html body.dashboard-home.a4-side-light .sidebar,
 html body.dashboard-home.a4-side-glass .sidebar,
 html body .a4-sidebar-head {display:none!important;visibility:hidden!important}
 html body .main,
 html body.dashboard-home .main,
 html body.a4-sidebar-collapsed .main,
 html body.a4-has-sidebar .main,
 html body.dashboard-home.a4-sidebar-collapsed .main {
   margin-left:0!important;width:100%!important;max-width:none!important;
   box-sizing:border-box!important;
 }
 html body .a4-compact-menu-button {position:fixed!important;bottom:18px!important;left:18px!important;z-index:2147483500!important;
   border:1px solid #b9cdf0!important;border-radius:12px!important;padding:12px 17px!important;
   background:#153259!important;color:#fff!important;font:600 14px system-ui,sans-serif!important;
   box-shadow:0 6px 24px #0b18303b!important;cursor:pointer!important}
 html body .a4-compact-menu-panel {position:fixed!important;bottom:76px!important;left:18px!important;z-index:2147483501!important;
   width:min(340px,calc(100vw - 36px))!important;max-height:min(70vh,650px)!important;overflow:auto!important;
   border:1px solid #cdd9e8!important;border-radius:14px!important;background:#fff!important;color:#18304f!important;
   padding:14px!important;box-shadow:0 16px 48px #101b3340!important;font:14px system-ui,sans-serif!important}
 html body .a4-compact-menu-panel[hidden]{display:none!important}
 html body .a4-compact-menu-panel h2{font-size:16px!important;margin:0 0 12px!important;color:#172c49!important}
 html body .a4-compact-menu-panel .a4-compact-group{font-weight:700!important;color:#596c83!important;padding:11px 8px 5px!important;text-transform:none!important}
 html body .a4-compact-menu-panel a{display:block!important;text-decoration:none!important;color:#1a3559!important;
   padding:10px 12px!important;border-radius:7px!important;font-weight:500!important}
 html body .a4-compact-menu-panel a:hover,html body .a4-compact-menu-panel a[aria-current=page]{background:#eaf1ff!important;color:#1558c7!important}
 html body .a4-compact-menu-panel .a4-compact-close {float:right!important;border:0!important;background:transparent!important;
   font:700 19px system-ui,sans-serif!important;color:#52677f!important;cursor:pointer!important}
 @media print {html body .a4-compact-menu-button,html body .a4-compact-menu-panel{display:none!important}}
 `;
 document.head.appendChild(css);
 const ready=()=>{
  if(document.getElementById('a4CompactMenu'))return;
  const button=document.createElement('button');
  button.type='button';button.className='a4-compact-menu-button';button.id='a4CompactMenu';
  button.textContent='☰ Разделы';button.setAttribute('aria-controls','a4CompactPanel');button.setAttribute('aria-expanded','false');
  const panel=document.createElement('div');panel.id='a4CompactPanel';panel.className='a4-compact-menu-panel';panel.hidden=true;
  panel.setAttribute('role','navigation');panel.setAttribute('aria-label','Разделы A4PRINT HUB');
  function fill(){
    panel.replaceChildren();
    const heading=document.createElement('h2');heading.textContent='Навигация A4PRINT HUB';
    const close=document.createElement('button');close.type='button';close.className='a4-compact-close';close.textContent='×';close.setAttribute('aria-label','Закрыть меню');close.onclick=hide;
    panel.append(close,heading);
    const sidebar=document.querySelector('.sidebar');
    const groups=sidebar?.querySelectorAll('.a4-nav-group');
    if(groups&&groups.length){
      for(const group of groups){
        const title=document.createElement('div');title.className='a4-compact-group';title.textContent=group.querySelector('.a4-nav-group-head')?.textContent?.replace('›','').trim()||'Разделы';panel.appendChild(title);
        for(const link of group.querySelectorAll('a[href]'))addLink(link);
      }
    }else{
      const links=sidebar?.querySelectorAll('nav a[href]')||[];
      for(const link of links)addLink(link);
    }
    if(!panel.querySelector('a')){
      for(const [label,href] of [['Главная','./index.html'],['Менеджер','./manager.html'],['Заказы','./orders.html'],['Клиенты','./customers.html'],['Склад','./warehouse.html'],['Производство','./production.html'],['Партнёры','./partners.html'],['Финансы','./payments.html'],['Отчёты','./reports.html'],['Документы','./documents.html'],['Приложения','./apps.html'],['Настройки','./settings.html']]){
        const a=document.createElement('a');a.href=href;a.textContent=label;panel.appendChild(a);
      }
    }
  }
  function addLink(link){
    const a=document.createElement('a');
    a.href=link.getAttribute('href')||'#';a.textContent=link.querySelector('.a4-nav-label')?.textContent?.trim()||link.textContent.trim();
    if(link.classList.contains('active'))a.setAttribute('aria-current','page');
    panel.appendChild(a);
  }
  function hide(){panel.hidden=true;button.setAttribute('aria-expanded','false');}
  button.addEventListener('click',()=>{if(panel.hidden){fill();panel.hidden=false;button.setAttribute('aria-expanded','true')}else hide()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='m'){e.preventDefault();button.click()}});
  document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!panel.contains(e.target)&&e.target!==button)hide()});
  document.body.append(button,panel);
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
