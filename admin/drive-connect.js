import {supabase} from './guard.js?v=20260923-drive1';

const cfg=window.A4PRINT_CONFIG||{};
const $=id=>document.getElementById(id);
const DRIVE_TIMEOUT_MS=7000;
let retryAction=null;

function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}
function clearError(){
  retryAction=null;
  if($('errorCard'))$('errorCard').style.display='none';
  if($('errorText'))$('errorText').textContent='';
}
function showError(error,retry=null){
  retryAction=typeof retry==='function'?retry:null;
  if($('errorText'))$('errorText').textContent=error?.message||String(error);
  if($('errorCard'))$('errorCard').style.display='block';
  if($('retryDrive'))$('retryDrive').style.display=retryAction?'inline-flex':'none';
  notify('error','Google Drive недоступен',error?.message||String(error),retryAction?{actionLabel:'Повторить',onAction:retryAction}:{});
}
async function sessionHeaders(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)throw new Error('Сессия истекла. Войдите снова.');
  return{
    Authorization:`Bearer ${session.access_token}`,
    apikey:cfg.supabasePublishableKey||'',
    'Content-Type':'application/json'
  };
}
async function fetchJson(url,options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),DRIVE_TIMEOUT_MS);
  try{
    const response=await fetch(url,{...options,signal:options.signal||controller.signal,cache:'no-store'});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.message||body.error||`HTTP ${response.status}`);
    return body;
  }catch(error){
    if(error?.name==='AbortError')throw new Error('Google Drive отвечает слишком долго. Повторите попытку.');
    throw error;
  }finally{clearTimeout(timer)}
}
function endpoint(){
  const base=String(cfg.supabaseUrl||'').replace(/\/$/,'');
  if(!base)throw new Error('Supabase URL не настроен.');
  return `${base}/functions/v1/chat-drive`;
}
async function call(body){
  return fetchJson(endpoint(),{method:'POST',headers:await sessionHeaders(),body:JSON.stringify(body)});
}
async function loadStatus(){
  return fetchJson(`${endpoint()}?action=status`,{headers:await sessionHeaders()});
}
function setStatus(title,text,tone=''){
  $('statusTitle').textContent=title;
  $('statusTitle').className=`status-title ${tone}`.trim();
  $('statusText').textContent=text;
}
function resetActions(){
  $('connect').style.display='none';
  $('openDrive').style.display='none';
  $('setupCard').style.display='none';
}
function safeFolderHref(folderId){
  const id=String(folderId||'').trim();
  return /^[A-Za-z0-9_-]+$/.test(id)?`https://drive.google.com/drive/folders/${id}`:null;
}
async function init(){
  clearError();resetActions();
  try{
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){location.replace('./login.html');return}
    $('me').textContent=session.user.email||'';
    $('redirectUri').textContent=location.origin+location.pathname;

    const params=new URLSearchParams(location.search);
    const oauthError=params.get('error');
    if(oauthError){
      history.replaceState({},'',location.pathname);
      throw new Error('Google не завершил авторизацию. Попробуйте подключение ещё раз.');
    }

    const code=params.get('code');
    if(code){
      setStatus('Завершаем подключение…','Проверяем разрешение Google Drive.');
      const result=await call({action:'exchange-code',code,redirect_uri:location.origin+location.pathname});
      history.replaceState({},'',location.pathname);
      setStatus('Google Drive подключён',result.google_email?`Аккаунт: ${result.google_email}`:'Подключение успешно.','ok');
      notify('success','Google Drive подключён',result.google_email?`Аккаунт: ${result.google_email}`:'Подключение успешно.');
    }

    const data=await loadStatus();
    if(data.connected){
      setStatus('Google Drive подключён',data.google_email?`Файлы HUB сохраняются в аккаунте ${data.google_email}.`:'Файловое хранилище активно.','ok');
      const href=safeFolderHref(data.root_folder_id);
      if(href){$('openDrive').href=href;$('openDrive').style.display='inline-flex'}
    }else if(!data.configured){
      setStatus('Нужна настройка OAuth','Интеграция HUB установлена, но Google OAuth Client ещё не указан на сервере.','warn');
      $('setupCard').style.display='block';
    }else if(data.is_admin){
      setStatus('Google Drive ещё не подключён','Подключение выполняется один раз для организации.','warn');
      $('connect').style.display='inline-block';
    }else{
      setStatus('Google Drive ещё не подключён','Подключение должен выполнить администратор HUB.','warn');
    }
  }catch(error){
    setStatus('Не удалось проверить Google Drive','Экран HUB остаётся доступным. Можно повторить проверку.','danger');
    showError(error,init);
  }
}
async function connectDrive(){
  const button=$('connect');button.disabled=true;clearError();
  try{
    const data=await call({action:'auth-url',redirect_uri:location.origin+location.pathname});
    const url=new URL(String(data.url||''));
    if(url.protocol!=='https:')throw new Error('Сервер вернул некорректный URL авторизации.');
    location.assign(url.href);
  }catch(error){
    showError(error,connectDrive);
    button.disabled=false;
  }
}

$('connect')?.addEventListener('click',connectDrive);
$('retryDrive')?.addEventListener('click',()=>retryAction?.());
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&document.visibilityState==='visible')void init()});

void init();
