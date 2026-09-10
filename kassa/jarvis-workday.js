(()=>{
  'use strict';
  if(window.__A4_KASSA_JARVIS_WORKDAY__)return;
  window.__A4_KASSA_JARVIS_WORKDAY__=true;

  const cfg=window.A4PRINT_CONFIG||{};
  const createClient=window.supabase?.createClient;
  const voice=window.A4VoiceEngine;
  if(!createClient||!voice)return;

  const client=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
    global:{fetch:window.A4SupabaseFetch||fetch},
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });

  const VOICE_KEY='a4_kassa_voice_enabled_v2';
  const GREETED_KEY='a4_kassa_greeted_shifts_v2';
  const REMINDERS_KEY='a4_kassa_workday_reminders_v2';
  const MOSCOW_TZ='Europe/Moscow';
  const REMINDERS=[
    {hours:4,profile:'female',text:'Вы работаете уже четыре часа. Если есть возможность, сделайте короткий перерыв и немного отдохните.'},
    {hours:8,profile:'female',text:'Рабочий день уже восемь часов. Основная смена отработана. Проверьте, что действительно нужно закончить сегодня.'},
    {hours:10,profile:'female',text:'Смена длится уже десять часов. По возможности начинайте завершать рабочий день и оставьте некритичные задачи на завтра.'},
    {hours:12,profile:'female',text:'Рабочий день уже двенадцать часов. Закройте только действительно важные задачи и, пожалуйста, завершайте смену.'}
  ];

  let openedAt=null;
  let activeShiftKey='';
  let initializedActiveShift=false;
  let timer=null;

  function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}}
  function writeJson(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
  function voiceEnabled(){try{return localStorage.getItem(VOICE_KEY)!=='0'}catch{return true}}
  function setVoiceEnabled(value){try{localStorage.setItem(VOICE_KEY,value?'1':'0')}catch{}render()}

  async function tokenProvider(){
    const {data,error}=await client.auth.getSession();
    if(error)throw error;
    return data?.session?.access_token||'';
  }

  function parseMoment(raw){
    const value=String(raw||'').trim();
    if(!value)return null;
    let normalized=value.replace(' ','T');
    if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(normalized))normalized+='+03:00';
    const date=new Date(normalized);
    return Number.isNaN(date.getTime())?null:date;
  }

  function moscowTime(date=new Date()){
    return new Intl.DateTimeFormat('ru-RU',{timeZone:MOSCOW_TZ,hour:'2-digit',minute:'2-digit'}).format(date);
  }

  function moscowHour(date=new Date()){
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:MOSCOW_TZ,hour:'2-digit',hourCycle:'h23'}).formatToParts(date);
    return Number(parts.find(x=>x.type==='hour')?.value||12);
  }

  function dayGreeting(){
    const hour=moscowHour();
    if(hour>=5&&hour<12)return'Доброе утро';
    if(hour>=12&&hour<18)return'Добрый день';
    return'Добрый вечер';
  }

  function operatorInfo(){
    const select=document.getElementById('operatorSelect');
    const option=select?.selectedOptions?.[0];
    const id=String(option?.value||select?.value||'operator').trim()||'operator';
    let name=String(option?.textContent||document.getElementById('uiCashierName')?.textContent||'оператор').replace(/\s*·\s*вы\s*$/i,'').trim();
    if(!name||/выберите|оператор/i.test(name)&&name.length<12)name='оператор';
    return{id,name};
  }

  function shiftKey(detail={}){
    const id=String(detail.shift?.id||window.A4KassaShiftSession?.remoteShift?.id||'').trim();
    if(id)return id;
    const raw=detail.openedAt||window.A4KassaShiftSession?.openedAt||openedAt?.toISOString()||'';
    return raw?`shift-${raw}`:'shift-current';
  }

  function elapsedMs(){return openedAt?Math.max(0,Date.now()-openedAt.getTime()):0}
  function durationText(ms){
    const minutes=Math.max(0,Math.floor(ms/60000));
    const hours=Math.floor(minutes/60),rest=minutes%60;
    if(!hours)return`${minutes} ${minutes%10===1&&minutes%100!==11?'минута':'минут'}`;
    return rest?`${hours} ч ${rest} мин`:`${hours} ч`;
  }

  async function say(text,profile='male',options={}){
    if(!voiceEnabled())return false;
    try{
      return await voice.speak(text,{
        profile,
        apiBaseUrl:String(cfg.apiBaseUrl||'').replace(/\/$/,''),
        tokenProvider,
        interrupt:!!options.interrupt,
        priority:options.priority||'normal'
      });
    }catch(error){console.warn('A4PRINT KASSA voice:',error);return false}
  }

  function greetedMap(){const data=readJson(GREETED_KEY,{});return data&&typeof data==='object'?data:{}}
  function reminderMap(){const data=readJson(REMINDERS_KEY,{});return data&&typeof data==='object'?data:{}}
  function pruneMap(map,max=80){const entries=Object.entries(map);if(entries.length<=max)return map;return Object.fromEntries(entries.slice(-max))}

  function markPastReminders(key,elapsed){
    if(!key)return;
    const all=reminderMap();
    const seen=new Set(Array.isArray(all[key])?all[key]:[]);
    for(const item of REMINDERS)if(elapsed>=item.hours*3600000)seen.add(item.hours);
    all[key]=[...seen].sort((a,b)=>a-b);
    writeJson(REMINDERS_KEY,pruneMap(all));
  }

  async function maybeRemind(){
    if(!openedAt||!activeShiftKey)return;
    const elapsed=elapsedMs();
    const all=reminderMap();
    const seen=new Set(Array.isArray(all[activeShiftKey])?all[activeShiftKey]:[]);
    for(const item of REMINDERS){
      if(elapsed<item.hours*3600000||seen.has(item.hours))continue;
      seen.add(item.hours);
      all[activeShiftKey]=[...seen].sort((a,b)=>a-b);
      writeJson(REMINDERS_KEY,pruneMap(all));
      await say(item.text,item.profile,{priority:item.hours>=10?'high':'normal'});
      break;
    }
  }

  function ensureUi(){
    const footer=document.querySelector('.footer-status');
    if(!footer)return;
    if(!document.getElementById('workdayChip')){
      const work=document.createElement('button');
      work.id='workdayChip';work.className='footer-chip';work.type='button';work.title='Рабочее время считается по Москве';
      work.innerHTML='<i></i><span>Работа · МСК</span>';
      footer.insertBefore(work,footer.firstChild);
    }
    if(!document.getElementById('kassaVoiceChip')){
      const sound=document.createElement('button');
      sound.id='kassaVoiceChip';sound.className='footer-chip';sound.type='button';sound.title='Включить или выключить голос Джарвиса и Ксюши';
      sound.innerHTML='<i></i><span>Голос</span>';
      const work=document.getElementById('workdayChip');
      work?.insertAdjacentElement('afterend',sound);
      sound.addEventListener('click',()=>{
        const next=!voiceEnabled();
        setVoiceEnabled(next);
        if(next)say('Голос включён. Джарвис и Ксюша на связи.','male',{interrupt:true});
        else voice.stop();
      });
    }
    if(!document.getElementById('a4WorkdayStyle')){
      const style=document.createElement('style');style.id='a4WorkdayStyle';style.textContent=`
        #workdayChip[data-long="1"]{font-weight:800}#workdayChip[data-long="1"] i{background:#f59e0b!important}
        #workdayChip[data-long="2"] i{background:#ef4444!important}
        #kassaVoiceChip[data-off="1"]{opacity:.62}#kassaVoiceChip[data-off="1"] i{background:#94a3b8!important}
        @media(max-width:720px){#workdayChip span,#kassaVoiceChip span{font-size:10px}}
      `;document.head.appendChild(style);
    }
  }

  function render(){
    ensureUi();
    const work=document.getElementById('workdayChip');
    const sound=document.getElementById('kassaVoiceChip');
    if(sound){sound.dataset.off=voiceEnabled()?'0':'1';sound.querySelector('span').textContent=voiceEnabled()?'Голос 🔊':'Голос 🔇'}
    if(!work)return;
    if(!openedAt){work.dataset.long='0';work.querySelector('span').textContent=`Работа · ${moscowTime()} МСК`;work.title='Смена не открыта · московское время';return}
    const elapsed=elapsedMs();
    work.dataset.long=elapsed>=10*3600000?'2':elapsed>=8*3600000?'1':'0';
    work.querySelector('span').textContent=`Работа ${durationText(elapsed)} · МСК`;
    work.title=`Смена началась в ${moscowTime(openedAt)} МСК · длительность ${durationText(elapsed)}`;
  }

  async function greet(detail){
    const key=shiftKey(detail),operator=operatorInfo();
    const all=greetedMap();
    const unique=`${key}:${operator.id}`;
    if(all[unique])return;
    all[unique]=Date.now();writeJson(GREETED_KEY,pruneMap(all));
    const start=parseMoment(detail.openedAt)||openedAt||new Date();
    const name=operator.name==='оператор'?'':`, ${operator.name}`;
    await say(`${dayGreeting()}${name}. Джарвис на связи. Смена открыта в ${moscowTime(start)} по московскому времени. Желаю удачного и продуктивного рабочего дня.`,'male',{interrupt:true,priority:'high'});
  }

  async function handleShift(event){
    const detail=event?.detail||{};
    if(detail.active){
      openedAt=parseMoment(detail.openedAt)||parseMoment(detail.shift?.openDate)||openedAt||new Date();
      activeShiftKey=shiftKey(detail);
      if(detail.reason==='open'){
        initializedActiveShift=true;
        markPastReminders(activeShiftKey,0);
        render();
        setTimeout(()=>greet(detail),180);
      }else if(!initializedActiveShift){
        initializedActiveShift=true;
        markPastReminders(activeShiftKey,elapsedMs());
      }
      render();
      return;
    }

    const previousOpened=openedAt;
    const operator=operatorInfo();
    openedAt=null;activeShiftKey='';initializedActiveShift=false;render();
    if(detail.reason==='close'&&previousOpened){
      const elapsed=Math.max(0,Date.now()-previousOpened.getTime());
      const name=operator.name==='оператор'?'':`${operator.name}, `;
      await say(`Смена закрыта. ${name}рабочее время за смену — ${durationText(elapsed)}. Спасибо за работу и хорошего отдыха.`,'male',{interrupt:true,priority:'high'});
    }
  }

  async function init(){
    ensureUi();
    try{await window.A4KassaShiftSession?.ready}catch{}
    const gate=window.A4KassaShiftSession;
    if(gate?.active){
      openedAt=parseMoment(gate.openedAt)||parseMoment(gate.remoteShift?.openDate)||new Date();
      activeShiftKey=shiftKey({shift:gate.remoteShift,openedAt:gate.openedAt});
      initializedActiveShift=true;
      markPastReminders(activeShiftKey,elapsedMs());
    }
    render();
    clearInterval(timer);
    timer=setInterval(()=>{render();if(!document.hidden)maybeRemind()},30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();maybeRemind()}});
    window.addEventListener('a4:kassa-shift',handleShift);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
