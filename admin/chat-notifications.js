(function(){
  if(window.__A4PRINT_CHAT_NOTIFICATIONS_V4__)return;
  window.__A4PRINT_CHAT_NOTIFICATIONS_V4__=true;
  window.__A4PRINT_CHAT_NOTIFICATIONS__=true;

  const BASE_TITLE=document.title;
  const seen=new Set();
  const isMobile=window.matchMedia?.('(max-width:760px)').matches||/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent||'');
  const POLL_MS=isMobile?60000:30000;
  let firstSync=true,supabase=null,profile=null,pollTimer=null,realtime=null,audioCtx=null;
  let rowsCache=[],lastSyncAt=0,syncing=false;
  let soundEnabled=localStorage.getItem('a4_chat_sound_enabled')!=='0';

  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const panelOpen=()=>document.getElementById('hubChatNotifyPanel')?.style.display==='block';

  function roomUrl(roomId='',messageId=''){
    const q=new URLSearchParams();
    if(roomId)q.set('room',roomId);
    if(messageId)q.set('message',messageId);
    q.set('v','notify4');
    const here=new URLSearchParams(location.search);
    if(here.get('app')==='1'||window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true)q.set('app','1');
    if(here.get('embed')==='1')q.set('embed','1');
    return `./messages.html?${q.toString()}`;
  }

  async function resolveMessageId(n){
    if(!supabase||!n?.entity_id)return'';
    try{
      const{data,error}=await supabase.from('messages').select('id,body,created_at').eq('room_id',n.entity_id).is('deleted_at',null).order('created_at',{ascending:false}).limit(40);
      if(error||!data?.length)return'';
      const targetText=String(n.body||'').trim();
      const targetTime=Date.parse(n.created_at||'')||0;
      const textMatches=(data||[]).filter(m=>{
        const body=String(m.body||'').trim();
        if(!targetText)return true;
        if(targetText==='Новое сообщение или вложение')return !body;
        return body===targetText||body.slice(0,180)===targetText||body.startsWith(targetText);
      });
      const pool=textMatches.length?textMatches:data;
      pool.sort((a,b)=>{
        const da=targetTime?Math.abs((Date.parse(a.created_at)||0)-targetTime):0;
        const db=targetTime?Math.abs((Date.parse(b.created_at)||0)-targetTime):0;
        return da-db;
      });
      return pool[0]?.id||'';
    }catch(e){console.warn('A4 message target resolve failed',e);return''}
  }

  async function notificationUrl(n){
    const roomId=n?.entity_id||'';
    if(!roomId)return roomUrl();
    const messageId=await resolveMessageId(n);
    return roomUrl(roomId,messageId);
  }

  async function openNotification(n){
    if(!n)return;
    try{if(n.id&&!String(n.id).startsWith('test-'))await supabase?.from('notifications').update({is_read:true}).eq('id',n.id)}catch{}
    const panel=document.getElementById('hubChatNotifyPanel');if(panel)panel.style.display='none';
    location.href=await notificationUrl(n);
  }

  function publishRows(rows){
    window.__A4_CHAT_UNREAD_NOTIFICATIONS__=(rows||[]).slice();
    window.dispatchEvent(new CustomEvent('a4:chat-unread',{detail:{rows:window.__A4_CHAT_UNREAD_NOTIFICATIONS__}}));
  }

  window.__A4_RESOLVE_CHAT_NOTIFICATION_URL__=notificationUrl;
  window.__A4_OPEN_CHAT_NOTIFICATION__=openNotification;

  function ensureUi(){
    if(document.getElementById('hubChatNotifyBell'))return;
    const wrap=document.createElement('div');
    wrap.id='hubChatNotifyCenter';
    wrap.style.cssText='position:fixed;right:20px;top:82px;z-index:2147483000;font-family:inherit';
    wrap.innerHTML=`
      <button id="hubChatNotifyBell" type="button" title="Уведомления" style="position:relative;width:48px;height:48px;border:1px solid #cbd5e1;border-radius:14px;background:#fff;box-shadow:0 10px 28px rgba(15,23,42,.16);font-size:22px;cursor:pointer">🔔
        <b id="hubChatNotifyCount" style="display:none;position:absolute;right:-6px;top:-6px;min-width:21px;height:21px;padding:0 5px;border-radius:999px;background:#ef4444;color:#fff;font:800 11px/21px Arial;text-align:center">0</b>
      </button>
      <div id="hubChatNotifyPanel" style="display:none;position:absolute;right:0;top:56px;width:min(400px,calc(100vw - 24px));max-height:520px;overflow:auto;background:#fff;border:1px solid #dbe2ea;border-radius:15px;box-shadow:0 20px 60px rgba(15,23,42,.22);padding:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
          <div><strong style="font-size:15px">Уведомления</strong><div id="hubChatNotifyStatus" style="font-size:10px;color:#64748b;margin-top:2px">Подключение…</div></div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">
            <button id="hubChatNotifySound" type="button" style="border:1px solid #dbe2ea;background:#f8fafc;border-radius:8px;padding:6px 8px;cursor:pointer;font:inherit;font-size:11px;font-weight:800">🔊</button>
            <button id="hubChatNotifyTest" type="button" style="border:1px solid #dbe2ea;background:#f8fafc;border-radius:8px;padding:6px 8px;cursor:pointer;font:inherit;font-size:11px;font-weight:800">Тест</button>
          </div>
        </div>
        <div id="hubChatNotifyList"><div style="padding:20px;text-align:center;color:#94a3b8">Загрузка…</div></div>
      </div>`;
    document.body.appendChild(wrap);
    const bell=document.getElementById('hubChatNotifyBell'),panel=document.getElementById('hubChatNotifyPanel');
    bell.onclick=async e=>{
      e.stopPropagation();unlockAudio();
      const opening=panel.style.display==='none';
      panel.style.display=opening?'block':'none';
      if(opening){render(rowsCache);if(Date.now()-lastSyncAt>5000)sync(false,true).catch(()=>{})}
    };
    panel.onclick=e=>e.stopPropagation();
    document.addEventListener('click',()=>{panel.style.display='none'});
    document.getElementById('hubChatNotifyTest').onclick=()=>testNotification();
    document.getElementById('hubChatNotifySound').onclick=()=>toggleSound();
    updateSoundButton();
  }

  function updateSoundButton(){const el=document.getElementById('hubChatNotifySound');if(el){el.textContent=soundEnabled?'🔊':'🔇';el.title=soundEnabled?'Звук включён':'Звук выключен'}}
  async function unlockAudio(){if(!soundEnabled)return;try{const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;if(!audioCtx)audioCtx=new Ctx();if(audioCtx.state==='suspended')await audioCtx.resume()}catch{}}
  function tone(freq,start,duration,gainValue){if(!audioCtx||audioCtx.state!=='running')return;const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type='sine';osc.frequency.setValueAtTime(freq,start);gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(gainValue,start+.015);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);osc.connect(gain);gain.connect(audioCtx.destination);osc.start(start);osc.stop(start+duration+.02)}
  async function playSound(){if(!soundEnabled)return;await unlockAudio();if(!audioCtx||audioCtx.state!=='running')return;const t=audioCtx.currentTime+.01;tone(880,t,.11,.1);tone(1175,t+.13,.13,.08)}
  async function toggleSound(){soundEnabled=!soundEnabled;localStorage.setItem('a4_chat_sound_enabled',soundEnabled?'1':'0');updateSoundButton();if(soundEnabled){await unlockAudio();await playSound()}}
  document.addEventListener('pointerdown',()=>unlockAudio(),{once:true,capture:true});

  function setStatus(text,bad=false){const el=document.getElementById('hubChatNotifyStatus');if(el){el.textContent=text;el.style.color=bad?'#b91c1c':'#64748b'}}
  function setError(message){ensureUi();setStatus('Ошибка подключения',true);const count=document.getElementById('hubChatNotifyCount');if(count){count.textContent='!';count.style.display='block'}const list=document.getElementById('hubChatNotifyList');if(list)list.innerHTML=`<div style="padding:14px;border-radius:11px;background:#fef2f2;color:#991b1b;font-size:12px">${esc(message||'Не удалось загрузить уведомления')}</div>`}
  function setCount(n){const count=document.getElementById('hubChatNotifyCount');if(count){count.textContent=n>99?'99+':String(n);count.style.display=n?'block':'none'}const side=document.getElementById('messageCount');if(side){side.textContent=n>99?'99+':String(n);side.style.display=n?'inline-flex':'none'}document.title=n?`(${n}) ${BASE_TITLE.replace(/^\(\d+\)\s*/,'')}`:BASE_TITLE.replace(/^\(\d+\)\s*/,'')}

  function render(rows){
    const list=document.getElementById('hubChatNotifyList');if(!list)return;
    if(!rows.length){list.innerHTML='<div style="padding:22px;text-align:center;color:#94a3b8">Новых сообщений нет</div>';return}
    list.innerHTML=rows.map(n=>`<button type="button" data-chat-notify-id="${esc(n.id)}" style="display:block;width:100%;border:0;border-bottom:1px solid #eef2f7;background:#fff;padding:10px 7px;text-align:left;cursor:pointer;color:#0f172a"><strong style="display:block;font-size:13px;margin-bottom:3px">💬 ${esc(n.title||'Новое сообщение')}</strong><span style="display:block;font-size:12px;color:#475569;line-height:1.35">${esc(n.body||'Откройте чат')}</span><small style="display:block;color:#94a3b8;margin-top:4px">${new Date(n.created_at).toLocaleString('ru-RU')}</small></button>`).join('');
    list.querySelectorAll('[data-chat-notify-id]').forEach(btn=>{btn.onclick=async()=>{const n=rows.find(x=>String(x.id)===String(btn.dataset.chatNotifyId));if(n)await openNotification(n)}})
  }

  function toast(n){
    let host=document.getElementById('hubChatNotifyToastHost');if(!host){host=document.createElement('div');host.id='hubChatNotifyToastHost';host.style.cssText='position:fixed;right:76px;top:16px;z-index:2147483001;display:grid;gap:8px;max-width:min(360px,calc(100vw - 96px))';document.body.appendChild(host)}
    const el=document.createElement('button');el.type='button';el.style.cssText='border:1px solid #93c5fd;background:#fff;border-radius:13px;padding:12px 14px;box-shadow:0 16px 44px rgba(15,23,42,.22);text-align:left;cursor:pointer;color:#0f172a;font:inherit';el.innerHTML=`<strong style="display:block;margin-bottom:4px">💬 ${esc(n.title||'Новое сообщение')}</strong><span style="font-size:12px;color:#475569;line-height:1.35">${esc(n.body||'Откройте чат')}</span>`;el.onclick=async()=>{el.disabled=true;try{await openNotification(n)}finally{el.remove()}};host.appendChild(el);setTimeout(()=>el.remove(),8000)
  }
  function announce(n){if(!n||seen.has(n.id))return;seen.add(n.id);toast(n);playSound()}

  async function sync(announceNew=true,forceRender=false){
    if(!supabase||!profile||syncing)return;syncing=true;
    try{
      const{data,error}=await supabase.from('notifications').select('id,title,body,type,entity_type,entity_id,is_read,created_at').eq('type','CHAT_MESSAGE').eq('is_read',false).order('created_at',{ascending:false}).limit(50);
      if(error)throw error;
      const rows=data||[];rowsCache=rows;publishRows(rows);lastSyncAt=Date.now();setCount(rows.length);
      if(forceRender||panelOpen())render(rows);
      setStatus(`Онлайн · Push + резерв ${Math.round(POLL_MS/1000)} сек${soundEnabled?' · звук':''}`);
      if(firstSync){rows.forEach(n=>seen.add(n.id));firstSync=false;return}
      if(announceNew)rows.slice().reverse().forEach(announce)
    }finally{syncing=false}
  }

  async function testNotification(){
    ensureUi();await unlockAudio();const test={id:`test-${Date.now()}`,title:'A4PRINT HUB',body:'Тест уведомления и звука',entity_id:''};toast(test);await playSound();
    if(!('Notification'in window))return alert('Этот браузер не поддерживает системные уведомления.');
    if(Notification.permission==='default')await Notification.requestPermission();
    if(Notification.permission==='granted'){
      const options={body:'Тест системного уведомления A4PRINT HUB',tag:`a4-test-${Date.now()}`,data:{url:'/admin/messages.html?app=1'}};
      try{const reg=await navigator.serviceWorker.getRegistration('/');if(reg)await reg.showNotification('A4PRINT HUB',options);else new Notification('A4PRINT HUB',options)}catch{}
      setStatus('Тест отправлен');
    }else setStatus('Системные уведомления запрещены',true)
  }

  function startRealtime(){
    try{
      realtime=supabase.channel(`a4-notify-${profile.id}-${Date.now()}`)
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${profile.id}`},payload=>{
          const n=payload.new;if(n?.type==='CHAT_MESSAGE'&&!n?.is_read){rowsCache=[n,...rowsCache.filter(x=>x.id!==n.id)].slice(0,50);publishRows(rowsCache);announce(n);sync(false,panelOpen()).catch(()=>{})}
        })
        .on('postgres_changes',{event:'UPDATE',schema:'public',table:'notifications',filter:`user_id=eq.${profile.id}`},()=>sync(false,panelOpen()).catch(()=>{}))
        .subscribe(status=>{if(status==='SUBSCRIBED')setStatus(`Онлайн · Push + резерв ${Math.round(POLL_MS/1000)} сек${soundEnabled?' · звук':''}`)});
    }catch(e){console.warn('A4 notification realtime unavailable',e)}
  }

  async function init(){
    ensureUi();
    try{
      const mod=await import('./guard.js');supabase=mod.supabase;
      const{data:{session}}=await supabase.auth.getSession();if(!session){setError('Нет активной сессии сотрудника');return}
      const{data:p,error:pErr}=await supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle();if(pErr)throw pErr;if(!p){setError('Профиль сотрудника не найден');return}profile=p;
      await sync(false,true);startRealtime();
      if(pollTimer)clearInterval(pollTimer);
      pollTimer=setInterval(()=>{if(!document.hidden)sync(true,panelOpen()).catch(()=>setStatus('Связь восстанавливается…',true))},POLL_MS);
      window.addEventListener('focus',()=>{if(Date.now()-lastSyncAt>8000)sync(true,panelOpen()).catch(()=>{})});
      document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastSyncAt>8000)sync(true,panelOpen()).catch(()=>{})});
      window.addEventListener('a4:notifications-changed',()=>sync(false,panelOpen()).catch(()=>{}));
    }catch(e){console.error('A4 notification center init failed',e);setError(e?.message||'Не удалось запустить уведомления')}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
