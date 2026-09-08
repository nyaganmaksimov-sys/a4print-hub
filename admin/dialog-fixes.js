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

  const loadWorkspaceLayout=()=>{
    if(document.querySelector('script[data-a4-workspace-layout]'))return;
    const s=document.createElement('script');
    s.dataset.a4WorkspaceLayout='1';
    s.src=new URL('workspace-layout.js',document.currentScript?.src||location.href).href+'?v=20260908-1';
    s.async=false;
    document.head.appendChild(s);
  };
  if(document.readyState==='complete')setTimeout(loadWorkspaceLayout,120);
  else window.addEventListener('load',()=>setTimeout(loadWorkspaceLayout,120),{once:true});
})();