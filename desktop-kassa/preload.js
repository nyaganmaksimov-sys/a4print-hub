const {contextBridge}=require('electron');
contextBridge.exposeInMainWorld('A4KassaDesktop',Object.freeze({
  desktop:true,
  platform:process.platform,
  version:'2.1.0'
}));
