(()=>{
  if(window.__A4_PARTNERS_MODERN__)return;
  window.__A4_PARTNERS_MODERN__=true;

  const legacyLayoutKey='a4print-partners-layout-v1';
  const clearLegacyLayout=()=>{try{localStorage.removeItem(legacyLayoutKey)}catch{}};
  clearLegacyLayout();
  window.addEventListener('pageshow',clearLegacyLayout,{passive:true});

  function installOpenStyles(){
    if(document.getElementById('a4-partner-open-styles'))return;
    const style=document.createElement('style');
    style.id='a4-partner-open-styles';
    style.textContent=`
      #partners .partner.partner-openable{cursor:pointer;position:relative}
      #partners .partner.partner-openable:focus-visible{outline:3px solid rgba(37,99,235,.16);outline-offset:2px}
      #partners .partner.partner-openable .row>div:first-child>b{transition:color .16s ease}
      #partners .partner.partner-openable:hover .row>div:first-child>b{color:#1d4ed8!important}
      #partners .partner.partner-openable:after{content:'Открыть карточку →';display:block;margin-top:7px;color:#8a99ad;font-size:10px;font-weight:750}
      #resetLayout{display:none!important}
      .drag-handle{display:none!important}
      @media(max-width:760px){#partners .partner.partner-openable:after{margin-top:5px}}
    `;
    document.head.appendChild(style);
  }

  function wirePartnerRows(){
    installOpenStyles();
    document.querySelectorAll('#partners .partner').forEach(row=>{
      if(row.dataset.partnerOpenable==='1')return;
      const btn=row.querySelector('[data-toggle],[data-order-partner]');
      const id=btn?.dataset.toggle||btn?.dataset.orderPartner||'';
      if(!id)return;
      row.dataset.partnerOpenable='1';
      row.classList.add('partner-openable');
      row.tabIndex=0;
      row.setAttribute('role','link');
      row.setAttribute('aria-label','Открыть карточку партнёра');
      const open=()=>location.href=`./partner.html?id=${encodeURIComponent(id)}`;
      row.addEventListener('click',event=>{
        if(event.target.closest('button,a,input,textarea,select,label'))return;
        open();
      });
      row.addEventListener('keydown',event=>{
        if((event.key==='Enter'||event.key===' ')&&!event.target.closest('button,a,input,textarea,select')){
          event.preventDefault();open();
        }
      });
    });
  }

  function enhance(){
    const main=document.querySelector('.main');
    if(!main)return;
    clearLegacyLayout();
    document.body.classList.add('partners-modern');

    const legacyReset=document.getElementById('resetLayout');
    if(legacyReset){legacyReset.hidden=true;legacyReset.setAttribute('aria-hidden','true')}

    const cards=[...document.querySelectorAll('.grid article.card')];
    cards.forEach(card=>{
      card.draggable=false;
      card.removeAttribute('draggable');
      card.querySelectorAll('.drag-handle').forEach(x=>x.remove());
    });

    const partnerCard=document.querySelector('#partners')?.closest('article.card');
    if(partnerCard){
      partnerCard.classList.add('partners-database-card');
      const title=partnerCard.querySelector('h2');
      if(title&&!partnerCard.querySelector('.partners-card-kicker')){
        const kicker=document.createElement('div');
        kicker.className='partners-card-kicker';
        kicker.textContent='Контрагенты и исполнители';
        title.insertAdjacentElement('afterend',kicker);
      }
    }

    const createCard=document.querySelector('#partnerForm')?.closest('article.card');
    if(createCard){
      createCard.classList.add('partners-create-card');
      const title=createCard.querySelector('h2');
      if(title&&!createCard.querySelector('.partners-card-kicker')){
        const kicker=document.createElement('div');
        kicker.className='partners-card-kicker';
        kicker.textContent='Создание партнёра вручную и выдача доступа в Partner CRM';
        title.insertAdjacentElement('afterend',kicker);
      }
    }

    const outboundCard=document.querySelector('#outboundForm')?.closest('article.card');
    if(outboundCard){
      outboundCard.classList.add('partners-outbound-card');
      const title=outboundCard.querySelector('h2');
      if(title&&!outboundCard.querySelector('.partners-card-kicker')){
        const kicker=document.createElement('div');
        kicker.className='partners-card-kicker';
        kicker.textContent='Заказ услуг у выбранного партнёра по его прайсу';
        title.insertAdjacentElement('afterend',kicker);
      }
    }

    const servicesCard=document.querySelector('#services')?.closest('article.card');
    if(servicesCard)servicesCard.classList.add('partners-catalog-card');

    const inviteCard=document.querySelector('.partner-invite-card');
    if(inviteCard)inviteCard.classList.add('partners-invite-card-ready');
    wirePartnerRows();
  }

  let timer=0;
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(enhance,30)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});
  else schedule();
  const observer=new MutationObserver(schedule);
  const startObserver=()=>observer.observe(document.body,{childList:true,subtree:true});
  if(document.body)startObserver();else document.addEventListener('DOMContentLoaded',startObserver,{once:true});
  window.addEventListener('load',()=>setTimeout(enhance,180),{once:true});
})();
