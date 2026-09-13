(()=>{
  if(window.__A4_PARTNERS_WORKSPACE_V4__)return;
  window.__A4_PARTNERS_WORKSPACE_V4__=true;

  const STYLE_ID='a4-partners-workspace-v4-styles';

  function installStyles(){
    let style=document.getElementById(STYLE_ID);
    if(!style){
      style=document.createElement('style');
      style.id=STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent=`
      /* Partners v4: keep the whole workspace visible; no compact modal tiles. */
      html body.partners-modern .main{
        max-width:none!important;
      }
      html body.partners-modern .partners-summary{
        margin:0 0 16px!important;
        gap:10px!important;
      }
      html body.partners-modern .grid{
        display:grid!important;
        grid-template-columns:minmax(0,1.38fr) minmax(380px,.72fr)!important;
        gap:16px!important;
        align-items:start!important;
      }
      html body.partners-modern .grid>div{
        display:block!important;
        min-width:0!important;
      }
      html body.partners-modern .grid>div>.card,
      html body.partners-modern .grid>div>.partners-popup-card{
        width:auto!important;
        margin:0 0 16px!important;
      }
      html body.partners-modern .grid>div>.card:last-child,
      html body.partners-modern .grid>div>.partners-popup-card:last-child{
        margin-bottom:0!important;
      }

      html body.partners-modern .grid article.partners-popup-card,
      html body.partners-modern .grid article.partners-popup-card:not(.is-modal-open),
      html body.partners-modern .grid article.partners-popup-card.is-modal-open{
        position:relative!important;
        inset:auto!important;
        top:auto!important;
        right:auto!important;
        bottom:auto!important;
        left:auto!important;
        z-index:auto!important;
        display:block!important;
        width:auto!important;
        height:auto!important;
        min-height:0!important;
        max-width:none!important;
        max-height:none!important;
        padding:19px!important;
        border:1px solid #e0e8f2!important;
        border-radius:18px!important;
        background:#fff!important;
        box-shadow:0 6px 22px rgba(31,52,79,.045)!important;
        overflow:visible!important;
        transform:none!important;
      }
      html body.partners-modern .grid article.partners-popup-card>.partners-compact-shell,
      html body.partners-modern .grid article.partners-popup-card>.partners-popup-close{
        display:none!important;
      }
      html body.partners-modern .grid article.partners-popup-card>.partners-full-content,
      html body.partners-modern .grid article.partners-popup-card:not(.is-modal-open)>.partners-full-content,
      html body.partners-modern .grid article.partners-popup-card.is-modal-open>.partners-full-content{
        display:block!important;
        width:auto!important;
        max-width:none!important;
        margin:0!important;
      }
      html body.partners-modern .partners-modal-backdrop{
        display:none!important;
        opacity:0!important;
        pointer-events:none!important;
      }
      html body.partners-modern.partners-popup-open{
        overflow:auto!important;
      }

      /* Restore the natural two-column hierarchy. */
      html body.partners-modern .partners-database-card,
      html body.partners-modern .partners-catalog-card,
      html body.partners-modern .partner-invite-card,
      html body.partners-modern .partners-create-card,
      html body.partners-modern .partners-outbound-card{
        order:initial!important;
        grid-column:auto!important;
      }

      html body.partners-modern .partners-database-card{
        min-height:360px!important;
      }
      html body.partners-modern .partners-database-card .toolbar{
        margin-top:12px!important;
      }
      html body.partners-modern .partners-catalog-card #services{
        margin-top:12px!important;
      }
      html body.partners-modern .partner-invite-card{
        background:linear-gradient(180deg,#fff 0%,#fbfdff 100%)!important;
      }

      @media(max-width:1180px){
        html body.partners-modern .grid{
          grid-template-columns:minmax(0,1.15fr) minmax(340px,.85fr)!important;
        }
      }
      @media(max-width:980px){
        html body.partners-modern .grid{
          grid-template-columns:1fr!important;
        }
        html body.partners-modern .grid>div{
          display:block!important;
        }
      }
      @media(max-width:760px){
        html body.partners-modern .grid article.partners-popup-card,
        html body.partners-modern .grid article.partners-popup-card:not(.is-modal-open),
        html body.partners-modern .grid article.partners-popup-card.is-modal-open{
          padding:16px!important;
          border-radius:16px!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function normalize(){
    installStyles();
    document.body.classList.remove('partners-popup-open');
    document.querySelectorAll('.partners-modal-backdrop').forEach(el=>{
      el.classList.remove('is-active');
      el.setAttribute('aria-hidden','true');
    });
    document.querySelectorAll('.partners-popup-card.is-modal-open').forEach(card=>{
      card.classList.remove('is-modal-open');
      card.setAttribute('aria-hidden','false');
    });
  }

  let timer=0;
  const schedule=()=>{
    clearTimeout(timer);
    timer=setTimeout(normalize,70);
  };

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>{
      setTimeout(normalize,120);
      setTimeout(normalize,280);
    },{once:true});
  }else{
    setTimeout(normalize,120);
  }

  window.addEventListener('load',()=>{
    setTimeout(normalize,180);
    setTimeout(normalize,420);
  },{once:true});

  const observer=new MutationObserver(schedule);
  const start=()=>observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  if(document.body)start();
  else document.addEventListener('DOMContentLoaded',start,{once:true});
})();
