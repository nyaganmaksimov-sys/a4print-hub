(()=>{
  function installCompactCardFix(){
    if(document.getElementById('a4-partners-compact-card-fix'))return;
    const style=document.createElement('style');
    style.id='a4-partners-compact-card-fix';
    style.textContent=`
      html body.partners-modern .main .grid{
        grid-auto-rows:112px!important;
        align-items:start!important;
      }
      html body.partners-modern .main .grid article.card.partners-popup-card:not(.is-modal-open){
        height:112px!important;
        min-height:112px!important;
        max-height:112px!important;
        padding:0!important;
        align-self:start!important;
        overflow:hidden!important;
      }
      html body.partners-modern .main .grid article.card.partners-popup-card:not(.is-modal-open)>button.partners-compact-shell{
        display:grid!important;
        position:static!important;
        width:100%!important;
        height:112px!important;
        min-height:112px!important;
        max-height:112px!important;
        margin:0!important;
        padding:12px 14px!important;
        grid-template-columns:36px minmax(0,1fr) auto!important;
        grid-template-rows:22px minmax(0,1fr) 20px!important;
        column-gap:10px!important;
        row-gap:2px!important;
        align-items:center!important;
        justify-items:stretch!important;
        justify-content:stretch!important;
        border:0!important;
        border-radius:0!important;
        background:transparent!important;
        color:inherit!important;
        box-shadow:none!important;
        transform:none!important;
        text-align:left!important;
        white-space:normal!important;
        overflow:hidden!important;
        box-sizing:border-box!important;
        line-height:1.2!important;
      }
      html body.partners-modern .main .grid article.card.partners-popup-card:not(.is-modal-open)>button.partners-compact-shell::before,
      html body.partners-modern .main .grid article.card.partners-popup-card:not(.is-modal-open)>button.partners-compact-shell::after{
        display:none!important;
        content:none!important;
      }
      html body.partners-modern .partners-compact-shell>.partners-compact-icon{
        display:grid!important;
        grid-column:1!important;
        grid-row:1/4!important;
        place-items:center!important;
        align-self:center!important;
        width:34px!important;
        height:34px!important;
        min-width:34px!important;
        min-height:34px!important;
        margin:0!important;
        padding:0!important;
        border-radius:10px!important;
        font-size:16px!important;
        line-height:1!important;
      }
      html body.partners-modern .partners-compact-shell>.partners-compact-title{
        display:block!important;
        grid-column:2/4!important;
        grid-row:1!important;
        min-width:0!important;
        margin:0!important;
        padding:0!important;
        color:#0f172a!important;
        font-size:14px!important;
        line-height:1.2!important;
        font-weight:900!important;
        white-space:nowrap!important;
        overflow:hidden!important;
        text-overflow:ellipsis!important;
      }
      html body.partners-modern .partners-compact-shell>.partners-compact-desc{
        display:block!important;
        grid-column:2/4!important;
        grid-row:2!important;
        align-self:start!important;
        min-width:0!important;
        max-width:none!important;
        margin:3px 0 0!important;
        padding:0!important;
        color:#748398!important;
        font-size:10.5px!important;
        line-height:1.3!important;
        white-space:nowrap!important;
        overflow:hidden!important;
        text-overflow:ellipsis!important;
      }
      html body.partners-modern .partners-compact-shell>.partners-compact-bottom{
        display:flex!important;
        grid-column:2/4!important;
        grid-row:3!important;
        align-items:center!important;
        justify-content:space-between!important;
        min-width:0!important;
        margin:0!important;
        padding:0!important;
        gap:10px!important;
      }
      html body.partners-modern .partners-compact-stat,
      html body.partners-modern .partners-compact-open{
        display:block!important;
        margin:0!important;
        padding:0!important;
        font-size:10px!important;
        line-height:1.15!important;
        white-space:nowrap!important;
      }
      html body.partners-modern .partners-compact-stat{
        min-width:0!important;
        overflow:hidden!important;
        text-overflow:ellipsis!important;
      }
      html body.partners-modern .partners-compact-open{
        flex:none!important;
        color:#2563eb!important;
        font-weight:850!important;
      }
      html body.partners-modern .partners-popup-card.is-modal-open{
        max-height:none!important;
        grid-row:auto!important;
      }
      @media(max-width:760px){
        html body.partners-modern .main .grid{grid-auto-rows:104px!important}
        html body.partners-modern .main .grid article.card.partners-popup-card:not(.is-modal-open),
        html body.partners-modern .main .grid article.card.partners-popup-card:not(.is-modal-open)>button.partners-compact-shell{
          height:104px!important;
          min-height:104px!important;
          max-height:104px!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function init(){
    installCompactCardFix();
    const select=document.getElementById('outService');
    if(!select||document.getElementById('outServiceSearch'))return;
    const label=select.closest('label');
    if(!label)return;
    const input=document.createElement('input');
    input.id='outServiceSearch';
    input.type='search';
    input.placeholder='Быстрый поиск услуги: название, категория…';
    input.autocomplete='off';
    input.style.marginBottom='8px';
    input.style.padding='10px 11px';
    input.style.border='1px solid #dbe1ea';
    input.style.borderRadius='9px';
    input.style.width='100%';
    label.insertBefore(input,select);
    let snapshot=[];
    const take=()=>{snapshot=[...select.options].map(o=>({value:o.value,text:o.textContent||'',disabled:o.disabled}))};
    const apply=()=>{
      const q=input.value.trim().toLowerCase(),current=select.value;
      if(!snapshot.length)take();
      const list=q?snapshot.filter((o,i)=>i===0||o.text.toLowerCase().includes(q)):snapshot;
      select.innerHTML='';
      for(const o of list){const el=document.createElement('option');el.value=o.value;el.textContent=o.text;el.disabled=o.disabled;select.appendChild(el)}
      if([...select.options].some(o=>o.value===current))select.value=current;
      else if(q&&select.options.length===2)select.selectedIndex=1;
      select.dispatchEvent(new Event('change',{bubbles:true}));
    };
    input.addEventListener('input',apply);
    const obs=new MutationObserver(()=>{if(document.activeElement!==input){take();if(input.value)apply()}});
    obs.observe(select,{childList:true});
    take();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
  setTimeout(init,800);
  setTimeout(installCompactCardFix,1400);
})();