(()=>{
  const addHead=()=>{
    if(!document.querySelector('link[rel="manifest"]')){const l=document.createElement('link');l.rel='manifest';l.href='./manifest.webmanifest';document.head.appendChild(l)}
    if(!document.querySelector('meta[name="theme-color"]')){const m=document.createElement('meta');m.name='theme-color';m.content='#2563eb';document.head.appendChild(m)}
    if(!document.querySelector('link[rel="apple-touch-icon"]')){const a=document.createElement('link');a.rel='apple-touch-icon';a.href='./pwa-icon.svg';document.head.appendChild(a)}
  };
  addHead();
  if('serviceWorker'in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(console.warn))}
  let deferredPrompt=null;
  const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  const ensureButton=()=>{
    if(standalone()||document.getElementById('pwaInstall'))return;
    const b=document.createElement('button');b.id='pwaInstall';b.type='button';b.textContent='Установить приложение';b.setAttribute('aria-label','Установить Partner CRM');
    Object.assign(b.style,{position:'fixed',right:'18px',bottom:'18px',zIndex:'9999',border:'0',borderRadius:'14px',padding:'12px 16px',background:'linear-gradient(135deg,#2563eb,#7c3aed)',color:'#fff',fontWeight:'850',boxShadow:'0 14px 36px rgba(37,99,235,.28)',cursor:'pointer',display:'none'});
    b.onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;b.remove()}else{alert('Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».')}};
    document.body.appendChild(b);
  };
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;ensureButton();const b=document.getElementById('pwaInstall');if(b)b.style.display='block'});
  window.addEventListener('appinstalled',()=>{deferredPrompt=null;document.getElementById('pwaInstall')?.remove()});
  window.addEventListener('DOMContentLoaded',()=>{ensureButton();setTimeout(()=>{const b=document.getElementById('pwaInstall');if(b&&!standalone())b.style.display='block'},1800)});
})();