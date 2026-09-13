(()=>{
  'use strict';
  if(window.__A4_KASSA_CASH_DIALOG_SYNC__)return;
  window.__A4_KASSA_CASH_DIALOG_SYNC__=true;

  const money=value=>Number(value||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const automaticMessage=/Проверяем точный остаток|Не удалось получить точный остаток|Не удалось проверить остаток|Для изъятия сначала откройте смену|В кассе нет наличных для изъятия/;

  window.addEventListener('a4:kassa-cash-balance',event=>{
    const overlay=document.getElementById('cashOpOverlay');
    if(!overlay)return;
    const button=overlay.querySelector('#cashOpSubmit');
    const error=overlay.querySelector('#cashOpError');
    const balance=overlay.querySelector('.cashop-balance strong');
    if(!button||!error||!balance||/Провожу/.test(button.textContent||''))return;

    const detail=event.detail||{};
    const data=detail.data||{};
    const cash=Number(detail.cash);
    const available=Boolean(detail.available)&&Number.isFinite(cash);
    const shiftOpen=Boolean(data?.shift?.id);

    balance.textContent=available?money(cash):'—';
    if(!available){
      button.disabled=true;
      if(!error.textContent||automaticMessage.test(error.textContent))error.textContent='Не удалось получить точный остаток из МойСклад. Изъятие временно заблокировано.';
      return;
    }
    if(!shiftOpen){
      button.disabled=true;
      if(!error.textContent||automaticMessage.test(error.textContent))error.textContent='Для изъятия сначала откройте смену.';
      return;
    }
    if(cash<=0){
      button.disabled=true;
      if(!error.textContent||automaticMessage.test(error.textContent))error.textContent='В кассе нет наличных для изъятия.';
      return;
    }

    button.disabled=false;
    if(automaticMessage.test(error.textContent||''))error.textContent='';
  });
})();
