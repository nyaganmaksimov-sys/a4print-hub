(()=>{
  window.__A4_POPUP_COVERAGE__=true;

  function cleanup(){
    document.documentElement.classList.remove('a4-compact-popup-html');
    document.body?.classList.remove('a4-compact-popup-workspace','a4-popup-open');
    document.querySelectorAll('.a4-pop-backdrop').forEach(el=>el.remove());
    document.querySelectorAll('.a4-pop-summary,.a4-pop-close').forEach(el=>el.remove());
    document.querySelectorAll('.a4-pop-card').forEach(card=>{
      card.classList.remove('a4-pop-card','a4-pop-open');
      card.removeAttribute('aria-expanded');
      card.removeAttribute('data-a4-popup-ready');
      delete card.dataset.a4WasCollapsed;
    });
    document.querySelectorAll('.a4-pop-grid-parent').forEach(el=>el.classList.remove('a4-pop-grid-parent'));
    document.getElementById('a4-popup-coverage-style')?.remove();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',cleanup,{once:true});
  else cleanup();
  window.addEventListener('load',cleanup,{once:true});
})();