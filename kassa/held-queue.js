(()=>{
  'use strict';
  const DB=window.A4KassaDB;
  const nav=document.getElementById('navHeld');
  const drawer=document.getElementById('queueDrawer');
  const list=document.getElementById('queueList');
  const retry=document.getElementById('retryQueue');
  const chip=document.getElementById('queueChip');
  if(!DB||!nav||!drawer||!list)return;

  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})+' ₽';
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  function stageLabel(row){
    if(row.stage==='backend_done')return 'Документ уже создан в МойСклад, сохраняем запись в A4PRINT HUB';
    if(row.last_error)return 'Ошибка синхронизации';
    return navigator.onLine?'Ожидает отправки':'Ожидает восстановления интернета';
  }

  async function render(){
    const rows=(await DB.getAll('queue')).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
    const title=drawer.querySelector('.drawer-head h2');
    const subtitle=drawer.querySelector('.drawer-head span');
    if(title)title.textContent='Отложенные чеки';
    if(subtitle)subtitle.textContent=rows.length?`${rows.length} чек(а) ещё не завершили синхронизацию`:'Все чеки синхронизированы';
    if(!rows.length){
      list.innerHTML='<div class="empty-grid">Отложенных чеков нет. Все продажи переданы в МойСклад и A4PRINT HUB.</div>';
      return;
    }
    list.innerHTML=rows.map(row=>{
      const items=Array.isArray(row.items)?row.items:[];
      return `<article class="queue-item ${row.last_error?'error':''}">
        <div class="row"><div><b>${new Date(row.created_at).toLocaleString('ru-RU')}</b><small>${esc(row.operator_name||'Оператор')} · ${esc(row.payment_method||'Оплата не указана')}</small></div><strong>${money(row.total)}</strong></div>
        <small>${esc(stageLabel(row))}${row.last_error?` · ${esc(row.last_error)}`:''}</small>
        <details style="margin-top:8px"><summary style="cursor:pointer;font-weight:700">Состав чека · ${items.length} поз.</summary><div style="padding-top:6px">${items.map(i=>`<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0"><span>${esc(i.name||'Позиция')} × ${Number(i.qty||0).toLocaleString('ru-RU')}</span><b>${money(Number(i.price||0)*Number(i.qty||0))}</b></div>`).join('')||'<span>Позиции не сохранены</span>'}</div></details>
      </article>`;
    }).join('');
  }

  function open(){
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden','false');
    render().catch(console.warn);
  }

  nav.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();open()},{capture:true});
  chip?.addEventListener('click',()=>setTimeout(()=>render().catch(console.warn),0));
  retry?.addEventListener('click',()=>setTimeout(()=>render().catch(console.warn),1200));
  window.addEventListener('online',()=>render().catch(console.warn));
})();
