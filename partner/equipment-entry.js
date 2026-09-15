(()=>{
  if(/\/partner\/equipment\.html$/.test(location.pathname))return;
  function add(){
    if(document.getElementById('partnerEquipmentEntry'))return;
    const top=document.querySelector('.top');
    if(!top)return;
    let actions=top.querySelector('[data-partner-top-actions]');
    if(!actions){
      actions=document.createElement('div');
      actions.dataset.partnerTopActions='1';
      actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;align-items:center';
      const logout=top.querySelector('#logout');
      if(logout){top.insertBefore(actions,logout);actions.appendChild(logout)}else top.appendChild(actions);
    }
    const a=document.createElement('a');
    a.id='partnerEquipmentEntry';a.href='./equipment.html';a.textContent='⚙ Моё оборудование';
    a.style.cssText='display:inline-flex;align-items:center;padding:10px 13px;border-radius:10px;background:#fff;color:#0f172a;text-decoration:none;font-weight:800';
    actions.insertBefore(a,actions.firstChild);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add);else add();
})();
