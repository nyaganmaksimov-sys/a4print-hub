(()=>{
  'use strict';
  if(window.__A4_KASSA_JARVIS_WORKDAY__)return;
  window.__A4_KASSA_JARVIS_WORKDAY__=true;

  const cfg=window.A4PRINT_CONFIG||{};
  const createClient=window.supabase?.createClient;
  const voice=window.A4VoiceEngine;
  const DB=window.A4KassaDB;
  if(!createClient||!voice){console.warn('A4PRINT KASSA: Jarvis voice dependencies unavailable');return}

  const client=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{global:{fetch:window.A4SupabaseFetch||fetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const VOICE_KEY='a4_kassa_voice_enabled_v3';
  const GREETED_KEY='a4_kassa_greeted_shifts_v3';
  const REMINDERS_KEY='a4_kassa_workday_reminders_v3';
  const SHIFT_STATS_KEY='a4_kassa_current_shift_stats_v1';
  const MOSCOW_TZ='Europe/Moscow';
  const REMINDERS=[
    {hours:4,text:'Вы работаете уже четыре часа. Если есть возможность, сделайте короткий перерыв и немного отдохните.'},
    {hours:8,text:'Рабочий день уже восемь часов. Основная смена отработана. Проверьте, что действительно нужно закончить сегодня.'},
    {hours:10,text:'Смена длится уже десять часов. По возможности начинайте завершать рабочий день и оставьте некритичные задачи на завтра.'},
    {hours:12,text:'Рабочий день уже двенадцать часов. Закройте только действительно важные задачи и завершайте смену.'}
  ];

  let openedAt=null;
  let closingOpenedAt=null;
  let activeShiftKey='';
  let initializedActiveShift=false;
  let closeAnnouncementStarted=false;
  let timer=null;
  let pendingGreeting=null;
  let greetingInFlight=false;

  function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}}
  function writeJson(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
  function voiceEnabled(){try{return localStorage.getItem(VOICE_KEY)!=='0'}catch{return true}}
  function setVoiceEnabled(value){try{localStorage.setItem(VOICE_KEY,value?'1':'0')}catch{}render()}

  async function tokenProvider(){const {data,error}=await client.auth.getSession();if(error)throw error;return data?.session?.access_token||''}

  function parseMoment(raw){
    const value=String(raw||'').trim();if(!value)return null;
    let normalized=value.replace(' ','T');
    if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(normalized))normalized+='+03:00';
    const date=new Date(normalized);return Number.isNaN(date.getTime())?null:date;
  }
  function moscowTime(date=new Date()){return new Intl.DateTimeFormat('ru-RU',{timeZone:MOSCOW_TZ,hour:'2-digit',minute:'2-digit'}).format(date)}
  function moscowHour(date=new Date()){const p=new Intl.DateTimeFormat('en-GB',{timeZone:MOSCOW_TZ,hour:'2-digit',hourCycle:'h23'}).formatToParts(date);return Number(p.find(x=>x.type==='hour')?.value||12)}
  function dayGreeting(){const h=moscowHour();if(h>=5&&h<12)return'Доброе утро';if(h>=12&&h<18)return'Добрый день';return'Добрый вечер'}

  function operatorInfo(){
    const select=document.getElementById('operatorSelect');const option=select?.selectedOptions?.[0];
    const id=String(option?.value||select?.value||'operator').trim()||'operator';
    let name=String(option?.textContent||document.getElementById('uiCashierName')?.textContent||'оператор').replace(/\s*·\s*вы\s*$/i,'').trim();
    if(!name||(/выберите|оператор/i.test(name)&&name.length<12))name='оператор';
    return{id,name};
  }
  function shiftKey(detail={}){
    const id=String(detail.shift?.id||window.A4KassaShiftSession?.remoteShift?.id||'').trim();if(id)return id;
    const raw=detail.openedAt||window.A4KassaShiftSession?.openedAt||openedAt?.toISOString()||'';return raw?`shift-${raw}`:'shift-current';
  }
  function elapsedMs(){return openedAt?Math.max(0,Date.now()-openedAt.getTime()):0}
  function durationText(ms){const minutes=Math.max(0,Math.floor(ms/60000));const hours=Math.floor(minutes/60),rest=minutes%60;if(!hours)return`${minutes} ${minutes%10===1&&minutes%100!==11?'минута':'минут'}`;return rest?`${hours} ч ${rest} мин`:`${hours} ч`}
  function plural(n,one,few,many){const value=Math.abs(Math.trunc(Number(n)||0));const n10=value%10,n100=value%100;if(n10===1&&n100!==11)return one;if(n10>=2&&n10<=4&&(n100<12||n100>14))return few;return many}
  function durationSpeech(ms){const minutes=Math.max(0,Math.floor(ms/60000));const hours=Math.floor(minutes/60),rest=minutes%60;const parts=[];if(hours)parts.push(`${hours} ${plural(hours,'час','часа','часов')}`);if(rest||!hours)parts.push(`${rest} ${plural(rest,'минута','минуты','минут')}`);return parts.join(' ')}
  function moneySpeech(value){
    const kopecks=Math.max(0,Math.round(Number(value||0)*100));const rub=Math.floor(kopecks/100),kop=kopecks%100;
    const base=`${rub.toLocaleString('ru-RU')} ${plural(rub,'рубль','рубля','рублей')}`;
    return kop?`${base} ${kop} ${plural(kop,'копейка','копейки','копеек')}`:base;
  }

  async function say(text,options={}){
    if(!voiceEnabled())return false;
    try{return await voice.speak(text,{profile:'male',apiBaseUrl:String(cfg.apiBaseUrl||'').replace(/\/$/,''),tokenProvider,interrupt:!!options.interrupt,priority:options.priority||'normal'})}
    catch(error){console.warn('A4PRINT KASSA Jarvis voice:',error);return false}
  }

  function greetedMap(){const data=readJson(GREETED_KEY,{});return data&&typeof data==='object'?data:{}}
  function reminderMap(){const data=readJson(REMINDERS_KEY,{});return data&&typeof data==='object'?data:{}}
  function pruneMap(map,max=80){const entries=Object.entries(map);return entries.length<=max?map:Object.fromEntries(entries.slice(-max))}
  function greetedUnique(detail={}){const operator=operatorInfo();return`${shiftKey(detail)}:${operator.id}`}
  function isGreeted(detail={}){return!!greetedMap()[greetedUnique(detail)]}
  function markGreeted(detail={}){const all=greetedMap();all[greetedUnique(detail)]=Date.now();writeJson(GREETED_KEY,pruneMap(all))}

  function markPastReminders(key,elapsed){
    if(!key)return;const all=reminderMap();const seen=new Set(Array.isArray(all[key])?all[key]:[]);
    for(const item of REMINDERS)if(elapsed>=item.hours*3600000)seen.add(item.hours);
    all[key]=[...seen].sort((a,b)=>a-b);writeJson(REMINDERS_KEY,pruneMap(all));
  }

  async function maybeRemind(){
    if(!openedAt||!activeShiftKey)return;const elapsed=elapsedMs();const all=reminderMap();const seen=new Set(Array.isArray(all[activeShiftKey])?all[activeShiftKey]:[]);
    for(const item of REMINDERS){
      if(elapsed<item.hours*3600000||seen.has(item.hours))continue;
      const played=await say(item.text,{priority:item.hours>=10?'high':'normal'});
      if(played){seen.add(item.hours);all[activeShiftKey]=[...seen].sort((a,b)=>a-b);writeJson(REMINDERS_KEY,pruneMap(all))}
      break;
    }
  }

  function emptyStats(detail={}){
    const start=parseMoment(detail.openedAt)||parseMoment(detail.shift?.openDate)||openedAt||new Date();
    return{session_key:`${start.toISOString()}:${operatorInfo().id}`,opened_at:start.toISOString(),shift_ids:[],sales_ids:[],return_ids:[],sales_count:0,sales_total:0,sales_cash:0,sales_cashless:0,returns_count:0,returns_total:0,updated_at:new Date().toISOString()};
  }
  function currentStats(){const value=readJson(SHIFT_STATS_KEY,null);return value&&typeof value==='object'?value:null}
  function saveStats(stats){if(!stats)return;stats.updated_at=new Date().toISOString();writeJson(SHIFT_STATS_KEY,stats)}
  function clearStats(){try{localStorage.removeItem(SHIFT_STATS_KEY)}catch{}}
  function ensureStats(detail={}){
    let stats=currentStats();
    if(!stats){stats=emptyStats(detail);saveStats(stats)}
    const id=String(detail.shift?.id||window.A4KassaShiftSession?.remoteShift?.id||'').trim();
    if(id&&!stats.shift_ids.includes(id)){stats.shift_ids.push(id);saveStats(stats)}
    return stats;
  }
  function saleBelongsToCurrent(sale,stats){
    const saleShift=String(sale?.shift?.id||sale?.moysklad_shift_id||'').trim();
    if(!saleShift)return Boolean(window.A4KassaShiftSession?.active);
    const gateId=String(window.A4KassaShiftSession?.remoteShift?.id||'').trim();
    return stats?.shift_ids?.includes(saleShift)||Boolean(gateId&&saleShift===gateId);
  }
  function isCash(method){const value=String(method||'').trim().toLowerCase();return value==='cash'||(/^налич/.test(value)&&!/^безнал/.test(value))}
  function recordSale(sale,{announce=false,seed=false}={}){
    if(!sale?.id)return false;
    const stats=ensureStats({shift:window.A4KassaShiftSession?.remoteShift,openedAt:window.A4KassaShiftSession?.openedAt});
    if(seed&&!saleBelongsToCurrent(sale,stats))return false;
    if(stats.sales_ids.includes(String(sale.id)))return false;
    const amount=Math.max(0,Number(sale?.backend_result?.sum??sale?.total??0));
    stats.sales_ids.push(String(sale.id));if(stats.sales_ids.length>500)stats.sales_ids=stats.sales_ids.slice(-500);
    stats.sales_count+=1;stats.sales_total+=amount;
    if(isCash(sale.payment_method))stats.sales_cash+=amount;else stats.sales_cashless+=amount;
    const saleShift=String(sale?.shift?.id||'').trim();if(saleShift&&!stats.shift_ids.includes(saleShift))stats.shift_ids.push(saleShift);
    saveStats(stats);
    if(announce)queueMicrotask(()=>announceSale(sale));
    return true;
  }
  function recordReturn(result,info={}){
    const id=String(result?.return?.id||result?.return?.name||result?.id||'').trim();if(!id)return false;
    const stats=ensureStats({shift:window.A4KassaShiftSession?.remoteShift,openedAt:window.A4KassaShiftSession?.openedAt});
    if(stats.return_ids.includes(id))return false;
    stats.return_ids.push(id);if(stats.return_ids.length>300)stats.return_ids=stats.return_ids.slice(-300);
    stats.returns_count+=1;stats.returns_total+=Math.max(0,Number(result?.amount||0));saveStats(stats);return true;
  }
  async function announceSale(sale){
    if(!voiceEnabled())return;
    const amount=Math.max(0,Number(sale?.backend_result?.sum??sale?.total??0));
    const amountText=amount>0?` Сумма чека — ${moneySpeech(amount)}.`:'';
    await say(`Продажа прошла.${amountText} Спасибо за покупку. Хорошего дня!`,{interrupt:true,priority:'high'});
  }
  function closeReport(stats,elapsed,operator){
    const s=stats||{sales_count:0,sales_total:0,sales_cash:0,sales_cashless:0,returns_count:0,returns_total:0};
    const name=operator?.name&&operator.name!=='оператор'?`${operator.name}, `:'';
    const pieces=['Смена закрыта.'];
    if(Number(s.sales_count||0)>0){
      pieces.push(`Итоги за смену: ${s.sales_count} ${plural(s.sales_count,'продажа','продажи','продаж')} на сумму ${moneySpeech(s.sales_total)}.`);
      pieces.push(`Наличными — ${moneySpeech(s.sales_cash)}, безналично — ${moneySpeech(s.sales_cashless)}.`);
    }else pieces.push('За смену продаж не было.');
    if(Number(s.returns_count||0)>0)pieces.push(`Возвратов — ${s.returns_count}, на сумму ${moneySpeech(s.returns_total)}.`);
    const net=Math.max(0,Number(s.sales_total||0)-Number(s.returns_total||0));
    if(Number(s.sales_count||0)>0||Number(s.returns_count||0)>0)pieces.push(`Чистая выручка — ${moneySpeech(net)}.`);
    pieces.push(`Рабочее время — ${durationSpeech(elapsed)}.`);
    pieces.push(`${name}спасибо за работу. Смена завершена. Хорошего отдыха!`);
    return pieces.join(' ');
  }
  async function announceClose(elapsed){
    if(closeAnnouncementStarted)return;closeAnnouncementStarted=true;
    const stats=currentStats();const operator=operatorInfo();
    try{await say(closeReport(stats,elapsed,operator),{interrupt:true,priority:'high'})}
    finally{clearStats()}
  }

  function installSaleTracker(){
    if(!DB?.put||DB.put.__a4JarvisSaleTracker)return;
    const nativePut=DB.put.bind(DB);
    const wrapped=async function(name,value){
      const result=await nativePut(name,value);
      try{if(name==='queue'&&value?.stage==='queued')recordSale(value,{announce:true})}catch(error){console.warn('A4PRINT KASSA Jarvis sale tracker:',error)}
      return result;
    };
    wrapped.__a4JarvisSaleTracker=true;DB.put=wrapped;
  }
  function installReturnTracker(){
    if(window.__A4_KASSA_JARVIS_RETURN_TRACKER__)return;window.__A4_KASSA_JARVIS_RETURN_TRACKER__=true;
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async function a4JarvisReturnTracker(input,init={}){
      let match=false,body={};
      try{
        const raw=input instanceof Request?input.url:String(input);const url=new URL(raw,location.href);const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
        match=method==='POST'&&/\/api\/v1\/pos\/returns\/?$/.test(url.pathname);
        if(match&&typeof init.body==='string')body=JSON.parse(init.body);
      }catch{}
      const response=await nativeFetch(input,init);
      if(match&&response.ok)response.clone().json().then(data=>{if(data?.success)recordReturn(data,{payment_method:body?.payment_method})}).catch(()=>{});
      return response;
    };
  }
  async function seedStatsFromDb(){
    if(!DB?.getAll||!window.A4KassaShiftSession?.active)return;
    try{
      ensureStats({shift:window.A4KassaShiftSession.remoteShift,openedAt:window.A4KassaShiftSession.openedAt});
      const [receipts,queue]=await Promise.all([DB.getAll('receipts').catch(()=>[]),DB.getAll('queue').catch(()=>[])]);
      for(const sale of [...(receipts||[]),...(queue||[])])recordSale(sale,{seed:true,announce:false});
    }catch(error){console.warn('A4PRINT KASSA Jarvis shift stats seed:',error)}
  }

  function ensureUi(){
    const footer=document.querySelector('.footer-status');if(!footer)return;
    if(!document.getElementById('workdayChip')){const work=document.createElement('button');work.id='workdayChip';work.className='footer-chip';work.type='button';work.title='Рабочее время считается по Москве';work.innerHTML='<i></i><span>Работа · МСК</span>';footer.insertBefore(work,footer.firstChild)}
    if(!document.getElementById('kassaVoiceChip')){
      const sound=document.createElement('button');sound.id='kassaVoiceChip';sound.className='footer-chip';sound.type='button';sound.title='Включить или выключить голос Джарвиса';sound.innerHTML='<i></i><span>Джарвис</span>';
      document.getElementById('workdayChip')?.insertAdjacentElement('afterend',sound);
      sound.addEventListener('click',async()=>{const next=!voiceEnabled();setVoiceEnabled(next);if(next){await voice.unlock?.();await say('Голос включён. Джарвис на связи.',{interrupt:true,priority:'high'});retryGreeting()}else voice.stop()});
    }
    if(!document.getElementById('a4WorkdayStyle')){const style=document.createElement('style');style.id='a4WorkdayStyle';style.textContent=`#workdayChip[data-long="1"]{font-weight:800}#workdayChip[data-long="1"] i{background:#f59e0b!important}#workdayChip[data-long="2"] i{background:#ef4444!important}#kassaVoiceChip[data-off="1"]{opacity:.62}#kassaVoiceChip[data-off="1"] i{background:#94a3b8!important}@media(max-width:720px){#workdayChip span,#kassaVoiceChip span{font-size:10px}}`;document.head.appendChild(style)}
  }

  function render(){
    ensureUi();const work=document.getElementById('workdayChip'),sound=document.getElementById('kassaVoiceChip');
    if(sound){sound.dataset.off=voiceEnabled()?'0':'1';sound.querySelector('span').textContent=voiceEnabled()?'Джарвис 🔊':'Джарвис 🔇'}
    if(!work)return;
    if(!openedAt){work.dataset.long='0';work.querySelector('span').textContent=`Работа · ${moscowTime()} МСК`;work.title='Смена не открыта · московское время';return}
    const elapsed=elapsedMs();work.dataset.long=elapsed>=10*3600000?'2':elapsed>=8*3600000?'1':'0';work.querySelector('span').textContent=`Работа ${durationText(elapsed)} · МСК`;work.title=`Смена началась в ${moscowTime(openedAt)} МСК · длительность ${durationText(elapsed)}`;
  }

  async function greet(detail={}){
    if(greetingInFlight||!openedAt||isGreeted(detail))return true;
    greetingInFlight=true;pendingGreeting=detail;
    try{
      const operator=operatorInfo();const start=parseMoment(detail.openedAt)||openedAt||new Date();const name=operator.name==='оператор'?'':`, ${operator.name}`;
      const played=await say(`${dayGreeting()}${name}. Джарвис на связи. Смена открыта в ${moscowTime(start)} по московскому времени. Желаю удачного и продуктивного рабочего дня.`,{interrupt:true,priority:'high'});
      if(played){markGreeted(detail);pendingGreeting=null;return true}
      return false;
    }finally{greetingInFlight=false}
  }

  async function retryGreeting(){if(!pendingGreeting||!openedAt||!voiceEnabled())return;await greet(pendingGreeting)}

  async function handleShift(event){
    const detail=event?.detail||{};
    if(detail.active){
      const nextOpened=parseMoment(detail.openedAt)||parseMoment(detail.shift?.openDate)||openedAt||new Date();
      if(!openedAt){closingOpenedAt=null;closeAnnouncementStarted=false}
      openedAt=nextOpened;activeShiftKey=shiftKey(detail);ensureStats(detail);
      if(detail.reason==='open'){
        initializedActiveShift=true;markPastReminders(activeShiftKey,0);pendingGreeting=detail;render();
        try{await voice.unlock?.()}catch{}
        setTimeout(()=>greet(detail),80);
      }else if(!initializedActiveShift){initializedActiveShift=true;markPastReminders(activeShiftKey,elapsedMs())}
      render();return;
    }
    const previousOpened=openedAt||closingOpenedAt;const reason=String(detail.reason||'');
    if(previousOpened&&!closingOpenedAt)closingOpenedAt=previousOpened;
    openedAt=null;activeShiftKey='';initializedActiveShift=false;pendingGreeting=null;render();
    if((reason==='close'||reason==='sync-close-complete')&&closingOpenedAt){
      const elapsed=Math.max(0,Date.now()-closingOpenedAt.getTime());
      await announceClose(elapsed);closingOpenedAt=null;
    }
  }

  async function init(){
    ensureUi();installSaleTracker();installReturnTracker();
    window.addEventListener('a4:kassa-shift',handleShift);
    window.addEventListener('a4:voice-unlocked',retryGreeting);
    document.addEventListener('pointerdown',()=>{if(pendingGreeting)queueMicrotask(retryGreeting)},{capture:true,passive:true});
    const gate=window.A4KassaShiftSession;
    try{await gate?.ready}catch{}
    if(gate?.active){
      openedAt=parseMoment(gate.openedAt)||parseMoment(gate.remoteShift?.openDate)||new Date();activeShiftKey=shiftKey({shift:gate.remoteShift,openedAt:gate.openedAt});initializedActiveShift=true;markPastReminders(activeShiftKey,elapsedMs());ensureStats({shift:gate.remoteShift,openedAt:gate.openedAt});
      const snapshot={active:true,reason:'restore',shift:gate.remoteShift,openedAt:gate.openedAt};
      if(!isGreeted(snapshot)){pendingGreeting=snapshot;setTimeout(()=>greet(snapshot),250)}
      setTimeout(()=>seedStatsFromDb(),150);
    }else clearStats();
    render();clearInterval(timer);timer=setInterval(()=>{render();if(!document.hidden){maybeRemind();retryGreeting()}},30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();maybeRemind();retryGreeting()}});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
