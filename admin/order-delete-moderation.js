import { supabase } from './guard.js?v=20260905-netfix1';

if (!window.__A4_ORDER_DELETE_MODERATION__) {
  window.__A4_ORDER_DELETE_MODERATION__=true;

  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=(value)=>Number(value||0).toLocaleString('ru-RU',{maximumFractionDigits:2});
  const when=(value)=>value?new Date(value).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
  let rows=[];
  let active=false;
  let badgeTimer=null;

  function injectStyles(){
    if(document.getElementById('a4-order-delete-moderation-style'))return;
    const style=document.createElement('style');
    style.id='a4-order-delete-moderation-style';
    style.textContent=`
      #orderDeleteModeration[hidden]{display:none!important}.delete-mod-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:14px}.delete-mod-head h2{margin:0}.delete-mod-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px}.delete-mod-stat{background:#fff;border:1px solid #dbe3ee;border-radius:14px;padding:14px}.delete-mod-stat small{color:#64748b}.delete-mod-stat strong{display:block;font-size:23px;margin-top:4px}.delete-mod-list{display:grid;gap:12px}.delete-mod-card{background:#fff;border:1px solid #dbe3ee;border-radius:16px;padding:16px}.delete-mod-card.pending{border-color:#fde68a}.delete-mod-card.approved{border-color:#bbf7d0}.delete-mod-card.rejected{border-color:#fecaca}.delete-mod-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.delete-mod-title h3{margin:0 0 5px}.delete-mod-meta{display:flex;gap:7px;flex-wrap:wrap}.delete-mod-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.delete-mod-box{padding:11px 12px;background:#f8fafc;border-radius:11px;line-height:1.45}.delete-mod-box b{display:block;margin-bottom:3px}.delete-mod-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.delete-mod-approve{background:#16a34a!important;color:#fff!important;border-color:#16a34a!important}.delete-mod-reject{background:#fff!important;color:#b91c1c!important;border-color:#fecaca!important}.delete-mod-status{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:11px;font-weight:800}.delete-mod-status.NEW{background:#fef3c7;color:#92400e}.delete-mod-status.APPROVED{background:#dcfce7;color:#166534}.delete-mod-status.REJECTED{background:#fee2e2;color:#991b1b}.delete-mod-empty{padding:32px;text-align:center;color:#94a3b8;border:1px dashed #dbe3ee;border-radius:14px;background:#fff}.delete-mod-reload{border:1px solid #dbe3ee;background:#fff;border-radius:10px;padding:9px 12px;font-weight:800;cursor:pointer}@media(max-width:760px){.delete-mod-summary,.delete-mod-grid{grid-template-columns:1fr}.delete-mod-title{flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  function statusText(value){return {NEW:'Ожидает решения',APPROVED:'Одобрено',REJECTED:'Отклонено'}[value]||value||'—'}

  function originalNodes(){
    return {
      stats:document.querySelector('main .stats'),
      toolbar:document.querySelector('main .toolbar'),
      list:document.getElementById('list')
    };
  }

  function setMode(enabled){
    active=enabled;
    const custom=document.getElementById('orderDeleteModeration');
    const nodes=originalNodes();
    if(custom)custom.hidden=!enabled;
    if(nodes.stats)nodes.stats.hidden=enabled;
    if(nodes.toolbar)nodes.toolbar.hidden=enabled;
    if(nodes.list)nodes.list.hidden=enabled;
    document.querySelectorAll('.tabs .tab').forEach(button=>button.classList.toggle('active',enabled?button.dataset.orderDeleteTab==='1':button.dataset.orderDeleteTab!=='1'&&button.classList.contains('active')));
  }

  function render(){
    const panel=document.getElementById('orderDeleteModeration');
    if(!panel)return;
    const newCount=rows.filter(x=>x.status==='NEW').length;
    const approved=rows.filter(x=>x.status==='APPROVED').length;
    const rejected=rows.filter(x=>x.status==='REJECTED').length;
    const cards=rows.map(r=>{
      const status=String(r.status||'NEW');
      const orderExists=Boolean(r.order_id);
      return `<article class="delete-mod-card ${status==='NEW'?'pending':status.toLowerCase()}">
        <div class="delete-mod-title"><div><h3>Удаление заказа №${esc(r.order_number)}</h3><div class="delete-mod-meta"><span class="delete-mod-status ${esc(status)}">${esc(statusText(status))}</span><span class="chip">${esc(when(r.created_at))}</span>${r.order_source?`<span class="chip">${esc(r.order_source)}</span>`:''}</div></div><b>${money(r.order_total)} ₽</b></div>
        <div class="delete-mod-grid">
          <div class="delete-mod-box"><b>Запросил</b>${esc(r.requester_name||'—')}${r.requester_email?`<br><small>${esc(r.requester_email)}</small>`:''}</div>
          <div class="delete-mod-box"><b>Заказ</b>${r.customer_name?`Клиент: ${esc(r.customer_name)}<br>`:''}Статус: ${esc(r.order_status||'—')}<br>${orderExists?'Заказ пока существует':'Заказ удалён'}</div>
          <div class="delete-mod-box" style="grid-column:1/-1"><b>Причина удаления</b>${esc(r.reason||'Не указана')}</div>
          ${status!=='NEW'?`<div class="delete-mod-box" style="grid-column:1/-1"><b>Решение</b>${esc(r.reviewer_name||'Администратор')} · ${esc(when(r.reviewed_at))}${r.reviewer_comment?`<br>${esc(r.reviewer_comment)}`:''}</div>`:''}
        </div>
        ${status==='NEW'?`<div class="delete-mod-actions"><button class="delete-mod-approve" data-delete-approve="${esc(r.id)}">Одобрить удаление</button><button class="delete-mod-reject" data-delete-reject="${esc(r.id)}">Отклонить</button></div>`:''}
      </article>`;
    }).join('')||'<div class="delete-mod-empty">Запросов на удаление заказов пока нет</div>';
    panel.innerHTML=`<div class="delete-mod-head"><div><h2>Удаление заказов</h2><div class="note">Менеджер отправляет запрос, заказ удаляется только после решения администратора.</div></div><button class="delete-mod-reload" id="deleteModReload">↻ Обновить</button></div><div class="delete-mod-summary"><div class="delete-mod-stat"><small>На модерации</small><strong>${newCount}</strong></div><div class="delete-mod-stat"><small>Одобрено</small><strong>${approved}</strong></div><div class="delete-mod-stat"><small>Отклонено</small><strong>${rejected}</strong></div></div><div class="delete-mod-list">${cards}</div>`;
    document.getElementById('deleteModReload')?.addEventListener('click',loadRows);
    panel.querySelectorAll('[data-delete-approve]').forEach(button=>button.addEventListener('click',()=>moderate(button.dataset.deleteApprove,true,button)));
    panel.querySelectorAll('[data-delete-reject]').forEach(button=>button.addEventListener('click',()=>moderate(button.dataset.deleteReject,false,button)));
  }

  async function loadRows(){
    const panel=document.getElementById('orderDeleteModeration');
    if(panel&&active)panel.innerHTML='<div class="delete-mod-empty">Загрузка запросов…</div>';
    const result=await supabase.from('order_deletion_requests').select('*').order('created_at',{ascending:false}).limit(500);
    if(result.error){
      if(panel&&active)panel.innerHTML=`<div class="delete-mod-empty">Не удалось загрузить запросы: ${esc(result.error.message)}</div>`;
      return;
    }
    rows=result.data||[];
    updateBadge();
    if(active)render();
  }

  function updateBadge(){
    const badge=document.getElementById('orderDeleteBadge');
    if(!badge)return;
    const count=rows.filter(x=>x.status==='NEW').length;
    badge.textContent=count?`(${count})`:'';
  }

  async function refreshBadge(){
    const result=await supabase.from('order_deletion_requests').select('id,status',{count:'exact'}).eq('status','NEW').limit(100);
    if(result.error)return;
    const badge=document.getElementById('orderDeleteBadge');
    const count=result.count??(result.data||[]).length;
    if(badge)badge.textContent=count?`(${count})`:'';
  }

  async function moderate(id,approve,button){
    const row=rows.find(x=>x.id===id);
    if(!row)return;
    let comment='';
    if(approve){
      if(!window.confirm(`Одобрить удаление заказа №${row.order_number}?\n\nЗаказ будет удалён из HUB. Запись о модерации останется в журнале.`))return;
      const value=window.prompt('Комментарий администратора (необязательно):','');
      if(value===null)return;
      comment=value.trim();
    }else{
      const value=window.prompt(`Почему отклоняется удаление заказа №${row.order_number}?`,'');
      if(value===null)return;
      comment=value.trim();
      if(!comment){window.alert('Укажите причину отклонения для менеджера.');return}
    }
    button.disabled=true;
    const old=button.textContent;
    button.textContent=approve?'Удаляем…':'Отклоняем…';
    const result=await supabase.rpc('moderate_order_deletion',{p_request_id:id,p_approve:approve,p_comment:comment||null});
    if(result.error){
      button.disabled=false;button.textContent=old;
      window.alert(`Не удалось обработать запрос: ${result.error.message}`);
      return;
    }
    await loadRows();
  }

  async function start(){
    if(!/\/admin\/requests\.html$/.test(location.pathname))return;
    const role=await supabase.rpc('has_role',{required_role:'ADMIN'});
    if(role.error||!role.data)return;
    injectStyles();
    const tabs=document.querySelector('.tabs');
    const list=document.getElementById('list');
    if(!tabs||!list)return;

    const button=document.createElement('button');
    button.type='button';button.className='btn tab';button.dataset.orderDeleteTab='1';
    button.innerHTML='Удаление заказов <span id="orderDeleteBadge"></span>';
    tabs.appendChild(button);

    const panel=document.createElement('div');
    panel.id='orderDeleteModeration';panel.hidden=true;
    list.insertAdjacentElement('afterend',panel);

    button.addEventListener('click',async()=>{
      document.querySelectorAll('.tabs .tab').forEach(x=>x.classList.toggle('active',x===button));
      setMode(true);
      await loadRows();
    });
    tabs.querySelectorAll('.tab[data-tab]').forEach(original=>original.addEventListener('click',()=>{
      setMode(false);
      document.querySelectorAll('.tabs .tab').forEach(x=>x.classList.toggle('active',x===original));
    }));

    await refreshBadge();
    badgeTimer=setInterval(refreshBadge,45000);
    window.addEventListener('beforeunload',()=>clearInterval(badgeTimer),{once:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
}
