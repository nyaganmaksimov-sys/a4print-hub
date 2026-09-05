(async()=>{
  if(window.__A4_AUTH_SETTINGS__)return;window.__A4_AUTH_SETTINGS__=true;
  const host=document.querySelector('.settings-grid>div:first-child');if(!host)return;
  const cfg=window.A4PRINT_CONFIG||{};if(!cfg.supabaseUrl||!cfg.supabasePublishableKey)return;
  const style=document.createElement('style');style.textContent=`
    .auth-settings-card{margin-top:20px}.auth-methods{display:grid;gap:10px;margin-top:14px}.auth-method{display:grid;grid-template-columns:minmax(170px,1fr) 110px 130px 140px;align-items:center;gap:12px;padding:13px 14px;border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc}.auth-method-name{display:flex;align-items:center;gap:10px;font-weight:900;color:#172033}.auth-method-icon{width:34px;height:34px;border-radius:10px;background:#fff;border:1px solid #e2e8f0;display:grid;place-items:center}.auth-col-label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-weight:900}.auth-toggle{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;color:#334155}.auth-toggle input{width:18px;height:18px;accent-color:#2563eb}.auth-status{justify-self:start;display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border-radius:999px;font-size:11px;font-weight:900;background:#e2e8f0;color:#475569}.auth-status.ok{background:#dcfce7;color:#166534}.auth-status.bad{background:#fee2e2;color:#b91c1c}.auth-status.wait{background:#fef3c7;color:#92400e}.auth-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px}.auth-settings-msg{font-size:12px}.auth-settings-msg.ok{color:#15803d}.auth-settings-msg.err{color:#b91c1c}@media(max-width:760px){.auth-method{grid-template-columns:1fr 1fr}.auth-method-name{grid-column:1/-1}.auth-status{grid-column:1/-1}.auth-col-label{display:none}}
  `;document.head.appendChild(style);
  const card=document.createElement('section');card.className='card auth-settings-card';card.innerHTML=`
    <h2>Вход и регистрация</h2>
    <p class="muted">Выберите, какие способы показывать сотрудникам. Статус справа показывает, подключён ли сам провайдер в Supabase.</p>
    <div class="auth-methods" id="a4AuthMethods"></div>
    <div class="auth-actions"><button class="btn" id="a4SaveAuth">Сохранить способы входа</button><button class="btn secondary" id="a4RefreshAuth" type="button">Проверить подключение</button><span class="auth-settings-msg" id="a4AuthMsg"></span></div>
  `;host.appendChild(card);
  const methods=[
    {key:'email',label:'Email + пароль',icon:'✉'},
    {key:'google',label:'Google',icon:'G'},
    {key:'yandex',label:'Яндекс',icon:'Я'},
    {key:'mailru',label:'Mail.ru',icon:'@'}
  ];
  const defaults={login:{email:true,google:true,yandex:false,mailru:false},registration:{email:true,google:true,yandex:false,mailru:false}};
  const list=document.getElementById('a4AuthMethods'),msg=document.getElementById('a4AuthMsg');
  list.innerHTML=methods.map(m=>`<div class="auth-method" data-auth-method="${m.key}"><div class="auth-method-name"><span class="auth-method-icon">${m.icon}</span><span>${m.label}</span></div><label class="auth-toggle"><input type="checkbox" data-mode="login"> Вход</label><label class="auth-toggle"><input type="checkbox" data-mode="registration"> Регистрация</label><span class="auth-status wait" data-auth-status>Проверяем…</span></div>`).join('');
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
  const {data:{session}}=await sb.auth.getSession();if(!session){card.remove();return}
  const {data:isAdmin}=await sb.rpc('has_role',{required_role:'ADMIN'});if(!isAdmin){card.remove();return}
  const normalize=raw=>{const out=JSON.parse(JSON.stringify(defaults));for(const mode of ['login','registration'])for(const key of methods.map(m=>m.key))if(typeof raw?.[mode]?.[key]==='boolean')out[mode][key]=raw[mode][key];return out};
  let current=defaults;
  const {data:row}=await sb.from('settings').select('value').eq('key','auth_ui').maybeSingle();current=normalize(row?.value);
  const fill=()=>methods.forEach(m=>{const row=list.querySelector(`[data-auth-method="${m.key}"]`);row.querySelector('[data-mode="login"]').checked=!!current.login[m.key];row.querySelector('[data-mode="registration"]').checked=!!current.registration[m.key]});fill();
  const providerConnected=(settings,key)=>{
    if(key==='email')return true;
    const ext=settings?.external||{};
    if(key==='google')return !!ext.google;
    if(key==='yandex')return !!(ext['custom:yandex']||ext.yandex);
    if(key==='mailru')return !!(ext['custom:mailru']||ext.mailru);
    return false;
  };
  async function refreshStatus(){
    methods.forEach(m=>{const el=list.querySelector(`[data-auth-method="${m.key}"] [data-auth-status]`);el.className='auth-status wait';el.textContent='Проверяем…'});
    try{
      const r=await fetch(`${cfg.supabaseUrl}/auth/v1/settings`,{headers:{apikey:cfg.supabasePublishableKey}});if(!r.ok)throw new Error('status');const settings=await r.json();
      methods.forEach(m=>{const el=list.querySelector(`[data-auth-method="${m.key}"] [data-auth-status]`),ok=providerConnected(settings,m.key);el.className='auth-status '+(ok?'ok':'bad');el.textContent=m.key==='email'?'Доступен':(ok?'Подключено':'Не подключено')});
    }catch{methods.forEach(m=>{const el=list.querySelector(`[data-auth-method="${m.key}"] [data-auth-status]`);el.className='auth-status wait';el.textContent='Не удалось проверить'})}
  }
  document.getElementById('a4RefreshAuth').onclick=refreshStatus;
  document.getElementById('a4SaveAuth').onclick=async()=>{
    msg.textContent='';msg.className='auth-settings-msg';
    const next={login:{},registration:{}};
    methods.forEach(m=>{const row=list.querySelector(`[data-auth-method="${m.key}"]`);next.login[m.key]=row.querySelector('[data-mode="login"]').checked;next.registration[m.key]=row.querySelector('[data-mode="registration"]').checked});
    if(!Object.values(next.login).some(Boolean)){msg.textContent='Нельзя отключить все способы входа — оставьте хотя бы один.';msg.className='auth-settings-msg err';return}
    const save=document.getElementById('a4SaveAuth');save.disabled=true;
    try{const {error}=await sb.from('settings').upsert({key:'auth_ui',value:next,updated_at:new Date().toISOString()});if(error)throw error;current=next;window.A4AuthUI?.invalidate?.();msg.textContent='Настройки входа и регистрации сохранены ✓';msg.className='auth-settings-msg ok'}catch(e){msg.textContent='Ошибка: '+(e?.message||'не удалось сохранить');msg.className='auth-settings-msg err'}finally{save.disabled=false}
  };
  refreshStatus();
})();
