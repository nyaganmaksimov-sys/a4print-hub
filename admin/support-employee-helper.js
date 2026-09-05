(()=>{
  if(window.__A4_SUPPORT_EMPLOYEE_HELPER__)return;
  window.__A4_SUPPORT_EMPLOYEE_HELPER__=true;

  const contexts=[
    {roles:'employeeRoles',dept:'employeeDepartment',pos:'employeePosition'},
    {roles:'approveRoles',dept:'approveDepartment',pos:'approvePosition'},
    {roles:'inviteRoles',dept:'inviteDepartment',pos:'invitePosition'}
  ];

  function roleName(input){return input?.closest('.rolecheck')?.querySelector('b')?.textContent?.trim().toUpperCase()||''}
  function selectSupportPlace(ctx){
    const dept=document.getElementById(ctx.dept),pos=document.getElementById(ctx.pos);if(!dept||!pos)return;
    const supportDept=[...dept.options].find(o=>/служба поддержки/i.test(o.textContent||''));
    if(supportDept){dept.value=supportDept.value;dept.dispatchEvent(new Event('change',{bubbles:true}))}
    setTimeout(()=>{
      const supportPos=[...pos.options].find(o=>/оператор службы поддержки/i.test(o.textContent||''));
      if(supportPos)pos.value=supportPos.value;
    },0);
  }
  function wire(ctx){
    const host=document.getElementById(ctx.roles);if(!host||host.dataset.supportWired==='1')return false;
    host.dataset.supportWired='1';
    host.addEventListener('change',e=>{
      const input=e.target.closest('input[type="checkbox"]');if(!input)return;
      const name=roleName(input);
      if(name==='SUPPORT'&&input.checked){
        host.querySelectorAll('input[type="checkbox"]').forEach(x=>{if(x!==input)x.checked=false});
        selectSupportPlace(ctx);
        showNotice(host,'Роль SUPPORT изолирована: сотрудник будет видеть только раздел поддержки и свои служебные настройки.');
      }else if(input.checked){
        host.querySelectorAll('input[type="checkbox"]').forEach(x=>{if(roleName(x)==='SUPPORT')x.checked=false});
      }
    });
    return true;
  }
  function showNotice(host,text){
    let n=host.parentElement?.querySelector('.a4-support-role-note');
    if(!n){n=document.createElement('div');n.className='a4-support-role-note';n.style.cssText='margin-top:8px;padding:9px 11px;border-radius:10px;background:#eff6ff;color:#1e40af;font-size:11px;line-height:1.45';host.insertAdjacentElement('afterend',n)}
    n.textContent=text;
  }
  let tries=0;const timer=setInterval(()=>{
    tries++;let wired=0;contexts.forEach(c=>{if(wire(c)||document.getElementById(c.roles)?.dataset.supportWired==='1')wired++});
    if(wired===contexts.length||tries>80)clearInterval(timer);
  },250);
})();
