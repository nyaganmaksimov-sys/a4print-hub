const UPDATE_SEEN_KEY='a4print_updates_seen_version';

async function loadUpdates(){
  try{
    const response=await fetch('/mobile/updates.json?ts='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    return await response.json();
  }catch(e){
    console.warn('A4PRINT HUB updates unavailable',e);
    return {current_version:'',updates:[]};
  }
}

function versionLabel(v){return v?`v${v}`:'—'}
function dateLabel(v){
  try{return new Date(v+'T12:00:00').toLocaleDateString('ru-RU',{day:'2-digit',month:'long',year:'numeric'})}
  catch{return v||''}
}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

async function initUpdateNotifications(){
  const data=await loadUpdates();
  const updates=Array.isArray(data.updates)?data.updates:[];
  const current=data.current_version||updates[0]?.version||'';
  const seen=localStorage.getItem(UPDATE_SEEN_KEY)||'';
  const unread=!!current&&seen!==current;

  document.querySelectorAll('[data-app-version]').forEach(el=>el.textContent=versionLabel(current));
  document.querySelectorAll('[data-updates-badge]').forEach(el=>{
    el.textContent=unread?'1':'';
    el.classList.toggle('show',unread);
  });

  const banner=document.querySelector('[data-update-banner]');
  if(banner&&unread&&updates[0]){
    const u=updates[0];
    banner.classList.add('show');
    banner.innerHTML=`<a href="/mobile/account.html#updates"><b>Новое ${esc(versionLabel(u.version))}</b><span>${esc(u.title||'Обновление A4PRINT HUB')}</span><em>Подробнее →</em></a>`;
  }

  const list=document.getElementById('updatesList');
  if(list){
    list.innerHTML=updates.map((u,i)=>`<article class="update-card ${i===0?'latest':''}">
      <div class="update-head"><div><strong>${esc(versionLabel(u.version))}</strong><span>${esc(dateLabel(u.date))}</span></div>${i===0?'<em>Текущая</em>':''}</div>
      <h3>${esc(u.title||'Обновление')}</h3>
      <p>${esc(u.description||'')}</p>
      ${Array.isArray(u.items)&&u.items.length?`<ul>${u.items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
    </article>`).join('')||'<div class="empty">История обновлений пока пуста.</div>';
    if(current)localStorage.setItem(UPDATE_SEEN_KEY,current);
    document.querySelectorAll('[data-updates-badge]').forEach(el=>{el.textContent='';el.classList.remove('show')});
  }
}

initUpdateNotifications();
