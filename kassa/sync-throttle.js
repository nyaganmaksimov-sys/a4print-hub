(()=>{
  'use strict';
  if(window.__A4_KASSA_SYNC_THROTTLE__)return;
  window.__A4_KASSA_SYNC_THROTTLE__=true;

  const nativeSetInterval=window.setInterval.bind(window);
  const fnText=fn=>{try{return Function.prototype.toString.call(fn)}catch{return''}};

  window.setInterval=function a4KassaSetInterval(handler,delay,...args){
    let nextDelay=Number(delay);
    // app.js already calls syncQueue immediately after a sale and health()
    // calls it every 15 seconds while the cashier is online. The legacy extra
    // five-second queue timer only repeats IndexedDB work and network attempts.
    if(nextDelay===5000&&typeof handler==='function'&&/\bsyncQueue\b/.test(fnText(handler))){
      nextDelay=60000;
    }
    return nativeSetInterval(handler,nextDelay,...args);
  };
})();
