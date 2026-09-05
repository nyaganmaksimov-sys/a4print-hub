(()=>{
  const cfg=window.A4PRINT_CONFIG||{};
  const SUPABASE_URL=cfg.supabaseUrl||'https://qgakliolffnwkymoqvzn.supabase.co';
  const SUPABASE_KEY=cfg.supabasePublishableKey||'';
  const PROJECT=(new URL(SUPABASE_URL)).hostname.split('.')[0];
  const SESSION_KEY=`sb-${PROJECT}-auth-token`;
  const ACCESS_KEY='a4print_mobile_access';
  const REFRESH_KEY='a4print_mobile_refresh';
  const EXPIRES_KEY='a4print_mobile_expires';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
  let authUser=null,profile=null;

  function stored(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')||{}}catch{return {}}}
  function saveSession(next){
    if(!next)return;const merged={...stored(),...next};
    if(merged.access_token)localStorage.setItem(ACCESS_KEY,merged.access_token);
    if(merged.refresh_token)localStorage.setItem(REFRESH_KEY,merged.refresh_token);
    if(merged.expires_at)localStorage.setItem(EXPIRES_KEY,String(merged.expires_at));
    localStorage.setItem(SESSION_KEY,JSON.stringify(merged));
  }
  function token(){return localStorage.getItem(ACCESS_KEY)||stored().access_token||''}
  function refreshToken(){return localStorage.getItem(REFRESH_KEY)||stored().refresh_token||''}
  function clearSession(){[SESSION_KEY,ACCESS_KEY,REFRESH_KEY,EXPIRES_KEY].forEach(k=>localStorage.removeItem(k))}
  function setMsg(id,text,type='ok'){const el=$(id);if(!el)return;el.textContent=text||'';el.className='profile-msg '+(text?type:'');el.hidden=!text}
  function friendly(e,fallback='Не удалось выполнить действие.'){
    const m=String(e?.message||e||'').trim();
    if(/jwt|unauthorized|401|session/i.test(m))return'Сессия завершена. Войдите снова.';
    if(/duplicate|already registered|already exists/i.test(m))return'Этот email уже используется другим аккаунтом.';
    if(/email.*invalid/i.test(m))return'Проверьте правильность email.';
    if(/network|failed to fetch|load failed|abort/i.test(m))return'Не удалось связаться с сервером. Проверьте интернет.';
    return m||fallback;
  }
  async function request(path,{method='GET',body,auth=token(),timeout=20000}={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    const headers={apikey:SUPABASE_KEY,Authorization:`Bearer ${auth||SUPABASE_KEY}`,Accept:'application/json'};
    if(body!==undefined)headers['Content-Type']='application/json';
    try{
      const r=await fetch(SUPABASE_URL+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
      const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
      if(!r.ok){const err=new Error(data?.msg||data?.message||data?.error_description||data?.error||`HTTP ${r.status}`);err.status=r.status;throw err}
      return data;
    }catch(e){if(e?.name==='AbortError')throw new Error('Превышено время ожидания ответа.');throw e}finally{clearTimeout(timer)}
  }
  async function refreshSession(){
    const rt=refreshToken();if(!rt)return false;
    try{const data=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:rt},auth:SUPABASE_KEY});if(!data?.access_token)return false;saveSession(data);return true}catch{return false}
  }
  async function authed(path,opt={}){
    try{return await request(path,opt)}catch(e){if(e.status===401&&await refreshSession())return request(path,opt);throw e}
  }
  async function getUser(){const user=await authed('/auth/v1/user');authUser=user;saveSession({user});return user}
  async function rpc(name,args={}){return authed(`/rest/v1/rpc/${name}`,{method:'POST',body:args})}

  function initials(name){return String(name||'A4').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'A4'}
  function drawAvatar(url,name){
    const box=$('avatar');if(!box)return;
    if(url)box.innerHTML=`<img src="${esc(url)}" alt="Аватар">`;
    else box.textContent=initials(name);
    $('removeAvatar').hidden=!url;
  }
  function render(){
    const u=profile?.user||{},d=profile?.department||{},org=d.organization||{};
    const dept=[org.name,d.name].filter(Boolean).join(' · ');
    $('name').textContent=u.full_name||'Сотрудник';
    $('email').textContent=u.email||authUser?.email||'';
    $('fullName').value=u.full_name||'';$('phone').value=u.phone||'';
    $('profileEmail').value=u.email||authUser?.email||'';
    $('provider').value=profile?.provider||'email';
    $('profileDepartment').value=dept||'Не назначен';$('profilePosition').value=u.position||'Не назначена';
    $('position').textContent=u.position||'Должность не назначена';$('department').textContent=dept||'Отдел не назначен';
    $('roles').innerHTML=(profile?.roles||[]).map(x=>`<span class="role">${esc(x.name)}</span>`).join('')||'<span class="muted">Роли не назначены</span>';
    const avatar=profile?.avatar_url||u.avatar_url||authUser?.user_metadata?.avatar_url||'';drawAvatar(avatar,u.full_name);
    const emailAuth=(profile?.provider||'email')==='email';$('securityEmail').hidden=!emailAuth;$('passwordBlock').hidden=!emailAuth;
    if(!emailAuth)$('providerNote').textContent='Email и пароль для этого аккаунта управляются через '+(profile?.provider||'внешний сервис')+'.';
    else $('providerNote').textContent='Для изменения email потребуется подтверждение по почте.';
  }
  async function load(){
    if(!token()&&!refreshToken()){return goLogin()}
    authUser=await getUser();profile=await rpc('get_my_staff_profile');
    if(profile?.status!=='ACTIVE'){
      if(profile?.status==='UNREGISTERED')location.replace('./register.html');else location.replace('./pending.html');return;
    }
    render();document.body.classList.add('profile-ready');
  }
  function goLogin(){
    const mobile=new URLSearchParams(location.search).get('mobile')==='1';
    if(mobile)location.replace('/mobile/?login=1&return='+encodeURIComponent(location.pathname+location.search));
    else location.replace('./login.html');
  }

  async function prepareImage(file){
    if(!file)throw new Error('Выберите изображение.');
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Поддерживаются JPG, PNG и WebP.');
    if(file.size>8*1024*1024)throw new Error('Исходный файл должен быть меньше 8 МБ.');
    const objectUrl=URL.createObjectURL(file);const img=new Image();
    try{
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Не удалось прочитать изображение.'));img.src=objectUrl});
      const max=720,scale=Math.min(1,max/Math.max(img.naturalWidth||1,img.naturalHeight||1));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.88));
      if(!blob)throw new Error('Не удалось подготовить изображение.');if(blob.size>3*1024*1024)throw new Error('После обработки аватар всё ещё слишком большой.');return blob;
    }finally{URL.revokeObjectURL(objectUrl)}
  }
  async function uploadAvatar(file){
    setMsg('avatarMsg','');const btn=$('chooseAvatar');btn.disabled=true;btn.textContent='Загружаем…';
    try{
      const blob=await prepareImage(file);const uid=authUser?.id;if(!uid)throw new Error('Не найден аккаунт пользователя.');
      const path=`${uid}/avatar.webp`,encoded=path.split('/').map(encodeURIComponent).join('/');
      const r=await fetch(`${SUPABASE_URL}/storage/v1/object/staff-avatars/${encoded}`,{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token()}`,'Content-Type':'image/webp','x-upsert':'true'},body:blob});
      if(!r.ok){let d={};try{d=await r.json()}catch{}throw new Error(d?.message||d?.error||`Ошибка загрузки ${r.status}`)}
      const url=`${SUPABASE_URL}/storage/v1/object/public/staff-avatars/${encoded}?v=${Date.now()}`;
      await rpc('update_my_staff_avatar',{p_avatar_url:url});
      const updated=await authed('/auth/v1/user',{method:'PUT',body:{data:{avatar_url:url}}});authUser=updated||authUser;saveSession({user:authUser});
      profile.avatar_url=url;if(profile.user)profile.user.avatar_url=url;drawAvatar(url,profile?.user?.full_name);setMsg('avatarMsg','Аватар обновлён ✓','ok');
    }catch(e){setMsg('avatarMsg',friendly(e,'Не удалось обновить аватар.'),'err')}finally{btn.disabled=false;btn.textContent='Сменить фото';$('avatarFile').value=''}
  }
  async function removeAvatar(){
    setMsg('avatarMsg','');const btn=$('removeAvatar');btn.disabled=true;
    try{
      const uid=authUser?.id,path=`${uid}/avatar.webp`,encoded=path.split('/').map(encodeURIComponent).join('/');
      await fetch(`${SUPABASE_URL}/storage/v1/object/staff-avatars/${encoded}`,{method:'DELETE',headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token()}`}}).catch(()=>{});
      await rpc('update_my_staff_avatar',{p_avatar_url:null});
      const updated=await authed('/auth/v1/user',{method:'PUT',body:{data:{avatar_url:null}}});authUser=updated||authUser;saveSession({user:authUser});
      profile.avatar_url=null;if(profile.user)profile.user.avatar_url=null;drawAvatar('',profile?.user?.full_name);setMsg('avatarMsg','Аватар удалён.','ok');
    }catch(e){setMsg('avatarMsg',friendly(e,'Не удалось удалить аватар.'),'err')}finally{btn.disabled=false}
  }

  $('profileForm').addEventListener('submit',async e=>{
    e.preventDefault();setMsg('profileMsg','');const btn=$('save');btn.disabled=true;btn.textContent='Сохраняем…';
    try{
      const full=$('fullName').value.trim(),phone=$('phone').value.trim();if(!full)throw new Error('Укажите ФИО.');
      await rpc('update_my_staff_profile',{p_full_name:full,p_phone:phone||null});
      const updated=await authed('/auth/v1/user',{method:'PUT',body:{data:{full_name:full,name:full}}});authUser=updated||authUser;saveSession({user:authUser});
      profile.user.full_name=full;profile.user.phone=phone||null;render();setMsg('profileMsg','Личные данные сохранены ✓','ok');
    }catch(e){setMsg('profileMsg',friendly(e,'Не удалось сохранить профиль.'),'err')}finally{btn.disabled=false;btn.textContent='Сохранить изменения'}
  });
  $('avatarFile').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)uploadAvatar(f)});$('chooseAvatar').onclick=()=>$('avatarFile').click();$('removeAvatar').onclick=removeAvatar;
  $('changeEmail').onclick=async()=>{
    setMsg('emailMsg','');const email=$('newEmail').value.trim().toLowerCase();if(!email)return setMsg('emailMsg','Введите новый email.','err');
    const btn=$('changeEmail');btn.disabled=true;try{await authed('/auth/v1/user',{method:'PUT',body:{email}});$('newEmail').value='';setMsg('emailMsg','На новый email отправлено подтверждение. После подтверждения адрес обновится в HUB.','ok')}catch(e){setMsg('emailMsg',friendly(e,'Не удалось изменить email.'),'err')}finally{btn.disabled=false}
  };
  $('changePassword').onclick=async()=>{
    setMsg('passwordMsg','');const p=$('newPassword').value;if(p.length<6)return setMsg('passwordMsg','Минимум 6 символов.','err');
    const btn=$('changePassword');btn.disabled=true;try{const updated=await authed('/auth/v1/user',{method:'PUT',body:{password:p}});authUser=updated||authUser;saveSession({user:authUser});$('newPassword').value='';setMsg('passwordMsg','Пароль изменён ✓','ok')}catch(e){setMsg('passwordMsg',friendly(e,'Не удалось изменить пароль.'),'err')}finally{btn.disabled=false}
  };
  $('logout').onclick=async()=>{try{await request('/auth/v1/logout',{method:'POST'})}catch{}clearSession();goLogin()};

  load().catch(e=>{if(/401|jwt|session|auth/i.test(String(e?.message||'')))return goLogin();const host=document.querySelector('.profile-grid');if(host)host.innerHTML=`<div class="card profile-fatal">${esc(friendly(e,'Не удалось открыть профиль.'))}</div>`});
})();
