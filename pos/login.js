const createClient=window.supabase?.createClient;
if(!createClient)throw new Error('Локальный модуль авторизации не загрузился. Обновите страницу.');

const cfg = window.A4PRINT_CONFIG || {};
const supabase = createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const form = document.getElementById('form');
const btn = document.getElementById('submit');
const err = document.getElementById('error');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const show = message => { err.textContent = message; err.style.display = 'block'; };

async function checkRoleWithRetry() {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(1500 * attempt);
    const [{ data: admin, error: adminError }, { data: operator, error: operatorError }] = await Promise.all([
      supabase.rpc('has_role', { required_role: 'ADMIN' }),
      supabase.rpc('has_role', { required_role: 'POS_OPERATOR' })
    ]);
    const roleError = adminError || operatorError;
    if (!roleError) return { admin: Boolean(admin), operator: Boolean(operator) };
    lastError = roleError;
    if (!/jwt issued at future/i.test(String(roleError.message || ''))) throw roleError;
  }
  throw lastError || new Error('JWT issued at future');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  err.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Входим...';

  try {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value
    });
    if (signInError) throw signInError;

    const role = await checkRoleWithRetry();
    if (!role.admin && !role.operator) {
      await supabase.auth.signOut();
      throw new Error('Нет доступа к кассе.');
    }

    location.replace('./index.html');
  } catch (error) {
    const message = String(error?.message || 'Не удалось войти');
    if (/jwt issued at future/i.test(message)) {
      show('На этом компьютере неверно синхронизированы дата или время. Включите автоматическую дату, время и часовой пояс в Windows, затем повторите вход.');
    } else {
      show(message);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Войти в кассу';
  }
});
