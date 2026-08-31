// A4PRINT HUB global block layout manager
// Enables safe per-page reordering of dashboard cards/sections and remembers layout in localStorage.
(() => {
  const STORAGE_PREFIX = 'a4print-hub-layout:v1:';
  const EDIT_CLASS = 'a4-layout-editing';
  const pageKey = STORAGE_PREFIX + location.pathname;
  let editing = false;
  let dragged = null;

  const css = document.createElement('style');
  css.textContent = `
    .a4-layout-toolbar{position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;gap:8px;align-items:center;padding:8px;background:rgba(15,23,42,.94);border-radius:14px;box-shadow:0 8px 28px rgba(15,23,42,.22)}
    .a4-layout-toolbar button{border:0;border-radius:9px;padding:9px 12px;font:700 12px/1 Arial,sans-serif;cursor:pointer;background:#fff;color:#0f172a}
    .a4-layout-toolbar button.a4-primary{background:#2563eb;color:#fff}
    .a4-layout-toolbar .a4-reset{display:none!important}.a4-layout-editing .a4-layout-toolbar .a4-reset{display:block!important}
    .a4-layout-handle{display:none!important;position:absolute;top:8px;right:8px;z-index:20;border:1px dashed #94a3b8!important;background:#fff!important;color:#334155!important;border-radius:8px!important;padding:6px 9px!important;font:700 11px/1 Arial,sans-serif!important;cursor:grab!important;box-shadow:0 2px 8px rgba(15,23,42,.12)}
    body:not(.a4-layout-editing) .a4-layout-handle{display:none!important;visibility:hidden!important;pointer-events:none!important}
    .a4-layout-editing .a4-layout-block{position:relative;outline:2px dashed rgba(37,99,235,.32);outline-offset:3px;min-height:40px}
    .a4-layout-editing .a4-layout-block>.a4-layout-handle{display:block!important;visibility:visible!important;pointer-events:auto!important}
    .a4-layout-block.a4-dragging{opacity:.45}.a4-layout-drop-before{box-shadow:0 -4px 0 #2563eb!important}.a4-layout-drop-after{box-shadow:0 4px 0 #2563eb!important}
    @media(max-width:700px){.a4-layout-toolbar{right:10px;bottom:10px}.a4-layout-toolbar button{padding:8px 9px}}
  `;
  document.head.appendChild(css);

  function textKey(el, i) {
    if (el.dataset.layoutKey) return el.dataset.layoutKey;
    const heading = el.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > .card-header h2,:scope > .card-header h3')?.textContent?.trim();
    const id = el.id || heading || `${el.tagName.toLowerCase()}-${i}`;
    const key = id.toLowerCase().replace(/\s+/g,'-').replace(/[^a-zа-яё0-9_-]+/gi,'').slice(0,80) || `block-${i}`;
    el.dataset.layoutKey = key;
    return key;
  }

  function candidateBlocks() {
    const main = document.querySelector('.main') || document.querySelector('main');
    if (!main) return [];
    const nodes = [...main.querySelectorAll('.card, article, .panel, .dashboard-card, .widget')];
    return nodes.filter(el => {
      if (el.closest('.sidebar,.topbar,header,nav,dialog,form,table,tbody,thead')) return false;
      const parentMovable = el.parentElement?.closest?.('.card,article,.panel,.dashboard-card,.widget');
      if (parentMovable && main.contains(parentMovable)) return false;
      const p = el.parentElement;
      if (!p) return false;
      return true;
    });
  }

  function markBlocks() {
    const blocks = candidateBlocks();
    blocks.forEach((el,i) => {
      el.classList.add('a4-layout-block');
      textKey(el,i);
      if (!el.querySelector(':scope > .a4-layout-handle')) {
        const h = document.createElement('button');
        h.type = 'button';
        h.className = 'a4-layout-handle';
        h.textContent = '↕ Переместить';
        h.title = 'Перетащите блок';
        h.draggable = true;
        h.hidden = !editing;
        el.prepend(h);
      }
    });
    syncHandleVisibility();
    return blocks;
  }

  function syncHandleVisibility() {
    document.querySelectorAll('.a4-layout-handle').forEach(h => {
      h.hidden = !editing;
      h.setAttribute('aria-hidden', editing ? 'false' : 'true');
      h.tabIndex = editing ? 0 : -1;
    });
  }

  function save() {
    const blocks = markBlocks();
    const state = blocks.map(el => ({
      key: el.dataset.layoutKey,
      parent: parentKey(el.parentElement),
      index: [...el.parentElement.children].filter(x=>x.classList?.contains('a4-layout-block')).indexOf(el)
    }));
    localStorage.setItem(pageKey, JSON.stringify(state));
  }

  function parentKey(parent) {
    if (!parent) return '';
    if (!parent.dataset.a4LayoutParent) {
      const all = [...document.querySelectorAll('.main *, main *')];
      const idx = all.indexOf(parent);
      parent.dataset.a4LayoutParent = parent.id ? `id:${parent.id}` : `p:${idx}`;
    }
    return parent.dataset.a4LayoutParent;
  }

  function restore() {
    const blocks = markBlocks();
    let state;
    try { state = JSON.parse(localStorage.getItem(pageKey) || '[]'); } catch { state=[]; }
    if (!Array.isArray(state) || !state.length) return;
    const byKey = Object.fromEntries(blocks.map(el=>[el.dataset.layoutKey,el]));
    const parents = new Map();
    document.querySelectorAll('[data-a4-layout-parent]').forEach(p=>parents.set(p.dataset.a4LayoutParent,p));
    state.forEach(s=>{
      const el=byKey[s.key], parent=parents.get(s.parent);
      if (!el || !parent) return;
      const siblings=[...parent.children].filter(x=>x.classList?.contains('a4-layout-block') && x!==el);
      const ref=siblings[Math.max(0,Math.min(Number(s.index)||0,siblings.length))] || null;
      parent.insertBefore(el,ref);
    });
  }

  function clearDropMarks() {
    document.querySelectorAll('.a4-layout-drop-before,.a4-layout-drop-after').forEach(x=>x.classList.remove('a4-layout-drop-before','a4-layout-drop-after'));
  }

  function enableDnD() {
    markBlocks();
    document.addEventListener('dragstart', e => {
      if (!editing || !e.target.classList?.contains('a4-layout-handle')) return;
      dragged = e.target.closest('.a4-layout-block');
      if (!dragged) return;
      dragged.classList.add('a4-dragging');
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain',dragged.dataset.layoutKey||'block');
    });
    document.addEventListener('dragover', e => {
      if (!editing || !dragged) return;
      const target=e.target.closest('.a4-layout-block');
      if (!target || target===dragged || target.parentElement!==dragged.parentElement) return;
      e.preventDefault(); clearDropMarks();
      const r=target.getBoundingClientRect();
      target.classList.add(e.clientY < r.top+r.height/2 ? 'a4-layout-drop-before' : 'a4-layout-drop-after');
    });
    document.addEventListener('drop', e => {
      if (!editing || !dragged) return;
      const target=e.target.closest('.a4-layout-block');
      if (!target || target===dragged || target.parentElement!==dragged.parentElement) return;
      e.preventDefault();
      const before=target.classList.contains('a4-layout-drop-before');
      target.parentElement.insertBefore(dragged,before?target:target.nextSibling);
      clearDropMarks(); save();
    });
    document.addEventListener('dragend',()=>{
      if (dragged) dragged.classList.remove('a4-dragging');
      dragged=null;clearDropMarks();
    });
  }

  function toolbar() {
    if (document.querySelector('.a4-layout-toolbar')) return;
    const bar=document.createElement('div'); bar.className='a4-layout-toolbar';
    const toggle=document.createElement('button'); toggle.type='button'; toggle.className='a4-primary'; toggle.textContent='Настроить блоки';
    const reset=document.createElement('button'); reset.type='button'; reset.className='a4-reset'; reset.textContent='Сбросить';
    toggle.onclick=()=>{
      editing=!editing;
      document.body.classList.toggle(EDIT_CLASS,editing);
      syncHandleVisibility();
      toggle.textContent=editing?'Готово':'Настроить блоки';
      if(!editing) save();
    };
    reset.onclick=()=>{localStorage.removeItem(pageKey);location.reload()};
    bar.append(toggle,reset); document.body.appendChild(bar);
  }

  function init(){
    if (/\/admin\/login\.html$/.test(location.pathname)) return;
    document.body.classList.remove(EDIT_CLASS);
    markBlocks(); restore(); enableDnD(); toolbar();
    syncHandleVisibility();
    const obs=new MutationObserver(()=>markBlocks());
    const main=document.querySelector('.main')||document.querySelector('main');
    if(main) obs.observe(main,{childList:true,subtree:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();