const {app,BrowserWindow,shell}=require('electron');
const path=require('path');
const KASSA_URL=process.env.A4_KASSA_URL||'https://a4print-hub.ru/kassa/';

let mainWindow;
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
      preload:path.join(__dirname,'preload.js'),
      contextIsolation:true,
      nodeIntegration:false,
      sandbox:true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({url})=>{
    if(/^https?:/i.test(url))shell.openExternal(url);
    return {action:'deny'};
  });
  mainWindow.webContents.on('will-navigate',(event,url)=>{
    if(url.startsWith(KASSA_URL)||url.startsWith('https://api.a4print-hub.ru'))return;
    event.preventDefault();if(/^https?:/i.test(url))shell.openExternal(url);
  });
  mainWindow.webContents.on('did-fail-load',(_event,_code,_desc,url,isMainFrame)=>{ if(isMainFrame && url.startsWith(KASSA_URL)) setTimeout(()=>mainWindow && mainWindow.loadURL(KASSA_URL),2500); });
  mainWindow.loadURL(KASSA_URL);
  mainWindow.once('ready-to-show',()=>{splash.destroy();mainWindow.show();mainWindow.focus()});
  mainWindow.on('closed',()=>{mainWindow=null});
}
app.whenReady().then(createWindow);
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()});
