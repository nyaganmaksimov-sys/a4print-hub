import {supabase} from './guard.js?v=20260905-netfix1';

const cfg=window.A4PRINT_CONFIG||{};
const $=id=>document.getElementById(id);
const DEFAULT='./assets/logo_bd_transparent.svg';
const billingFields=['name','legal_name','inn','kpp','ogrn','phone','email','bank_name','bik','settlement_account','correspondent_account','signatory','address'];
let current='';

function msg(text,ok=false){$('msg').textContent=text;$('msg').className='msg '+(ok?'ok':'err')}
function tgMessage(text,ok=false){$('tgMsg').textContent=text;$('tgMsg').className='msg '+(ok?'ok':'err')}
function notify(tone,title,message,options={}){
  if(window.A4Feedback?.show)return window.A4Feedback.show({...options,tone,title,message});
  const method=tone==='error'?'error':tone==='warning'?'warn':'log';
  console[method]('[A4PRINT HUB]',title,message);
}
async function token(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error('Нет активной сессии.');
  return session.access_token;
}
async function api(path,options={}){
  const bearer=await token();
  const res=await fetch((cfg.apiBaseUrl||'https://a4print-hub-api.onrender.com')+path,{
    ...options,
    cache:'no-store',
    headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json',...(options.headers||{})}
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.message||data.error||('HTTP '+res.status));
  return data;
}
function renderTgStatus(data){
  const box=$('tgStatus');box.classList.remove('on','off');
  if(data.connected&&data.enabled){
    box.classList.add('on');
    box.innerHTML=`<span class="status-dot"></span><span><b>Подключён${data.bot_username?' · @'+data.bot_username:''}</b><small>Сообщения принимаются</small></span>`;
  }else if(data.connected){
    box.classList.add('off');
    box.innerHTML=`<span class="status-dot"></span><span><b>Подключён, но выключен${data.bot_username?' · @'+data.bot_username:''}</b><small>Webhook сейчас отключён</small></span>`;
  }else{
    box.classList.add('off');
    box.innerHTML='<span class="status-dot"></span><span><b>Telegram не подключён</b><small>Добавьте токен бота</small></span>';
  }
}
async function loadTelegram(){
  try{
    const d=await api('/api/v1/integrations/telegram/status');
    renderTgStatus(d);
    $('tgEnabled').checked=!!d.enabled;
    $('tgAcceptOrders').checked=d.accept_orders!==false;
    $('tgAutoReply').checked=d.auto_reply!==false;
    $('tgDisconnect').disabled=!d.connected;
    $('tgTest').disabled=!d.connected;
  }catch(error){
    renderTgStatus({connected:false});
    tgMessage('Не удалось проверить Telegram: '+(error.message||error));
  }
}
async function ensureAdmin(){
  const roles=Array.isArray(window.__A4_CURRENT_ROLES__)&&window.__A4_CURRENT_ROLES__.length
    ? window.__A4_CURRENT_ROLES__.map(String)
    : (await supabase.rpc('get_my_roles')).data||[];
  if(!roles.map(String).includes('ADMIN'))throw new Error('Настройки доступны только администратору.');
}
async function init(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){location.replace('./login.html');return}
  try{await ensureAdmin()}
  catch(error){
    notify('warning','Нет доступа',error.message||String(error));
    location.replace('./index.html');return;
  }
  const [branding,billing]=await Promise.all([
    supabase.from('settings').select('value').eq('key','hub_branding').maybeSingle(),
    supabase.from('settings').select('value').eq('key','company_billing').maybeSingle()
  ]);
  if(branding.error)throw branding.error;
  if(billing.error)throw billing.error;
  current=branding.data?.value?.logo||'';
  $('logoUrl').value=current&&/^https?:/.test(current)?current:'';
  $('preview').src=current||DEFAULT;
  const b=billing.data?.value||{};
  billingFields.forEach(field=>{const el=$('seller_'+field);if(el)el.value=b[field]||''});
  await loadTelegram();
}
function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    if(file.type==='image/svg+xml'){
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);return;
    }
    const img=new Image(),reader=new FileReader();
    reader.onload=()=>{
      img.onload=()=>{
        const max=700,scale=Math.min(1,max/Math.max(img.width,img.height)),canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL('image/webp',.9));
      };
      img.onerror=reject;img.src=reader.result;
    };
    reader.onerror=reject;reader.readAsDataURL(file);
  });
}
async function saveBilling(){
  const button=$('saveBilling');button.disabled=true;
  const value={};billingFields.forEach(field=>value[field]=$('seller_'+field)?.value.trim()||'');
  try{
    const {error}=await supabase.from('settings').upsert({key:'company_billing',value,updated_at:new Date().toISOString()});
    if(error)throw error;
    $('billingMsg').className='msg ok';$('billingMsg').textContent='Реквизиты сохранены ✓';
  }catch(error){
    $('billingMsg').className='msg err';$('billingMsg').textContent='Ошибка: '+(error.message||error);
  }finally{button.disabled=false}
}
async function saveLogo(){
  try{
    const logo=$('logoUrl').value.trim()||current;
    if(!logo)return msg('Выберите файл или укажите URL.');
    if(logo.length>900000)return msg('Файл слишком большой.');
    const {error}=await supabase.from('settings').upsert({key:'hub_branding',value:{logo},updated_at:new Date().toISOString()});
    if(error)throw error;
    localStorage.setItem('a4print_hub_logo',logo);msg('Логотип сохранён.',true);
  }catch(error){msg(error.message||'Не удалось сохранить логотип.')}
}
async function resetLogo(){
  try{
    const {error}=await supabase.from('settings').upsert({key:'hub_branding',value:{logo:''},updated_at:new Date().toISOString()});
    if(error)throw error;
    current='';$('logoUrl').value='';$('logoFile').value='';$('preview').src=DEFAULT;
    localStorage.removeItem('a4print_hub_logo');msg('Стандартный логотип восстановлен.',true);
  }catch(error){msg(error.message||'Не удалось сбросить логотип.')}
}
async function saveTelegram(){
  const button=$('tgSave');button.disabled=true;tgMessage('Сохраняем настройки…',true);
  try{
    const d=await api('/api/v1/integrations/telegram/config',{
      method:'PUT',
      body:JSON.stringify({token:$('tgToken').value.trim(),enabled:$('tgEnabled').checked,accept_orders:$('tgAcceptOrders').checked,auto_reply:$('tgAutoReply').checked})
    });
    $('tgToken').value='';renderTgStatus(d);tgMessage('Telegram настроен. Webhook обновлён ✓',true);
    $('tgDisconnect').disabled=false;$('tgTest').disabled=false;
  }catch(error){tgMessage('Ошибка: '+(error.message||error))}
  finally{button.disabled=false}
}
async function testTelegram(){
  const button=$('tgTest');button.disabled=true;tgMessage('Проверяем Telegram…',true);
  try{
    const d=await api('/api/v1/integrations/telegram/test',{method:'POST',body:'{}'});
    const extra=d.webhook?.last_error_message?' Ошибка webhook: '+d.webhook.last_error_message:'';
    tgMessage(`Связь работает. Бот @${d.bot?.username||'без username'}, очередь: ${d.webhook?.pending_update_count||0}.${extra}`,!extra);
  }catch(error){tgMessage('Проверка не пройдена: '+(error.message||error))}
  finally{button.disabled=false}
}
async function disconnectTelegram(){
  if(!window.confirm('Отключить Telegram-бота от A4PRINT HUB? Входящие сообщения останутся в истории.'))return;
  const button=$('tgDisconnect');button.disabled=true;
  try{
    await api('/api/v1/integrations/telegram',{method:'DELETE'});
    renderTgStatus({connected:false});tgMessage('Telegram отключён. История сообщений сохранена.',true);$('tgTest').disabled=true;
  }catch(error){tgMessage('Не удалось отключить: '+(error.message||error))}
  finally{button.disabled=false}
}
function bind(){
  $('saveBilling').addEventListener('click',saveBilling);
  $('logoFile').addEventListener('change',async()=>{
    const file=$('logoFile').files[0];if(!file)return;
    try{const data=await fileToDataUrl(file);$('preview').src=data;current=data;$('logoUrl').value='';msg('Файл готов к сохранению.',true)}
    catch{msg('Не удалось прочитать изображение.')}
  });
  $('logoUrl').addEventListener('input',()=>{const url=$('logoUrl').value.trim();if(url){$('preview').src=url;current=url}});
  $('save').addEventListener('click',saveLogo);$('reset').addEventListener('click',resetLogo);
  $('tgSave').addEventListener('click',saveTelegram);$('tgTest').addEventListener('click',testTelegram);$('tgDisconnect').addEventListener('click',disconnectTelegram);
  $('logout').addEventListener('click',async()=>{await supabase.auth.signOut();location.replace('./login.html')});
}
bind();
init().catch(error=>msg(error.message||String(error)));
