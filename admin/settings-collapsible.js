(()=>{
  if(!/\/admin\/settings\.html$/.test(location.pathname)) return;

  const STYLE_ID='a4-settings-collapsible-style';
  function injectStyle(){
    if(document.getElementById(STYLE_ID)) return;
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=`
      .a4-settings-controls{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin:0 0 14px}
      .a4-settings-controls button{border:1px solid #dbe2ea;background:#fff;color:#334155;border-radius:10px;padding:9px 12px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}
      .a4-settings-controls button:hover{background:#f8fafc}
      .a4-settings-card{padding:0!important;overflow:hidden}
      .a4-settings-card-toggle{width:100%;border:0;background:#fff;color:#0f172a;padding:17px 19px;display:flex;align-items:center;justify-content:space-between;gap:14px;text-align:left;cursor:pointer;font:inherit;font-weight:900;font-size:17px}
      .a4-settings-card-toggle:hover{background:#f8fafc}
      .a4-settings-card-toggle:focus-visible{outline:3px solid rgba(37,99,235,.22);outline-offset:-3px}
      .a4-settings-card-title{display:flex;align-items:center;gap:10px;min-width:0}
      .a4-settings-card-title small{display:block;color:#64748b;font-size:11px;font-weight:700;margin-top:2px}
      .a4-settings-card-chevron{width:30px;height:30px;display:grid;place-items:center;border-radius:9px;background:#f1f5f9;color:#475569;font-size:18px;transition:transform .18s ease,background .18s ease}
      .a4-settings-card.is-open .a4-settings-card-chevron{transform:rotate(180deg);background:#eaf2ff;color:#1d4ed8}
      .a4-settings-card-body{display:none;padding:0 19px 19px;border-top:1px solid transparent}
      .a4-settings-card.is-open .a4-settings-card-body{display:block;border-top-color:#eef2f7}
      .a4-settings-card-body>p:first-child{margin-top:15px}
      @media(max-width:850px){.a4-settings-controls{justify-content:stretch}.a4-settings-controls button{flex:1}.a4-settings-card-toggle{padding:15px 16px}.a4-settings-card-body{padding:0 16px 16px}}
    `;
    document.head.appendChild(style);
  }

  function makeCard(card,index){
    if(card.dataset.a4Collapsible==='1') return;
    const heading=card.querySelector(':scope > h2, :scope > h3');
    if(!heading) return;
    const title=heading.textContent.trim()||`Раздел ${index+1}`;
    const body=document.createElement('div');
    body.className='a4-settings-card-body';
    const bodyId=`a4-settings-body-${index+1}`;
    body.id=bodyId;

    [...card.children].forEach(node=>{
      if(node!==heading) body.appendChild(node);
    });
    heading.remove();

    const toggle=document.createElement('button');
    toggle.type='button';
    toggle.className='a4-settings-card-toggle';
    toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-controls',bodyId);
    toggle.innerHTML=`<span class="a4-settings-card-title"><span>${title}</span></span><span class="a4-settings-card-chevron" aria-hidden="true">⌄</span>`;
    toggle.addEventListener('click',()=>{
      const open=!card.classList.contains('is-open');
      card.classList.toggle('is-open',open);
      toggle.setAttribute('aria-expanded',String(open));
    });

    card.classList.add('a4-settings-card');
    card.dataset.a4Collapsible='1';
    card.append(toggle,body);
  }

  function setAll(open){
    document.querySelectorAll('.a4-settings-card').forEach(card=>{
      card.classList.toggle('is-open',open);
      card.querySelector('.a4-settings-card-toggle')?.setAttribute('aria-expanded',String(open));
    });
  }

  function init(){
    injectStyle();
    const grid=document.querySelector('.settings-grid');
    if(!grid) return;
    const cards=[...grid.querySelectorAll('.card')];
    cards.forEach(makeCard);
    // Всегда начинаем со свёрнутых модулей при загрузке страницы.
    setAll(false);

    if(!document.querySelector('.a4-settings-controls')){
      const controls=document.createElement('div');
      controls.className='a4-settings-controls';
      controls.innerHTML='<button type="button" data-a4-expand-settings>Развернуть все</button><button type="button" data-a4-collapse-settings>Свернуть все</button>';
      grid.parentNode.insertBefore(controls,grid);
      controls.querySelector('[data-a4-expand-settings]').onclick=()=>setAll(true);
      controls.querySelector('[data-a4-collapse-settings]').onclick=()=>setAll(false);
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
