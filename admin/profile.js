(async()=>{
  const cfg=window.A4PRINT_CONFIG||{};
  const SUPABASE_URL=cfg.supabaseUrl||'https://qgakliolffnwkymoqvzn.supabase.co';
  const SUPABASE_KEY=cfg.supabasePublishableKey||'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
  let authUser=null,profile=null,supabase=null;

  function setMsg(id,text,type='ok'){
    const el=$(id);if(!el)return;
    el.textContent=text||'';el.className='profile-msg '+(text?type:'');el.hidden=!text;
  }
  function friendly(e,fallback='Не удалось выполнить действие.'){
    const m=String(e?.message||e||'').trim();
    if(/invalid login credentials|invalid_credentials/i.test(m))return'Сессия входа недействительна. Войдите снова.';
    if(/jwt.*expired|token.*expired|unauthorized|401/i.test(m))return'Сессия завершена. Войдите снова.';
    if(/duplicate|already registered|already exists/i.test(m))return'Этот email уже используется другим аккаунтом.';
    if(/email.*invalid/i.test(m))return'Проверьте правильность email.';
    if(/network|failed to fetch|load failed|abort/i.test(m))return'Не удалось связаться с сервером. Проверьте интернет.';
    return m||fallback;
  }

  async function loadLocalSupabase(){
    if(window.supabase?.createClient)return window.supabase.createClient;
    await new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-a4-supabase-local]');
      if(existing){
        if(window.supabase?.createClient)return resolve();
        existing.addEventListener('load',resolve,{once:true});
        existing.addEventListener('error',()=>reject(new Error('Не удалось загрузить модуль авторизации.')),{once:true});
        return;
      }
      const script=document.createElement('script');
      script.src='/admin/vendor/supabase.js?v=20260905-1';
      script.dataset.a4SupabaseLocal='1';
      script.onload=resolve;
      script.onerror=()=>reject(new Error('Не удалось загрузить модуль авторизации.'));
      document.head.appendChild(script);
    });
    if(!window.supabase?.createClient)throw new Error('Модуль авторизации загружен некорректно.');
    return window.supabase.createClient;
  }

  async function getSharedClient(){
    if(window.__A4_SUPABASE_CLIENT__)return window.__A4_SUPABASE_CLIENT__;
    if(window.__A4_SUPABASE_CLIENT_PROMISE__)return window.__A4_SUPABASE_CLIENT_PROMISE__;
    window.__A4_SUPABASE_CLIENT_PROMISE__=(async()=>{
      const createClient=await loadLocalSupabase();
      if(window.__A4_SUPABASE_CLIENT__)return window.__A4_SUPABASE_CLIENT__;
      const client=createClient(SUPABASE_URL,SUPABASE_KEY,{
        global:{fetch:window.A4SupabaseFetch||fetch},
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });
      window.__A4_SUPABASE_CLIENT__=client;
      return client;
    })();
    try{return await window.__A4_SUPABASE_CLIENT_PROMISE__}
    catch(e){delete window.__A4_SUPABASE_CLIENT_PROMISE__;throw e}
  }

  async function currentSession(){
    let {data:{session},error}=await supabase.auth.getSession();
    if(error)console.warn('Profile session read failed',error);
    if(!session)return null;

    let userResult=await supabase.auth.getUser();
    if(userResult.error&&/expired|jwt|token/i.test(String(userResult.error.message||''))){
      const refreshed=await supabase.auth.refreshSession();
      if(refreshed.error||!refreshed.data.session)return null;
      session=refreshed.data.session;
      userResult=await supabase.auth.getUser();
    }
    if(userResult.error||!userResult.data.user)return null;
    authUser=userResult.data.user;
    return session;
  }

  async function rpc(name,args={}){
    const {data,error}=await supabase.rpc(name,args);
    if(error)throw error;
    return data;
  }

  function goLogin(reason='session'){
    const mobile=new URLSearchParams(location.search).get('mobile')==='1';
    const ret=location.pathname+location.search+location.hash;
    if(mobile){location.replace('/mobile/?login=1&reason='+encodeURIComponent(reason)+'&return='+encodeURIComponent(ret));return}
    if(reason==='logout'){location.replace('./login.html');return}
    location.replace('./login.html?returnTo='+encodeURIComponent(ret));
  }

  function initials(name){return String(name||'A4').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'A4'}
  function drawAvatar(url,name){
    const box=$('avatar');if(!box)return;
    if(url)box.innerHTML=`<img src="${esc(url)}" alt="Аватар">`;
    else box.textContent=initials(name);
    if($('removeAvatar'))$('removeAvatar').hidden=!url;
  }
  function providerValue(){return profile?.provider||authUser?.app_metadata?.provider||'email'}
  function render(){
    const u=profile?.user||{},d=profile?.department||{},org=d.organization||{};
    const dept=[org.name,d.name].filter(Boolean).join(' · ');
    $('name').textContent=u.full_name||authUser?.user_metadata?.full_name||'Сотрудник';
    $('email').textContent=u.email||authUser?.email||'';
    $('fullName').value=u.full_name||authUser?.user_metadata?.full_name||'';
    $('phone').value=u.phone||authUser?.phone||'';
    $('profileEmail').value=u.email||authUser?.email||'';
    $('provider').value=providerValue();
    $('profileDepartment').value=dept||'Не назначен';
    $('profilePosition').value=u.position||'Не назначена';
    $('position').textContent=u.position||'Должность не назначена';
    $('department').textContent=dept||'Отдел не назначен';
    $('roles').innerHTML=(profile?.roles||[]).map(x=>`<span class="role">${esc(x.name)}</span>`).join('')||'<span class="muted">Роли не назначены</span>';
    const avatar=profile?.avatar_url||u.avatar_url||authUser?.user_metadata?.avatar_url||'';
    drawAvatar(avatar,u.full_name||authUser?.user_metadata?.full_name);
    const emailAuth=providerValue()==='email';
    $('securityEmail').hidden=!emailAuth;$('passwordBlock').hidden=!emailAuth;
    $('providerNote').textContent=emailAuth?'Для изменения email потребуется подтверждение по почте.':'Email и пароль для этого аккаунта управляются через '+providerValue()+'.';
  }

  async function load(){
    supabase=await getSharedClient();
    const session=await currentSession();
    if(!session){goLogin('session');return}
    profile=await rpc('get_my_staff_profile');
    if(profile?.status!=='ACTIVE'){
      if(profile?.status==='UNREGISTERED')location.replace('./register.html');
      else location.replace('./pending.html');
      return;
    }
    render();
    document.body.classList.add('profile-ready');
  }

  async function prepareImage(file){
    if(!file)throw new Error('Выберите изображение.');
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Поддерживаются JPG, PNG и WebP.');
    if(file.size>8*1024*1024)throw new Error('Исходный файл должен быть меньше 8 МБ.');
    const objectUrl=URL.createObjectURL(file),img=new Image();
    try{
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Не удалось прочитать изображение.'));img.src=objectUrl});
      const max=720,scale=Math.min(1,max/Math.max(img.naturalWidth||1,img.naturalHeight||1));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.88));
      if(!blob)throw new Error('Не удалось подготовить изображение.');
      if(blob.size>3*1024*1024)throw new Error('После обработки аватар всё ещё слишком большой.');
      return blob;
    }finally{URL.revokeObjectURL(objectUrl)}
  }

  async function uploadAvatar(file){
    setMsg('avatarMsg','');const btn=$('chooseAvatar');btn.disabled=true;btn.textContent='Загружаем…';
    try{
      const blob=await prepareImage(file),uid=authUser?.id;
      if(!uid)throw new Error('Не найден аккаунт пользователя.');
      const path=`${uid}/avatar.webp`;
      const bucket=supabase.storage.from('staff-avatars');
      const {error:uploadError}=await bucket.upload(path,blob,{upsert:true,contentType:'image/webp',cacheControl:'3600'});
      if(uploadError)throw uploadError;
      const {data:publicData}=bucket.getPublicUrl(path);
      const url=(publicData?.publicUrl||`${SUPABASE_URL}/storage/v1/object/public/staff-avatars/${path}`)+'?v='+Date.now();
      await rpc('update_my_staff_avatar',{p_avatar_url:url});
      const {data,error}=await supabase.auth.updateUser({data:{avatar_url:url}});
      if(error)throw error;
      authUser=data?.user||authUser;
      profile.avatar_url=url;if(profile.user)profile.user.avatar_url=url;
      drawAvatar(url,profile?.user?.full_name);
      setMsg('avatarMsg','Аватар обновлён ✓','ok');
    }catch(e){setMsg('avatarMsg',friendly(e,'Не удалось обновить аватар.'),'err')}
    finally{btn.disabled=false;btn.textContent='Сменить фото';$('avatarFile').value=''}
  }

  async function removeAvatar(){
    setMsg('avatarMsg','');const btn=$('removeAvatar');btn.disabled=true;
    try{
      const uid=authUser?.id;if(!uid)throw new Error('Не найден аккаунт пользователя.');
      const path=`${uid}/avatar.webp`;
      await supabase.storage.from('staff-avatars').remove([path]).catch(()=>{});
      await rpc('update_my_staff_avatar',{p_avatar_url:null});
      const {data,error}=await supabase.auth.updateUser({data:{avatar_url:null}});
      if(error)throw error;
      authUser=data?.user||authUser;
      profile.avatar_url=null;if(profile.user)profile.user.avatar_url=null;
      drawAvatar('',profile?.user?.full_name);
      setMsg('avatarMsg','Аватар удалён.','ok');
    }catch(e){setMsg('avatarMsg',friendly(e,'Не удалось удалить аватар.'),'err')}
    finally{btn.disabled=false}
  }

  $('profileForm').addEventListener('submit',async e=>{
    e.preventDefault();setMsg('profileMsg','');const btn=$('save');btn.disabled=true;btn.textContent='Сохраняем…';
    try{
      const full=$('fullName').value.trim(),phone=$('phone').value.trim();
      if(!full)throw new Error('Укажите ФИО.');
      await rpc('update_my_staff_profile',{p_full_name:full,p_phone:phone||null});
      const {data,error}=await supabase.auth.updateUser({data:{full_name:full,name:full}});
      if(error)throw error;
      authUser=data?.user||authUser;
      profile.user=profile.user||{};profile.user.full_name=full;profile.user.phone=phone||null;
      render();setMsg('profileMsg','Личные данные сохранены ✓','ok');
    }catch(e){setMsg('profileMsg',friendly(e,'Не удалось сохранить профиль.'),'err')}
    finally{btn.disabled=false;btn.textContent='Сохранить профиль'}
  });

  $('avatarFile').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)uploadAvatar(f)});
  $('chooseAvatar').onclick=()=>$('avatarFile').click();
  $('removeAvatar').onclick=removeAvatar;

  $('changeEmail').onclick=async()=>{
    setMsg('emailMsg','');const email=$('newEmail').value.trim().toLowerCase();
    if(!email)return setMsg('emailMsg','Введите новый email.','err');
    const btn=$('changeEmail');btn.disabled=true;
    try{
      const {error}=await supabase.auth.updateUser({email});if(error)throw error;
      $('newEmail').value='';setMsg('emailMsg','На новый email отправлено подтверждение. После подтверждения адрес обновится в HUB.','ok');
    }catch(e){setMsg('emailMsg',friendly(e,'Не удалось изменить email.'),'err')}
    finally{btn.disabled=false}
  };

  $('changePassword').onclick=async()=>{
    setMsg('passwordMsg','');const p=$('newPassword').value;
    if(p.length<6)return setMsg('passwordMsg','Минимум 6 символов.','err');
    const btn=$('changePassword');btn.disabled=true;
    try{
      const {data,error}=await supabase.auth.updateUser({password:p});if(error)throw error;
      authUser=data?.user||authUser;$('newPassword').value='';setMsg('passwordMsg','Пароль изменён ✓','ok');
    }catch(e){setMsg('passwordMsg',friendly(e,'Не удалось изменить пароль.'),'err')}
    finally{btn.disabled=false}
  };

  $('logout').onclick=async()=>{
    try{await supabase?.auth?.signOut()}catch{}
    goLogin('logout');
  };

  try{await load()}
  catch(e){
    console.error('Profile load failed',e);
    const host=document.querySelector('.profile-grid');
    if(host)host.innerHTML=`<div class="card profile-fatal"><b>Не удалось открыть профиль.</b><div style="margin-top:8px">${esc(friendly(e,'Повторите попытку.'))}</div><button type="button" class="btn" style="margin-top:12px" onclick="location.reload()">Повторить</button></div>`;
  }
})();
