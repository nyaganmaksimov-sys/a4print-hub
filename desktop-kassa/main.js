const {app,BrowserWindow,session,ipcMain,net}=require('electron');
const {autoUpdater}=require('electron-updater');
const fs=require('fs');
const path=require('path');

const PRIMARY_KASSA_URL=process.env.A4_KASSA_URL||'https://a4print-hub.ru/kassa/?desktop=1';
const KASSA_URLS=[PRIMARY_KASSA_URL,'https://a4print-hub.ru/kassa/index.html?desktop=1']
  .filter((value,index,array)=>value&&array.indexOf(value)===index);
const APP_ICON=path.join(__dirname,'build','icon.ico');
const TRANSIENT_LOAD_CODES=new Set([-7,-21,-101,-102,-105,-106,-109,-118,-137,-138,-324]);
const RETRY_DELAYS=[1500,3000,5000,8000,12000,20000,30000];
const RELEASE_NOTES_URL='https://github.com/nyaganmaksimov-sys/a4print-hub/releases/download/kassa-desktop/update-notes.json';
const LOCAL_NOTES_FILE=path.join(__dirname,'update-notes.json');
const UPDATE_PREFS_FILE=()=>path.join(app.getPath('userData'),'update-state.json');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');

let mainWindow;
let retryTimer=null;
let retryAttempt=0;
let lastFailedUrl='';
let updateState={status:'idle',currentVersion:app.getVersion(),availableVersion:null,percent:0,message:'',releaseNotes:null,whatsNew:null,showWhatsNew:false};
let localReleaseNotes=null;
let updatePrefs={lastSeenWhatsNewVersion:null};

