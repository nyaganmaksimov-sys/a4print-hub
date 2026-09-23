const btn=document.getElementById('hubInstall');
const status=document.getElementById('hubInstallStatus');
let installPrompt=null;

function notify(tone,title,message){
  if(window.A4Feedback?.show)return window.A4Feedback.show({tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}
function isInstalled(){
  return window.matchMedia?.('(display-mode: standalone)').matches===true||window.navigator.standalone===true;
}
function setInstallState(text,{ok=false,disabled=false,label=null}={}){
  if(status){
    status.textContent=text;
    status.className=ok?'status ok':'status';
  }
  if(btn){
    btn.disabled=disabled;
    if(label)btn.textContent=label;
  }
}
function renderInitialState(){
  if(isInstalled()){
    setInstallState('Веб-приложение уже установлено',{ok:true,disabled:true,label:'Установлено'});
    return;
  }
  setInstallState('Установка доступна через Chrome/Edge, когда браузер разрешит PWA',{label:'Установить веб-приложение'});
}
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  installPrompt=event;
  setInstallState('Веб-приложение готово к установке',{ok:true,label:'Установить веб-приложение'});
});
window.addEventListener('appinstalled',()=>{
  installPrompt=null;
  setInstallState('Веб-приложение A4PRINT HUB установлено',{ok:true,disabled:true,label:'Установлено'});
  notify('success','A4PRINT HUB установлен','Веб-приложение добавлено в Windows.');
});
btn?.addEventListener('click',async()=>{
  if(isInstalled()){
    setInstallState('Веб-приложение уже установлено',{ok:true,disabled:true,label:'Установлено'});
    return;
  }
  if(!installPrompt){
    setInstallState('Откройте меню Chrome/Edge → «Установить A4PRINT HUB». Это PWA; отдельный Desktop-клиент будет выпускаться отдельно.');
    return;
  }
  btn.disabled=true;
  try{
    installPrompt.prompt();
    const choice=await installPrompt.userChoice;
    installPrompt=null;
    if(choice?.outcome==='accepted'){
      setInstallState('Установка подтверждена. Windows завершает добавление приложения…',{ok:true,label:'Устанавливается…'});
    }else{
      setInstallState('Установка отменена. Можно повторить позже.',{label:'Установить веб-приложение'});
      btn.disabled=false;
    }
  }catch(error){
    console.error('PWA install failed',error);
    setInstallState('Не удалось запустить установку. Используйте меню Chrome/Edge.',{label:'Установить веб-приложение'});
    btn.disabled=false;
    notify('error','Не удалось установить веб-приложение',error?.message||String(error));
  }
});
async function ensureServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  try{
    const existing=await navigator.serviceWorker.getRegistration('../');
    if(!existing)await navigator.serviceWorker.register('../a4print-hub-sw.js',{scope:'../'});
  }catch(error){
    console.warn('A4PRINT HUB service worker registration failed',error);
  }
}
renderInitialState();
void ensureServiceWorker();
