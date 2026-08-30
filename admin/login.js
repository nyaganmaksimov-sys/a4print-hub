import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qgakliolffnwkymoqvzn.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = window.A4PRINT_SUPABASE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const form=document.getElementById('form'), submit=document.getElementById('submit'), error=document.getElementById('error');
function showError(message){error.textContent=message;error.style.display='block'}
form.addEventListener('submit',async e=>{e.preventDefault();error.style.display='none';submit.disabled=true;submit.textContent='Входим...';try{if(!SUPABASE_PUBLISHABLE_KEY)throw new Error('Не задан ключ Supabase для интерфейса.');const {error}=await supabase.auth.signInWithPassword({email:document.getElementById('email').value.trim(),password:document.getElementById('password').value});if(error)throw error;location.href='./index.html'}catch(e){showError(e.message||'Не удалось выполнить вход.')}finally{submit.disabled=false;submit.textContent='Войти'}});
