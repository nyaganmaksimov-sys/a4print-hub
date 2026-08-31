(()=>{
  if(window.__A4PRINT_DIALOG_FIXES__)return;window.__A4PRINT_DIALOG_FIXES__=true;

  function wireCancelButtons(root=document){
    root.querySelectorAll('dialog form[method="dialog"] button[value="cancel"]').forEach(btn=>{
      if(btn.dataset.a4CancelReady==='1')return;
      btn.dataset.a4CancelReady='1';
      btn.type='button';
      btn.addEventListener('click',e=>{
        e.preventDefault();
        e.stopPropagation();
        const dlg=btn.closest('dialog');
        if(dlg?.open)dlg.close('cancel');
      });
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>wireCancelButtons(),{once:true});
  else wireCancelButtons();

  new MutationObserver(mutations=>{
    for(const m of mutations){
      for(const node of m.addedNodes){
        if(node.nodeType!==1)continue;
        if(node.matches?.('dialog form[method="dialog"] button[value="cancel"]'))wireCancelButtons(node.parentElement||document);
        else if(node.querySelector?.('dialog form[method="dialog"] button[value="cancel"]'))wireCancelButtons(node);
      }
    }
  }).observe(document.documentElement,{childList:true,subtree:true});
})();