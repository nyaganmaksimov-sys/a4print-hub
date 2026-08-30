import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.A4PRINT_CONFIG || {};
const SUPABASE_URL = config.supabaseUrl || 'https://qgakliolffnwkymoqvzn.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = config.supabasePublishableKey || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const form = document.getElementById('form');
const submit = document.getElementById('submit');
const error = document.getElementById('error');

function showError(message) {
  error.textContent = message;
  error.style.display = 'block';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.style.display = 'none';
  submit.disabled = true;
  submit.textContent = 'Входим...';

  try {
    if (!SUPABASE_PUBLISHABLE_KEY) {
      throw new Error('Не задан Publishable Key Supabase в admin/config.js.');
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value
    });

    if (authError) throw authError;
    location.replace('./index.html');
  } catch (err) {
    showError(err?.message || 'Не удалось выполнить вход.');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Войти';
  }
});
