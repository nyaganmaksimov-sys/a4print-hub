const {app,BrowserWindow,session}=require('electron');
const path=require('path');
const KASSA_URL=process.env.A4_KASSA_URL||'https://a4print-hub.ru/kassa/';
let mainWindow;
if(!app.requestSingleInstanceLock()){app.quit();}
app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});
async function createWindow(){
  const splash=new BrowserWindow({width:520,height:300,frame:false,resizable:false,show:true,backgroundColor:'#ffffff'});
  await splash.loadFile(path.join(__dirname,'splash.html')).catch(()=>{});
  const partition='persist:a4kassa';
  const ses=session.fromPartition(partition,{cache:true});
  mainWindow=new BrowserWindow({
    width:1440,height:900,minWidth:1100,minHeight:700,show:false,
    title:'A4PRINT KASSA 2.1',backgroundColor:'#f6fbfc',autoHideMenuBar:true,
    webPreferences:{partition,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}
  });
  const reveal=()=>{if(!splash.isDestroyed())splash.destroy();if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.show();mainWindow.focus();}};
  mainWindow.webContents.on('did-finish-load',reveal);
  mainWindow.webContents.on('did-fail-load',(_e,code,desc,url,isMain)=>{
    if(!isMain||code===-3)return;
    console.error('A4-Kassa load failed',code,desc,url);
  });
  mainWindow.webContents.on('render-process-gone',(_e,d)=>console.error('A4-Kassa renderer stopped',d.reason,d.exitCode));
  // Do not intercept navigation, redirects, auth callbacks or window creation.
  // The desktop shell deliberately behaves like a normal Chromium tab.
  await mainWindow.loadURL(KASSA_URL,{userAgent:mainWindow.webContents.getUserAgent().replace(/ Electron\/[^ ]+/,'')}).catch(console.error);
  reveal();
  mainWindow.on('closed',()=>{mainWindow=null});
}
app.whenReady().then(createWindow);
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
