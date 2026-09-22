import {supabase} from './guard.js?v=20260922-authflow1';

const $=id=>document.getElementById(id);
function show(id,text){
  const el=$(id);if(!el)return;
  el.textContent=text||'';
  el.style.display=text?'block':'none';
}
function friendly(error,fallback='Не удалось выполнить действие.'){
  const message=String(error?.message||error||'').trim();
  if(/expired|invalid.*token|otp.*expired|invalid.*session|jwt/i.test(message))return 'Ссылка восстановления недействительна или уже истекла. Запросите новую ссылку на странице входа.';
  if(/network|failed to fetch|load failed|abort/i.test(message))return 'Не удалось связаться с сервером. Проверьте интернет и повторите попытку.';
  return message||fallback;
}
async function recoverySession(){
  const first=await supabase.auth.getSession();
  if(first.error)throw first.error;
  if(first.data.session)return first.data.session;

  return await new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(value,error=null)=>{
      if(settled)return;settled=true;clearTimeout(timer);subscription?.unsubscribe();
      if(error)reject(error);else resolve(value);
    };
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{if(session)finish(session)});
    const timer=setTimeout(()=>finish(null),4500);
  });
}
async function init(){
  show('info','Проверяем ссылку восстановления…');
  const session=await recoverySession();
  if(!session){
    show('info','');
    show('error','Ссылка восстановления недействительна или уже истекла. Запросите новую ссылку на странице входа.');
    return;
  }
  show('info','');$('form').style.display='block';
}
$('form').addEventListener('submit',async e=>{
  e.preventDefault();show('error','');show('success','');
  const p=$('password').value,p2=$('password2').value;
  if(p!==p2){show('error','Пароли не совпадают.');return}
  if(p.length<6){show('error','Пароль должен содержать минимум 6 символов.');return}
  $('submit').disabled=true;$('submit').textContent='Сохраняем…';
  try{
    const {error}=await supabase.auth.updateUser({password:p});
    if(error)throw error;
    show('success','Пароль изменён. Теперь можно войти с новым паролем.');
    await supabase.auth.signOut();
    setTimeout(()=>location.replace('./login.html'),900);
  }catch(error){show('error',friendly(error,'Не удалось изменить пароль.'))}
  finally{$('submit').disabled=false;$('submit').textContent='Сохранить новый пароль'}
});
init().catch(error=>{show('info','');show('error',friendly(error,'Не удалось открыть ссылку восстановления.'))});
