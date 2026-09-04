import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabase=createClient('https://qgakliolffnwkymoqvzn.supabase.co','sb_publishable_WbZxATu_lxqWF21jR_qFag_fcEeVIMu');
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const statusName={NEW:'Новый',CONFIRMED:'Подтверждён',IN_PROGRESS:'В работе',READY:'Готов',COMPLETED:'Завершён',ON_HOLD:'Пауза',CANCELLED:'Отменён'};

function showLogin(message=''){
  $('loginView').classList.remove('hidden');$('appView').classList.add('hidden');
  const e=$('loginError');e.textContent=message;e.classList.toggle('show',!!message);
}
function showApp(){ $('loginView').classList.add('hidden');$('appView').classList.remove('hidden'); }
function statusClass(s){return s==='READY'?'ready':s==='NEW'?'new':['CONFIRMED','IN_PROGRESS'].includes(s)?'work':''}
function customerName(o){const c=o.customers||{};return c.full_name||c.company_name||'Клиент не указан'}

async function loadHome(profile){
  $('hello').textContent=profile.full_name?`Привет, ${profile.full_name.split(/\s+/)[0]}`:'Главная';
  const {data,error}=await supabase.from('orders').select('id,order_number,status,total,total_amount,model_name,source,business_unit,created_at,customers(full_name,company_name)').order('created_at',{ascending:false}).limit(100);
  if(error) throw error;
  const rows=data||[];
  $('newOrders').textContent=rows.filter(x=>x.status==='NEW').length;
  $('workOrders').textContent=rows.filter(x=>['CONFIRMED','IN_PROGRESS'].includes(x.status)).length;
  $('readyOrders').textContent=rows.filter(x=>x.status==='READY').length;
  $('recentOrders').innerHTML=rows.slice(0,8).map(o=>`<a class="order" href="/admin/order.html?id=${encodeURIComponent(o.id)}&mobile=1"><span><b>№${esc(o.order_number||String(o.id).slice(0,8))} · ${esc(customerName(o))}</b><small>${esc(o.model_name||o.source||(o.business_unit==='3D_ARTPRINT'?'3D-заказ':'Печать / услуга'))}</small><em class="status ${statusClass(o.status)}">${esc(statusName[o.status]||o.status||'—')}</em></span><strong>${Number(o.total||o.total_amount||0).toLocaleString('ru-RU')} ₽</strong></a>`).join('')||'<div class="empty">Заказов пока нет</div>';
}

async function enterApp(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){showLogin();return}
  const {data:profile,error}=await supabase.from('users').select('id,full_name,email,is_active').eq('auth_user_id',session.user.id).maybeSingle();
  if(error) throw error;
  if(!profile||profile.is_active===false){await supabase.auth.signOut({scope:'local'});showLogin('Профиль сотрудника не найден или ещё не активирован.');return}
  showApp();await loadHome(profile);
}

$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();const btn=$('loginButton'),err=$('loginError');err.classList.remove('show');btn.disabled=true;btn.textContent='Входим…';
  try{
    const {error}=await supabase.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
    if(error) throw error;
    await enterApp();
  }catch(ex){showLogin(ex?.message||'Не удалось войти. Проверьте email и пароль.');}
  finally{btn.disabled=false;btn.textContent='Войти'}
});

$('logout').onclick=async()=>{await supabase.auth.signOut({scope:'local'});showLogin()};
enterApp().catch(e=>showLogin(e?.message||'Не удалось открыть приложение.'));
