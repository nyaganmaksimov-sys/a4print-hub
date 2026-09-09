(()=>{
  'use strict';
  if(window.__A4_KASSA_SHIFT_MOBILE_V2__)return;
  window.__A4_KASSA_SHIFT_MOBILE_V2__=true;
  if(!matchMedia('(max-width:980px)').matches)return;
  const $=id=>document.getElementById(id);
  const num=s=>Number(String(s||'').replace(/\s/g,'').replace(',','.').replace(/[^0-9.-]/g,''))||0;
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})+' ₽';

  function ensureDetailsToggle(){
    const card=$('shiftProfileCard');
    if(!card)return;
    // Reuse the compact-profile toggle that already exists. Never create a
    // second "Подробнее" button.
    const existing=$('shiftProfileDetailsToggle');
    const duplicate=$('shiftV2Details');
    if(duplicate)duplicate.remove();
    if(existing){
      existing.classList.add('shift-profile-details-toggle-v2');
      existing.textContent=existing.getAttribute('aria-expanded')==='true'?'Свернуть':'ⓘ Подробнее';
    }
  }

  function ensureQuickStats(){
    const summary=document.querySelector('#shiftSummaryWrap .shift-summary-card');
    if(!summary||summary.querySelector('.a4-shift-quickstats'))return;
    const box=document.createElement('div');
    box.className='a4-shift-quickstats';
    box.innerHTML='<div class="a4-shift-stat"><span>В кассе</span><strong id="shiftV2Cash">0 ₽</strong></div><div class="a4-shift-stat"><span>Чеков</span><strong id="shiftV2Checks">0</strong></div><div class="a4-shift-stat"><span>Средний чек</span><strong id="shiftV2Avg">0 ₽</strong></div>';
    summary.appendChild(box);
  }

  function sync(){
    ensureDetailsToggle();ensureQuickStats();
    const salesCount=num($('shiftSalesCount')?.textContent);
    const salesTotal=num($('shiftSalesTotal')?.textContent);
    const cash=$('shiftCashRegister')?.textContent||'0 ₽';
    if($('shiftV2Cash'))$('shiftV2Cash').textContent=cash;
    if($('shiftV2Checks'))$('shiftV2Checks').textContent=String(salesCount||0);
    if($('shiftV2Avg'))$('shiftV2Avg').textContent=money(salesCount?salesTotal/salesCount:0);
  }

  function init(){
    sync();
    const root=$('shiftView')||document.body;
    const obs=new MutationObserver(()=>sync());
    obs.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','class','aria-expanded']});
    document.addEventListener('click',e=>{if(e.target?.closest?.('#navShift,#shiftChip,[data-mobile-nav="shift"]'))setTimeout(sync,180)},true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();