(()=>{
  if(window.__A4PRINT_THEME_LOADED__)return;
  window.__A4PRINT_THEME_LOADED__=true;

  function applyLightTheme(){
    const body=document.body;
    if(!body)return;
    body.classList.remove('a4-dark','a4-side-glass','a4-side-flat','a4-side-light');
    body.classList.add('a4-theme-light');
    document.documentElement.dataset.theme='light';
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyLightTheme,{once:true});
  else applyLightTheme();

  window.A4Theme={
    mode:'light',
    apply:applyLightTheme
  };
})();