function readJson(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return fallback}}
function writeJson(file,value){try{fs.writeFileSync(file,JSON.stringify(value,null,2),'utf8')}catch(error){log('WRITE JSON FAIL',file,String(error))}}
function normalizeNotes(notes,version){
  if(!notes||typeof notes!=='object')return null;
  const changes=Array.isArray(notes.changes)?notes.changes.filter(Boolean).map(String):[];
  return {version:String(notes.version||version||''),title:String(notes.title||'Что нового'),summary:String(notes.summary||''),changes,important:String(notes.important||'')};
}
async function fetchRemoteReleaseNotes(version){
  try{
    const response=await net.fetch(RELEASE_NOTES_URL+'?v='+encodeURIComponent(version||Date.now()),{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    return normalizeNotes(await response.json(),version);
  }catch(error){log('RELEASE NOTES FETCH FAIL',String(error));return null}
}
function loadLocalWhatsNew(){
  localReleaseNotes=normalizeNotes(readJson(LOCAL_NOTES_FILE,null),app.getVersion());
  updatePrefs=readJson(UPDATE_PREFS_FILE(),{lastSeenWhatsNewVersion:null})||{lastSeenWhatsNewVersion:null};
  const current=app.getVersion();
  const shouldShow=Boolean(localReleaseNotes&&localReleaseNotes.version===current&&updatePrefs.lastSeenWhatsNewVersion!==current);
  updateState={...updateState,whatsNew:localReleaseNotes,showWhatsNew:shouldShow};
}

function sendUpdateState(patch={}){
  updateState={...updateState,...patch,currentVersion:app.getVersion()};
  log('UPDATE STATE',updateState);
  if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('a4-kassa:update:state',updateState);
  return updateState;
}

function setupUpdater(){
  autoUpdater.autoDownload=false;
  autoUpdater.autoInstallOnAppQuit=true;
  autoUpdater.allowDowngrade=false;
  autoUpdater.on('checking-for-update',()=>sendUpdateState({status:'checking',message:'Проверяем обновления…'}));
  autoUpdater.on('update-available',async info=>{
    sendUpdateState({status:'available',availableVersion:info.version,percent:0,message:'Доступна новая версия'});
    const releaseNotes=await fetchRemoteReleaseNotes(info.version);
    if(releaseNotes&&String(releaseNotes.version)===String(info.version))sendUpdateState({releaseNotes});
  });
  autoUpdater.on('update-not-available',info=>sendUpdateState({status:'current',availableVersion:info?.version||null,percent:0,message:'Установлена актуальная версия'}));
  autoUpdater.on('download-progress',progress=>sendUpdateState({status:'downloading',percent:Math.round(Number(progress.percent||0)),message:'Скачивание обновления'}));
  autoUpdater.on('update-downloaded',info=>sendUpdateState({status:'downloaded',availableVersion:info.version,percent:100,message:'Обновление готово к установке'}));
  autoUpdater.on('error',error=>sendUpdateState({status:'error',message:String(error?.message||error)}));
  ipcMain.handle('a4-kassa:update:state',()=>updateState);
  ipcMain.handle('a4-kassa:update:whats-new-seen',()=>{
    const version=app.getVersion();
    updatePrefs={...updatePrefs,lastSeenWhatsNewVersion:version};
    writeJson(UPDATE_PREFS_FILE(),updatePrefs);
    return sendUpdateState({showWhatsNew:false});
  });
  ipcMain.handle('a4-kassa:update:check',async()=>{
    if(!app.isPackaged)return sendUpdateState({status:'dev',message:'Проверка обновлений доступна в установленной версии'});
    try{await autoUpdater.checkForUpdates();return updateState}catch(error){return sendUpdateState({status:'error',message:String(error?.message||error)})}
  });
  ipcMain.handle('a4-kassa:update:download',async()=>{
    if(updateState.status!=='available'&&updateState.status!=='error')return updateState;
    try{sendUpdateState({status:'downloading',percent:0,message:'Скачивание обновления'});await autoUpdater.downloadUpdate();return updateState}catch(error){return sendUpdateState({status:'error',message:String(error?.message||error)})}
  });
  ipcMain.handle('a4-kassa:update:install',()=>{
    if(updateState.status!=='downloaded')return false;
    setImmediate(()=>autoUpdater.quitAndInstall(false,true));
    return true;
  });
}

function log(...parts){
  try{
    fs.appendFileSync(
      path.join(app.getPath('userData'),'desktop.log'),
      new Date().toISOString()+' '+parts.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')+'\n'
    );
  }catch{}
}

function safeHtml(value){
  return String(value??'').replace(/[&<>"']/g,m=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

function recoveryPage({title,detail,attempt=0,delayMs=0,automatic=false}){
  if(!mainWindow||mainWindow.isDestroyed())return;
  const logPath=path.join(app.getPath('userData'),'desktop.log');
  const retryUrl=PRIMARY_KASSA_URL;
  const seconds=Math.max(1,Math.ceil(delayMs/1000));
  const status=automatic
    ? `Повторное подключение выполняется автоматически. Следующая попытка через <b id="retrySeconds">${seconds}</b> сек.`
    : 'Автоматическое восстановление недоступно для этой ошибки.';
  const html=`<!doctype html>
<meta charset="utf-8">
<title>A4PRINT KASSA 2.1</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font:16px system-ui,-apple-system,Segoe UI,sans-serif;background:#f6fbfc;color:#17202a;padding:40px}
  main{max-width:820px;margin:45px auto;background:white;padding:34px;border-radius:20px;box-shadow:0 12px 42px #0f172a12}
  h1{margin:0 0 18px;color:#087f8c;font-size:34px}
  p{line-height:1.55}
  .state{margin:18px 0;padding:16px 18px;background:#ecfeff;border:1px solid #b9edf1;border-radius:12px;color:#155e75}
  pre{white-space:pre-wrap;background:#f4f6f8;padding:16px;border-radius:10px;color:#344054}
  .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
  button,a{border:0;border-radius:10px;padding:12px 16px;font:800 14px system-ui;cursor:pointer;text-decoration:none}
  button{background:#08aebb;color:#fff}
  a{background:#eef2f6;color:#344054}
  small{display:block;margin-top:18px;color:#667085}
</style>
<main>
  <h1>A4-Касса: восстанавливаем подключение</h1>
  <p>${safeHtml(title)}</p>
  <div class="state">${status}</div>
  <pre>${safeHtml(detail)}</pre>
  <div class="actions">
    <button onclick="location.href=${JSON.stringify(retryUrl)}">Повторить сейчас</button>
    <a href="${safeHtml(retryUrl)}">Открыть кассу</a>
  </div>
  <small>Попытка: ${attempt||1}. Диагностика: ${safeHtml(logPath)}</small>
</main>
<script>
  let left=${seconds};
  const node=document.getElementById('retrySeconds');
  if(node){
    setInterval(()=>{left=Math.max(0,left-1);node.textContent=String(left)},1000);
  }
</script>`;
  mainWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html)).catch(error=>log('RECOVERY PAGE FAIL',String(error)));
}

function clearRetry(){
  if(retryTimer){clearTimeout(retryTimer);retryTimer=null}
}

function retryDelay(){
  return RETRY_DELAYS[Math.min(Math.max(retryAttempt-1,0),RETRY_DELAYS.length-1)];
}

function currentTarget(){
  return KASSA_URLS[retryAttempt%KASSA_URLS.length]||PRIMARY_KASSA_URL;
}

function isRemoteUrl(url){
  return /^https?:\/\//i.test(String(url||''));
}

async function loadKassa(reason='startup'){
  if(!mainWindow||mainWindow.isDestroyed())return;
  clearRetry();
  const url=currentTarget();
  log('LOAD TRY',retryAttempt+1,reason,url);
  try{
    await mainWindow.loadURL(url,{
      userAgent:mainWindow.webContents.getUserAgent().replace(/ Electron\/[^ ]+/,'')
    });
  }catch(error){
    log('LOAD URL REJECT',retryAttempt+1,url,String(error?.message||error));
  }
}

function scheduleRetry(code,desc,url){
  retryAttempt+=1;
  lastFailedUrl=url||lastFailedUrl||PRIMARY_KASSA_URL;
  const delay=retryDelay();
  log('RETRY SCHEDULE',retryAttempt,delay,code,desc,lastFailedUrl);
  recoveryPage({
    title:'Не удалось связаться с веб-кассой. Приложение продолжает попытки подключения.',
    detail:`Код: ${code}\n${desc}\n${lastFailedUrl}`,
    attempt:retryAttempt,
    delayMs:delay,
    automatic:true
  });
  clearRetry();
  retryTimer=setTimeout(()=>loadKassa('auto-retry'),delay);
}

if(!app.requestSingleInstanceLock()){
  app.quit();
}

app.on('second-instance',()=>{
  if(mainWindow){
    if(mainWindow.isMinimized())mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if(!isRemoteUrl(mainWindow.webContents.getURL()))loadKassa('second-instance');
  }
});

async function createWindow(){
  const splash=new BrowserWindow({
    width:520,height:300,frame:false,resizable:false,show:true,
    backgroundColor:'#ffffff',icon:APP_ICON
  });
  await splash.loadFile(path.join(__dirname,'splash.html')).catch(()=>{});

  const partition='persist:a4kassa';
  const ses=session.fromPartition(partition,{cache:true});

  await ses.clearCache().catch(error=>log('CLEAR CACHE FAIL',String(error)));
  await ses.clearStorageData({storages:['serviceworkers','cachestorage']})
    .catch(error=>log('CLEAR SW FAIL',String(error)));

  mainWindow=new BrowserWindow({
    width:1440,height:900,minWidth:1100,minHeight:700,show:false,
    title:'A4PRINT KASSA 2.1',icon:APP_ICON,backgroundColor:'#f6fbfc',autoHideMenuBar:true,
    webPreferences:{
      partition,contextIsolation:true,nodeIntegration:false,sandbox:false,
      backgroundThrottling:false
    }
  });

  const reveal=()=>{
    if(!splash.isDestroyed())splash.destroy();
    if(mainWindow&&!mainWindow.isDestroyed()){
      mainWindow.show();
      mainWindow.focus();
    }
  };

  mainWindow.webContents.on('did-start-navigation',(_e,url,_isInPlace,isMain)=>{
    if(isMain)log('NAV START',url);
  });

  mainWindow.webContents.on('did-redirect-navigation',(_e,url,_isInPlace,isMain)=>{
    if(isMain)log('NAV REDIRECT',url);
  });

  mainWindow.webContents.on('did-navigate',(_e,url)=>{
    log('NAV DONE',url);
    if(isRemoteUrl(url)){
      clearRetry();
      retryAttempt=0;
      lastFailedUrl='';
      log('CONNECTION RECOVERED',url);
    }
  });

  mainWindow.webContents.on('console-message',(_e,level,message,line,sourceId)=>{
    log('CONSOLE',level,message,line,sourceId);
  });

  mainWindow.webContents.on('did-finish-load',()=>{
    const url=mainWindow?.webContents?.getURL?.()||'';
    log('LOAD FINISH',url);
    reveal();
  });

  mainWindow.webContents.on('did-fail-load',(_e,code,desc,url,isMain)=>{
    if(!isMain||code===-3)return;
    log('LOAD FAIL',code,desc,url);

    if(TRANSIENT_LOAD_CODES.has(code)){
      scheduleRetry(code,desc,url);
      reveal();
      return;
    }

    clearRetry();
    recoveryPage({
      title:'Страница кассы не загрузилась.',
      detail:`Код: ${code}\n${desc}\n${url}`,
      attempt:retryAttempt+1,
      automatic:false
    });
    reveal();
  });

  mainWindow.webContents.on('render-process-gone',(_e,d)=>{
    log('RENDER GONE',d);
    clearRetry();
    retryAttempt+=1;
    recoveryPage({
      title:'Процесс отображения кассы завершился. Приложение перезапустит страницу автоматически.',
      detail:`${d.reason}; code ${d.exitCode}`,
      attempt:retryAttempt,
      delayMs:3000,
      automatic:true
    });
    retryTimer=setTimeout(()=>loadKassa('renderer-recovery'),3000);
    reveal();
  });

  mainWindow.webContents.on('child-process-gone',(_e,d)=>log('CHILD GONE',d));

  retryAttempt=0;
  await loadKassa('startup');
  reveal();

  mainWindow.on('closed',()=>{
    clearRetry();
    mainWindow=null;
  });
}

app.whenReady().then(async()=>{
  loadLocalWhatsNew();
  setupUpdater();
  await createWindow();
  if(app.isPackaged)setTimeout(()=>autoUpdater.checkForUpdates().catch(error=>sendUpdateState({status:'error',message:String(error?.message||error)})),10000);
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
