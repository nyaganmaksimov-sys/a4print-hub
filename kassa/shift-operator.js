(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const STORAGE_KEY='a4_kassa_selected_operator';
  const nativeFetch=window.fetch.bind(window);

  function selectedId(){
    const main=$('operatorSelect');
    if(main?.value)return main.value;
    try{return localStorage.getItem(STORAGE_KEY)||''}catch{return''}
  }

  function persist(id){try{if(id)localStorage.setItem(STORAGE_KEY,id)}catch{}}

  function copyOperatorOptions(){
    const main=$('operatorSelect'), shift=$('shiftOperatorSelect');
    if(!main||!shift)return;
    const saved=(()=>{try{return localStorage.getItem(STORAGE_KEY)||''}catch{return''}})();
    if(saved&&[...main.options].some(o=>o.value===saved)&&main.value!==saved){
      main.value=saved;
      main.dispatchEvent(new Event('change',{bubbles:true}));
    }
    const current=main.value;
    const html=[...main.options].map(o=>`<option value="${String(o.value).replace(/"/g,'&quot;')}">${o.textContent||''}</option>`).join('');
    if(shift.innerHTML!==html)shift.innerHTML=html;
    shift.value=current;
    shift.disabled=main.disabled||shift.options.length<=1;
    const hint=$('shiftOperatorHint');
    if(hint)hint.textContent=shift.options.length>1?'Выберите сотрудника, который работает за кассой':'Текущий сотрудник кассы';
    if(current)persist(current);
  }

  function applyShiftOperator(){
    const main=$('operatorSelect'), shift=$('shiftOperatorSelect');
    if(!main||!shift||!shift.value)return;
    if(main.value!==shift.value){
      main.value=shift.value;
      persist(shift.value);
      main.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }

  function ensureOperatorUi(){
    const view=$('shiftView');
    if(!view)return false;
    if(!$('shiftOperatorBar')){
      const style=document.createElement('style');
      style.textContent=`
        .shift-operator-bar{max-width:720px;margin:14px auto 0;padding:12px 16px;display:grid;grid-template-columns:minmax(150px,.7fr) minmax(260px,1.3fr);gap:12px;align-items:center;background:#fff;border:1px solid #d9e2ea;border-radius:10px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
        .shift-operator-label{display:flex;flex-direction:column;gap:2px}.shift-operator-label b{font-size:15px;color:#162033}.shift-operator-label span{font-size:12px;color:#7b8797}
        .shift-operator-select{width:100%;height:42px;border:1px solid #c9d5e1;border-radius:8px;background:#fff;color:#172033;padding:0 38px 0 12px;font-weight:600;outline:none}
        .shift-operator-select:focus{border-color:#10b8c5;box-shadow:0 0 0 3px rgba(16,184,197,.13)}
        .shift-operator-select:disabled{background:#f3f6f8;color:#7b8797}
        @media(max-width:720px){.shift-operator-bar{margin:10px 12px 0;grid-template-columns:1fr}.shift-operator-select{height:46px}}
      `;
      document.head.append(style);
      const bar=document.createElement('div');
      bar.id='shiftOperatorBar';
      bar.className='shift-operator-bar';
      bar.innerHTML='<div class="shift-operator-label"><b>Оператор кассы</b><span id="shiftOperatorHint">Выберите сотрудника, который работает за кассой</span></div><select id="shiftOperatorSelect" class="shift-operator-select" aria-label="Оператор кассы"></select>';
      view.querySelector('.shift-topline')?.insertAdjacentElement('afterend',bar);
      $('shiftOperatorSelect')?.addEventListener('change',applyShiftOperator);
    }
    copyOperatorOptions();
    return true;
  }

  function bindMainOperator(){
    const main=$('operatorSelect');
    if(!main||main.dataset.a4OperatorBound)return;
    main.dataset.a4OperatorBound='1';
    main.addEventListener('change',()=>{persist(main.value);copyOperatorOptions()});
    new MutationObserver(copyOperatorOptions).observe(main,{childList:true,subtree:true,attributes:true});
    copyOperatorOptions();
  }

  // Returns in the old module did not send the currently selected operator.
  // Inject only that field. The backend still uses the same single MoySklad cashier;
  // the operator is used for A4PRINT attribution and the MoySklad document comment.
  window.fetch=async function a4OperatorFetch(input,init){
    try{
      const url=new URL(input instanceof Request?input.url:String(input),location.href);
      const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
      if(method==='POST'&&url.pathname==='/api/v1/pos/returns'){
        const options={...(init||{})};
        let body=options.body;
        if(typeof body==='string'){
          const data=JSON.parse(body);
          const operatorId=selectedId();
          if(operatorId&&!data.operator_id){data.operator_id=operatorId;options.body=JSON.stringify(data)}
          return nativeFetch(input,options);
        }
      }
    }catch{}
    return nativeFetch(input,init);
  };

  function init(){
    bindMainOperator();
    ensureOperatorUi();
    const observer=new MutationObserver(()=>{bindMainOperator();ensureOperatorUi()});
    observer.observe(document.body,{childList:true,subtree:true});
    setInterval(()=>{bindMainOperator();if($('shiftView')&&!$('shiftView').hidden)ensureOperatorUi()},1500);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
