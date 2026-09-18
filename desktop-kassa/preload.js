const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('A4KassaDesktop',Object.freeze({
  desktop:true,
  platform:process.platform,
  version:'2.1.0',
  printers:()=>ipcRenderer.invoke('a4-kassa:print'),
  print:()=>ipcRenderer.invoke('a4-kassa:print-page')
}));
