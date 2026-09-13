(()=>{
  if(window.__A4_JARVIS_SETTINGS_UI__)return;
  window.__A4_JARVIS_SETTINGS_UI__=true;

  const KEY='a4print_jarvis_enabled_v1';
  const control=()=>window.A4JarvisControl||{
    isEnabled(){try{return localStorage.getItem(KEY)!=='0'}catch{return true}},
    setEnabled(v){try{localStorage.setItem(KEY,v?'1':'0')}catch{}return !!v}
  };

  function mount(){
    if(!/\/admin\/settings\.html$/.test(location.pathname)||document.getElementById('jarvisMasterCard'))return;
    const column=document.querySelector('.settings-grid > div:first-child');
    if(!column)return;

    const style=document.createElement('style');
    style.id='a4-jarvis-settings-style';
    style.textContent=`
      #jarvisMasterCard .jarvis-master{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px;border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc}
      #jarvisMasterCard .jarvis-master-copy{min-width:0}#jarvisMasterCard .jarvis-master-copy b{display:block;font-size:14px;color:#0f172a}#jarvisMasterCard .jarvis-master-copy small{display:block;margin-top:5px;color:#64748b;font-size:11px;line-height:1.45}
      #jarvisMasterCard .jarvis-switch{position:relative;display:inline-flex;flex:0 0 auto;width:52px;height:30px}#jarvisMasterCard .jarvis-switch input{position:absolute;opacity:0;pointer-events:none}#jarvisMasterCard .jarvis-switch span{position:absolute;inset:0;border-radius:999px;background:#cbd5e1;cursor:pointer;transition:.18s}#jarvisMasterCard .jarvis-switch span:after{content:'';position:absolute;width:24px;height:24px;left:3px;top:3px;border-radius:50%;background:white;box-shadow:0 2px 7px rgba(15,23,42,.18);transition:.18s}#jarvisMasterCard .jarvis-switch input:checked+span{background:#2563eb}#jarvisMasterCard .jarvis-switch input:checked+span:after{transform:translateX(22px)}
      #jarvisMasterCard .jarvis-state{display:flex;align-items:center;gap:8px;margin-top:12px;color:#64748b;font-size:11px;font-weight:750}#jarvisMasterCard .jarvis-state i{width:9px;height:9px;border-radius:50%;background:#94a3b8}#jarvisMasterCard .jarvis-state.on i{background:#22c55e}#jarvisMasterCard .jarvis-state.off i{background:#ef4444}
      #jarvisMasterCard .jarvis-note{margin-top:10px;padding:10px 12px;border-radius:10px;background:#eff6ff;color:#1e40af;font-size:10.5px;line-height:1.45}
    `;
    document.head.appendChild(style);

    const card=document.createElement('div');
    card.className='card section';card.id='jarvisMasterCard';
    card.innerHTML=`<h2>Джарвис</h2><p class="muted">Полное включение и отключение ассистента на этом устройстве.</p><div class="jarvis-master"><div class="jarvis-master-copy"><b>Запускать Джарвиса в HUB</b><small>Голос, wake-word, Sentinel, AI-интерфейс и приветствие при входе.</small></div><label class="jarvis-switch" title="Включить или выключить Джарвиса"><input id="jarvisMasterToggle" type="checkbox"><span></span></label></div><div id="jarvisMasterState" class="jarvis-state"><i></i><span></span></div><div class="jarvis-note">При выключении модули Джарвиса вообще не загружаются. Изменение применяется ко всем открытым вкладкам HUB на этом компьютере после автоматической перезагрузки.</div>`;

    const telegram=[...column.children].find(el=>el.querySelector?.('#tgStatus'));
    if(telegram)column.insertBefore(card,telegram);else column.appendChild(card);

    const toggle=card.querySelector('#jarvisMasterToggle');
    const state=card.querySelector('#jarvisMasterState');
    const render=()=>{const enabled=control().isEnabled();toggle.checked=enabled;state.classList.toggle('on',enabled);state.classList.toggle('off',!enabled);state.querySelector('span').textContent=enabled?'Джарвис включён':'Джарвис полностью выключен'};
    render();
    toggle.addEventListener('change',()=>{
      const enabled=toggle.checked;
      control().setEnabled(enabled);
      render();
      state.querySelector('span').textContent=enabled?'Включаем Джарвиса…':'Выключаем Джарвиса…';
      setTimeout(()=>location.reload(),350);
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();