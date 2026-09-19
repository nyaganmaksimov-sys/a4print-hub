const {app,BrowserWindow,session}=require('electron');
const fs=require('fs');
const path=require('path');
const KASSA_URL=process.env.A4_KASSA_URL||'https://a4print-hub.ru/kassa/?desktop=1';
const APP_ICON=path.join(__dirname,'build','icon.ico');
// Windows workstation compatibility: renderer exit code 3 is a Chromium GPU-process crash on affected drivers.
// Disable GPU before app ready and keep software rasterization enabled for the POS shell only.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
let mainWindow;
function log(...parts){try{fs.appendFileSync(path.join(app.getPath('userData'),'desktop.log'),new Date().toISOString()+' '+parts.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')+'\n')}catch{}}
function diagnostic(title,detail=''){if(!mainWindow||mainWindow.isDestroyed())return;const safe=s=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));mainWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;background:#f6fbfc;color:#17202a;padding:40px}main{max-width:760px;margin:auto;background:white;padding:32px;border-radius:18px;box-shadow:0 8px 30px #0001}h1{color:#087f8c}pre{white-space:pre-wrap;background:#f4f6f8;padding:16px;border-radius:10px}</style><main><h1>A4-Касса: ошибка запуска</h1><p>${safe(title)}</p><pre>${safe(detail)}</pre><p>Диагностика сохранена: ${safe(path.join(app.getPath('userData'),'desktop.log'))}</p></main>`));}
if(!app.requestSingleInstanceLock()){app.quit();}
app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});
async function createWindow(){
  const splash=new BrowserWindow({width:520,height:300,frame:false,resizable:false,show:true,backgroundColor:'#ffffff',icon:APP_ICON});
  await splash.loadFile(path.join(__dirname,'splash.html')).catch(()=>{});
  const partition='persist:a4kassa';
  const ses=session.fromPartition(partition,{cache:true});
  // Keep auth cookies/localStorage, but remove stale executable web caches that can
  // survive desktop upgrades and re-run old Kassa boot code.
  await ses.clearCache().catch(error=>log('CLEAR CACHE FAIL',String(error)));
  await ses.clearStorageData({storages:['serviceworkers','cachestorage']}).catch(error=>log('CLEAR SW FAIL',String(error)));
  mainWindow=new BrowserWindow({
    width:1440,height:900,minWidth:1100,minHeight:700,show:false,
    title:'A4PRINT KASSA 2.1',icon:APP_ICON,backgroundColor:'#f6fbfc',autoHideMenuBar:true,
    webPreferences:{partition,contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}
  });
  const reveal=()=>{if(!splash.isDestroyed())splash.destroy();if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.show();mainWindow.focus();}};
  mainWindow.webContents.on('did-start-navigation',(_e,url,isInPlace,isMain)=>{if(isMain)log('NAV START',url)});
  mainWindow.webContents.on('did-redirect-navigation',(_e,url,isInPlace,isMain)=>{if(isMain)log('NAV REDIRECT',url)});
  mainWindow.webContents.on('did-navigate',(_e,url)=>log('NAV DONE',url));
  mainWindow.webContents.on('console-message',(_e,level,message,line,sourceId)=>log('CONSOLE',level,message,line,sourceId));
  mainWindow.webContents.on('did-finish-load',()=>{log('LOAD FINISH',mainWindow.webContents.getURL());reveal();});
  mainWindow.webContents.on('did-fail-load',(_e,code,desc,url,isMain)=>{
    if(!isMain||code===-3)return;
    log('LOAD FAIL',code,desc,url); diagnostic('Страница кассы не загрузилась.',`Код: ${code}\n${desc}\n${url}`);
  });
  mainWindow.webContents.on('render-process-gone',(_e,d)=>{log('RENDER GONE',d);diagnostic('Процесс отображения кассы завершился.',`${d.reason}; code ${d.exitCode}`)});
  mainWindow.webContents.on('child-process-gone',(_e,d)=>log('CHILD GONE',d));
  // Do not intercept navigation, redirects, auth callbacks or window creation.
  // The desktop shell deliberately behaves like a normal Chromium tab.
  await mainWindow.loadURL(KASSA_URL,{userAgent:mainWindow.webContents.getUserAgent().replace(/ Electron\/[^ ]+/,'')}).catch(console.error);
  reveal();
  mainWindow.on('closed',()=>{mainWindow=null});
}
app.whenReady().then(createWindow);
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
