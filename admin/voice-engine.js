(()=>{
  'use strict';
  if(window.A4VoiceEngine)return;

  const queue=[];
  let running=false;
  let currentAudio=null;
  let currentUrl='';
  let cancelCurrent=null;
  let generation=0;
  let audioContext=null;
  let unlocked=false;
  let unlockInFlight=null;

  function cleanupAudio(){
    if(currentAudio){
      try{currentAudio.pause()}catch{}
      try{currentAudio.removeAttribute('src');currentAudio.load()}catch{}
      currentAudio=null;
    }
    if(currentUrl){
      try{URL.revokeObjectURL(currentUrl)}catch{}
      currentUrl='';
    }
  }

  async function unlock(){
    if(unlocked)return true;
    if(unlockInFlight)return unlockInFlight;
    unlockInFlight=(async()=>{
      try{
        const Context=window.AudioContext||window.webkitAudioContext;
        if(Context){
          audioContext=audioContext||new Context();
          if(audioContext.state==='suspended')await audioContext.resume();
          const buffer=audioContext.createBuffer(1,1,22050);
          const source=audioContext.createBufferSource();
          source.buffer=buffer;source.connect(audioContext.destination);source.start(0);
          unlocked=audioContext.state==='running';
        }else{
          unlocked=true;
        }
      }catch{unlocked=false}
      if(unlocked){
        try{window.dispatchEvent(new CustomEvent('a4:voice-unlocked'))}catch{}
      }
      return unlocked;
    })().finally(()=>{unlockInFlight=null});
    return unlockInFlight;
  }

  function primeUnlock(){unlock().catch(()=>{})}
  window.addEventListener('pointerdown',primeUnlock,{capture:true,passive:true});
  window.addEventListener('touchstart',primeUnlock,{capture:true,passive:true});
  window.addEventListener('keydown',primeUnlock,{capture:true});

  function cancelPlayback(){
    generation+=1;
    const cancel=cancelCurrent;
    cancelCurrent=null;
    if(cancel)try{cancel()}catch{}
    try{window.speechSynthesis?.cancel?.()}catch{}
    cleanupAudio();
  }

  function browserVoice(text,profile,myGeneration){
    if(!('speechSynthesis'in window)||myGeneration!==generation)return Promise.resolve(false);
    return new Promise(resolve=>{
      let settled=false;
      let timer=null;
      const finish=value=>{
        if(settled)return;
        settled=true;
        clearTimeout(timer);
        if(cancelCurrent===cancel)cancelCurrent=null;
        resolve(value);
      };
      const cancel=()=>{try{window.speechSynthesis.cancel()}catch{}finish(false)};
      cancelCurrent=cancel;
      try{
        const utterance=new SpeechSynthesisUtterance(String(text));
        utterance.lang='ru-RU';
        utterance.rate=profile==='male'?0.92:0.98;
        utterance.pitch=profile==='male'?0.82:1.02;
        utterance.volume=1;
        const voices=window.speechSynthesis.getVoices?.()||[];
        const russian=voices.filter(v=>String(v.lang||'').toLowerCase().startsWith('ru'));
        const preferred=russian.find(v=>profile==='male'
          ?/dmit|pavel|alex|male|муж/i.test(v.name)
          :/svetlana|alena|irina|mariya|female|жен/i.test(v.name));
        if(preferred)utterance.voice=preferred;
        utterance.onend=()=>finish(true);
        utterance.onerror=()=>finish(false);
        timer=setTimeout(()=>finish(false),Math.max(12000,Math.min(60000,String(text).length*140)));
        window.speechSynthesis.speak(utterance);
      }catch{finish(false)}
    });
  }

  async function neuralAudio(item){
    const base=String(item.apiBaseUrl||window.A4PRINT_CONFIG?.apiBaseUrl||'').replace(/\/$/,'');
    if(!base)throw new Error('VOICE_API_NOT_CONFIGURED');
    const token=typeof item.tokenProvider==='function'?await item.tokenProvider():'';
    if(!token)throw new Error('VOICE_AUTH_REQUIRED');
    const response=await fetch(`${base}/api/v1/jarvis/tts`,{
      method:'POST',
      cache:'no-store',
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'audio/mpeg'},
      body:JSON.stringify({text:String(item.text).slice(0,2500),voice:item.profile})
    });
    if(!response.ok){
      const body=await response.json().catch(()=>({}));
      throw new Error(body.error||body.detail||`VOICE_HTTP_${response.status}`);
    }
    return response.blob();
  }

  async function playItem(item){
    const myGeneration=generation;
    try{
      const blob=await neuralAudio(item);
      if(myGeneration!==generation)return false;
      cleanupAudio();
      currentUrl=URL.createObjectURL(blob);
      const audio=new Audio(currentUrl);
      currentAudio=audio;
      const played=await new Promise((resolve,reject)=>{
        let settled=false;
        const finish=(value,error)=>{
          if(settled)return;
          settled=true;
          if(cancelCurrent===cancel)cancelCurrent=null;
          error?reject(error):resolve(value);
        };
        const cancel=()=>finish(false);
        cancelCurrent=cancel;
        audio.onended=()=>finish(true);
        audio.onerror=()=>finish(false,new Error('VOICE_AUDIO_PLAYBACK_FAILED'));
        const started=audio.play();
        if(started?.catch)started.catch(error=>finish(false,error));
      });
      cleanupAudio();
      return played;
    }catch(error){
      cleanupAudio();
      if(myGeneration!==generation)return false;
      if(item.fallback===false)throw error;
      return browserVoice(item.text,item.profile,myGeneration);
    }
  }

  async function drain(){
    if(running)return;
    running=true;
    try{
      while(queue.length){
        const item=queue.shift();
        if(!item)continue;
        try{item.resolve(await playItem(item))}
        catch(error){item.reject(error)}
      }
    }finally{running=false;cancelCurrent=null}
  }

  function speak(text,options={}){
    const value=String(text||'').trim();
    if(!value)return Promise.resolve(false);
    const profile=options.profile==='female'?'female':'male';
    if(options.interrupt){queue.splice(0).forEach(item=>item.resolve(false));cancelPlayback()}
    return new Promise((resolve,reject)=>{
      const item={text:value,profile,apiBaseUrl:options.apiBaseUrl,tokenProvider:options.tokenProvider,fallback:options.fallback!==false,resolve,reject};
      options.priority==='high'?queue.unshift(item):queue.push(item);
      drain();
    });
  }

  function stop(){queue.splice(0).forEach(item=>item.resolve(false));cancelPlayback()}

  window.A4VoiceEngine={speak,stop,unlock,isUnlocked:()=>unlocked};
})();
