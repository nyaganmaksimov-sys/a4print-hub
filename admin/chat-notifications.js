(function(){
  if(window.__A4PRINT_CHAT_NOTIFICATIONS_V2__) return;
  window.__A4PRINT_CHAT_NOTIFICATIONS_V2__ = true;
  // Disable the older notification initializer in navigation.js to avoid duplicates.
  window.__A4PRINT_CHAT_NOTIFICATIONS__ = true;

  const BASE_TITLE = document.title;
  const seen = new Set();
  let firstSync = true;
  let supabase = null;
  let profile = null;
  let swRegistration = null;
  let pollTimer = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  function ensureUi(){
    if(document.getElementById('hubChatNotifyBell')) return;
    const wrap = document.createElement('div');
    wrap.id = 'hubChatNotifyCenter';
    wrap.style.cssText = 'position:fixed;right:20px;top:82px;z-index:2147483000;font-family:inherit';
    wrap.innerHTML = `
      <button id="hubChatNotifyBell" type="button" title="Уведомления о сообщениях" style="position:relative;width:52px;height:52px;border:1px solid #cbd5e1;border-radius:16px;background:#fff;box-shadow:0 12px 36px rgba(15,23,42,.20);font-size:24px;cursor:pointer">🔔
        <b id="hubChatNotifyCount" style="display:none;position:absolute;right:-7px;top:-7px;min-width:22px;height:22px;padding:0 5px;border-radius:999px;background:#ef4444;color:#fff;font:800 11px/22px Arial;text-align:center">0</b>
      </button>
      <div id="hubChatNotifyPanel" style="display:none;position:absolute;right:0;top:60px;width:min(400px,calc(100vw - 32px));max-height:540px;overflow:auto;background:#fff;border:1px solid #dbe2ea;border-radius:16px;box-shadow:0 24px 70px rgba(15,23,42,.24);padding:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
          <div><strong style="font-size:16px">Уведомления</strong><div id="hubChatNotifyStatus" style="font-size:11px;color:#64748b;margin-top:2px">Подключение…</div></div>
          <button id="hubChatNotifyTest" type="button" style="border:1px solid #dbe2ea;background:#f8fafc;border-radius:9px;padding:7px 9px;cursor:pointer;font:inherit;font-size:12px;font-weight:800">Тест</button>
        </div>
        <div id="hubChatNotifyList"><div style="padding:22px;text-align:center;color:#94a3b8">Загрузка…</div></div>
      </div>`;
    document.body.appendChild(wrap);

    const bell = document.getElementById('hubChatNotifyBell');
    const panel = document.getElementById('hubChatNotifyPanel');
    bell.onclick = e => { e.stopPropagation(); panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; };
    panel.onclick = e => e.stopPropagation();
    document.addEventListener('click', () => { panel.style.display = 'none'; });
    document.getElementById('hubChatNotifyTest').onclick = () => testNotification();
  }

  function setStatus(text, bad=false){
    const el = document.getElementById('hubChatNotifyStatus');
    if(el){ el.textContent = text; el.style.color = bad ? '#b91c1c' : '#64748b'; }
  }

  function setError(message){
    ensureUi();
    setStatus('Ошибка подключения', true);
    const count = document.getElementById('hubChatNotifyCount');
    if(count){ count.textContent='!'; count.style.display='block'; }
    const list = document.getElementById('hubChatNotifyList');
    if(list) list.innerHTML = `<div style="padding:16px;border-radius:12px;background:#fef2f2;color:#991b1b;font-size:13px">${esc(message || 'Не удалось загрузить уведомления')}</div>`;
  }

  function setCount(n){
    const count = document.getElementById('hubChatNotifyCount');
    if(count){ count.textContent = n > 99 ? '99+' : String(n); count.style.display = n ? 'block' : 'none'; }
    const side = document.getElementById('messageCount');
    if(side){ side.textContent = n > 99 ? '99+' : String(n); side.style.display = n ? 'inline-flex' : 'none'; }
    document.title = n ? `(${n}) ${BASE_TITLE.replace(/^\(\d+\)\s*/, '')}` : BASE_TITLE.replace(/^\(\d+\)\s*/, '');
  }

  function render(rows){
    const list = document.getElementById('hubChatNotifyList');
    if(!list) return;
    if(!rows.length){
      list.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8">Новых сообщений нет</div>';
      return;
    }
    list.innerHTML = rows.map(n => `
      <button type="button" data-chat-notify-id="${esc(n.id)}" style="display:block;width:100%;border:0;border-bottom:1px solid #eef2f7;background:#fff;padding:11px 8px;text-align:left;cursor:pointer;color:#0f172a">
        <strong style="display:block;font-size:13px;margin-bottom:4px">💬 ${esc(n.title || 'Новое сообщение')}</strong>
        <span style="display:block;font-size:12px;color:#475569;line-height:1.4">${esc(n.body || 'Откройте чат')}</span>
        <small style="display:block;color:#94a3b8;margin-top:5px">${new Date(n.created_at).toLocaleString('ru-RU')}</small>
      </button>`).join('');
    list.querySelectorAll('[data-chat-notify-id]').forEach(btn => {
      btn.onclick = async () => {
        try{ await supabase.from('notifications').update({is_read:true}).eq('id', btn.dataset.chatNotifyId); }catch{}
        location.href = './messages.html?v=notify';
      };
    });
  }

  function toast(n){
    let host = document.getElementById('hubChatNotifyToastHost');
    if(!host){
      host = document.createElement('div');
      host.id = 'hubChatNotifyToastHost';
      host.style.cssText = 'position:fixed;right:84px;top:18px;z-index:2147483001;display:grid;gap:10px;max-width:min(390px,calc(100vw - 110px))';
      document.body.appendChild(host);
    }
    const el = document.createElement('button');
    el.type = 'button';
    el.style.cssText = 'border:1px solid #60a5fa;background:#fff;border-radius:15px;padding:14px 16px;box-shadow:0 20px 55px rgba(15,23,42,.26);text-align:left;cursor:pointer;color:#0f172a;font:inherit';
    el.innerHTML = `<strong style="display:block;margin-bottom:5px">💬 ${esc(n.title || 'Новое сообщение')}</strong><span style="font-size:13px;color:#475569;line-height:1.4">${esc(n.body || 'Откройте чат')}</span>`;
    el.onclick = () => { location.href = './messages.html?v=notify'; };
    host.appendChild(el);
    setTimeout(() => el.remove(), 12000);
  }

  async function browserNotify(n){
    if(!('Notification' in window) || Notification.permission !== 'granted') return;
    const options = { body:n.body || 'Новое сообщение', tag:`a4-hub-chat-${n.id}`, renotify:true, data:{url:'./messages.html?v=notify'} };
    try{
      if(swRegistration?.showNotification) await swRegistration.showNotification(n.title || 'A4PRINT HUB', options);
      else new Notification(n.title || 'A4PRINT HUB', options);
    }catch(e){ console.warn('A4 system notification failed', e); }
  }

  function announce(n){
    if(!n || seen.has(n.id)) return;
    seen.add(n.id);
    toast(n);
    browserNotify(n);
  }

  async function sync(announceNew=true){
    if(!supabase || !profile) return;
    const {data,error} = await supabase.from('notifications')
      .select('id,title,body,type,entity_type,entity_id,is_read,created_at')
      .eq('type','CHAT_MESSAGE').eq('is_read',false)
      .order('created_at',{ascending:false}).limit(100);
    if(error) throw error;
    const rows = data || [];
    setCount(rows.length);
    render(rows);
    setStatus(`Работает · проверка каждые 2 сек${Notification.permission === 'granted' ? ' · браузер включён' : ''}`);
    if(firstSync){ rows.forEach(n => seen.add(n.id)); firstSync = false; return; }
    if(announceNew) rows.slice().reverse().forEach(announce);
  }

  async function testNotification(){
    ensureUi();
    const test = {id:`test-${Date.now()}`,title:'A4PRINT HUB',body:'Тест: уведомления внутри HUB работают'};
    toast(test);
    if(!('Notification' in window)) return alert('Этот браузер не поддерживает системные уведомления.');
    if(Notification.permission === 'default') await Notification.requestPermission();
    if(Notification.permission === 'granted'){
      await browserNotify({...test, body:'Тест системного уведомления A4PRINT HUB'});
      setStatus('Тест отправлен · браузерные уведомления разрешены');
    } else {
      setStatus('Уведомления браузера запрещены, внутри HUB работают', true);
    }
  }

  async function init(){
    ensureUi();
    try{
      const mod = await import('./guard.js');
      supabase = mod.supabase;
      const {data:{session}} = await supabase.auth.getSession();
      if(!session){ setError('Нет активной сессии сотрудника'); return; }
      const {data:p,error:pErr} = await supabase.from('users').select('id').eq('auth_user_id',session.user.id).maybeSingle();
      if(pErr) throw pErr;
      if(!p){ setError('Профиль сотрудника не найден'); return; }
      profile = p;

      if('serviceWorker' in navigator){
        try{
          const reg = await navigator.serviceWorker.register('./notification-sw.js?v=20260904-2',{scope:'./'});
          swRegistration = await navigator.serviceWorker.ready || reg;
        }catch(e){ console.warn('A4 notification service worker failed', e); }
      }

      await sync(false);
      if(pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => sync(true).catch(e => setStatus('Ошибка обновления · повторяем…', true)), 2000);
      window.addEventListener('focus', () => sync(true).catch(()=>{}));
      document.addEventListener('visibilitychange', () => { if(!document.hidden) sync(true).catch(()=>{}); });
    }catch(e){
      console.error('A4 notification center init failed', e);
      setError(e?.message || 'Не удалось запустить уведомления');
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
