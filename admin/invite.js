(function(){
  const cfg=window.A4PRINT_CONFIG||{};
  const client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
  const edge=`${cfg.supabaseUrl}/functions/v1/staff-invite`;
  const token=new URLSearchParams(location.search).get('token')||'';
  const root=document.getElementById('root');
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  async function call(action,payload={}){
    const r=await fetch(edge,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.supabasePublishableKey},body:JSON.stringify({action,token,...payload})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||d.error||'Ошибка регистрации');return d;
  }
  function fail(message){root.innerHTML=`<div class="state" style="grid-column:1/-1"><h2>Ссылка недоступна</h2><p>${esc(message)}</p><p><a href="./login.html">Перейти ко входу в HUB</a></p></div>`}
  function render(inv){
    root.innerHTML=`<section class="intro"><div class="logo"><img src="./assets/a4print-hub-logo.png" alt="A4PRINT HUB" onerror="this.src='./assets/logo_bd_transparent.svg'"></div><h1>Добро пожаловать в A4PRINT HUB</h1><p>Вам подготовили рабочее место. Заполните данные и придумайте пароль — после этого доступ откроется автоматически.</p><div class="assignment"><div><small>Организация</small><b>${esc(inv.organization?.name||'A4PRINT HUB')}</b></div><div><small>Отдел</small><b>${esc(inv.department?.name||'—')}</b></div><div><small>Должность</small><b>${esc(inv.position?.name||'—')}</b></div><div><small>Доступ</small><div class="roles">${(inv.roles||[]).map(r=>`<span class="role">${esc(r.name)}</span>`).join('')}</div></div></div></section><section class="formside"><h2>Создать аккаунт</h2><p class="sub">Введите данные сотрудника. Email будет использоваться как логин.</p><form id="inviteAcceptForm"><label class="field"><span>ФИО</span><input id="fullName" autocomplete="name" required></label><div class="grid2"><label class="field"><span>Email</span><input id="email" type="email" autocomplete="email" required></label><label class="field"><span>Телефон</span><input id="phone" autocomplete="tel"></label></div><div class="grid2"><label class="field"><span>Пароль</span><input id="password" type="password" minlength="6" autocomplete="new-password" required></label><label class="field"><span>Повторите пароль</span><input id="password2" type="password" minlength="6" autocomplete="new-password" required></label></div><div id="error" class="error"></div><button id="submit" class="btn">Создать аккаунт и войти</button></form></section>`;
    document.getElementById('inviteAcceptForm').onsubmit=accept;
  }
  async function accept(e){
    e.preventDefault();const err=document.getElementById('error'),btn=document.getElementById('submit');err.style.display='none';err.textContent='';
    const full_name=document.getElementById('fullName').value.trim(),email=document.getElementById('email').value.trim(),phone=document.getElementById('phone').value.trim(),password=document.getElementById('password').value,password2=document.getElementById('password2').value;
    if(password!==password2){err.textContent='Пароли не совпадают.';err.style.display='block';return}
    try{btn.disabled=true;btn.textContent='Создаём аккаунт…';await call('accept',{full_name,email,phone,password});const {error:loginError}=await client.auth.signInWithPassword({email,password});if(loginError)throw new Error('Аккаунт создан. Войдите через обычную страницу входа.');root.innerHTML='<div class="state" style="grid-column:1/-1"><h2>Готово ✓</h2><p>Аккаунт сотрудника создан. Открываем A4PRINT HUB…</p></div>';setTimeout(()=>location.replace('./index.html'),700)}catch(x){err.textContent=x.message||'Не удалось завершить регистрацию.';err.style.display='block';btn.disabled=false;btn.textContent='Создать аккаунт и войти'}
  }
  (async()=>{if(!token)return fail('В ссылке отсутствует код приглашения.');try{const d=await call('inspect');render(d.invite)}catch(e){fail(e.message)}})();
})();
