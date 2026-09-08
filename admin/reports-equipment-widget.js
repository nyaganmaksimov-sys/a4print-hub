import {supabase} from './guard.js?v=20260905-netfix1';

if(!window.__A4_REPORTS_EQUIPMENT__){
  window.__A4_REPORTS_EQUIPMENT__=true;
  const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:0})+' ₽';
  const fmtDate=v=>{if(!v)return'—';const d=new Date(`${v}T00:00:00`);return Number.isFinite(d.getTime())?d.toLocaleDateString('ru-RU'):'—'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  let busy=false,channel=null,reloadTimer=null;

  function periodStart(){
    const key=document.querySelector('.reports-periods button.active')?.dataset.period||'TODAY';
    if(key==='ALL')return null;
    const d=new Date();d.setHours(0,0,0,0);
    if(key==='7D')d.setDate(d.getDate()-6);
    if(key==='30D')d.setDate(d.getDate()-29);
    return d.getTime();
  }

  function ensure(){
    let section=document.getElementById('reportsEquipmentSection');
    if(section)return section;
    const shell=document.querySelector('.reports-shell');if(!shell)return null;
    const activity=[...shell.children].find(x=>x.classList?.contains('reports-card')&&x.querySelector('#activity'));
    section=document.createElement('section');section.id='reportsEquipmentSection';section.className='reports-grid';
    section.innerHTML=`<article class="reports-card"><div class="reports-card-head"><div><h2>Оборудование и сервис</h2><p>ТО и ремонты за выбранный период</p></div><a href="./equipment.html" style="color:#2563eb;text-decoration:none;font-size:12px;font-weight:850">Открыть →</a></div><div class="report-money-stack" id="reportsEquipmentMoney"><div class="reports-empty">Загрузка…</div></div></article><article class="reports-card"><div class="reports-card-head"><div><h2>Контроль ТО</h2><p>Текущее состояние оборудования</p></div><span class="reports-badge">LIVE</span></div><div class="reports-card-body" id="reportsEquipmentDue"><div class="reports-empty">Загрузка…</div></div></article>`;
    if(activity)shell.insertBefore(section,activity);else shell.appendChild(section);
    return section;
  }

  function row(title,sub,value){return `<div class="report-row"><div class="report-row-main"><div class="report-row-title">${esc(title)}</div><div class="report-row-sub">${esc(sub)}</div></div><div class="report-row-value">${esc(value)}</div></div>`}

  async function load(){
    if(busy)return;busy=true;
    try{
      ensure();
      const [servicesR,assetsR]=await Promise.all([
        supabase.from('equipment_service_log').select('service_type,serviced_at,cost,description,provider'),
        supabase.from('equipment_assets').select('id,inventory_number,name,status,next_service_date').neq('status','WRITTEN_OFF')
      ]);
      if(servicesR.error)throw servicesR.error;if(assetsR.error)throw assetsR.error;
      const start=periodStart();
      const services=(servicesR.data||[]).filter(s=>{if(start==null)return true;const t=new Date(`${s.serviced_at}T00:00:00`).getTime();return Number.isFinite(t)&&t>=start});
      const cost=services.reduce((sum,s)=>sum+Number(s.cost||0),0);
      const maintenance=services.filter(s=>s.service_type==='MAINTENANCE').length;
      const repairs=services.filter(s=>s.service_type==='REPAIR').length;
      const moneyRoot=document.getElementById('reportsEquipmentMoney');
      if(moneyRoot)moneyRoot.innerHTML=`<div class="report-money-line total"><span>Затраты на обслуживание</span><b>${money(cost)}</b></div><div class="report-money-line"><span>Всего записей</span><b>${services.length}</b></div><div class="report-money-line"><span>Плановое ТО</span><b>${maintenance}</b></div><div class="report-money-line"><span>Ремонты</span><b>${repairs}</b></div>`;
      const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(),soon=today+14*86400000;
      const assets=assetsR.data||[];
      const overdue=assets.filter(a=>a.next_service_date&&new Date(`${a.next_service_date}T23:59:59`).getTime()<today).sort((a,b)=>String(a.next_service_date).localeCompare(String(b.next_service_date)));
      const upcoming=assets.filter(a=>{if(!a.next_service_date)return false;const t=new Date(`${a.next_service_date}T23:59:59`).getTime();return t>=today&&t<=soon}).sort((a,b)=>String(a.next_service_date).localeCompare(String(b.next_service_date)));
      const dueRoot=document.getElementById('reportsEquipmentDue');
      if(dueRoot){
        const rows=[];
        rows.push(row('Просрочено ТО',overdue.length?'Требуется обслуживание':'Всё в срок',String(overdue.length)));
        rows.push(row('В ближайшие 14 дней',upcoming.length?'Нужно запланировать':'Ближайших ТО нет',String(upcoming.length)));
        for(const a of overdue.slice(0,3))rows.push(row(`${a.inventory_number} · ${a.name}`,'Просрочено',fmtDate(a.next_service_date)));
        for(const a of upcoming.slice(0,3))rows.push(row(`${a.inventory_number} · ${a.name}`,'Запланировано ТО',fmtDate(a.next_service_date)));
        dueRoot.innerHTML=rows.join('');
      }
    }catch(error){
      console.warn('Equipment report unavailable',error);
      const a=document.getElementById('reportsEquipmentMoney'),b=document.getElementById('reportsEquipmentDue');
      if(a)a.innerHTML='<div class="reports-empty reports-error">Не удалось загрузить сервис оборудования</div>';
      if(b)b.innerHTML='<div class="reports-empty reports-error">Не удалось загрузить контроль ТО</div>';
    }finally{busy=false}
  }

  document.addEventListener('click',e=>{if(e.target.closest('.reports-periods button'))setTimeout(load,0)});
  if(typeof supabase.channel==='function'){
    const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(load,400)};
    let ch=supabase.channel('reports-equipment-v1');
    for(const table of ['equipment_assets','equipment_service_log'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);
    channel=ch.subscribe();window.addEventListener('beforeunload',()=>{if(channel)supabase.removeChannel(channel)},{once:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});else load();
}
