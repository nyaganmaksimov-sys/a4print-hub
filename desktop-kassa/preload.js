const {contextBridge,ipcRenderer}=require('electron');
let scanBuffer='';let scanTimer=null;
window.addEventListener('keydown',(event)=>{
  if(event.key==='Enter'&&scanBuffer.length>=4){ window.dispatchEvent(new CustomEvent('a4-kassa:barcode',{detail:scanBuffer}));scanBuffer='';clearTimeout(scanTimer);return; }
  if(event.key.length!==1)return;
  scanBuffer+=event.key;clearTimeout(scanTimer);scanTimer=setTimeout(()=>{scanBuffer='';},80);
});
contextBridge.exposeInMainWorld('A4KassaDesktop',Object.freeze({
  desktop:true,
  platform:process.platform,
  version:'2.1.3',
  printers:()=>ipcRenderer.invoke('a4-kassa:print'),
  settings:()=>ipcRenderer.invoke('a4-kassa:settings:get'),
  selectPrinter:(name)=>ipcRenderer.invoke('a4-kassa:settings:set-printer',name),
  print:(options={})=>ipcRenderer.invoke('a4-kassa:print-page',options),
  updater:Object.freeze({
    state:()=>ipcRenderer.invoke('a4-kassa:update:state'),
    check:()=>ipcRenderer.invoke('a4-kassa:update:check'),
    download:()=>ipcRenderer.invoke('a4-kassa:update:download'),
    install:()=>ipcRenderer.invoke('a4-kassa:update:install'),
    onState:(handler)=>{
      if(typeof handler!=='function')return()=>{};
      const listener=(_event,state)=>handler(state);
      ipcRenderer.on('a4-kassa:update:state',listener);
      return()=>ipcRenderer.removeListener('a4-kassa:update:state',listener);
    }
  })
}));
