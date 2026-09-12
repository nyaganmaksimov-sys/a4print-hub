(()=>{
  'use strict';
  if(window.__A4_KASSA_JARVIS_CASHIER_EVENTS__)return;
  window.__A4_KASSA_JARVIS_CASHIER_EVENTS__=true;

  const cfg=window.A4PRINT_CONFIG||{};
  const voice=window.A4VoiceEngine;
  const DB=window.A4KassaDB;
  const createClient=window.supabase?.createClient;
  if(!voice)return;

  const VOICE_KEY='a4_kassa_voice_enabled_v3';
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const client=createClient&&cfg.supabaseUrl&&cfg.supabasePublishableKey
    ?createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{global:{fetch:window.A4SupabaseFetch||fetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}})
    :null;

  const spoken=new Map();
  let speechChain=Promise.resolve();
  let queueIssueKey='';
  let queueHadProblem=false;
  let networkState=null;
  let lastReturnId='';
  let queueTimer=null;

  function voiceEnabled(){try{return localStorage.getItem(VOICE_KEY)!=='0'}catch{return true}}
  function plural(n,one,few,many){const v=Math.abs(Math.trunc(Number(n)||0)),n10=v%10,n100=v%100;if(n10===1&&n100!==11)return one;if(n10>=2&&n10<=4&&(n100<12||n100>14))return few;return many}
  function moneySpeech(value){
    const kopecks=Math.max(0,Math.round(Number(value||0)*100));
    const rub=Math.floor(kopecks/100),kop=kopecks%100;
    const base=`${rub.toLocaleString('ru-RU')} ${plural(rub,'рубль','рубля','рублей')}`;
    return kop?`${base} ${kop} ${plural(kop,'копейка','копейки','копеек')}`:base;
  }
  async function tokenProvider(){
    if(!client)return'';
    const {data,error}=await client.auth.getSession();
    if(error)throw error;
    return data?.session?.access_token||'';
  }
  function canSpeak(key,cooldown=30000){
    const now=Date.now(),last=Number(spoken.get(key)||0);
    if(now-last<cooldown)return false;
    spoken.set(key,now);
    return true;
  }
  function say(text,{key=text,cooldown=30000,interrupt=false,priority='normal'}={}){
    if(!voiceEnabled()||!text||!canSpeak(key,cooldown))return Promise.resolve(false);
    const run=async()=>{
      try{return await voice.speak(text,{profile:'male',apiBaseUrl:API,tokenProvider,interrupt,priority})}
      catch(error){console.warn('A4PRINT KASSA Jarvis cashier events:',error);return false}
    };
    if(interrupt)return run();
    speechChain=speechChain.then(run,run);
    return speechChain;
  }

  function paymentSpeech(method){
    const value=String(method||'').toLowerCase();
    if(value.includes('налич')&&!value.includes('безнал'))return'наличными';
    if(value.includes('сбп')||value.includes('qr'))return'по СБП';
    if(value.includes('карт')||value.includes('банк')||value.includes('безнал'))return'безналично';
    return'';
  }

  async function announceReturn(data,requestBody={}){
    const id=String(data?.return?.id||data?.return?.name||data?.id||'').trim();
    if(!id||id===lastReturnId)return;
    lastReturnId=id;
    const amount=Math.max(0,Number(data?.amount||0));
    const method=paymentSpeech(requestBody?.payment_method);
    const sum=amount?` Сумма возврата — ${moneySpeech(amount)}.`:'';
    const way=method?` Возврат выполнен ${method}.`:'';
    await say(`Возврат проведён.${sum}${way} Операция завершена.`,{key:`return:${id}`,cooldown:86400000,interrupt:true,priority:'high'});
  }

  function returnPost(input,init={}){
    try{
      const req=input instanceof Request?input:null;
      const url=new URL(req?.url||String(input),location.href);
      const method=String(init?.method||req?.method||'GET').toUpperCase();
      return method==='POST'&&/\/api\/v1\/pos\/returns\/?$/.test(url.pathname);
    }catch{return false}
  }

  function installReturnVoice(){
    if(window.__A4_KASSA_JARVIS_RETURN_VOICE__)return;
    window.__A4_KASSA_JARVIS_RETURN_VOICE__=true;
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async function a4JarvisCashierFetch(input,init={}){
      if(!returnPost(input,init))return nativeFetch(input,init);
      let body={};
      try{
        if(typeof init.body==='string')body=JSON.parse(init.body);
        else if(input instanceof Request){const text=await input.clone().text();body=text?JSON.parse(text):{}}
      }catch{}
      const response=await nativeFetch(input,init);
      if(response.ok){
        response.clone().json().then(data=>{if(data?.success)announceReturn(data,body)}).catch(()=>{});
      }
      return response;
    };
  }

  function friendlyErrorSpeech(raw){
    const text=String(raw||'').replace(/\s+/g,' ').trim();
    const low=text.toLowerCase();
    if(!text)return'';
    if(/возврат/.test(low)&&/(нет связи|не провед|ошиб|abort|синхрон)/.test(low))return'Внимание. Результат возврата пока не подтверждён. Не проводите возврат повторно сразу. Обновите список возвратов и проверьте результат операции.';
    if(/(синхрон|очеред)/.test(low)&&/(ошиб|не удалось|задерж|нет связи|offline|офлайн)/.test(low))return'Ошибка синхронизации. Данные сохранены локально. Джарвис продолжит отправку в фоне.';
    if(/(нет связи|сервер|network|failed to fetch|abort|offline|офлайн)/.test(low))return'Есть проблема связи с сервером. Касса сохранит локальные данные и продолжит синхронизацию после восстановления соединения.';
    if(/смен/.test(low)&&/(ошиб|не удалось|нет связи)/.test(low))return'Не удалось подтвердить операцию со сменой. Проверьте состояние смены перед повторным действием.';
    const compact=text.length>170?text.slice(0,167)+'…':text;
    return`Внимание. ${compact}`;
  }

  function watchToast(){
    const toast=document.getElementById('toast');
    if(!toast)return;
    let previous='';
    const check=()=>{
      if(!toast.classList.contains('show')||!toast.classList.contains('error'))return;
      const raw=String(toast.textContent||'').trim();
      if(!raw||raw===previous)return;
      previous=raw;
      const speech=friendlyErrorSpeech(raw);
      if(speech)say(speech,{key:`error:${speech}`,cooldown:45000,interrupt:true,priority:'high'});
    };
    new MutationObserver(check).observe(toast,{attributes:true,attributeFilter:['class'],childList:true,subtree:true,characterData:true});
    check();
  }

  function isOfflineUi(){
    const banner=document.getElementById('offlineBanner');
    if(banner&&!banner.hidden)return true;
    const chip=String(document.getElementById('networkChip')?.textContent||'').toLowerCase();
    return /офлайн|offline|нет связи/.test(chip);
  }
  function checkNetwork({silentInitial=false}={}){
    const offline=!navigator.onLine||isOfflineUi();
    if(networkState===null){networkState=offline;if(silentInitial)return}
    if(offline===networkState)return;
    networkState=offline;
    if(offline){
      say('Связь с сервером потеряна. Касса продолжит работу локально. Несинхронизированные чеки будут отправлены автоматически после восстановления связи.',{key:'network-offline',cooldown:60000,interrupt:true,priority:'high'});
    }else{
      say('Связь восстановлена. Проверяю синхронизацию чеков.',{key:'network-online',cooldown:30000,priority:'normal'});
      setTimeout(checkQueue,500);
    }
  }
  function watchNetwork(){
    window.addEventListener('offline',()=>checkNetwork());
    window.addEventListener('online',()=>checkNetwork());
    const targets=[document.getElementById('offlineBanner'),document.getElementById('networkChip')].filter(Boolean);
    if(targets.length){
      const observer=new MutationObserver(()=>checkNetwork());
      for(const target of targets)observer.observe(target,{attributes:true,attributeFilter:['hidden','class'],childList:true,subtree:true,characterData:true});
    }
    checkNetwork({silentInitial:true});
  }

  async function checkQueue(){
    if(!DB?.getAll)return;
    try{
      const rows=await DB.getAll('queue');
      const failed=(rows||[]).filter(row=>String(row?.last_error||'').trim());
      if(failed.length){
        const ids=failed.map(row=>String(row.id||'')).sort().join('|');
        const key=`${ids}:${failed.length}`;
        if(key!==queueIssueKey){
          queueIssueKey=key;queueHadProblem=true;
          say(`Синхронизация задерживается. В очереди ${failed.length} ${plural(failed.length,'чек','чека','чеков')}. Данные сохранены локально, повторная отправка будет выполнена автоматически.`,{key:`queue-problem:${key}`,cooldown:300000,priority:'high'});
        }
        return;
      }
      queueIssueKey='';
      if(queueHadProblem){
        queueHadProblem=false;
        say('Синхронизация восстановлена. Очередь чеков успешно отправлена.',{key:'queue-restored',cooldown:30000,priority:'normal'});
      }
    }catch{}
  }

  function watchQueue(){
    window.addEventListener('a4:kassa-queue-recovered',()=>setTimeout(checkQueue,250));
    window.addEventListener('focus',()=>setTimeout(checkQueue,300));
    clearInterval(queueTimer);
    queueTimer=setInterval(()=>{if(!document.hidden)checkQueue()},7000);
    setTimeout(checkQueue,1200);
  }

  function watchShiftSync(){
    let warned=false;
    window.addEventListener('a4:kassa-shift',event=>{
      const detail=event?.detail||{};
      const reason=String(detail.reason||'');
      if(reason==='sync-error'){
        warned=true;
        say('Смена открыта локально, но синхронизация с МойСклад задерживается. Можно продолжать работу. Джарвис повторит синхронизацию автоматически.',{key:'shift-sync-error',cooldown:90000,priority:'high'});
      }else if(reason==='sync-complete'&&warned){
        warned=false;
        say('Синхронизация смены с МойСклад восстановлена.',{key:'shift-sync-restored',cooldown:30000,priority:'normal'});
      }
    });
  }

  function init(){
    installReturnVoice();
    watchToast();
    watchNetwork();
    watchQueue();
    watchShiftSync();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
