'use strict';
const {app,BrowserWindow,Menu,shell}=require('electron');
const path=require('path');
const HUB='https://a4print-hub.ru/admin/index.html';
const KASSA='https://a4print-hub.ru/kassa/';
let windowMain=null;
let launcherMode=true;
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
 createMain();
 app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createMain()});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('web-contents-created',(_event,contents)=>{
 contents.on('will-attach-webview',event=>event.preventDefault());
});
