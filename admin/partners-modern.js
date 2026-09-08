(()=>{
  if(window.__A4_PARTNERS_MODERN__)return;
  window.__A4_PARTNERS_MODERN__=true;

  function enhance(){
    const main=document.querySelector('.main');
    if(!main)return;
    document.body.classList.add('partners-modern');

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
  }

  let timer=0;
  const schedule=()=>{
    clearTimeout(timer);
    timer=setTimeout(enhance,30);
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});
  else schedule();

  const observer=new MutationObserver(schedule);
  const startObserver=()=>observer.observe(document.body,{childList:true,subtree:true});
  if(document.body)startObserver();
  else document.addEventListener('DOMContentLoaded',startObserver,{once:true});

  window.addEventListener('load',()=>setTimeout(enhance,180),{once:true});
})();