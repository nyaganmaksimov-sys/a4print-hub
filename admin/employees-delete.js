(async function(){
  if(window.__A4_EMPLOYEE_DELETE__)return;window.__A4_EMPLOYEE_DELETE__=true;
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const cfg=window.A4PRINT_CONFIG||{};
  const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
  const edgeUrl=`${cfg.supabaseUrl}/functions/v1/staff-admin`;
  let busy=false;

  async function removeEmployee(userId,name,button){
    if(busy)return;
    const label=name||'этого сотрудника';
    if(!confirm(`Удалить сотрудника «${label}»?\n\nБудут удалены профиль сотрудника, его роли и учётная запись для входа. История рабочих операций и сообщений останется в системе.`))return;
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){location.replace('./login.html');return}
    busy=true;
    const old=button.textContent;
    button.disabled=true;
    button.textContent='Удаляем…';
    try{
      const r=await fetch(edgeUrl,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.supabasePublishableKey,'Authorization':`Bearer ${session.access_token}`},body:JSON.stringify({action:'delete',user_id:userId})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.message||d.error||'Не удалось удалить сотрудника.');
      document.getElementById('refresh')?.click();
    }catch(e){
      alert(e?.message||'Не удалось удалить сотрудника.');
      button.disabled=false;
      button.textContent=old;
    }finally{busy=false}
  }

  function enhance(){
    document.querySelectorAll('#employeeList button[data-edit]').forEach(edit=>{
      if(edit.dataset.deleteReady==='1')return;
      edit.dataset.deleteReady='1';
      const td=edit.closest('td');if(!td)return;
      let wrap=td.querySelector('.employee-row-actions');
      if(!wrap){wrap=document.createElement('div');wrap.className='employee-row-actions';td.insertBefore(wrap,edit);wrap.appendChild(edit)}
      const del=document.createElement('button');
      del.type='button';del.className='btn danger';del.textContent='Удалить';del.dataset.deleteEmployee=edit.dataset.edit;
      const name=edit.closest('tr')?.querySelector('.person b')?.textContent?.trim()||'';
      del.onclick=()=>removeEmployee(edit.dataset.edit,name,del);
      wrap.appendChild(del);
    });
  }

  const style=document.createElement('style');
  style.textContent='.employee-row-actions{display:flex;gap:7px;flex-wrap:wrap;align-items:center}.employee-row-actions .btn{padding:8px 11px;white-space:nowrap}@media(max-width:800px){.employee-row-actions{min-width:190px}}';
  document.head.appendChild(style);

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enhance,{once:true});else enhance();
  const wait=()=>{const target=document.getElementById('employeeList');if(target){enhance();new MutationObserver(enhance).observe(target,{childList:true,subtree:true});return}setTimeout(wait,120)};wait();
})().catch(e=>console.error('Employee delete controls failed',e));
