import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.A4PRINT_CONFIG || {};
const SUPABASE_URL = config.supabaseUrl || 'https://qgakliolffnwkymoqvzn.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = config.supabasePublishableKey || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const form = document.getElementById('form');
const submit = document.getElementById('submit');
const error = document.getElementById('error');
const recoveryBox=document.getElementById('recoveryBox');
const recoveryEmail=document.getElementById('recoveryEmail');
const recoveryError=document.getElementById('recoveryError');
const recoverySuccess=document.getElementById('recoverySuccess');
const sendRecovery=document.getElementById('sendRecovery');

function showError(message) {
  error.textContent = message;
  error.style.display = 'block';
}
function resetRecoveryMessages(){recoveryError.style.display='none';recoverySuccess.style.display='none';recoveryError.textContent='';recoverySuccess.textContent=''}

document.getElementById('showRecovery').onclick=()=>{resetRecoveryMessages();recoveryEmail.value=document.getElementById('email').value.trim();recoveryBox.classList.add('open');recoveryEmail.focus()};
document.getElementById('hideRecovery').onclick=()=>recoveryBox.classList.remove('open');
sendRecovery.onclick=async()=>{resetRecoveryMessages();const email=recoveryEmail.value.trim();if(!email){recoveryError.textContent='Введите email.';recoveryError.style.display='block';return}sendRecovery.disabled=true;sendRecovery.textContent='Отправляем...';try{const redirectTo=new URL('./reset-password.html',location.href).href;const{error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo});if(error)throw error;recoverySuccess.textContent='Ссылка отправлена. Откройте письмо и перейдите по ней.';recoverySuccess.style.display='block'}catch(e){recoveryError.textContent=e?.message||'Не удалось отправить письмо.';recoveryError.style.display='block'}finally{sendRecovery.disabled=false;sendRecovery.textContent='Отправить ссылку'}};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.style.display = 'none';
  submit.disabled = true;
  submit.textContent = 'Входим...';

  try {
    if (!SUPABASE_PUBLISHABLE_KEY) throw new Error('Не задан Publishable Key Supabase в admin/config.js.');

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value
    });
    if (authError) throw authError;

    const roleNames = ['ADMIN','MANAGER','WAREHOUSE','PRODUCTION','VIEWER','POS_OPERATOR'];
    const checks = await Promise.all(roleNames.map(name => supabase.rpc('has_role', { required_role: name })));
    for (const check of checks) if (check.error) throw check.error;
    const has = Object.fromEntries(roleNames.map((name,i)=>[name,Boolean(checks[i].data)]));

    if (has.ADMIN || has.MANAGER || has.WAREHOUSE || has.PRODUCTION || has.VIEWER) location.replace('./index.html');
    else if (has.POS_OPERATOR) location.replace('../pos/index.html');
    else throw new Error('Для этой учётной записи не назначена роль доступа.');
  } catch (err) {
    showError(err?.message || 'Не удалось выполнить вход.');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Войти';
  }
});
