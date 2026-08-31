(()=>{
  if(window.__A4PRINT_UI_ICONS__)return;window.__A4PRINT_UI_ICONS__=true;
  const svg=body=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const map={
    '🧑‍💼':svg('<circle cx="12" cy="7" r="3"/><path d="M6 20v-2a6 6 0 0 1 12 0v2M9 12h6"/>'),
    '💼':svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 12h18M10 12v2h4v-2"/>'),
    '👥':svg('<path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M17 11a4 4 0 0 1 4 4v2M16 3.2a4 4 0 0 1 0 7.6"/>'),
    '🛒':svg('<path d="M4 5h2l2 10h9l2-7H7"/><circle cx="10" cy="19" r="1"/><circle cx="17" cy="19" r="1"/>'),
    '🧮':svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>'),
    '💬':svg('<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8M8 13h5"/>'),
    '🏭':svg('<path d="M3 21V10l6 3V9l6 4V5h6v16Z"/><path d="M7 17h2M12 17h2M17 17h2"/>'),
    '📦':svg('<path d="m12 3 8 4-8 4-8-4 8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/>'),
    '📁':svg('<path d="M3 6h6l2 2h10v11H3Z"/>'),
    '💰':svg('<path d="M12 3v18M16 7.5c-.8-1-2-1.5-4-1.5-2.2 0-4 1-4 2.7 0 4 8 1.6 8 5.6 0 1.7-1.8 2.7-4 2.7-2 0-3.4-.6-4.3-1.7"/>'),
    '📊':svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    '⚙️':svg('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A7 7 0 0 0 15 6l-.3-2.6h-4L10.4 6A7 7 0 0 0 9 7.1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1A7 7 0 0 0 10.4 18l.3 2.6h4L15 18a7 7 0 0 0 1.5-1.1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z"/>'),
    '📖':svg('<path d="M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4Z"/><path d="M20 4h-6a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h6Z"/>'),
    '🧭':svg('<circle cx="12" cy="12" r="9"/><path d="m15 9-2 5-5 2 2-5 5-2Z"/>'),
    '🏠':svg('<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>'),
    '🔐':svg('<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2"/>'),
    '🤝':svg('<path d="M8 12 4.5 8.5a2.1 2.1 0 0 1 3-3L11 9"/><path d="m16 12 3.5-3.5a2.1 2.1 0 0 0-3-3L13 9"/><path d="m8 12 3 3a1.4 1.4 0 0 0 2 0l3-3"/>'),
    '☎️':svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"/>'),
    '☎':svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"/>'),
    '✉️':svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
    '✉':svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
    '🎨':svg('<path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 0-4H12a1.5 1.5 0 0 1 0-3h2a7 7 0 0 0-2-11Z"/><circle cx="7.5" cy="10" r=".7" fill="currentColor" stroke="none"/><circle cx="9" cy="6.5" r=".7" fill="currentColor" stroke="none"/><circle cx="14" cy="6.5" r=".7" fill="currentColor" stroke="none"/>'),
    '🖨️':svg('<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>'),
    '🧾':svg('<path d="M6 2h12v20l-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M9 7h6M9 11h6M9 15h4"/>'),
    '🏪':svg('<path d="M4 10v10h16V10M3 6h18l-1 4H4L3 6Z"/><path d="M8 20v-6h8v6"/>'),
    '✅':svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>'),
    '❌':svg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>')
  };
  const keys=Object.keys(map).sort((a,b)=>b.length-a.length);
  const css=document.createElement('style');css.textContent='.a4-inline-icon{display:inline-flex;align-items:center;justify-content:center;width:1.05em;height:1.05em;vertical-align:-.14em;margin-right:.28em;color:currentColor}.a4-inline-icon svg{display:block;width:100%;height:100%}';document.head.appendChild(css);
  function replaceNode(node){if(!node?.nodeValue||!keys.some(k=>node.nodeValue.includes(k)))return;const parent=node.parentElement;if(!parent||parent.closest('script,style,textarea,input,select,option,.a4-inline-icon'))return;let text=node.nodeValue,parts=[{text}];for(const key of keys){const next=[];for(const p of parts){if(p.icon){next.push(p);continue}const chunks=p.text.split(key);chunks.forEach((c,i)=>{if(c)next.push({text:c});if(i<chunks.length-1)next.push({icon:key})})}parts=next}const frag=document.createDocumentFragment();for(const p of parts){if(p.icon){const s=document.createElement('span');s.className='a4-inline-icon';s.innerHTML=map[p.icon];frag.appendChild(s)}else frag.appendChild(document.createTextNode(p.text))}node.replaceWith(frag)}
  function scan(root=document.body){if(!root)return;const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes=[];while(w.nextNode())nodes.push(w.currentNode);nodes.forEach(replaceNode)}
  const start=()=>{scan();new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes){if(n.nodeType===3)replaceNode(n);else if(n.nodeType===1)scan(n)}}).observe(document.body,{childList:true,subtree:true})};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();