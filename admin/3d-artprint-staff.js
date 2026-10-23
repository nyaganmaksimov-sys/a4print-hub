// 3D-ARTPRINT employee administration. Authorization is enforced by the server function.
export async function renderStaffAdmin({supabase,root,profile}){
 root.replaceChildren();
 const roles=Array.isArray(profile?.roles)?profile.roles:[];
 const admin=roles.some(r=>r.name==='ADMIN')&&profile?.department?.organization?.code==='3DARTPRINT';
 if(!admin){const p=document.createElement('p');p.textContent='Управление учётными записями доступно только администратору 3D-ARTPRINT.';root.append(p);return}
 const section=document.createElement('section');section.className='art-staff-admin';
 const h=document.createElement('h2');h.textContent='Учётные записи операторов';
 const summary=document.createElement('p');summary.textContent='Создавайте операторам логины и временные пароли. Электронная почта сотрудника не требуется. Доступ привязан к его персональной учётной записи.';
 const message=document.createElement('p');message.className='art-staff-result';message.setAttribute('role','status');
 const form=document.createElement('form');form.className='art-staff-form';
 const mk=(label,name,type='text')=>{const wrap=document.createElement('label');wrap.textContent=label;const el=document.createElement('input');el.name=name;el.type=type;el.required=true;el.autocomplete=type==='password'?'new-password':'off';wrap.append(el);return wrap};
 form.append(mk('Имя оператора','name'),mk('Логин (латиницей)','login'),mk('Временный пароль (от 12 символов)','password','password'));
 const create=document.createElement('button');create.type='submit';create.textContent='Создать сотрудника';form.append(create);
 const members=document.createElement('div');members.className='art-staff-members';
 const invoke=async body=>{const {data,error}=await supabase.functions.invoke('artprint-staff-admin',{body});if(error)throw Error(error.message||'Ошибка серверной функции');if(data?.error)throw Error(data.error);return data};
 const refresh=async()=>{members.textContent='Загружаем сотрудников…';try{const result=await invoke({action:'list'});members.replaceChildren();if(!result.users?.length){members.textContent='Операторы ещё не созданы.';return}
  for(const u of result.users){
   const card=document.createElement('article');card.className='art-staff-person';
   const title=document.createElement('strong');title.textContent=u.name+' · '+u.login;
   const state=document.createElement('span');state.textContent=u.active?'Активен':'Заблокирован';
   const lock=document.createElement('button');lock.type='button';lock.textContent=u.active?'Заблокировать':'Разблокировать';
   lock.addEventListener('click',async()=>{if(!confirm((u.active?'Заблокировать':'Разблокировать')+' сотрудника '+u.login+'?'))return;lock.disabled=true;try{await invoke({action:'set_active',login:u.login,active:!u.active});message.textContent='Статус обновлён';await refresh()}catch(e){message.textContent=e.message;lock.disabled=false}});
   const reset=document.createElement('button');reset.type='button';reset.textContent='Сменить пароль';
   reset.addEventListener('click',async()=>{const password=prompt('Новый пароль для '+u.login+' (от 12 символов)');if(password===null)return;if(password.length<12){message.textContent='Пароль должен быть не короче 12 символов';return}reset.disabled=true;try{await invoke({action:'reset_password',login:u.login,password});message.textContent='Пароль изменён. Передайте его сотруднику лично.'}catch(e){message.textContent=e.message}finally{reset.disabled=false}});
   card.append(title,state,lock,reset);members.append(card);
  }
 }catch(e){members.textContent='Не удалось загрузить сотрудников: '+e.message}};
 form.addEventListener('submit',async e=>{e.preventDefault();const data=new FormData(form),name=String(data.get('name')||'').trim(),login=String(data.get('login')||'').trim().toLowerCase(),password=String(data.get('password')||'');if(!/^[a-z][a-z0-9._-]{2,31}$/.test(login)||name.length<2||password.length<12){message.textContent='Проверьте имя, логин и пароль (не менее 12 символов)';return}create.disabled=true;message.textContent='Создание сотрудника…';try{await invoke({action:'create',name,login,password});form.reset();message.textContent='Оператор '+login+' создан. Передайте ему логин и пароль лично.';await refresh()}catch(err){message.textContent='Ошибка создания: '+err.message}finally{create.disabled=false}});
 section.append(h,summary,form,message,members);root.append(section);await refresh();
}