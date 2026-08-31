(()=>{
  if(window.__A4PRINT_DIALOG_FIXES__)return;window.__A4PRINT_DIALOG_FIXES__=true;
  document.addEventListener('click',e=>{
    const btn=e.target.closest('dialog form[method="dialog"] button[value="cancel"]');
    if(!btn)return;
    e.preventDefault();
    const dlg=btn.closest('dialog');
    if(dlg?.open)dlg.close('cancel');
  },true);
})();