'use strict';
const {app,BrowserWindow,Menu,shell}=require('electron');
const path=require('path');
const {autoUpdater}=require('electron-updater');
const HUB='https://a4print-hub.ru/admin/index.html';
const KASSA='https://a4print-hub.ru/kassa/';
let windowMain=null;
let launcherMode=true;
let updateWindow=null;
let updateState={status:'idle',currentVersion:app.getVersion(),version:null,progress:0,message:'Проверка обновлений ещё не выполнялась.'};
function broadcast(patch){updateState={...updateState,...patch};if(updateWindow&&!updateWindow.isDestroyed())updateWindow.webContents.send('update-state',updateState)}
function trusted(raw){try{const u=new URL(raw);return u.protocol==='https:'&&(u.hostname==='a4print-hub.ru'||u.hostname.endsWith('.a4print-hub.ru'))}catch{return false}}
function openLauncher(){
 if(!windowMain||windowMain.isDestroyed())return;
 launcherMode=true;
 windowMain.setTitle('A4PRINT HUB');
 windowMain.loadFile(path.join(__dirname,'index.html'));
}
function openModule(id){
 if(!windowMain||windowMain.isDestroyed())return;
 if(id==='pos'){
   // KASSA is an independent app, NOT a HUB module.
   shell.openExternal(KASSA).catch(console.error);
   return;
 }
 if(!['hub','commerce','partner','mobile'].includes(id))return;
 // Known HUB route only. Never invent module-specific routes.
 launcherMode=false;
 windowMain.setTitle('A4PRINT HUB — Центр управления');
 windowMain.loadURL(HUB);
}

function updatesWindow(){
 if(updateWindow&&!updateWindow.isDestroyed()){updateWindow.focus();return}
 updateWindow=new BrowserWindow({width:520,height:560,minWidth:480,minHeight:480,title:'Обновления A4PRINT HUB',parent:windowMain||undefined,autoHideMenuBar:true,backgroundColor:'#f3f7fc',webPreferences:{preload:path.join(__dirname,'update-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
 updateWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 updateWindow.webContents.on('will-navigate',(e,u)=>{if(!u.startsWith('file://'))e.preventDefault()});
 updateWindow.loadFile('updates.html');
 updateWindow.on('closed',()=>{updateWindow=null});
}
async function checkUpdate(){
 if(!app.isPackaged){broadcast({status:'dev',message:'Проверка обновлений работает в установленной версии.'});return updateState}
 try{broadcast({status:'checking',message:'Проверяем обновления…'});await autoUpdater.checkForUpdates()}
 catch(e){broadcast({status:'error',message:String(e.message||e)})}
 return updateState;
}
function initUpdates(){
 autoUpdater.autoDownload=false;
 autoUpdater.autoInstallOnAppQuit=false;
 autoUpdater.allowDowngrade=false;
 autoUpdater.on('checking-for-update',()=>broadcast({status:'checking',message:'Проверяем обновления…'}));
 autoUpdater.on('update-available',v=>broadcast({status:'available',version:v.version,notes:v.releaseNotes||'',progress:0,message:'Доступна новая версия'}));
 autoUpdater.on('update-not-available',()=>broadcast({status:'current',message:'Установлена актуальная версия'}));
 autoUpdater.on('download-progress',p=>broadcast({status:'downloading',progress:Math.round(p.percent||0),message:'Загрузка обновления…'}));
 autoUpdater.on('update-downloaded',v=>broadcast({status:'ready',version:v.version,progress:100,message:'Обновление готово к установке'}));
 autoUpdater.on('error',e=>broadcast({status:'error',message:String(e.message||e)}));
 const {ipcMain}=require('electron');
 ipcMain.handle('update:state',()=>updateState);
 ipcMain.handle('update:check',()=>checkUpdate());
 ipcMain.handle('update:download',async()=>{if(updateState.status!=='available')return updateState;try{broadcast({status:'downloading',progress:0,message:'Загрузка обновления…'});await autoUpdater.downloadUpdate()}catch(e){broadcast({status:'error',message:String(e.message||e)})}return updateState});
 ipcMain.handle('update:install',()=>{if(updateState.status!=='ready')return false;setImmediate(()=>autoUpdater.quitAndInstall(false,true));return true});
}
function createMain(){
 if(windowMain&&!windowMain.isDestroyed()){windowMain.focus();return}
 windowMain=new BrowserWindow({
   width:1440,height:900,minWidth:940,minHeight:650,
   title:'A4PRINT HUB',backgroundColor:'#f2f6fb',
   webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webviewTag:false}
 });
 windowMain.setMenu(Menu.buildFromTemplate([
  {label:'Навигация',submenu:[
   {label:'Каталог приложений',accelerator:'Ctrl+Home',click:openLauncher},
   {label:'Назад',accelerator:'Alt+Left',click:()=>{if(!launcherMode&&windowMain.webContents.canGoBack())windowMain.webContents.goBack();else openLauncher()}},
   {label:'Центр управления HUB',click:()=>openModule('hub')},
   {label:'Обновить',accelerator:'F5',click:()=>windowMain.reload()}
  ]},
  {label:'Обновления',submenu:[{label:'Проверить обновления',click:()=>{updatesWindow();void checkUpdate()}}]},
  {label:'Окно',submenu:[{role:'minimize'},{role:'togglefullscreen'},{role:'close'}]}
 ]));
 windowMain.webContents.setWindowOpenHandler(({url})=>{
   // Internal HUB links stay inside the existing window.
   if(trusted(url)){launcherMode=false;windowMain.loadURL(url).catch(console.error)}
   else if(url.startsWith('https:'))shell.openExternal(url).catch(console.error);
   return {action:'deny'};
 });
 windowMain.webContents.on('will-navigate',(event,url)=>{
   if(url.startsWith('a4hub://')){
     event.preventDefault();
     const id=url.slice('a4hub://'.length).replace(/\/$/,'');
     openModule(id);
     return;
   }
   if(!trusted(url)&&!url.startsWith('file://'))event.preventDefault();
   if(trusted(url))launcherMode=false;
 });
 windowMain.on('closed',()=>{windowMain=null});
 openLauncher();
}
app.whenReady().then(()=>{
 initUpdates();
 createMain();
 setTimeout(()=>{if(app.isPackaged)void checkUpdate()},15000);
 app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createMain()});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('web-contents-created',(_event,contents)=>{
 contents.on('will-attach-webview',event=>event.preventDefault());
});
