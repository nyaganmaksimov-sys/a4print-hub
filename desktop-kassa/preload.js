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
  version:'2.1.0',
  printers:()=>ipcRenderer.invoke('a4-kassa:print'),
  print:(options={})=>ipcRenderer.invoke('a4-kassa:print-page',options)
}));
