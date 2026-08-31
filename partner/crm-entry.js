(()=>{
  // CRM pages already have their own navigation. Do not add a duplicate floating button there.
  if(/\/partner\/login\.html$/.test(location.pathname)||/\/partner\/crm(?:-[^/]*)?\.html$/.test(location.pathname))return;
  const add=()=>{
    if(document.getElementById('partnerCrmEntry'))return;
    const link=document.createElement('a');
    link.id='partnerCrmEntry';
    link.href='./crm.html';
    link.textContent='Открыть CRM';
    link.style.cssText='display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:10px;background:#fff;color:#0f172a;text-decoration:none;font-weight:800;margin-right:8px';
    const top=document.querySelector('.top');
    if(top){
      const actions=top.lastElementChild;
      if(actions&&actions.tagName==='BUTTON')actions.parentNode.insertBefore(link,actions);else top.appendChild(link);
    }else{
      link.style.cssText+=';position:fixed;right:20px;top:20px;z-index:10000;background:#2563eb;color:#fff';
      document.body.appendChild(link);
    }
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add,{once:true});else add();
})();