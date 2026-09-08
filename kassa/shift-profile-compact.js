(()=>{
  'use strict';
  if(window.__A4_KASSA_SHIFT_PROFILE_COMPACT__)return;
  window.__A4_KASSA_SHIFT_PROFILE_COMPACT__=true;
  const $=id=>document.getElementById(id);
  let observer=null;

  function setup(){
    const card=$('shiftProfileCard');
    if(!card||card.dataset.compactReady==='1')return false;
    const head=card.querySelector('.shift-profile-head');
    const body=$('shiftProfileBody');
    const grid=card.querySelector('.shift-profile-grid');
    const actions=card.querySelector('.shift-profile-actions');
    const history=$('shiftProfileHistory');
    const refresh=$('shiftProfileRefresh');
    if(!head||!body||!grid||!actions||!refresh)return false;

    card.dataset.compactReady='1';

    let headActions=head.querySelector('.shift-profile-head-actions');
    if(!headActions){
      headActions=document.createElement('div');
      headActions.className='shift-profile-head-actions';
      headActions.appendChild(refresh);
      head.appendChild(headActions);
    }

    const toggle=document.createElement('button');
    toggle.id='shiftProfileDetailsToggle';
    toggle.className='shift-profile-details-toggle';
    toggle.type='button';
    toggle.textContent='Подробнее';
    toggle.setAttribute('aria-expanded','false');
    headActions.insertBefore(toggle,refresh);

    const details=document.createElement('div');
    details.id='shiftProfileDetails';
    details.className='shift-profile-details';
    details.hidden=true;
    details.appendChild(grid);
    details.appendChild(actions);
    if(history)details.appendChild(history);
    body.appendChild(details);

    toggle.addEventListener('click',()=>{
      const open=details.hidden;
      details.hidden=!open;
      toggle.textContent=open?'Свернуть':'Подробнее';
      toggle.setAttribute('aria-expanded',open?'true':'false');
      if(!open&&history&&!history.hidden){
        history.hidden=true;
        const hbtn=$('shiftProfileHistoryToggle');
        if(hbtn)hbtn.textContent='Последние смены';
      }
    });
    return true;
  }

  function init(){
    if(setup())return;
    observer=new MutationObserver(()=>{
      if(setup()){observer?.disconnect();observer=null}
    });
    observer.observe(document.documentElement,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
