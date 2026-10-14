'use strict';
const {app,BrowserWindow,Menu,shell,ipcMain}=require('electron');
const path=require('path');
const fs=require('fs');
const {autoUpdater}=require('electron-updater');

const HUB_URL='https://a4print-hub.ru/admin/index.html';
let mainWindow=null;
let updateWindow=null;
let updateState={status:'idle',currentVersion:app.getVersion(),version:null,progress:0,message:'Обновления ещё не проверялись.'};

function isHubUrl(raw){
 try{
  const url=new URL(raw);
  return url.protocol==='https:'&&(url.hostname==='a4print-hub.ru'||url.hostname.endsWith('.a4print-hub.ru'));
 }catch{return false}
}
function report(patch){
 updateState={...updateState,...patch,currentVersion:app.getVersion()};
 if(updateWindow&&!updateWindow.isDestroyed())updateWindow.webContents.send('update-state',updateState);
}
function showUpdates(){
 if(updateWindow&&!updateWindow.isDestroyed()){updateWindow.focus();return}
 updateWindow=new BrowserWindow({
  width:520,height:560,minWidth:480,minHeight:480,
  title:'Обновления A4PRINT HUB',parent:mainWindow||undefined,
  autoHideMenuBar:true,backgroundColor:'#f3f7fc',
  webPreferences:{preload:path.join(__dirname,'update-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}
 });
 updateWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 updateWindow.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('file://'))event.preventDefault()});
 updateWindow.loadFile(path.join(__dirname,'updates.html')).catch(console.error);
 updateWindow.on('closed',()=>{updateWindow=null});
}
async function checkUpdates(){
 if(!app.isPackaged){report({status:'dev',message:'Проверка доступна в установленной версии.'});return updateState}
 try{report({status:'checking',message:'Проверяем обновления…'});await autoUpdater.checkForUpdates()}
 catch(error){report({status:'error',message:String(error.message||error)})}
 return updateState;
}
function configureUpdates(){
 autoUpdater.autoDownload=false;
 autoUpdater.autoInstallOnAppQuit=false;
 autoUpdater.allowDowngrade=false;
 autoUpdater.on('checking-for-update',()=>report({status:'checking',message:'Проверяем обновления…'}));
 autoUpdater.on('update-available',info=>report({status:'available',version:info.version,notes:info.releaseNotes||'',progress:0,message:'Доступна новая версия'}));
 autoUpdater.on('update-not-available',()=>report({status:'current',message:'Установлена актуальная версия'}));
 autoUpdater.on('download-progress',p=>report({status:'downloading',progress:Math.round(p.percent||0),message:'Загрузка обновления…'}));
 autoUpdater.on('update-downloaded',info=>report({status:'ready',version:info.version,progress:100,message:'Обновление готово к установке'}));
 autoUpdater.on('error',error=>report({status:'error',message:String(error.message||error)}));
 ipcMain.handle('update:state',()=>updateState);
 ipcMain.handle('update:check',()=>checkUpdates());
 ipcMain.handle('update:download',async()=>{
  if(updateState.status!=='available')return updateState;
  try{report({status:'downloading',progress:0,message:'Загрузка обновления…'});await autoUpdater.downloadUpdate()}
  catch(error){report({status:'error',message:String(error.message||error)})}
  return updateState;
 });
 ipcMain.handle('update:install',()=>{
  if(updateState.status!=='ready')return false;
  setImmediate(()=>autoUpdater.quitAndInstall(false,true));
  return true;
 });
}
function createMainWindow(){
 if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.focus();return}
 mainWindow=new BrowserWindow({
  width:1440,height:900,minWidth:950,minHeight:650,
  title:'A4PRINT HUB — Центр управления',
  backgroundColor:'#f5f7fb',
  autoHideMenuBar:true,
  webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webviewTag:false}
 });
 const desktopCss=fs.readFileSync(path.join(__dirname,'desktop-layout.css'),'utf8');
 mainWindow.webContents.on('did-finish-load',async()=>{
  let target;
  try{target=new URL(mainWindow.webContents.getURL())}catch{return}
  if(target.hostname!=='a4print-hub.ru'||!target.pathname.startsWith('/admin/'))return;
  try{
   // Restore the real dark HUB sidebar on every admin navigation.
   await mainWindow.webContents.insertCSS(desktopCss,{cssOrigin:'user'});
  }catch(error){console.error('Desktop navigation injection failed',error)}
 });
 mainWindow.setMenu(Menu.buildFromTemplate([
  {label:'Навигация',submenu:[
   {label:'Назад',accelerator:'Alt+Left',click:()=>{if(mainWindow.webContents.canGoBack())mainWindow.webContents.goBack()}},
   {label:'Вперёд',accelerator:'Alt+Right',click:()=>{if(mainWindow.webContents.canGoForward())mainWindow.webContents.goForward()}},
   {label:'Главная HUB',accelerator:'Ctrl+Home',click:()=>mainWindow.loadURL(HUB_URL).catch(console.error)},
   {label:'Обновить страницу',accelerator:'F5',click:()=>mainWindow.webContents.reload()}
  ]},
  {label:'Обновления',submenu:[{label:'Проверить обновления…',accelerator:'Ctrl+U',click:()=>{showUpdates();void checkUpdates()}}]},
  {label:'Окно',submenu:[{role:'minimize'},{role:'togglefullscreen'},{role:'close'}]}
 ]));
 mainWindow.webContents.setWindowOpenHandler(({url})=>{
  if(isHubUrl(url)){
   // Reuse the same HUB window, even for links with target=_blank.
   mainWindow.loadURL(url).catch(console.error);
  }else if(/^https:\/\//i.test(url)){
   // External authentication/payment links are opened outside the trusted HUB context.
   shell.openExternal(url).catch(console.error);
  }
  return {action:'deny'};
 });
 mainWindow.webContents.on('will-navigate',(event,url)=>{
  if(!isHubUrl(url))event.preventDefault();
 });
 mainWindow.on('closed',()=>{mainWindow=null});
 mainWindow.loadURL(HUB_URL).catch(error=>console.error('HUB loading failed',error));
}
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{
 if(!mainWindow)return;
 if(mainWindow.isMinimized())mainWindow.restore();
 mainWindow.show();
 mainWindow.focus();
});
app.whenReady().then(()=>{
 configureUpdates();
 createMainWindow();
 setTimeout(()=>{if(app.isPackaged)void checkUpdates()},15000);
 app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createMainWindow()});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('web-contents-created',(_event,contents)=>{
 contents.on('will-attach-webview',event=>event.preventDefault());
});
