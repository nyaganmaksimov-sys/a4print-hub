const {app,BrowserWindow,shell,ipcMain}=require('electron');
const path=require('path');
const KASSA_URL=process.env.A4_KASSA_URL||'https://a4print-hub.ru/kassa/';
// Some Windows GPU/driver combinations cause Electron surfaces to alternate between white and rendered frames.
// The POS UI is lightweight, so software compositing is more stable and has negligible impact here.
// Keep Chromium's default renderer path; forcing software compositing caused blank surfaces on some Windows PCs.

let mainWindow;
const store={printer:''};
const gotLock=app.requestSingleInstanceLock();
if(!gotLock){ app.quit(); }
app.on('second-instance',()=>{ if(mainWindow){ if(mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
function createWindow(){
  const splash=new BrowserWindow({width:520,height:300,frame:false,resizable:false,show:true,backgroundColor:'#ffffff'});
  splash.loadFile(path.join(__dirname,'splash.html'));

  mainWindow=new BrowserWindow({
    width:1440,height:900,minWidth:1100,minHeight:700,show:false,
    title:'A4PRINT KASSA 2.1',
    icon:path.join(__dirname,'assets','kassa.ico'),
    backgroundColor:'#f6fbfc',
    autoHideMenuBar:true,
    webPreferences:{
      contextIsolation:true,
      nodeIntegration:false,
      sandbox:true,
      backgroundThrottling:false,
      spellcheck:false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({url})=>{
    if(/^https?:/i.test(url))shell.openExternal(url);
    return {action:'deny'};
  });
  mainWindow.webContents.on('will-navigate',(event,url)=>{
    if(url.startsWith('https://a4print-hub.ru/')||url.startsWith('https://api.a4print-hub.ru/'))return;
    event.preventDefault();if(/^https?:/i.test(url))shell.openExternal(url);
  });
  mainWindow.webContents.on('did-fail-load',(_event,code,desc,url,isMainFrame)=>{
    if(!isMainFrame)return;
    // ERR_ABORTED (-3) is normal during redirects/auth navigation. Retrying it creates an endless white/login loop.
    if(code===-3)return;
    console.error('A4-Kassa load failed:',code,desc,url);
    if(url.startsWith('https://a4print-hub.ru/')) setTimeout(()=>mainWindow&&!mainWindow.isDestroyed()&&mainWindow.loadURL(KASSA_URL),2500);
  });
  const reveal=()=>{if(splash&&!splash.isDestroyed())splash.destroy();if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.show();mainWindow.focus();}};
  mainWindow.webContents.on('did-finish-load',reveal);
  mainWindow.webContents.on('render-process-gone',(_event,details)=>{
    console.error('A4-Kassa renderer stopped:',details.reason,details.exitCode);
    if(mainWindow&&!mainWindow.isDestroyed())mainWindow.loadURL(KASSA_URL);
  });
  mainWindow.loadURL(KASSA_URL).catch(error=>{console.error('A4-Kassa initial load failed:',error);reveal();});
  setTimeout(reveal,8000);
  mainWindow.on('closed',()=>{mainWindow=null});
}
app.whenReady().then(createWindow);
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()});
