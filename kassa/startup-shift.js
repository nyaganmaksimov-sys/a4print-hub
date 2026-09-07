(()=>{
  'use strict';
  if(window.__A4_KASSA_STARTUP_SHIFT__)return;
  window.__A4_KASSA_STARTUP_SHIFT__=true;

  let done=false;
  let attempts=0;
  let timer=null;

  function appReady(){
    const app=document.getElementById('appView');
    const auth=document.getElementById('authView');
    const nav=document.getElementById('navShift');
    if(!app||!nav)return false;
    if(app.hidden)return false;
    if(auth&&!auth.hidden)return false;
    return true;
  }

  function enterShiftOnce(){
    if(done)return true;
    if(!appReady())return false;
    const view=document.getElementById('shiftView');
    if(view&&view.hidden===false){done=true;return true}
    const nav=document.getElementById('navShift');
    if(!nav)return false;
    nav.click();
    done=true;
    return true;
  }

  function tick(){
    attempts+=1;
    if(enterShiftOnce()||attempts>=120){
      if(timer)clearInterval(timer);
      timer=null;
    }
  }

  function start(){
    tick();
    if(!done&&!timer)timer=setInterval(tick,250);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
  window.addEventListener('pageshow',()=>{if(!done)start()});
})();
