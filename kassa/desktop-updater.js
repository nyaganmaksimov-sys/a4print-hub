(()=>{
  'use strict';
  if(window.__A4_KASSA_DESKTOP_UPDATER__)return;
  window.__A4_KASSA_DESKTOP_UPDATER__=true;
  const api=window.A4KassaDesktop?.updater;
  if(!api)return;

  let state={status:'idle',currentVersion:window.A4KassaDesktop?.version||'—',percent:0};

  function ensure(){
    let box=document.getElementById('a4DesktopUpdateBanner');
    if(box)return box;
    const style=document.createElement('style');
    style.textContent='.a4-desktop-update{position:fixed;right:18px;bottom:18px;z-index:260;width:min(460px,calc(100vw - 36px));background:#fff;border:1px solid #d7e2ea;border-radius:14px;box-shadow:0 18px 50px #0f172a28;padding:14px 16px;display:none}.a4-desktop-update.show{display:block}.a4-desktop-update h4{margin:0 0 5px;font-size:15px}.a4-desktop-update p{margin:0;color:#667085;font-size:11px;line-height:1.45}.a4-update-notes{margin:10px 0 0;padding:10px 12px;background:#f8fafc;border:1px solid #e5eaf0;border-radius:10px}.a4-update-notes b{display:block;margin-bottom:5px;font-size:11px}.a4-update-notes ul{margin:0;padding-left:17px;color:#475467;font-size:10px;line-height:1.5}.a4-update-notes .important{margin-top:7px;color:#087f89;font-weight:800}.a4-desktop-update .bar{height:6px;background:#e8eef2;border-radius:99px;overflow:hidden;margin-top:10px}.a4-desktop-update .bar i{display:block;height:100%;background:#08aebb;width:0}.a4-desktop-update .actions{display:flex;gap:7px;margin-top:11px}.a4-desktop-update button{border:1px solid #d5dee6;background:#fff;border-radius:8px;padding:9px 11px;font-weight:800;cursor:pointer}.a4-desktop-update button.primary{background:#08aebb;border-color:#08aebb;color:#fff}.a4-whats-new-backdrop{position:fixed;inset:0;z-index:300;background:rgba(15,23,42,.55);display:grid;place-items:center;padding:20px}.a4-whats-new-card{width:min(620px,100%);max-height:82vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 28px 90px #0f172a35;padding:24px}.a4-whats-new-card .version{display:inline-block;padding:5px 9px;border-radius:999px;background:#e9fbfc;color:#087f89;font-size:10px;font-weight:900}.a4-whats-new-card h3{margin:10px 0 6px;font-size:24px}.a4-whats-new-card p{margin:0;color:#667085;line-height:1.55}.a4-whats-new-card ul{margin:16px 0 0;padding-left:20px}.a4-whats-new-card li{margin:7px 0;color:#344054;line-height:1.45}.a4-whats-new-card .important{margin-top:14px;padding:10px 12px;background:#ecfeff;border-radius:10px;color:#155e75;font-weight:750}.a4-whats-new-card .actions{display:flex;justify-content:flex-end;margin-top:18px}.a4-whats-new-card button{border:0;border-radius:9px;background:#08aebb;color:#fff;padding:11px 16px;font-weight:900;cursor:pointer}';
    document.head.appendChild(style);
    box=document.createElement('aside');
    box.id='a4DesktopUpdateBanner';
    box.className='a4-desktop-update';
    document.body.appendChild(box);
    return box;
  }


  function notesHtml(notes){
    if(!notes)return'';
    const items=Array.isArray(notes.changes)?notes.changes:[];
    return '<div class="a4-update-notes">'+
      '<b>'+String(notes.title||'Что изменится')+'</b>'+
      (notes.summary?'<p>'+String(notes.summary)+'</p>':'')+
      (items.length?'<ul>'+items.map(x=>'<li>'+String(x)+'</li>').join('')+'</ul>':'')+
      (notes.important?'<div class="important">'+String(notes.important)+'</div>':'')+
      '</div>';
  }

  function showWhatsNew(notes){
    if(!notes||document.getElementById('a4WhatsNewBackdrop'))return;
    const wrap=document.createElement('div');
    wrap.id='a4WhatsNewBackdrop';
    wrap.className='a4-whats-new-backdrop';
    const items=Array.isArray(notes.changes)?notes.changes:[];
    wrap.innerHTML='<div class="a4-whats-new-card">'+
      '<span class="version">Версия '+String(notes.version||state.currentVersion||'')+'</span>'+
      '<h3>Что нового</h3>'+
      '<p>'+String(notes.summary||notes.title||'Обновление установлено.')+'</p>'+
      (items.length?'<ul>'+items.map(x=>'<li>'+String(x)+'</li>').join('')+'</ul>':'')+
      (notes.important?'<div class="important">'+String(notes.important)+'</div>':'')+
      '<div class="actions"><button type="button" data-whats-new-close>Понятно</button></div></div>';
    document.body.appendChild(wrap);
  }

  function render(next){
    state={...state,...(next||{})};
    window.__A4_KASSA_UPDATE_STATE__=state;
    window.dispatchEvent(new CustomEvent('a4:kassa-update-state',{detail:state}));
    const box=ensure();
    if(!['available','downloading','downloaded','error'].includes(state.status)){
      box.classList.remove('show');
      return;
    }

    const title=
      state.status==='available'?'Доступно обновление '+(state.availableVersion||''):
      state.status==='downloading'?'Скачиваем обновление…':
      state.status==='downloaded'?'Обновление готово':
      'Не удалось проверить обновление';

    const text=
      state.status==='available'?'Можно скачать новую версию кассы, не закрывая смену.':
      state.status==='downloading'?'Загружено '+Number(state.percent||0)+'%.':
      state.status==='downloaded'?'Нажмите «Перезапустить и установить».':
      (state.message||'Повторите проверку позже.');

    let actions='';
    if(state.status==='available')actions='<button class="primary" data-updater-download>Скачать</button><button data-updater-hide>Позже</button>';
    else if(state.status==='downloaded')actions='<button class="primary" data-updater-install>Перезапустить и установить</button><button data-updater-hide>Позже</button>';
    else if(state.status==='error')actions='<button class="primary" data-updater-check>Повторить</button><button data-updater-hide>Закрыть</button>';

    const visibleNotes=state.releaseNotes||null;
    box.innerHTML='<h4>'+title+'</h4><p>'+text+'</p>'+notesHtml(visibleNotes)+
      (state.status==='downloading'?'<div class="bar"><i style="width:'+Number(state.percent||0)+'%"></i></div>':'')+
      '<div class="actions">'+actions+'</div>';
    box.classList.add('show');
  }

  document.addEventListener('click',async event=>{
    if(event.target.closest('[data-updater-download]'))render(await api.download());
    else if(event.target.closest('[data-updater-install]'))await api.install();
    else if(event.target.closest('[data-updater-check]'))render(await api.check());
    else if(event.target.closest('[data-updater-hide]'))ensure().classList.remove('show');
    else if(event.target.closest('[data-whats-new-close]')){
      document.getElementById('a4WhatsNewBackdrop')?.remove();
      await api.markWhatsNewSeen();
    }
  });

  function renderSettingsCard(){
    const grid=document.querySelector('#utilityDrawer.a4-settings-mode .a4-sh-grid');
    if(!grid||document.getElementById('a4DesktopUpdateCard'))return;
    const card=document.createElement('section');
    card.id='a4DesktopUpdateCard';
    card.className='a4-sh-card wide';
    card.innerHTML='<h3>Обновление программы</h3><p>Установлена версия '+(window.A4KassaDesktop?.version||'—')+'.</p><div class="a4-sh-actions"><button id="a4UpdateCheck" class="a4-sh-btn primary">Проверить обновления</button><button id="a4UpdateDownload" class="a4-sh-btn" hidden>Скачать обновление</button><button id="a4UpdateInstall" class="a4-sh-btn primary" hidden>Перезапустить и установить</button></div><div id="a4UpdateStatus" class="a4-cash-msg"></div>';
    grid.appendChild(card);
    const paint=()=>{
      const s=state||{};
      const status=document.getElementById('a4UpdateStatus');
      const download=document.getElementById('a4UpdateDownload');
      const install=document.getElementById('a4UpdateInstall');
      if(!status)return;
      status.textContent=
        s.status==='available'?'Доступна версия '+(s.availableVersion||''):
        s.status==='downloading'?'Скачивание: '+Number(s.percent||0)+'%':
        s.status==='downloaded'?'Обновление скачано и готово к установке.':
        s.status==='current'?'Установлена актуальная версия.':
        s.status==='checking'?'Проверяем обновления…':
        s.status==='error'?'Ошибка: '+(s.message||'не удалось проверить обновление'):
        'Нажмите «Проверить обновления».';
      if(download)download.hidden=s.status!=='available';
      if(install)install.hidden=s.status!=='downloaded';
    };
    card.querySelector('#a4UpdateCheck')?.addEventListener('click',async()=>render(await api.check()));
    card.querySelector('#a4UpdateDownload')?.addEventListener('click',async()=>render(await api.download()));
    card.querySelector('#a4UpdateInstall')?.addEventListener('click',()=>api.install());
    paint();
  }

  const settingsObserver=new MutationObserver(()=>renderSettingsCard());
  settingsObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});

  api.onState(next=>{render(next);renderSettingsCard();if(next?.showWhatsNew&&next?.whatsNew)showWhatsNew(next.whatsNew)});
  api.state().then(next=>{render(next);renderSettingsCard();if(next?.showWhatsNew&&next?.whatsNew)showWhatsNew(next.whatsNew)}).catch(()=>{});
})();