// Legacy compatibility shim.
// The old drag-and-drop engine was competing with workspace-layout.js and could
// restore stale DOM order after refresh. Keep this file for older pages, but
// delegate all layout behavior to the single current engine.
(()=>{
  if(window.__A4_BLOCK_LAYOUT__||window.__A4_WORKSPACE_LAYOUT_LOADING__)return;
  if(window.__A4_DISABLE_BLOCK_LAYOUT__)return;
  window.__A4_WORKSPACE_LAYOUT_LOADING__=true;
  const base=new URL('./',document.currentScript?.src||location.href);
  const s=document.createElement('script');
  s.src=new URL('workspace-layout.js?v=20260908-stable4',base).href;
  s.async=false;
  s.dataset.a4WorkspaceLayout='1';
  s.onload=()=>{window.__A4_WORKSPACE_LAYOUT_LOADING__=false};
  s.onerror=()=>{window.__A4_WORKSPACE_LAYOUT_LOADING__=false;console.warn('A4 workspace layout failed to load')};
  document.head.appendChild(s);
})();
