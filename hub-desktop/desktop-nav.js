(function(){
'use strict';
if(window.__A4_DESKTOP_NAV_V105__)return;window.__A4_DESKTOP_NAV_V105__=true;
function init(){
 if(document.getElementById('a4-desktop-menu-trigger')||!document.body)return;
 const trigger=document.createElement('button');trigger.type='button';trigger.id='a4-desktop-menu-trigger';
 trigger.textContent='☰ Разделы';trigger.setAttribute('aria-expanded','false');
 const panel=document.createElement('div');panel.id='a4-desktop-menu-panel';panel.hidden=true;
 panel.setAttribute('role','navigation');panel.setAttribute('aria-label','Навигация A4PRINT HUB');
 const groups=[
 ['Работа',[['Главная','index.html'],['Менеджер','manager.html'],['Заказы','orders.html'],['Клиенты','customers.html'],['Заявки','requests.html']]],
 ['Бизнес',[['Производство','production.html'],['Склад','warehouse.html'],['Оборудование','equipment.html']]],
 ['Партнёры',[['Партнёры','partners.html'],['A4 Network','partners.html?view=network'],['ЦУИМ','cuim-delivery.html']]],
 ['Команда',[['Сотрудники','employees.html'],['Отделы','staff-structure.html']]],
 ['Финансы',[['Оплаты','payments.html'],['Отчёты','reports.html'],['Документы','documents.html']]],
 ['Система',[['Приложения','apps.html'],['Поддержка','support.html'],['Настройки','settings.html']]]
 ];
 const heading=document.createElement('h2');heading.textContent='Разделы A4PRINT HUB';panel.append(heading);
 const base=location.origin+'/admin/';
 for(const [title,links] of groups){
   const label=document.createElement('div');label.className='a4-desk-group';label.textContent=title;panel.append(label);
   for(const [name,route] of links){const a=document.createElement('a');a.textContent=name;a.href=new URL(route,base).href;panel.append(a)}
 }
 function hide(){panel.hidden=true;trigger.setAttribute('aria-expanded','false')}
 trigger.addEventListener('click',()=>{panel.hidden=!panel.hidden;trigger.setAttribute('aria-expanded',String(!panel.hidden))});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='m'){e.preventDefault();trigger.click()}});
 document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!panel.contains(e.target)&&e.target!==trigger)hide()});
 document.body.append(trigger,panel);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();