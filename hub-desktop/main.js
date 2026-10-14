'use strict';
const {app,BrowserWindow,shell}=require('electron');
const path=require('path');
const ROOT='https://a4print-hub.ru/admin/index.html';
function trusted(raw){try{let u=new URL(raw);return u.protocol==='https:'&&(u.hostname==='a4print-hub.ru'||u.hostname.endsWith('.a4print-hub.ru'))}catch{return false}}
function webWindow(){const w=new BrowserWindow({width:1380,height:850,minWidth:920,minHeight:600,backgroundColor:'#fff',title:'A4PRINT HUB — Рабочее место',autoHideMenuBar:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webviewTag:false}});w.webContents.setWindowOpenHandler(({url})=>{if(trusted(url)){w.loadURL(url)}else if(url.startsWith('https:'))shell.openExternal(url);return {action:'deny'}});w.webContents.on('will-navigate',(e,url)=>{if(!trusted(url))e.preventDefault()});w.loadURL(ROOT);return w}
function home(){const w=new BrowserWindow({width:1440,height:900,minWidth:940,minHeight:650,backgroundColor:'#f2f6fb',title:'A4PRINT HUB',autoHideMenuBar:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webviewTag:false}});w.loadFile(path.join(__dirname,'index.html'));w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',(e,url)=>{if(url.startsWith('a4hub://')){e.preventDefault();const id=url.slice('a4hub://'.length).replace(/\/$/,'');if(['hub','pos','commerce','partner','mobile'].includes(id))webWindow()}else if(!url.startsWith('file://'))e.preventDefault()});w.webContents.on('before-input-event',(_event,input)=>{if(input.key==='F5'&&input.type==='keyDown')w.reload()});w.webContents.on('console-message',(_e,level,message)=>{if(level>=3)console.error(message)});return w}
app.whenReady().then(()=>{home();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)home()})});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('web-contents-created',(_e,contents)=>{contents.on('will-attach-webview',e=>e.preventDefault())});
const {ipcMain}=require('electron');
ipcMain.on('hub:open',(_e,id)=>{if(['hub','pos','commerce','partner','mobile'].includes(id))webWindow()});
