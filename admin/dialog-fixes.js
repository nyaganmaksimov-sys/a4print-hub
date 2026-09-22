(()=>{
  if(window.__A4PRINT_DIALOG_FIXES__)return;
  window.__A4PRINT_DIALOG_FIXES__=true;

  // One delegated handler is enough for both static and dynamically created dialogs.
  // Do not observe the entire document and do not bootstrap legacy workspace-layout.
  document.addEventListener('click',event=>{
    const btn=event.target?.closest?.('dialog form[method="dialog"] button[value="cancel"]');
    if(!btn)return;
    const dlg=btn.closest('dialog');
    if(!dlg?.open)return;
    event.preventDefault();
    event.stopPropagation();
    dlg.close('cancel');
  });
})();
