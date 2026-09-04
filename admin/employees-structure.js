(()=>{
  const boot=()=>{
    if(!/\/admin\/employees\.html$/.test(location.pathname))return;
    const cfg=window.A4PRINT_CONFIG||{};
    import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm').then(async({createClient})=>{
      const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
      const $=id=>document.getElementById(id);
      let departments=[],organizations=[],positions=[],assignments=new Map();
      const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
      const selectedRoles=el=>[...el.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);
      async function session(){const{data:{session},error}=await supabase.auth.getSession();if(error||!session)throw error||new Error('AUTH_REQUIRED');return session}
      async function api(path,opt={}){const s=await session();const r=await fetch(cfg.apiBaseUrl+path,{...opt,headers:{Authorization:`Bearer ${s.access_token}`,'Content-Type':'application/json',...(opt.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||d.error||'Ошибка API');return d}
      async function loadStructure(){
        const[ou,org,pos,usr]=await Promise.all([
          supabase.from('organization_units').select('id,organization_id,name,code,is_active').eq('is_active',true).order('name'),
          supabase.from('organizations').select('id,name,code,is_active').eq('is_active',true).order('name'),
          supabase.from('staff_positions').select('id,organization_unit_id,name,code,is_active,sort_order').eq('is_active',true).order('sort_order').order('name'),
          supabase.from('users').select('id,position,position_id,organization_unit_id')
        ]);
        if(ou.error)throw ou.error;if(org.error)throw org.error;if(pos.error)throw pos.error;if(usr.error)throw usr.error;
        departments=ou.data||[];organizations=org.data||[];positions=pos.data||[];assignments=new Map((usr.data||[]).map(x=>[x.id,x]));
      }
      function departmentOptions(selected=''){
        return '<option value="">Выберите отдел</option>'+organizations.map(o=>{
          const list=departments.filter(d=>d.organization_id===o.id);
          if(!list.length)return'';
          return `<optgroup label="${esc(o.name)}">${list.map(d=>`<option value="${esc(d.id)}" ${d.id===selected?'selected':''}>${esc(d.name)}</option>`).join('')}</optgroup>`;
        }).join('');
      }
      function positionOptions(departmentId='',selected=''){
        const list=positions.filter(p=>p.organization_unit_id===departmentId);
        return '<option value="">Выберите должность</option>'+list.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('');
      }
      function wirePosition(deptId,posId){
        const dept=$(deptId),pos=$(posId);if(!dept||!pos)return;
        const redraw=(selected='')=>{pos.innerHTML=positionOptions(dept.value,selected);pos.disabled=!dept.value};
        dept.onchange=()=>redraw('');
        redraw(pos.value);
      }
      function ensureFields(){
        const employeeRoles=$('employeeRoles'),approveRoles=$('approveRoles');
        const actions=document.querySelector('.page-actions');
        if(actions&&!document.getElementById('manageStructure')){
          const a=document.createElement('a');a.id='manageStructure';a.href='./staff-structure.html';a.className='btn secondary';a.textContent='Отделы и должности';a.style.textDecoration='none';actions.prepend(a);
        }
        if(employeeRoles&&!$('employeeDepartment')){
          const wrap=document.createElement('div');wrap.className='grid2';wrap.id='employeeAssignmentFields';wrap.innerHTML=`<label class="field">Отдел<select id="employeeDepartment" required style="padding:11px 12px;border:1px solid #dbe2ea;border-radius:10px;font:inherit;background:#fff"></select></label><label class="field">Должность<select id="employeePosition" required style="padding:11px 12px;border:1px solid #dbe2ea;border-radius:10px;font:inherit;background:#fff"></select></label>`;employeeRoles.parentElement.before(wrap);
        }
        if(approveRoles&&!$('approveDepartment')){
          const wrap=document.createElement('div');wrap.className='grid2';wrap.innerHTML=`<label class="field">Отдел<select id="approveDepartment" required style="padding:11px 12px;border:1px solid #dbe2ea;border-radius:10px;font:inherit;background:#fff"></select></label><label class="field">Должность<select id="approvePosition" required style="padding:11px 12px;border:1px solid #dbe2ea;border-radius:10px;font:inherit;background:#fff"></select></label>`;approveRoles.parentElement.before(wrap);
        }
        if($('employeeDepartment'))$('employeeDepartment').innerHTML=departmentOptions($('employeeDepartment').value);
        if($('approveDepartment'))$('approveDepartment').innerHTML=departmentOptions($('approveDepartment').value);
        wirePosition('employeeDepartment','employeePosition');wirePosition('approveDepartment','approvePosition');
      }
      function orgName(id){return organizations.find(o=>o.id===id)?.name||''}
      function deptName(id){const d=departments.find(x=>x.id===id);return d?`${orgName(d.organization_id)} · ${d.name}`:''}
      function positionName(id,fallback=''){return positions.find(x=>x.id===id)?.name||fallback||''}
      function decorateRows(){
        document.querySelectorAll('#employeeList [data-edit]').forEach(btn=>{
          const id=btn.dataset.edit,a=assignments.get(id),tr=btn.closest('tr');if(!tr||!a)return;
          const person=tr.querySelector('.person > div:last-child');if(!person)return;
          let meta=person.querySelector('.assignment-meta');if(!meta){meta=document.createElement('div');meta.className='muted assignment-meta';person.appendChild(meta)}
          meta.textContent=[positionName(a.position_id,a.position),deptName(a.organization_unit_id)].filter(Boolean).join(' · ')||'Отдел и должность не назначены';
        });
      }
      async function refresh(){await loadStructure();ensureFields();decorateRows()}
      document.addEventListener('click',e=>{
        const edit=e.target.closest?.('[data-edit]');if(edit){setTimeout(()=>{ensureFields();const a=assignments.get(edit.dataset.edit)||{};$('employeeDepartment').value=a.organization_unit_id||'';$('employeePosition').innerHTML=positionOptions(a.organization_unit_id||'',a.position_id||'');$('employeePosition').value=a.position_id||'';$('employeePosition').disabled=!a.organization_unit_id},0)}
        const add=e.target.closest?.('#newEmployee');if(add){setTimeout(()=>{ensureFields();$('employeeDepartment').value='';$('employeePosition').innerHTML=positionOptions();$('employeePosition').disabled=true},0)}
        const approve=e.target.closest?.('[data-approve]');if(approve){setTimeout(()=>{ensureFields();$('approveDepartment').value='';$('approvePosition').innerHTML=positionOptions();$('approvePosition').disabled=true},0)}
      });
      $('employeeForm')?.addEventListener('submit',async e=>{
        e.preventDefault();e.stopImmediatePropagation();const err=$('employeeError');err.textContent='';
        const id=$('employeeId').value,role_ids=selectedRoles($('employeeRoles')),department_id=$('employeeDepartment').value,position_id=$('employeePosition').value;
        if(!role_ids.length){err.textContent='Выберите хотя бы одну роль.';return}if(!department_id){err.textContent='Выберите отдел.';return}if(!position_id){err.textContent='Выберите должность.';return}
        const body={full_name:$('fullName').value.trim(),phone:$('phone').value.trim(),role_ids};
        if(!id){body.email=$('email').value.trim();body.password=$('password').value}else{body.is_active=$('active').checked;if($('password').value)body.password=$('password').value}
        try{$('employeeSave').disabled=true;const result=await api(id?'/api/v1/users/'+id:'/api/v1/users',{method:id?'PATCH':'POST',body:JSON.stringify(body)});const userId=id||result.user?.id;if(!userId)throw new Error('Не удалось определить сотрудника для назначения отдела.');const{error:rErr}=await supabase.rpc('admin_set_staff_assignment_v2',{p_user_id:userId,p_department_id:department_id,p_position_id:position_id});if(rErr)throw rErr;location.reload()}catch(x){err.textContent=x?.message||'Не удалось сохранить сотрудника.'}finally{$('employeeSave').disabled=false}
      },true);
      $('approveForm')?.addEventListener('submit',async e=>{
        e.preventDefault();e.stopImmediatePropagation();const err=$('approveError');err.textContent='';const role_ids=selectedRoles($('approveRoles')),department_id=$('approveDepartment').value,position_id=$('approvePosition').value,request_id=$('requestId').value;
        if(!role_ids.length){err.textContent='Выберите хотя бы одну роль.';return}if(!department_id){err.textContent='Выберите отдел.';return}if(!position_id){err.textContent='Выберите должность.';return}
        try{$('approveSave').disabled=true;const{error:rErr}=await supabase.rpc('approve_staff_registration_v3',{p_request_id:request_id,p_role_ids:role_ids,p_department_id:department_id,p_position_id:position_id});if(rErr)throw rErr;location.reload()}catch(x){err.textContent=x?.message||'Не удалось одобрить заявку.'}finally{$('approveSave').disabled=false}
      },true);
      const observer=new MutationObserver(()=>decorateRows());const list=$('employeeList');if(list)observer.observe(list,{childList:true,subtree:true});
      refresh().catch(console.error);
    }).catch(console.error);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
