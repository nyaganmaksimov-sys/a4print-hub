(()=>{
  'use strict';
  if(window.A4VoiceEngine)return;

  const queue=[];
  let running=false;
  let currentAudio=null;
  let currentUrl='';

  function cleanupAudio(){
    if(currentAudio){
      try{currentAudio.pause()}catch{}
      currentAudio.src='';
      currentAudio=null;
    }
    if(currentUrl){
      try{URL.revokeObjectURL(currentUrl)}catch{}
      currentUrl='';
    }
  }

  function browserVoice(text,profile){
    if(!('speechSynthesis'in window))return Promise.resolve(false);
    return new Promise(resolve=>{
      try{
        const utterance=new SpeechSynthesisUtterance(String(text));
        utterance.lang='ru-RU';
        utterance.rate=profile==='male'?0.92:0.98;
        utterance.pitch=profile==='male'?0.82:1.02;
        utterance.volume=1;
        const voices=speechSynthesis.getVoices?.()||[];
        const russian=voices.filter(v=>String(v.lang||'').toLowerCase().startsWith('ru'));
        const preferred=russian.find(v=>profile==='male'
          ?/dmit|pavel|alex|male|муж/i.test(v.name)
          :/svetlana|alena|irina|mariya|female|жен/i.test(v.name));
        if(preferred)utterance.voice=preferred;
        utterance.onend=()=>resolve(true);
        utterance.onerror=()=>resolve(false);
        speechSynthesis.speak(utterance);
      }catch{resolve(false)}
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
      headers:{
        Authorization:`Bearer ${token}`,
        'Content-Type':'application/json',
        Accept:'audio/mpeg'
      },
      body:JSON.stringify({text:String(item.text).slice(0,2500),voice:item.profile})
    });
    if(!response.ok){
      const body=await response.json().catch(()=>({}));
      throw new Error(body.error||body.detail||`VOICE_HTTP_${response.status}`);
    }
    return response.blob();
  }

  async function playItem(item){
    try{
      const blob=await neuralAudio(item);
      cleanupAudio();
      currentUrl=URL.createObjectURL(blob);
      const audio=new Audio(currentUrl);
      currentAudio=audio;
      await new Promise((resolve,reject)=>{
        audio.onended=resolve;
        audio.onerror=()=>reject(new Error('VOICE_AUDIO_PLAYBACK_FAILED'));
        const started=audio.play();
        if(started?.catch)started.catch(reject);
      });
      cleanupAudio();
      return true;
    }catch(error){
      cleanupAudio();
      if(item.fallback===false)throw error;
      return browserVoice(item.text,item.profile);
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
    }finally{running=false}
  }

  function speak(text,options={}){
    const value=String(text||'').trim();
    if(!value)return Promise.resolve(false);
    const profile=options.profile==='female'?'female':'male';
    if(options.interrupt){
      queue.splice(0).forEach(item=>item.resolve(false));
      try{speechSynthesis?.cancel?.()}catch{}
      cleanupAudio();
    }
    return new Promise((resolve,reject)=>{
      const item={
        text:value,
        profile,
        apiBaseUrl:options.apiBaseUrl,
        tokenProvider:options.tokenProvider,
        fallback:options.fallback!==false,
        resolve,
        reject
      };
      options.priority==='high'?queue.unshift(item):queue.push(item);
      drain();
    });
  }

  function stop(){
    queue.splice(0).forEach(item=>item.resolve(false));
    try{speechSynthesis?.cancel?.()}catch{}
    cleanupAudio();
    running=false;
  }

  window.A4VoiceEngine={speak,stop};
})();
