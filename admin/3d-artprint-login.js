const params=new URLSearchParams(location.search);
const requested=params.get('returnTo')||'./3d-artprint.html';
const target=new URL(requested,location.href);
const returnTo=target.origin===location.origin&&/\/admin\/3d-artprint(?:-workspace)?\.html$/.test(target.pathname)?target.pathname+target.search+target.hash:'/admin/3d-artprint.html';
document.getElementById('existingLogin').href='./login.html?returnTo='+encodeURIComponent(returnTo);
const form=document.getElementById('employeeLogin'),message=document.getElementById('message'),button=document.getElementById('submit');
const config=window.A4PRINT_CONFIG||{};
const create=window.supabase?.createClient;
if(!create){message.textContent='Модуль входа недоступен. Обновите страницу.'}
else{
 const db=create(config.supabaseUrl||'https://qgakliolffnwkymoqvzn.supabase.co',config.supabasePublishableKey||'sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled)return;
  message.textContent='';button.disabled=true;
  try{
   const data=new FormData(form),login=String(data.get('login')||'').trim().toLowerCase(),password=String(data.get('password')||'');
   if(!/^[a-z][a-z0-9._-]{2,31}$/.test(login))throw Error('Укажите корректный логин');
   const email=login+'@staff.3d-artprint.ru';
   const result=await db.auth.signInWithPassword({email,password});
   if(result.error)throw Error('Неверный логин или пароль');
   const profileResult=await db.rpc('get_my_staff_profile');
   const profile=profileResult.data;
   if(profileResult.error||profile?.status!=='ACTIVE'||profile?.department?.organization?.code!=='3DARTPRINT'){
    await db.auth.signOut();throw Error('Нет активного доступа к 3D-ARTPRINT');
   }
   location.replace(returnTo);
  }catch(error){message.textContent=error?.message||'Ошибка входа';button.disabled=false}
 });
}